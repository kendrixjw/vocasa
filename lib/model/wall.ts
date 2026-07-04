// Wall helpers: construction, geometry, hit-testing, bounds, and rendering.
// Behavior lives here (not on the entity) so walls stay serializable.

import type { Bounds, Point, Viewport } from "../viewport.ts";
import { worldToScreen } from "../viewport.ts";
import type { Wall } from "./types.ts";

// A typical interior partition is ~4.5"; use 5" as a friendly default.
export const DEFAULT_WALL_THICKNESS = 5;

const WALL_COLOR = "#57534e"; // stone-600 — solid but not harsh
const WALL_SELECTED = "#2563eb"; // blue-600

export function createWall(a: Point, b: Point, thickness = DEFAULT_WALL_THICKNESS): Wall {
  return { id: crypto.randomUUID(), type: "wall", a: { ...a }, b: { ...b }, thickness };
}

export function wallLength(w: Wall): number {
  return Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
}

export function wallEndpoints(w: Wall): Point[] {
  return [w.a, w.b];
}

/** Axis-aligned world bounds including wall half-thickness. */
export function wallBounds(w: Wall): Bounds {
  const h = w.thickness / 2;
  return {
    minX: Math.min(w.a.x, w.b.x) - h,
    minY: Math.min(w.a.y, w.b.y) - h,
    maxX: Math.max(w.a.x, w.b.x) + h,
    maxY: Math.max(w.a.y, w.b.y) + h,
  };
}

/** Shortest distance (world inches) from a point to the wall's centerline segment. */
export function distanceToWall(w: Wall, p: Point): number {
  const { a, b } = w;
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * abx;
  const cy = a.y + t * aby;
  return Math.hypot(p.x - cx, p.y - cy);
}

/** True if `p` is within the wall body (plus tolerance), for click selection. */
export function hitTestWall(w: Wall, p: Point, tolInches: number): boolean {
  return distanceToWall(w, p) <= w.thickness / 2 + tolInches;
}

/**
 * Draw a wall as a solid, round-capped band. Equal-thickness walls sharing an
 * endpoint visually join because of the round caps — this is the "auto-join"
 * look. Width is in screen pixels (thickness * scale) so it stays true to size,
 * with a small floor so thin walls remain visible when zoomed way out.
 */
export function drawWall(
  ctx: CanvasRenderingContext2D,
  w: Wall,
  vp: Viewport,
  opts: { selected?: boolean } = {},
): void {
  const a = worldToScreen(vp, w.a);
  const b = worldToScreen(vp, w.b);
  const widthPx = Math.max(w.thickness * vp.scale, 1.5);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (opts.selected) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = WALL_SELECTED;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = widthPx + 6;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = WALL_COLOR;
  ctx.lineWidth = widthPx;
  ctx.stroke();
}
