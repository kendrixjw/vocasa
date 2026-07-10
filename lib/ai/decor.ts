// Client-side decor suggestions: snapshot (+ style, + optional photo) ->
// POST /api/decor -> validated scheme. Furnishing ideas become retailer SEARCH
// links built locally from the item text (honest: a search, never a fabricated
// product URL).

import type { Editor } from "../editor.ts";
import { buildSnapshot } from "./snapshot.ts";
import { fileToBase64 } from "./photoImport.ts";

export type Swatch = { name: string; hex: string };
export type NamedNote = { name: string; note: string };
export type DecorScheme = {
  style: string;
  palette: Swatch[];
  materials: NamedNote[];
  items: NamedNote[];
};

export type DecorResult =
  | { kind: "scheme"; scheme: DecorScheme }
  | { kind: "error"; message: string };

const HEX = /^#[0-9a-fA-F]{6}$/;

function str(v: unknown, max = 120): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function normalizeDecor(raw: unknown): DecorScheme {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const palette: Swatch[] = Array.isArray(o.palette)
    ? o.palette
        .map((s) => {
          const e = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
          const hex = str(e.hex, 7);
          return { name: str(e.name), hex: HEX.test(hex) ? hex.toLowerCase() : "" };
        })
        .filter((s) => s.name && s.hex)
        .slice(0, 8)
    : [];
  const pairs = (v: unknown): NamedNote[] =>
    Array.isArray(v)
      ? v
          .map((s) => {
            const e = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
            return { name: str(e.name), note: str(e.note, 200) };
          })
          .filter((s) => s.name)
          .slice(0, 8)
      : [];
  return {
    style: str(o.style, 200),
    palette,
    materials: pairs(o.materials),
    items: pairs(o.items),
  };
}

/** A retailer/Google Shopping SEARCH link for a furnishing idea (not a product page). */
export function searchUrl(item: string): string {
  return `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(item)}`;
}

export async function requestDecor(editor: Editor, style: string, file: File | null): Promise<DecorResult> {
  const snapshot = buildSnapshot(editor.doc, editor.aiCursor, editor.selectionIds);

  let image: string | undefined;
  let mediaType: string | undefined;
  if (file) {
    try {
      const payload = await fileToBase64(file);
      image = payload.data;
      mediaType = payload.mediaType;
    } catch {
      return { kind: "error", message: "Couldn't read that image." };
    }
  }

  let res: Response;
  try {
    res = await fetch("/api/decor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot, style, image, mediaType }),
    });
  } catch {
    return { kind: "error", message: "Couldn't reach the server." };
  }

  let data: { decor?: unknown; error?: string };
  try {
    data = await res.json();
  } catch {
    return { kind: "error", message: "The server returned an unexpected response." };
  }
  if (data.error) return { kind: "error", message: data.error };

  const scheme = normalizeDecor(data.decor);
  if (scheme.palette.length === 0 && scheme.materials.length === 0 && scheme.items.length === 0) {
    return { kind: "error", message: "I couldn't put together a scheme. Try a clearer style hint." };
  }
  return { kind: "scheme", scheme };
}
