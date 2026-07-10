// Serve a completed redesign render to its owner. Renders live in PRIVATE Blob
// storage (or, as a fallback, inline in the DB), so they can't be linked
// directly from the browser — this route authorizes via the renders table (RLS
// scopes the row to the signed-in user) and streams the image back.

import { get } from "@vercel/blob";
import { getSupabaseServerClient } from "@/lib/supabase/server.ts";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  const supabase = await getSupabaseServerClient();
  const {
    data: { user } = { user: null },
  } = (await supabase?.auth.getUser()) ?? { data: { user: null } };
  if (!supabase || !user) {
    return new Response("Sign in to view renders.", { status: 401 });
  }

  // RLS ensures this only returns the caller's own render.
  const { data: row, error } = await supabase
    .from("renders")
    .select("result_url, status")
    .eq("id", id)
    .maybeSingle();
  if (error || !row || row.status !== "complete" || !row.result_url) {
    return new Response("Not found.", { status: 404 });
  }

  const stored = row.result_url as string;

  // Fallback path: the render was saved inline as a data URL.
  if (stored.startsWith("data:")) {
    const comma = stored.indexOf(",");
    const meta = stored.slice(5, comma); // e.g. image/png;base64
    const contentType = meta.split(";")[0] || "image/png";
    const bytes = Buffer.from(stored.slice(comma + 1), "base64");
    return new Response(bytes, {
      headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=3600" },
    });
  }

  // Normal path: stream from private Blob.
  try {
    const blob = await get(stored, { access: "private" });
    if (!blob || blob.statusCode !== 200) {
      return new Response("Not found.", { status: 404 });
    }
    return new Response(blob.stream, {
      headers: {
        "Content-Type": blob.blob.contentType || "image/png",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response("Couldn't load the render.", { status: 502 });
  }
}
