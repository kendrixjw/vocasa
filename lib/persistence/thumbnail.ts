// Render the current plan to a small PNG data URL for the dashboard, using the
// editor's overlay-free thumbnail render path.
"use client";

import type { Editor } from "../editor.ts";

export function makeThumbnail(editor: Editor, width = 320, height = 200): string | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  try {
    editor.renderThumbnail(ctx, width, height, 1);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
