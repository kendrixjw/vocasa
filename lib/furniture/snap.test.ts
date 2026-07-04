import { test } from "node:test";
import assert from "node:assert/strict";
import { createDocument } from "../model/types.ts";
import { createWall } from "../model/wall.ts";
import { createFurniture } from "../model/furniture.ts";
import { snapFurnitureMove } from "./snap.ts";

const approx = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `${a} !== ${b}`);

test("furniture snaps flush against a nearby wall face", () => {
  const doc = createDocument();
  // Horizontal wall along y=0, thickness 5, x in [0,200].
  doc.entities.push(createWall({ x: 0, y: 0 }, { x: 200, y: 0 }));
  const f = createFurniture("sofa", { x: 100, y: 20 }); // 84 x 36

  const s = snapFurnitureMove({ x: 100, y: 20 }, f, doc, 10, false);
  assert.equal(s.onWall, true);
  // Aligned to the wall (0 or pi); depth toward wall = h/2 = 18, + half thickness.
  approx(s.position.y, 2.5 + 18);
  approx(s.position.x, 100);
});

test("shift disables snapping", () => {
  const doc = createDocument();
  doc.entities.push(createWall({ x: 0, y: 0 }, { x: 200, y: 0 }));
  const f = createFurniture("sofa", { x: 100, y: 20 });
  const s = snapFurnitureMove({ x: 100, y: 20 }, f, doc, 10, true);
  assert.equal(s.onWall, false);
  assert.deepEqual(s.position, { x: 100, y: 20 });
});

test("furniture aligns to another block's center with a guide", () => {
  const doc = createDocument();
  const a = createFurniture("nightstand", { x: 0, y: 0 });
  doc.entities.push(a);
  const b = createFurniture("nightstand", { x: 3, y: 100 }); // near x=0
  doc.entities.push(b);

  const s = snapFurnitureMove({ x: 3, y: 100 }, b, doc, 10, false);
  assert.equal(s.onWall, false);
  approx(s.position.x, 0); // snapped to a's center x
  assert.ok(s.guides.some((g) => g.axis === "x" && Math.abs(g.at) < 1e-6));
});
