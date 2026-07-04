// Furniture snapping while moving. Priority:
//  1. Against a wall — rotate to the wall's orientation and sit flush against
//     its face (this is the "against the north wall" behavior voice needs too).
//  2. Alignment guides — line the block's center/edges up with other furniture.
//  3. Otherwise, follow the cursor freely.

import type { Point } from "../viewport.ts";
import type { Document, Furniture } from "../model/types.ts";
import { walls } from "../model/document.ts";
import { furnitureBounds, halfExtentAlong } from "../model/furniture.ts";

export type Guide = { axis: "x" | "y"; at: number };

export type FurnitureSnap = {
  position: Point;
  rotation: number;
  guides: Guide[];
  onWall: boolean;
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Nearest rotation of `k*90deg` offset from `base` to `current`. */
function alignRotation(base: number, current: number): number {
  let best = base;
  let bestDiff = Infinity;
  for (let k = 0; k < 4; k++) {
    const cand = base + (k * Math.PI) / 2;
    // Smallest absolute angular difference, wrapped to [-pi, pi].
    let d = ((cand - current) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    d = Math.abs(d);
    if (d < bestDiff) {
      bestDiff = d;
      best = cand;
    }
  }
  return best;
}

function trySnapWall(
  proposed: Point,
  f: Furniture,
  doc: Document,
  thresholdWorld: number,
): { position: Point; rotation: number } | null {
  const margin = clamp(thresholdWorld * 1.5, 4, 18);
  let best: { position: Point; rotation: number; d: number } | null = null;

  for (const w of walls(doc)) {
    const abx = w.b.x - w.a.x;
    const aby = w.b.y - w.a.y;
    const len = Math.hypot(abx, aby);
    if (len < 1e-6) continue;
    const dir = { x: abx / len, y: aby / len };
    const nrm = { x: -dir.y, y: dir.x };

    const relx = proposed.x - w.a.x;
    const rely = proposed.y - w.a.y;
    const t = relx * dir.x + rely * dir.y; // along wall (unclamped)
    const tc = clamp(t, 0, len);
    const foot = { x: w.a.x + dir.x * tc, y: w.a.y + dir.y * tc };
    const d = Math.hypot(proposed.x - foot.x, proposed.y - foot.y);

    const base = Math.atan2(dir.y, dir.x);
    const rot = alignRotation(base, f.rotation);
    const aligned: Furniture = { ...f, rotation: rot };
    const halfDepth = halfExtentAlong(aligned, nrm);
    const halfLen = halfExtentAlong(aligned, dir);

    if (d > w.thickness / 2 + halfDepth + margin) continue;

    const sign = (proposed.x - foot.x) * nrm.x + (proposed.y - foot.y) * nrm.y >= 0 ? 1 : -1;
    // Keep the block within the wall span (unless the wall is shorter than it).
    const tSlide = len > 2 * halfLen ? clamp(t, halfLen, len - halfLen) : len / 2;
    const footLine = { x: w.a.x + dir.x * tSlide, y: w.a.y + dir.y * tSlide };
    const off = w.thickness / 2 + halfDepth;
    const position = { x: footLine.x + nrm.x * sign * off, y: footLine.y + nrm.y * sign * off };

    if (!best || d < best.d) best = { position, rotation: rot, d };
  }

  return best ? { position: best.position, rotation: best.rotation } : null;
}

function tryAlign(
  proposed: Point,
  f: Furniture,
  doc: Document,
  thresholdWorld: number,
): { position: Point; guides: Guide[] } {
  const others = doc.entities.filter(
    (e): e is Furniture => e.type === "furniture" && e.id !== f.id,
  );
  const guides: Guide[] = [];
  const pos = { ...proposed };

  const hx = halfExtentAlong(f, { x: 1, y: 0 });
  const hy = halfExtentAlong(f, { x: 0, y: 1 });

  const snapAxis = (
    coord: number,
    half: number,
    refValues: number[],
  ): { value: number; guideAt: number } | null => {
    // Anchors: block left / center / right (or top/center/bottom).
    const anchors = [-half, 0, half];
    let best: { value: number; guideAt: number; dist: number } | null = null;
    for (const ref of refValues) {
      for (const a of anchors) {
        const candidateCenter = ref - a;
        const dist = Math.abs(coord - candidateCenter);
        if (dist <= thresholdWorld && (!best || dist < best.dist)) {
          best = { value: candidateCenter, guideAt: ref, dist };
        }
      }
    }
    return best ? { value: best.value, guideAt: best.guideAt } : null;
  };

  const refsX: number[] = [];
  const refsY: number[] = [];
  for (const o of others) {
    const b = furnitureBounds(o);
    refsX.push(o.position.x, b.minX, b.maxX);
    refsY.push(o.position.y, b.minY, b.maxY);
  }

  const sx = snapAxis(proposed.x, hx, refsX);
  if (sx) {
    pos.x = sx.value;
    guides.push({ axis: "x", at: sx.guideAt });
  }
  const sy = snapAxis(proposed.y, hy, refsY);
  if (sy) {
    pos.y = sy.value;
    guides.push({ axis: "y", at: sy.guideAt });
  }
  return { position: pos, guides };
}

export function snapFurnitureMove(
  proposed: Point,
  f: Furniture,
  doc: Document,
  thresholdWorld: number,
  disabled: boolean,
): FurnitureSnap {
  if (disabled) return { position: { ...proposed }, rotation: f.rotation, guides: [], onWall: false };

  const wall = trySnapWall(proposed, f, doc, thresholdWorld);
  if (wall) return { position: wall.position, rotation: wall.rotation, guides: [], onWall: true };

  const align = tryAlign(proposed, f, doc, thresholdWorld);
  return { position: align.position, rotation: f.rotation, guides: align.guides, onWall: false };
}
