// Server-side design-assist proxy. Sends the current plan + a design-principles
// prompt to Claude and returns { notes, ops? }. `notes` is plain-English advice;
// `ops` (optional) is a PROPOSED batch the client previews — never auto-applied.
// The API key stays server-side only.

import Anthropic from "@anthropic-ai/sdk";
import { buildAssistSystemPrompt, buildAssistUserPrompt } from "@/lib/ai/prompt";

export const runtime = "nodejs";

type Body = { snapshot?: unknown; request?: unknown };

export async function POST(req: Request): Promise<Response> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return Response.json({ error: "Server is missing ANTHROPIC_API_KEY." }, { status: 500 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const request = typeof body.request === "string" ? body.request.slice(0, 2000) : "";
  const client = new Anthropic({ apiKey: key });

  try {
    const message = await client.messages.create({
      model: "claude-opus-4-8",
      // Adaptive thinking spends part of this budget before the JSON is written,
      // and a response can carry both notes and a proposed op batch — keep ample
      // room so it isn't truncated mid-object (which would fail to parse).
      max_tokens: 8192,
      thinking: { type: "adaptive" },
      system: buildAssistSystemPrompt(),
      messages: [{ role: "user", content: buildAssistUserPrompt(body.snapshot ?? {}, request) }],
    });

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    const obj = extractJsonObject(text);
    if (!obj || typeof obj.notes !== "string") {
      const notes =
        message.stop_reason === "max_tokens"
          ? "That was a lot to analyze at once — try asking about one area at a time."
          : "I couldn't analyze the layout just now — try again in a moment.";
      return Response.json({ notes });
    }
    return Response.json({ notes: obj.notes, ops: Array.isArray(obj.ops) ? obj.ops : [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI request failed.";
    return Response.json({ error: msg }, { status: 502 });
  }
}

/** Pull the first JSON object out of the model text, tolerating stray code fences. */
function extractJsonObject(text: string): { notes?: unknown; ops?: unknown } | null {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}
