// Server-side decor-suggestion proxy. Sends the plan snapshot + a style
// direction (and optional style-reference image) to Claude and returns a
// structured { decor } scheme. Text-based suggestions only - never image
// renders. The API key stays server-side.

import Anthropic from "@anthropic-ai/sdk";
import { buildDecorSystemPrompt, buildDecorUserPrompt } from "@/lib/ai/decorPrompt";

export const runtime = "nodejs";

type Body = { snapshot?: unknown; style?: unknown; image?: unknown; mediaType?: unknown };

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

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

  const style = typeof body.style === "string" ? body.style.slice(0, 400) : "";
  const image = typeof body.image === "string" ? body.image : "";
  const mediaType = typeof body.mediaType === "string" ? body.mediaType : "";
  const hasImage = image.length > 0 && ALLOWED.has(mediaType);
  if (image.length > 8_000_000) {
    return Response.json({ error: "That image is too large. Try one under 5 MB." }, { status: 413 });
  }

  const userText = buildDecorUserPrompt(body.snapshot ?? {}, style, hasImage);
  const content: Anthropic.ContentBlockParam[] = [];
  if (hasImage) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: mediaType as "image/png", data: image },
    });
  }
  content.push({ type: "text", text: userText });

  const client = new Anthropic({ apiKey: key });
  try {
    const message = await client.messages.create({
      model: "claude-opus-4-8",
      // Adaptive thinking spends part of this budget before the JSON is written,
      // and a full scheme (palette + materials + items) is sizable — keep ample
      // room so it isn't truncated mid-object (which would fail to parse).
      max_tokens: 8192,
      thinking: { type: "adaptive" },
      system: buildDecorSystemPrompt(),
      messages: [{ role: "user", content }],
    });

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    const obj = extractJsonObject(text);
    if (!obj) {
      const error =
        message.stop_reason === "max_tokens"
          ? "That scheme got too long to finish - try a more focused style hint."
          : "I couldn't put together a scheme just now - try again.";
      return Response.json({ error }, { status: 502 });
    }
    return Response.json({ decor: obj });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI request failed.";
    return Response.json({ error: msg }, { status: 502 });
  }
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const v = JSON.parse(s.slice(start, end + 1));
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
