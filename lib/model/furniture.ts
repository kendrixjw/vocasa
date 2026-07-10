// Furniture geometry + rendering. Position is the block CENTER; rotation is CCW
// radians in world space. World math uses standard (Y-up) rotation; the draw
// path applies the inverse angle because the canvas Y axis points down.

import type { Bounds, Point, Viewport } from "../viewport.ts";
import { worldToScreen } from "../viewport.ts";
import type { Furniture } from "./types.ts";
import { furnitureDef } from "../furniture/library.ts";

export const MIN_FURNITURE_SIZE = 6; // inches

/** Create a furniture block of `kind` centered at `position`, using library
 *  default dimensions. Unknown kinds fall back to a 24x24 block. */
export function createFurniture(kind: string, position: Point, rotation = 0): Furniture {
  const def = furnitureDef(kind);
  return {
    id: crypto.randomUUID(),
    type: "furniture",
    kind,
    position: { ...position },
    rotation,
    w: def?.defaultW ?? 24,
    h: def?.defaultH ?? 24,
  };
}

function rotate(p: Point, ang: number): Point {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** Local (footprint) point -> world point. */
export function localToWorld(f: Furniture, local: Point): Point {
  const r = rotate(local, f.rotation);
  return { x: f.position.x + r.x, y: f.position.y + r.y };
}

/** World point -> local (footprint) coordinates. */
export function worldToLocal(f: Furniture, p: Point): Point {
  return rotate({ x: p.x - f.position.x, y: p.y - f.position.y }, -f.rotation);
}

/** The four world-space corners, in order TL, TR, BR, BL (local frame). */
export function corners(f: Furniture): Point[] {
  const hw = f.w / 2;
  const hh = f.h / 2;
  return [
    localToWorld(f, { x: -hw, y: -hh }),
    localToWorld(f, { x: hw, y: -hh }),
    localToWorld(f, { x: hw, y: hh }),
    localToWorld(f, { x: -hw, y: hh }),
  ];
}

/** Axis-aligned world bounds enclosing the (possibly rotated) block. */
export function furnitureBounds(f: Furniture): Bounds {
  const cs = corners(f);
  return {
    minX: Math.min(...cs.map((c) => c.x)),
    minY: Math.min(...cs.map((c) => c.y)),
    maxX: Math.max(...cs.map((c) => c.x)),
    maxY: Math.max(...cs.map((c) => c.y)),
  };
}

/** Half-extent of the footprint along a unit world direction `n`. */
export function halfExtentAlong(f: Furniture, n: Point): number {
  const ex = rotate({ x: 1, y: 0 }, f.rotation);
  const ey = rotate({ x: 0, y: 1 }, f.rotation);
  return (f.w / 2) * Math.abs(ex.x * n.x + ex.y * n.y) + (f.h / 2) * Math.abs(ey.x * n.x + ey.y * n.y);
}

/** True if world point `p` lies inside the block (plus tolerance). */
export function hitTestFurniture(f: Furniture, p: Point, tolInches = 0): boolean {
  const l = worldToLocal(f, p);
  return Math.abs(l.x) <= f.w / 2 + tolInches && Math.abs(l.y) <= f.h / 2 + tolInches;
}

export type FurnitureHandles = {
  corners: Point[]; // screen coords, order TL,TR,BR,BL
  rotate: Point; // screen coords of the rotate grip
};

/** Screen-space handle positions for the selection UI. */
export function furnitureHandles(f: Furniture, vp: Viewport): FurnitureHandles {
  const cs = corners(f).map((w) => worldToScreen(vp, w));
  const center = worldToScreen(vp, f.position);
  const topMid = { x: (cs[0].x + cs[1].x) / 2, y: (cs[0].y + cs[1].y) / 2 };
  // Push the rotate grip 26px outward from the top edge, away from center.
  const dx = topMid.x - center.x;
  const dy = topMid.y - center.y;
  const len = Math.hypot(dx, dy) || 1;
  const rotate = { x: topMid.x + (dx / len) * 26, y: topMid.y + (dy / len) * 26 };
  return { corners: cs, rotate };
}

export function drawFurniture(
  ctx: CanvasRenderingContext2D,
  f: Furniture,
  vp: Viewport,
  opts: { selected?: boolean; ghost?: boolean } = {},
): void {
  const def = furnitureDef(f.kind);
  const c = worldToScreen(vp, f.position);
  const hw = (f.w * vp.scale) / 2;
  const hh = (f.h * vp.scale) / 2;

  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(-f.rotation); // world CCW -> canvas (Y-down)
  if (f.flipX) ctx.scale(-1, 1); // mirror the icon within its own frame
  if (opts.ghost) ctx.globalAlpha = 0.55;
  if (def) {
    def.icon(ctx, hw, hh);
  } else {
    // Fallback: plain rounded block.
    ctx.beginPath();
    ctx.roundRect(-hw, -hh, hw * 2, hh * 2, 6);
    ctx.fillStyle = "#f5f5f4";
    ctx.fill();
    ctx.strokeStyle = "#a8a29e";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();

  if (opts.selected) {
    const cs = corners(f).map((w) => worldToScreen(vp, w));
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cs[0].x, cs[0].y);
    for (let i = 1; i < cs.length; i++) ctx.lineTo(cs[i].x, cs[i].y);
    ctx.closePath();
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}
