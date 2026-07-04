import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLoops } from "./detect.ts";
import { createWall } from "../model/wall.ts";
import type { Point } from "../viewport.ts";

const wall = (a: Point, b: Point) => createWall(a, b);

test("single square encloses one room with correct area", () => {
  // 10ft x 10ft = 120in x 120in => 100 sq ft.
  const p = [
    { x: 0, y: 0 },
    { x: 120, y: 0 },
    { x: 120, y: 120 },
    { x: 0, y: 120 },
  ];
  const walls = [wall(p[0], p[1]), wall(p[1], p[2]), wall(p[2], p[3]), wall(p[3], p[0])];
  const loops = detectLoops(walls);
  assert.equal(loops.length, 1);
  assert.ok(Math.abs(loops[0].areaSqIn - 14400) < 1e-6, `area ${loops[0].areaSqIn}`);
  assert.equal(loops[0].wallIds.length, 4);
});

test("open (un-closed) walls enclose nothing", () => {
  const walls = [
    wall({ x: 0, y: 0 }, { x: 120, y: 0 }),
    wall({ x: 120, y: 0 }, { x: 120, y: 120 }),
    wall({ x: 120, y: 120 }, { x: 0, y: 120 }),
    // missing the closing wall
  ];
  assert.equal(detectLoops(walls).length, 0);
});

test("two rooms sharing a wall detect as two rooms", () => {
  // Two stacked 120x120 squares sharing the middle horizontal wall.
  const walls = [
    // bottom square
    wall({ x: 0, y: 0 }, { x: 120, y: 0 }),
    wall({ x: 120, y: 0 }, { x: 120, y: 120 }),
    wall({ x: 120, y: 120 }, { x: 0, y: 120 }),
    wall({ x: 0, y: 120 }, { x: 0, y: 0 }),
    // top square (shares the y=120 edge)
    wall({ x: 120, y: 120 }, { x: 120, y: 240 }),
    wall({ x: 120, y: 240 }, { x: 0, y: 240 }),
    wall({ x: 0, y: 240 }, { x: 0, y: 120 }),
  ];
  const loops = detectLoops(walls);
  assert.equal(loops.length, 2);
  for (const l of loops) assert.ok(Math.abs(l.areaSqIn - 14400) < 1e-6);
});

test("endpoints within tolerance still close the loop", () => {
  // Corners don't meet exactly (0.5in gap) but should merge.
  const walls = [
    wall({ x: 0, y: 0 }, { x: 120, y: 0 }),
    wall({ x: 120, y: 0.4 }, { x: 120, y: 120 }),
    wall({ x: 120, y: 120 }, { x: 0.3, y: 120 }),
    wall({ x: 0, y: 120 }, { x: 0, y: 0.2 }),
  ];
  assert.equal(detectLoops(walls).length, 1);
});
