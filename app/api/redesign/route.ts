// Premium redesign proxy (paid, metered image-to-image).
//
// Flow: authenticate the user -> reserve a render slot server-side (free
// allowance or a paid credit, decided atomically in Postgres) -> call the
// image model through the Vercel AI Gateway with the uploaded photo -> finalize
// the render with its result, or refund the credit if generation failed. The
// client can NEVER mint free renders or spend someone else's credits: all
// accounting is server-side and tied to the session user.

import { generateText } from "ai";
import { put } from "@vercel/blob";
import { getSupabaseServerClient } from "@/lib/supabase/server.ts";
import { buildRedesignPrompt, type RedesignModule } from "@/lib/ai/redesignPrompt.ts";

export const runtime = "nodejs";

function blobConfigured(): boolean {
  return !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_OIDC_TOKEN);
}

// Save the render and return what to persist in renders.result_url: a private
// Blob pathname, or an inline data URL when Blob isn't configured.
async function storeRender(
  userId: string,
  renderId: string,
  base64: string,
  mediaType: string,
): Promise<string> {
  if (!blobConfigured()) {
    return `data:${mediaType};base64,${base64}`;
  }
  const ext = mediaType.split("/")[1] || "png";
  const pathname = `renders/${userId}/${renderId}.${ext}`;
  const bytes = Buffer.from(base64, "base64");
  const blob = await put(pathname, bytes, { access: "private", contentType: mediaType });
  return blob.pathname;
}

// Multimodal image model that accepts an input photo and returns a restyled
// image (image-to-image), routed through the AI Gateway.
const IMAGE_MODEL = "google/gemini-3.1-flash-image-preview";

// Rough per-render COGS estimate (cents) recorded for margin reporting. Replace
// with the gateway's reported cost once wired to usage.
const RENDER_COST_CENTS = 4;

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);
const MODULES = new Set<RedesignModule>(["design", "landscaping"]);

type Body = { module?: unknown; style?: unknown; image?: unknown; mediaType?: unknown };

export async function POST(req: Request): Promise<Response> {
  // Gateway auth is provided by VERCEL_OIDC_TOKEN (after `vercel env pull`) or
  // AI_GATEWAY_API_KEY. Fail clearly if neither is present.
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    return Response.json(
      { error: "Renders aren't configured on this server yet." },
      { status: 503 },
    );
  }

  const supabase = await getSupabaseServerClient();
  if (!supabase) {
    return Response.json({ error: "Sign-in is required for renders." }, { status: 401 });
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Please sign in to generate renders." }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const module = body.module as RedesignModule;
  if (!MODULES.has(module)) {
    return Response.json({ error: "Unknown redesign module." }, { status: 400 });
  }
  const style = typeof body.style === "string" ? body.style.slice(0, 400) : "";
  const image = typeof body.image === "string" ? body.image : "";
  const mediaType = typeof body.mediaType === "string" ? body.mediaType : "";
  if (!image || !ALLOWED.has(mediaType)) {
    return Response.json({ error: "Attach a JPEG, PNG, or WEBP photo." }, { status: 400 });
  }
  if (image.length > 8_000_000) {
    return Response.json({ error: "That image is too large. Try one under 5 MB." }, { status: 413 });
  }

  // Reserve a slot BEFORE spending money on the model call.
  const reservation = await supabase.rpc("reserve_render", { p_module: module });
  if (reservation.error) {
    const msg = reservation.error.message || "";
    if (msg.includes("insufficient_credits")) {
      return Response.json(
        { error: "You're out of free renders and credits for this module.", code: "insufficient_credits" },
        { status: 402 },
      );
    }
    return Response.json({ error: "Couldn't start a render. Try again." }, { status: 500 });
  }
  const row = Array.isArray(reservation.data) ? reservation.data[0] : reservation.data;
  const renderId: string | undefined = row?.render_id;
  const source: string | undefined = row?.source;
  if (!renderId) {
    return Response.json({ error: "Couldn't start a render. Try again." }, { status: 500 });
  }

  try {
    const result = await generateText({
      model: IMAGE_MODEL,
      providerOptions: { gateway: { user: user.id, tags: [`feature:redesign:${module}`] } },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: buildRedesignPrompt(module, style) },
            { type: "image", image: `data:${mediaType};base64,${image}` },
          ],
        },
      ],
    });

    const file = result.files.find((f) => f.mediaType?.startsWith("image/"));
    if (!file) {
      await supabase.rpc("fail_render", { p_render_id: renderId });
      return Response.json({ error: "The model didn't return an image. Try again." }, { status: 502 });
    }

    // Persist the render. Preferred: private Vercel Blob (store the pathname).
    // Fallback when Blob isn't configured: an inline data URL, so the feature
    // still works locally. Either way it's served through /api/renders/[id].
    const outType = file.mediaType ?? "image/png";
    const stored = await storeRender(user.id, renderId, file.base64, outType);

    const fin = await supabase.rpc("finalize_render", {
      p_render_id: renderId,
      p_result_url: stored,
      p_style: style,
      p_cost_cents: RENDER_COST_CENTS,
    });
    if (fin.error) {
      return Response.json({ error: "Render saved but couldn't be recorded. Try again." }, { status: 500 });
    }
    return Response.json({ render: { id: renderId, url: `/api/renders/${renderId}`, source } });
  } catch (err) {
    await supabase.rpc("fail_render", { p_render_id: renderId });
    const status = typeof (err as { statusCode?: number })?.statusCode === "number"
      ? (err as { statusCode: number }).statusCode
      : 502;
    const msg = err instanceof Error ? err.message : "Render failed.";
    return Response.json({ error: msg }, { status: status === 429 ? 429 : 502 });
  }
}
