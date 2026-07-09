// Dimension line: geometry, drawing, and hit-testing. A dimension measures the
// straight-line distance between two world points, drawn with end ticks and a
// centered ft-in label. Pure helpers — the entity is plain data.

import { worldToScreen, type Point, type Viewport } from "../viewport.ts";
import { formatFeetInches } from "../units.ts";
import type { Dimension } from "./types.ts";

const LINE_COLOR = "#0f766e"; // teal-700
const LINE_COLOR_SELECTED = "#2563eb"; // blue-600
const TICK_PX = 6; // half-length of the end ticks, screen px

export function createDimension(from: Point, to: Point, offset = 0): Dimension {
  return { id: crypto.randomUUID(), type: "dimension", from: { ...from }, to: { ...to }, offset };
}

/** Length of the measured span in world inches. */
export function dimensionLength(d: Dimension): number {
  return Math.hypot(d.to.x - d.from.x, d.to.y - d.from.y);
}

/** The two endpoints after applying the perpendicular `offset` (world inches). */
function offsetEnds(d: Dimension): { a: Point; b: Point } {
  const dx = d.to.x - d.from.x;
  const dy = d.to.y - d.from.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len; // unit normal
  const ny = dx / len;
  const ox = nx * d.offset;
  const oy = ny * d.offset;
  return {
    a: { x: d.from.x + ox, y: d.from.y + oy },
    b: { x: d.to.x + ox, y: d.to.y + oy },
  };
}

/** Distance (world inches) from point `p` to the (offset) dimension line. */
export function distanceToDimension(d: Dimension, p: Point): number {
  const { a, b } = offsetEnds(d);
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

export function hitTestDimension(d: Dimension, p: Point, tol: number): boolean {
  return distanceToDimension(d, p) <= tol;
}

export function drawDimension(
  ctx: CanvasRenderingContext2D,
  d: Dimension,
  vp: Viewport,
  opts: { selected?: boolean } = {},
): void {
  const { a, b } = offsetEnds(d);
  const sa = worldToScreen(vp, a);
  const sb = worldToScreen(vp, b);
  const dx = sb.x - sa.x;
  const dy = sb.y - sa.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;

  ctx.save();
  ctx.strokeStyle = opts.selected ? LINE_COLOR_SELECTED : LINE_COLOR;
  ctx.lineWidth = opts.selected ? 2 : 1.5;

  // Main line.
  ctx.beginPath();
  ctx.moveTo(sa.x, sa.y);
  ctx.lineTo(sb.x, sb.y);
  ctx.stroke();

  // End ticks (perpendicular).
  for (const s of [sa, sb]) {
    ctx.beginPath();
    ctx.moveTo(s.x - nx * TICK_PX, s.y - ny * TICK_PX);
    ctx.lineTo(s.x + nx * TICK_PX, s.y + ny * TICK_PX);
    ctx.stroke();
  }

  // Centered ft-in label on a small pill so it stays readable over the line.
  const mid = { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 };
  const text = formatFeetInches(dimensionLength(d));
  ctx.font = "12px ui-monospace, monospace";
  const padX = 5;
  const w = ctx.measureText(text).width + padX * 2;
  const h = 16;
  ctx.beginPath();
  ctx.roundRect(mid.x - w / 2, mid.y - h / 2, w, h, 5);
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fill();
  ctx.fillStyle = opts.selected ? LINE_COLOR_SELECTED : LINE_COLOR;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, mid.x, mid.y + 0.5);
  ctx.restore();
}
