// Server-side vision proxy (Phase 16). Accepts a base64 image + media type,
// sends it to a vision-capable Claude model with the floorplan prompt, and
// returns { ops } (a raw JSON array the client validates). The AI never returns
// an image - only structured ops. Key stays server-side.

import Anthropic from "@anthropic-ai/sdk";
import { buildPhotoSystemPrompt } from "@/lib/ai/photoPrompt";

export const runtime = "nodejs";

type Body = { image?: unknown; mediaType?: unknown };

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

  const image = typeof body.image === "string" ? body.image : "";
  const mediaType = typeof body.mediaType === "string" ? body.mediaType : "";
  if (!image) return Response.json({ error: "No image provided." }, { status: 400 });
  if (!ALLOWED.has(mediaType)) {
    return Response.json({ error: "Unsupported image type. Use PNG, JPEG, WEBP, or GIF." }, { status: 400 });
  }
  // Guard against oversized payloads (base64 of ~5MB image).
  if (image.length > 8_000_000) {
    return Response.json({ error: "That image is too large. Try one under 5 MB." }, { status: 413 });
  }

  const client = new Anthropic({ apiKey: key });

  try {
    const message = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system: buildPhotoSystemPrompt(),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType as "image/png", data: image },
            },
            { type: "text", text: "Reconstruct this floorplan as a JSON array of operations." },
          ],
        },
      ],
    });

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    const parsed = extractJsonArray(text);
    if (parsed === null) {
      return Response.json({ ops: [] });
    }
    return Response.json({ ops: parsed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI request failed.";
    return Response.json({ error: msg }, { status: 502 });
  }
}

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
