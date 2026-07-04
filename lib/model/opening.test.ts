import { test } from "node:test";
import assert from "node:assert/strict";
import { createDocument } from "./types.ts";
import { createWall } from "./wall.ts";
import {
  clampOffset,
  createDoor,
  createWindow,
  hitTestOpening,
  openingFrame,
  projectOffset,
} from "./opening.ts";
import { DeleteEntities } from "../commands.ts";

const approx = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `${a} !== ${b}`);

test("openingFrame places center at offset along the wall", () => {
  const wall = createWall({ x: 0, y: 0 }, { x: 100, y: 0 });
  const f = openingFrame(wall, 40);
  approx(f.center.x, 40);
  approx(f.center.y, 0);
  approx(f.dir.x, 1);
  approx(f.normal.y, 1);
});

test("opening follows the wall (derived from offset)", () => {
  const wall = createWall({ x: 0, y: 0 }, { x: 100, y: 0 });
  const door = createDoor(wall.id, 50, 32);
  approx(openingFrame(wall, door.offset).center.x, 50);
  // Move the wall; the derived center moves with it (same offset).
  wall.a = { x: 10, y: 20 };
  wall.b = { x: 110, y: 20 };
  const f = openingFrame(wall, door.offset);
  approx(f.center.x, 60);
  approx(f.center.y, 20);
});

test("clampOffset keeps the opening inside the wall", () => {
  const wall = createWall({ x: 0, y: 0 }, { x: 100, y: 0 });
  approx(clampOffset(wall, 32, 5), 16); // too close to a
  approx(clampOffset(wall, 32, 95), 84); // too close to b
  approx(clampOffset(wall, 32, 50), 50); // fine
});

test("projectOffset returns distance along the wall", () => {
  const wall = createWall({ x: 0, y: 0 }, { x: 0, y: 100 });
  approx(projectOffset(wall, { x: 5, y: 30 }), 30);
});

test("hitTestOpening covers the opening footprint", () => {
  const wall = createWall({ x: 0, y: 0 }, { x: 100, y: 0 });
  const win = createWindow(wall.id, 50, 36);
  assert.ok(hitTestOpening(win, wall, { x: 50, y: 0 }));
  assert.ok(hitTestOpening(win, wall, { x: 60, y: 0 }));
  assert.ok(!hitTestOpening(win, wall, { x: 80, y: 0 })); // beyond half-width
});

test("deleting a wall cascades to its doors/windows and undoes together", () => {
  const doc = createDocument();
  const wall = createWall({ x: 0, y: 0 }, { x: 100, y: 0 });
  const door = createDoor(wall.id, 50);
  const other = createWall({ x: 0, y: 50 }, { x: 100, y: 50 });
  doc.entities.push(wall, door, other);

  const cmd = new DeleteEntities([wall.id]);
  cmd.do(doc);
  assert.deepEqual(
    doc.entities.map((e) => e.id).sort(),
    [other.id].sort(),
  );
  cmd.undo(doc);
  assert.equal(doc.entities.length, 3);
  assert.ok(doc.entities.some((e) => e.id === door.id));
});
