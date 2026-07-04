// Auto-room detection: find the enclosed loops (minimal faces) of the wall
// graph. Treat walls as edges of a planar graph; the interior faces are rooms.
//
// Algorithm (classic planar-subdivision face extraction):
//  1. Merge near-coincident endpoints into shared vertices.
//  2. For every directed half-edge, walk faces by always taking the next edge
//     clockwise around the arrival vertex. Each such walk traces one minimal
//     face.
//  3. Interior faces have positive signed area (CCW, with Y up); the single
//     outer boundary comes out negative and is discarded, as are slivers.

import type { Point } from "../viewport.ts";
import type { Wall } from "../model/types.ts";

export type Loop = { wallIds: string[]; poly: Point[]; areaSqIn: number };

const MERGE_TOL = 0.75; // inches — endpoints closer than this are the same vertex
const MIN_AREA = 100; // sq inches (~0.7 sq ft) — ignore slivers

/** Signed polygon area (positive == counter-clockwise with Y up). */
export function signedArea(poly: Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

type Neighbor = { to: number; wallId: string; angle: number };

export function detectLoops(walls: Wall[]): Loop[] {
  // 1. Merge endpoints into vertices.
  const verts: Point[] = [];
  const findVert = (p: Point): number => {
    for (let i = 0; i < verts.length; i++) {
      if (Math.hypot(verts[i].x - p.x, verts[i].y - p.y) <= MERGE_TOL) return i;
    }
    verts.push({ x: p.x, y: p.y });
    return verts.length - 1;
  };

  const adj: Neighbor[][] = [];
  const ensure = (i: number) => {
    while (adj.length <= i) adj.push([]);
  };
  const seenEdge = new Set<string>();
  for (const w of walls) {
    const u = findVert(w.a);
    const v = findVert(w.b);
    if (u === v) continue;
    ensure(u);
    ensure(v);
    const key = u < v ? `${u}_${v}` : `${v}_${u}`;
    if (seenEdge.has(key)) continue; // ignore duplicate edges between same verts
    seenEdge.add(key);
    adj[u].push({ to: v, wallId: w.id, angle: Math.atan2(verts[v].y - verts[u].y, verts[v].x - verts[u].x) });
    adj[v].push({ to: u, wallId: w.id, angle: Math.atan2(verts[u].y - verts[v].y, verts[u].x - verts[v].x) });
  }
  for (const list of adj) list.sort((a, b) => a.angle - b.angle);

  // 2. Walk faces via the next-clockwise-edge rule.
  const visited = new Set<string>();
  const loops: Loop[] = [];
  const maxSteps = seenEdge.size * 2 + 8;

  for (let u = 0; u < adj.length; u++) {
    for (const start of adj[u]) {
      const startKey = `${u}->${start.to}`;
      if (visited.has(startKey)) continue;

      const poly: Point[] = [];
      const wallIds: string[] = [];
      let a = u;
      let b = start.to;
      let steps = 0;
      let ok = true;

      for (;;) {
        const key = `${a}->${b}`;
        if (visited.has(key) && key !== startKey) break;
        visited.add(key);
        poly.push(verts[a]);
        const nb = adj[a].find((n) => n.to === b);
        if (nb) wallIds.push(nb.wallId);

        const list = adj[b];
        const deg = list.length;
        const i = list.findIndex((n) => n.to === a);
        if (i < 0) {
          ok = false;
          break;
        }
        const next = list[(i - 1 + deg) % deg].to; // clockwise turn
        a = b;
        b = next;
        if (`${a}->${b}` === startKey) break;
        if (++steps > maxSteps) {
          ok = false;
          break;
        }
      }

      if (!ok || poly.length < 3) continue;
      loops.push({ wallIds, poly, areaSqIn: signedArea(poly) });
    }
  }

  // 3. Keep interior faces (positive area), drop outer boundary + slivers.
  return loops.filter((l) => l.areaSqIn > MIN_AREA);
}
