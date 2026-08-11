import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOOR_HEIGHT,
  WALL_HEIGHT,
  WINDOW_SILL,
  WINDOW_TOP,
  buildScene,
  furnitureHeight,
  sliceWall,
} from "./scene3d.ts";
import { Editor } from "../editor.ts";
import { AddEntities } from "../commands.ts";
import { createWall, DEFAULT_WALL_THICKNESS } from "../model/wall.ts";
import { walls as docWalls } from "../model/document.ts";
import type { Opening, Wall } from "../model/types.ts";

function wall(len: number): Wall {
  return createWall({ x: 0, y: 0 }, { x: len, y: 0 }, DEFAULT_WALL_THICKNESS);
}

function door(w: Wall, offset: number, width = 32): Opening {
  return { id: crypto.randomUUID(), type: "door", wallId: w.id, offset, width, swing: "in" };
}

function windowAt(w: Wall, offset: number, width = 36): Opening {
  return { id: crypto.randomUUID(), type: "window", wallId: w.id, offset, width };
}

const spanLen = (s: { a: { x: number }; b: { x: number } }) => Math.abs(s.b.x - s.a.x);

// --- Slicing a wall ---------------------------------------------------------

test("a wall with no openings is one full-height slab", () => {
  const w = wall(120);
  const out = sliceWall(w, []);
  assert.equal(out.length, 1);
  assert.equal(out[0].base, 0);
  assert.equal(out[0].top, WALL_HEIGHT);
  assert.equal(spanLen(out[0]), 120);
});

test("a door leaves a gap to the floor with a header above it", () => {
  const w = wall(120);
  const out = sliceWall(w, [door(w, 60, 32)]);

  // left solid | header over the doorway | right solid
  assert.equal(out.length, 3);
  const header = out.find((s) => s.base === DOOR_HEIGHT)!;
  assert.ok(header, "expected a header slab above the door");
  assert.equal(header.top, WALL_HEIGHT);
  assert.equal(spanLen(header), 32);

  // Nothing spans the doorway below the door height.
  const blocking = out.filter((s) => s.base < DOOR_HEIGHT && spanLen(s) > 0 && s.a.x >= 44 && s.b.x <= 76);
  assert.equal(blocking.length, 0, "the doorway must be open to the floor");
});

test("a window leaves a sill below and a header above", () => {
  const w = wall(120);
  const out = sliceWall(w, [windowAt(w, 60, 36)]);

  const sill = out.find((s) => s.base === 0 && s.top === WINDOW_SILL);
  const header = out.find((s) => s.base === WINDOW_TOP && s.top === WALL_HEIGHT);
  assert.ok(sill, "expected a sill slab below the window");
  assert.ok(header, "expected a header slab above the window");
  assert.equal(spanLen(sill!), 36);
  assert.equal(spanLen(header!), 36);
});

test("wall material is conserved: slabs tile the wall with no overlap", () => {
  const w = wall(200);
  const out = sliceWall(w, [door(w, 40), windowAt(w, 140)]);

  // Total area of the slabs == full wall area minus the two holes.
  const area = out.reduce((s, x) => s + spanLen(x) * (x.top - x.base), 0);
  const holes = 32 * DOOR_HEIGHT + 36 * (WINDOW_TOP - WINDOW_SILL);
  assert.equal(Math.round(area), Math.round(200 * WALL_HEIGHT - holes));

  for (const s of out) assert.ok(s.top > s.base, "no inverted slab");
});

test("openings at the very ends don't produce zero-width or negative slabs", () => {
  const w = wall(100);
  for (const o of [door(w, 0), door(w, 100), windowAt(w, 2)]) {
    const out = sliceWall(w, [o]);
    for (const s of out) {
      assert.ok(spanLen(s) > 0, "zero-length slab");
      assert.ok(s.top > s.base, "zero-height slab");
    }
  }
});

test("overlapping openings are skipped rather than producing broken geometry", () => {
  const w = wall(120);
  const out = sliceWall(w, [door(w, 60, 40), door(w, 70, 40)]);
  for (const s of out) {
    assert.ok(spanLen(s) > 0);
    assert.ok(s.top > s.base);
  }
  // Still tiles a sane total (only the first door was cut).
  const area = out.reduce((s, x) => s + spanLen(x) * (x.top - x.base), 0);
  assert.equal(Math.round(area), Math.round(120 * WALL_HEIGHT - 40 * DOOR_HEIGHT));
});

test("openings belonging to another wall are ignored", () => {
  const a = wall(120);
  const b = wall(120);
  const out = sliceWall(a, [door(b, 60)]);
  assert.equal(out.length, 1);
  assert.equal(spanLen(out[0]), 120);
});

test("a degenerate zero-length wall produces nothing", () => {
  const w = createWall({ x: 5, y: 5 }, { x: 5, y: 5 }, DEFAULT_WALL_THICKNESS);
  assert.deepEqual(sliceWall(w, []), []);
});

// --- Whole scene ------------------------------------------------------------

test("an empty floor yields an empty but usable scene", () => {
  const s = buildScene([]);
  assert.deepEqual(s.walls, []);
  assert.deepEqual(s.floors, []);
  assert.deepEqual(s.furniture, []);
  assert.ok(s.radius > 0, "radius must stay positive so the camera is valid");
  assert.ok(Number.isFinite(s.spawn.x) && Number.isFinite(s.spawn.y));
});

test("a template room becomes walls, a floor and furniture", () => {
  const ed = new Editor();
  ed.addRoomTemplate("kitchen");
  const s = buildScene(ed.doc.entities);

  assert.equal(s.walls.length, 4); // no openings -> one slab per wall
  assert.equal(s.floors.length, 1);
  assert.equal(s.floors[0].name, "Kitchen");
  assert.equal(s.furniture.length, 4);
  for (const f of s.furniture) assert.ok(f.height > 0);
});

test("the spawn point lands inside the biggest room, not in a wall", () => {
  const ed = new Editor();
  ed.addRoomTemplate("bathroom"); // 8 x 6 = 48
  ed.addRoomTemplate("living"); // 16 x 14 = 224
  const s = buildScene(ed.doc.entities);

  const living = ed.doc.entities.find((e) => e.type === "room" && e.name === "Living room");
  assert.ok(living && living.type === "room");
  const xs = living.poly.map((p) => p.x);
  const ys = living.poly.map((p) => p.y);
  assert.ok(s.spawn.x > Math.min(...xs) && s.spawn.x < Math.max(...xs));
  assert.ok(s.spawn.y > Math.min(...ys) && s.spawn.y < Math.max(...ys));
});

test("a door drawn in the editor really opens the wall in 3D", () => {
  const ed = new Editor();
  ed.addRoomTemplate("bedroom");
  const target = docWalls(ed.doc)[0];
  ed.execute(new AddEntities([door(target, 40, 32)]));

  const s = buildScene(ed.doc.entities);
  const onTarget = s.walls.filter(
    (x) => Math.abs(x.a.x - x.b.x) + Math.abs(x.a.y - x.b.y) > 0,
  );
  // The wall that got the door is now more than one slab.
  assert.ok(s.walls.length > 4, "the doored wall should be split into extra slabs");
  assert.ok(onTarget.some((x) => x.base === DOOR_HEIGHT), "expected a door header");
});

test("furniture heights are known for every kind in the library", async () => {
  const { FURNITURE } = await import("../furniture/library.ts");
  for (const def of FURNITURE) {
    assert.ok(furnitureHeight(def.kind) > 0, `${def.kind} has no height`);
  }
});

test("scene geometry is a copy — mutating it can't corrupt the document", () => {
  const ed = new Editor();
  ed.addRoomTemplate("office");
  const s = buildScene(ed.doc.entities);

  s.floors[0].poly[0].x = 99999;
  s.furniture[0].position.x = 99999;

  const room = ed.doc.entities.find((e) => e.type === "room");
  assert.ok(room && room.type === "room" && room.poly[0].x !== 99999);
  const f = ed.doc.entities.find((e) => e.type === "furniture");
  assert.ok(f && f.type === "furniture" && f.position.x !== 99999);
});
