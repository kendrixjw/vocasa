// Doors & windows: geometry (all derived from the host wall + offset) and
// rendering. They cut a gap in the wall and draw a symbol in it — a swing arc
// for doors, glass lines for windows.

import type { Point, Viewport } from "../viewport.ts";
import { worldToScreen } from "../viewport.ts";
import type { Door, Document, Opening, Wall, Window } from "./types.ts";

export const DEFAULT_DOOR_WIDTH = 32;
export const DEFAULT_WINDOW_WIDTH = 36;

// Must match the canvas background so the "gap" reads as an opening.
const BG = "#fafaf9";
const JAMB = "#57534e";
const DOOR_LEAF = "#57534e";
const GLASS = "#60a5fa"; // blue-400
const SELECTED = "#2563eb";

export function findWall(doc: Document, wallId: string): Wall | undefined {
  const e = doc.entities.find((x) => x.id === wallId);
  return e && e.type === "wall" ? e : undefined;
}

export function createDoor(wallId: string, offset: number, width = DEFAULT_DOOR_WIDTH): Door {
  return { id: crypto.randomUUID(), type: "door", wallId, offset, width, swing: "in" };
}

export function createWindow(wallId: string, offset: number, width = DEFAULT_WINDOW_WIDTH): Window {
  return { id: crypto.randomUUID(), type: "window", wallId, offset, width };
}

export type OpeningFrame = {
  center: Point;
  dir: Point; // unit vector a->b
  normal: Point; // unit vector, left of dir
  wallLen: number;
};

export function wallLength(wall: Wall): number {
  return Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
}

/** Clamp an offset so the opening fits within the wall (centered if too long). */
export function clampOffset(wall: Wall, width: number, offset: number): number {
  const len = wallLength(wall);
  if (len <= width) return len / 2;
  return Math.max(width / 2, Math.min(len - width / 2, offset));
}

export function openingFrame(wall: Wall, offset: number): OpeningFrame {
  const abx = wall.b.x - wall.a.x;
  const aby = wall.b.y - wall.a.y;
  const len = Math.hypot(abx, aby) || 1;
  const dir = { x: abx / len, y: aby / len };
  const normal = { x: -dir.y, y: dir.x };
  return {
    center: { x: wall.a.x + dir.x * offset, y: wall.a.y + dir.y * offset },
    dir,
    normal,
    wallLen: len,
  };
}

/** Offset (inches along wall from a) for the projection of world point p. */
export function projectOffset(wall: Wall, p: Point): number {
  const abx = wall.b.x - wall.a.x;
  const aby = wall.b.y - wall.a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return 0;
  return ((p.x - wall.a.x) * abx + (p.y - wall.a.y) * aby) / Math.sqrt(len2);
}

/** True if world point p is within the opening's footprint (plus tolerance). */
export function hitTestOpening(op: Opening, wall: Wall, p: Point, tolInches = 0): boolean {
  const f = openingFrame(wall, clampOffset(wall, op.width, op.offset));
  const rel = { x: p.x - f.center.x, y: p.y - f.center.y };
  const along = rel.x * f.dir.x + rel.y * f.dir.y;
  const across = rel.x * f.normal.x + rel.y * f.normal.y;
  return Math.abs(along) <= op.width / 2 + tolInches && Math.abs(across) <= wall.thickness / 2 + tolInches;
}

function addScaled(p: Point, v: Point, s: number): Point {
  return { x: p.x + v.x * s, y: p.y + v.y * s };
}

/** Hinge point + swept leaf endpoints for a door's swing symbol. */
function doorSwing(door: Door, f: OpeningFrame, thickness: number): {
  hinge: Point;
  closed: Point;
  open: Point;
} {
  const half = door.width / 2;
  const startEnd = addScaled(f.center, f.dir, -half); // a-side jamb
  const endEnd = addScaled(f.center, f.dir, half); // b-side jamb
  const hingeAtEnd = door.swing === "right";
  const hinge = hingeAtEnd ? endEnd : startEnd;
  const other = hingeAtEnd ? startEnd : endEnd;
  const openSign = door.swing === "in" ? -1 : 1; // which side of the wall
  const closed = other; // leaf lies along the wall when shut
  const open = addScaled(hinge, f.normal, openSign * door.width);
  void thickness;
  return { hinge, closed, open };
}

function fillGap(ctx: CanvasRenderingContext2D, op: Opening, wall: Wall, f: OpeningFrame, vp: Viewport) {
  const half = op.width / 2;
  const t = wall.thickness / 2;
  const quad = [
    addScaled(addScaled(f.center, f.dir, -half), f.normal, -t),
    addScaled(addScaled(f.center, f.dir, half), f.normal, -t),
    addScaled(addScaled(f.center, f.dir, half), f.normal, t),
    addScaled(addScaled(f.center, f.dir, -half), f.normal, t),
  ].map((w) => worldToScreen(vp, w));
  ctx.beginPath();
  ctx.moveTo(quad[0].x, quad[0].y);
  for (let i = 1; i < quad.length; i++) ctx.lineTo(quad[i].x, quad[i].y);
  ctx.closePath();
  ctx.fillStyle = BG;
  ctx.fill();
}

function strokeWorld(ctx: CanvasRenderingContext2D, a: Point, b: Point, vp: Viewport, color: string, lw: number) {
  const s1 = worldToScreen(vp, a);
  const s2 = worldToScreen(vp, b);
  ctx.beginPath();
  ctx.moveTo(s1.x, s1.y);
  ctx.lineTo(s2.x, s2.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.stroke();
}

export function drawOpening(
  ctx: CanvasRenderingContext2D,
  op: Opening,
  wall: Wall,
  vp: Viewport,
  opts: { selected?: boolean } = {},
): void {
  const offset = clampOffset(wall, op.width, op.offset);
  const f = openingFrame(wall, offset);
  const half = op.width / 2;
  const t = wall.thickness / 2;

  fillGap(ctx, op, wall, f, vp);

  // Jamb ticks at both ends (span the wall thickness).
  const startTop = addScaled(addScaled(f.center, f.dir, -half), f.normal, -t);
  const startBot = addScaled(addScaled(f.center, f.dir, -half), f.normal, t);
  const endTop = addScaled(addScaled(f.center, f.dir, half), f.normal, -t);
  const endBot = addScaled(addScaled(f.center, f.dir, half), f.normal, t);
  strokeWorld(ctx, startTop, startBot, vp, JAMB, 2);
  strokeWorld(ctx, endTop, endBot, vp, JAMB, 2);

  if (op.type === "door") {
    const s = doorSwing(op, f, wall.thickness);
    // Leaf (open position) + swing arc from open to closed.
    strokeWorld(ctx, s.hinge, s.open, vp, DOOR_LEAF, 2);
    const hinge = worldToScreen(vp, s.hinge);
    const closed = worldToScreen(vp, s.closed);
    const open = worldToScreen(vp, s.open);
    const r = Math.hypot(open.x - hinge.x, open.y - hinge.y);
    const a0 = Math.atan2(open.y - hinge.y, open.x - hinge.x);
    const a1 = Math.atan2(closed.y - hinge.y, closed.x - hinge.x);
    ctx.beginPath();
    ctx.arc(hinge.x, hinge.y, r, a0, a1, angleShouldReverse(a0, a1));
    ctx.strokeStyle = DOOR_LEAF;
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    // Window: two face lines across the gap + a center glass line.
    const c0 = addScaled(f.center, f.dir, -half);
    const c1 = addScaled(f.center, f.dir, half);
    strokeWorld(ctx, addScaled(c0, f.normal, -t), addScaled(c1, f.normal, -t), vp, JAMB, 1.5);
    strokeWorld(ctx, addScaled(c0, f.normal, t), addScaled(c1, f.normal, t), vp, JAMB, 1.5);
    strokeWorld(ctx, c0, c1, vp, GLASS, 2);
  }

  if (opts.selected) {
    ctx.save();
    ctx.beginPath();
    const q = [startTop, endTop, endBot, startBot].map((w) => worldToScreen(vp, w));
    ctx.moveTo(q[0].x, q[0].y);
    for (let i = 1; i < q.length; i++) ctx.lineTo(q[i].x, q[i].y);
    ctx.closePath();
    ctx.strokeStyle = SELECTED;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}

// Choose the shorter arc direction between two angles.
function angleShouldReverse(a0: number, a1: number): boolean {
  let d = a1 - a0;
  while (d <= -Math.PI) d += Math.PI * 2;
  while (d > Math.PI) d -= Math.PI * 2;
  return d < 0;
}
