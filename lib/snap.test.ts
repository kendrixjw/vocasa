import { test } from "node:test";
import assert from "node:assert/strict";
import { nearestEndpoint, snapAngle, snapForDraw } from "./snap.ts";
import type { NamedPoint } from "./model/document.ts";

const approx = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `${a} !== ${b}`);

test("snapAngle locks to 45-degree increments preserving length", () => {
  // 10 degrees above horizontal, length 100 -> snaps to 0 degrees.
  const raw = { x: 100 * Math.cos(0.1745), y: 100 * Math.sin(0.1745) };
  const s = snapAngle({ x: 0, y: 0 }, raw);
  approx(Math.hypot(s.x, s.y), 100);
  approx(s.y, 0);
  approx(s.x, 100);

  // 50 degrees -> snaps to 45.
  const raw2 = { x: 100 * Math.cos(0.8727), y: 100 * Math.sin(0.8727) };
  const s2 = snapAngle({ x: 0, y: 0 }, raw2);
  approx(s2.x, s2.y); // 45 degrees => x == y
});

test("nearestEndpoint respects threshold and exclusion", () => {
  const cands: NamedPoint[] = [
    { point: { x: 0, y: 0 }, ownerId: "a" },
    { point: { x: 100, y: 0 }, ownerId: "b" },
  ];
  assert.equal(nearestEndpoint({ x: 3, y: 4 }, cands, 6)?.ownerId, "a");
  assert.equal(nearestEndpoint({ x: 3, y: 4 }, cands, 4), null); // dist 5 > 4
  assert.equal(nearestEndpoint({ x: 3, y: 4 }, cands, 6, "a"), null); // excluded
});

test("snapForDraw prefers endpoint join over angle lock", () => {
  const eps: NamedPoint[] = [{ point: { x: 98, y: 2 }, ownerId: "w1" }];
  const r = snapForDraw({ x: 100, y: 0 }, { x: 0, y: 0 }, eps, 10, false);
  assert.equal(r.kind, "endpoint");
  assert.equal(r.ownerId, "w1");
  assert.deepEqual(r.point, { x: 98, y: 2 });
});

test("snapForDraw falls back to angle lock when no endpoint near", () => {
  const r = snapForDraw({ x: 100, y: 8 }, { x: 0, y: 0 }, [], 10, false);
  assert.equal(r.kind, "angle");
  approx(r.point.y, 0); // ~5 deg snaps to horizontal
});

test("snapForDraw disabled returns raw point", () => {
  const eps: NamedPoint[] = [{ point: { x: 98, y: 2 }, ownerId: "w1" }];
  const r = snapForDraw({ x: 100, y: 0 }, { x: 0, y: 0 }, eps, 10, true);
  assert.equal(r.kind, "none");
  assert.deepEqual(r.point, { x: 100, y: 0 });
});
