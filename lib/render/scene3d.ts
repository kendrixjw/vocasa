// Document -> 3D scene description.
//
// Pure geometry: no three.js, no React. It emits plan-space data (inches, Y-up,
// same frame as the 2D canvas) plus heights; the R3F component maps that onto
// three's axes. Keeping the mapping out of here means the whole scene build is
// unit-testable without a WebGL context.
//
// The one genuinely interesting bit is openings. Doors and windows are anchored
// to a wall by offset, so we can cut REAL holes: a wall becomes a list of
// sub-segments, each with its own vertical span — full height where it's solid,
// a header above a door, a sill below and a header above a window.

import type { Entity, Furniture, Opening, Room, Wall } from "../model/types.ts";
import type { Point } from "../viewport.ts";

/** Inches. 9ft ceilings, standard door and window heights. */
export const WALL_HEIGHT = 108;
export const DOOR_HEIGHT = 80;
export const WINDOW_SILL = 36;
export const WINDOW_TOP = 72;
/** Camera eye height for the first-person walkthrough. */
export const EYE_HEIGHT = 66;

/** A drawable chunk of wall: a segment in plan, spanning [base, top] vertically. */
export type WallSlab = {
  a: Point;
  b: Point;
  thickness: number;
  base: number;
  top: number;
};

export type FloorSlab = {
  /** Room outline in plan space, in order. */
  poly: Point[];
  name: string;
};

export type FurnitureBlock = {
  id: string;
  kind: string;
  /** Center, plan space. */
  position: Point;
  rotation: number; // radians CCW
  w: number;
  h: number;
  height: number; // inches tall
};

export type Scene3D = {
  walls: WallSlab[];
  floors: FloorSlab[];
  furniture: FurnitureBlock[];
  /** Plan-space center of the content, and a sensible spawn point to stand at. */
  center: Point;
  spawn: Point;
  /** Half-extent of the content, for framing the orbit camera. */
  radius: number;
};

/** How tall each furniture kind stands. Falls back to a table-ish height. */
const HEIGHTS: Record<string, number> = {
  sofa: 32,
  loveseat: 32,
  armchair: 32,
  "coffee-table": 18,
  "tv-stand": 20,
  rug: 0.5,
  plant: 40,
  bookshelf: 72,
  "bed-queen": 24,
  "bed-twin": 24,
  nightstand: 24,
  dresser: 32,
  desk: 30,
  "dining-table": 30,
  "dining-chair": 34,
  fridge: 68,
  stove: 36,
  sink: 36,
  toilet: 30,
  tub: 22,
  vanity: 32,
};

export function furnitureHeight(kind: string): number {
  return HEIGHTS[kind] ?? 30;
}

function len(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** The vertical hole an opening punches: [base, top]. */
function holeSpan(o: Opening): { base: number; top: number } {
  return o.type === "door"
    ? { base: 0, top: Math.min(DOOR_HEIGHT, WALL_HEIGHT) }
    : { base: WINDOW_SILL, top: Math.min(WINDOW_TOP, WALL_HEIGHT) };
}

/**
 * Cut one wall into slabs around its openings.
 *
 * Openings are given as offsets along the wall from `a`. Overlapping openings
 * are skipped rather than producing inverted geometry — the 2D editor allows
 * placing them close together, and a malformed plan must not crash the viewer.
 */
export function sliceWall(wall: Wall, openings: Opening[]): WallSlab[] {
  const L = len(wall.a, wall.b);
  if (L <= 0) return [];

  const slab = (from: number, to: number, base: number, top: number): WallSlab | null => {
    if (to - from <= 1e-6 || top - base <= 1e-6) return null;
    return {
      a: lerp(wall.a, wall.b, from / L),
      b: lerp(wall.a, wall.b, to / L),
      thickness: wall.thickness,
      base,
      top,
    };
  };

  const cuts = openings
    .filter((o) => o.wallId === wall.id)
    .map((o) => {
      const half = o.width / 2;
      return {
        start: Math.max(0, o.offset - half),
        end: Math.min(L, o.offset + half),
        ...holeSpan(o),
      };
    })
    .filter((c) => c.end > c.start)
    .sort((x, y) => x.start - y.start);

  const out: WallSlab[] = [];
  let cursor = 0;

  for (const c of cuts) {
    if (c.start < cursor) continue; // overlaps the previous opening — skip it
    const solid = slab(cursor, c.start, 0, WALL_HEIGHT);
    if (solid) out.push(solid);

    const below = slab(c.start, c.end, 0, c.base);
    if (below) out.push(below);
    const above = slab(c.start, c.end, c.top, WALL_HEIGHT);
    if (above) out.push(above);

    cursor = c.end;
  }

  const tail = slab(cursor, L, 0, WALL_HEIGHT);
  if (tail) out.push(tail);

  return out;
}

/** Area-weighted centroid of a polygon; falls back to the vertex mean. */
function centroid(poly: Point[]): Point {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    const n = poly.length || 1;
    return {
      x: poly.reduce((s, p) => s + p.x, 0) / n,
      y: poly.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** Build the scene for one floor's entities. */
export function buildScene(entities: Entity[]): Scene3D {
  const walls = entities.filter((e): e is Wall => e.type === "wall");
  const rooms = entities.filter((e): e is Room => e.type === "room");
  const openings = entities.filter(
    (e): e is Opening => e.type === "door" || e.type === "window",
  );
  const items = entities.filter((e): e is Furniture => e.type === "furniture");

  const slabs = walls.flatMap((w) => sliceWall(w, openings));

  const floors: FloorSlab[] = rooms
    .filter((r) => r.poly.length >= 3)
    .map((r) => ({ poly: r.poly.map((p) => ({ ...p })), name: r.name }));

  const furniture: FurnitureBlock[] = items.map((f) => ({
    id: f.id,
    kind: f.kind,
    position: { ...f.position },
    rotation: f.rotation,
    w: f.w,
    h: f.h,
    height: furnitureHeight(f.kind),
  }));

  // Framing: bounds over wall endpoints (furniture sits inside them anyway).
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const w of walls) {
    for (const p of [w.a, w.b]) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  const hasContent = Number.isFinite(minX);
  const center: Point = hasContent
    ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
    : { x: 0, y: 0 };
  const radius = hasContent ? Math.max(maxX - minX, maxY - minY) / 2 || 120 : 120;

  // Stand in the biggest room, so the walkthrough doesn't start inside a wall.
  const biggest = rooms.reduce<Room | null>(
    (best, r) => (!best || r.areaSqFt > best.areaSqFt ? r : best),
    null,
  );
  const spawn = biggest && biggest.poly.length >= 3 ? centroid(biggest.poly) : center;

  return { walls: slabs, floors, furniture, center, spawn, radius };
}
