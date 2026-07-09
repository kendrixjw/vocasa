// Text annotation: geometry, drawing, and hit-testing. A note anchored at a
// world point, drawn as fixed-size text on a translucent pill (screen space,
// like room labels). Pure helpers — the entity is plain data.

import { worldToScreen, type Point, type Viewport } from "../viewport.ts";
import type { Annotation } from "./types.ts";

const TEXT_COLOR = "#1c1917"; // stone-900
const TEXT_COLOR_SELECTED = "#2563eb"; // blue-600
const FONT = "13px ui-sans-serif, system-ui, sans-serif";
const PAD_X = 6;
const BOX_H = 20; // screen px
const APPROX_CHAR_PX = 7; // for ctx-free hit-testing

export function createAnnotation(position: Point, text: string, rotation = 0): Annotation {
  return { id: crypto.randomUUID(), type: "annotation", position: { ...position }, text, rotation };
}

/** Approximate half-extents (screen px) of the note's clickable box. */
function halfExtentsPx(a: Annotation): { hx: number; hy: number } {
  const w = a.text.length * APPROX_CHAR_PX + PAD_X * 2;
  return { hx: Math.max(w, 12) / 2, hy: BOX_H / 2 };
}

/**
 * Hit-test against the note's screen box. `screen` is the pointer in screen px;
 * `vp` locates the note. Text is fixed-size, so hit-testing is done in screen
 * space (consistent with how it's drawn).
 */
export function hitTestAnnotation(a: Annotation, screen: Point, vp: Viewport): boolean {
  const s = worldToScreen(vp, a.position);
  const { hx, hy } = halfExtentsPx(a);
  return Math.abs(screen.x - s.x) <= hx && Math.abs(screen.y - s.y) <= hy;
}

export function drawAnnotation(
  ctx: CanvasRenderingContext2D,
  a: Annotation,
  vp: Viewport,
  opts: { selected?: boolean } = {},
): void {
  if (!a.text) return;
  const s = worldToScreen(vp, a.position);
  ctx.save();
  ctx.font = FONT;
  const w = ctx.measureText(a.text).width + PAD_X * 2;
  const h = BOX_H;
  ctx.beginPath();
  ctx.roundRect(s.x - w / 2, s.y - h / 2, w, h, 5);
  ctx.fillStyle = opts.selected ? "rgba(219,234,254,0.95)" : "rgba(255,255,255,0.88)";
  ctx.fill();
  if (opts.selected) {
    ctx.strokeStyle = TEXT_COLOR_SELECTED;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.fillStyle = opts.selected ? TEXT_COLOR_SELECTED : TEXT_COLOR;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(a.text, s.x, s.y + 0.5);
  ctx.restore();
}
