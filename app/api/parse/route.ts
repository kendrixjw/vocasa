// Server-side proxy to Anthropic. The API key lives only here (env var), never
// reaches the client. Takes { snapshot, transcript }, returns { ops } (a raw
// JSON array the client validates) or { clarify } / { error }. The model emits
// ONLY structured ops — never images, never coordinates it invented itself.

import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt, buildUserPrompt } from "@/lib/ai/prompt";

export const runtime = "nodejs";

type Body = { snapshot?: unknown; transcript?: unknown };

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

  const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
  if (!transcript) {
    return Response.json({ error: "Empty instruction." }, { status: 400 });
  }
  if (transcript.length > 2000) {
    return Response.json({ error: "Instruction is too long." }, { status: 400 });
  }

  const client = new Anthropic({ apiKey: key });

  try {
    const message = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 2048,
      system: buildSystemPrompt(),
      messages: [{ role: "user", content: buildUserPrompt(body.snapshot ?? {}, transcript) }],
    });

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    const parsed = extractJsonArray(text);
    if (parsed === null) {
      return Response.json({ clarify: "Sorry, I didn't catch that. Try rephrasing?" });
    }
    return Response.json({ ops: parsed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI request failed.";
    return Response.json({ error: msg }, { status: 502 });
  }
}

/** Pull a JSON array out of the model text, tolerating stray code fences. */
function extractJsonArray(text: string): unknown[] | null {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const v = JSON.parse(s.slice(start, end + 1));
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
