// Smart snapping. v1 does a linear scan over candidates (fine for now) and
// picks the nearest within a screen-pixel threshold. No jargon surfaces to the
// user — it just behaves.

import type { Point } from "./viewport.ts";
import type { NamedPoint } from "./model/document.ts";

export type SnapKind = "endpoint" | "angle" | "none";

export type SnapResult = {
  point: Point;
  kind: SnapKind;
  ownerId?: string; // set when snapped to an existing endpoint (for join)
};

/** Nearest candidate endpoint to `p` within `maxDist` (world inches), or null. */
export function nearestEndpoint(
  p: Point,
  candidates: NamedPoint[],
  maxDist: number,
  excludeId?: string,
): NamedPoint | null {
  let best: NamedPoint | null = null;
  let bestD = maxDist;
  for (const c of candidates) {
    if (excludeId && c.ownerId === excludeId) continue;
    const d = Math.hypot(c.point.x - p.x, c.point.y - p.y);
    if (d <= bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/**
 * Snap the vector base->raw to the nearest `stepDeg` increment (default 45°),
 * preserving length. Gives 0/45/90/... angle locks.
 */
export function snapAngle(base: Point, raw: Point, stepDeg = 45): Point {
  const dx = raw.x - base.x;
  const dy = raw.y - base.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { ...raw };
  const step = (stepDeg * Math.PI) / 180;
  const ang = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: base.x + len * Math.cos(ang), y: base.y + len * Math.sin(ang) };
}

/**
 * Resolve the target point while drawing a wall segment from `base` (may be
 * null for the very first point). Priority: snap to an existing endpoint
 * (join), else lock to a 45° angle from base. `disabled` (Shift held) returns
 * the raw point.
 */
export function snapForDraw(
  raw: Point,
  base: Point | null,
  endpoints: NamedPoint[],
  thresholdWorld: number,
  disabled: boolean,
): SnapResult {
  if (disabled) return { point: { ...raw }, kind: "none" };

  const ep = nearestEndpoint(raw, endpoints, thresholdWorld);
  if (ep) return { point: { ...ep.point }, kind: "endpoint", ownerId: ep.ownerId };

  if (base) return { point: snapAngle(base, raw), kind: "angle" };

  return { point: { ...raw }, kind: "none" };
}
