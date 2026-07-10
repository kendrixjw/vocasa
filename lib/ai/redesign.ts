// Client-side redesign renders: a real photo (+ style) for a module ->
// POST /api/redesign -> a photorealistic restyled image, metered server-side.
// The result is an inspirational data-URL image, NOT editable geometry.

import { fileToBase64 } from "./photoImport.ts";
import type { RedesignModule } from "./redesignPrompt.ts";

export type RenderResult =
  | { kind: "render"; id: string; url: string; source: "free" | "credit" }
  | { kind: "error"; message: string; code?: "insufficient_credits" };

export async function requestRedesign(
  module: RedesignModule,
  style: string,
  file: File,
): Promise<RenderResult> {
  let payload: { data: string; mediaType: string };
  try {
    payload = await fileToBase64(file);
  } catch {
    return { kind: "error", message: "Couldn't read that photo." };
  }

  let res: Response;
  try {
    res = await fetch("/api/redesign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ module, style, image: payload.data, mediaType: payload.mediaType }),
    });
  } catch {
    return { kind: "error", message: "Couldn't reach the server." };
  }

  let data: { render?: { id?: string; url?: string; source?: string }; error?: string; code?: string };
  try {
    data = await res.json();
  } catch {
    return { kind: "error", message: "The server returned an unexpected response." };
  }

  if (data.error || !data.render?.url || !data.render.id) {
    return {
      kind: "error",
      message: data.error ?? "The render didn't come through. Try again.",
      code: data.code === "insufficient_credits" ? "insufficient_credits" : undefined,
    };
  }
  return {
    kind: "render",
    id: data.render.id,
    url: data.render.url,
    source: data.render.source === "credit" ? "credit" : "free",
  };
}
