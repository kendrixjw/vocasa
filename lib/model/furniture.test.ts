import { test } from "node:test";
import assert from "node:assert/strict";
import {
  corners,
  createFurniture,
  furnitureBounds,
  halfExtentAlong,
  hitTestFurniture,
} from "./furniture.ts";

const approx = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `${a} !== ${b}`);

test("createFurniture uses library default dimensions", () => {
  const f = createFurniture("sofa", { x: 0, y: 0 });
  assert.equal(f.w, 84);
  assert.equal(f.h, 36);
  assert.equal(f.kind, "sofa");
});

test("hitTestFurniture respects the footprint (unrotated)", () => {
  const f = createFurniture("sofa", { x: 0, y: 0 }); // 84 x 36 -> half 42 x 18
  assert.ok(hitTestFurniture(f, { x: 41, y: 17 }));
  assert.ok(!hitTestFurniture(f, { x: 43, y: 0 }));
  assert.ok(!hitTestFurniture(f, { x: 0, y: 19 }));
});

test("hitTestFurniture respects rotation", () => {
  const f = createFurniture("sofa", { x: 0, y: 0 });
  f.rotation = Math.PI / 2; // now footprint is 36 wide x 84 tall
  assert.ok(hitTestFurniture(f, { x: 0, y: 41 }));
  assert.ok(!hitTestFurniture(f, { x: 0, y: 43 }));
  assert.ok(hitTestFurniture(f, { x: 17, y: 0 }));
});

test("corners and AABB rotate correctly at 90 degrees", () => {
  const f = createFurniture("sofa", { x: 10, y: 10 });
  f.rotation = Math.PI / 2;
  const b = furnitureBounds(f);
  approx(b.minX, 10 - 18);
  approx(b.maxX, 10 + 18);
  approx(b.minY, 10 - 42);
  approx(b.maxY, 10 + 42);
  assert.equal(corners(f).length, 4);
});

test("halfExtentAlong gives w/2 and h/2 on axes when unrotated", () => {
  const f = createFurniture("sofa", { x: 0, y: 0 });
  approx(halfExtentAlong(f, { x: 1, y: 0 }), 42);
  approx(halfExtentAlong(f, { x: 0, y: 1 }), 18);
});
