import { test } from "node:test";
import assert from "node:assert/strict";
import { Editor } from "./editor.ts";
import { AddEntities } from "./commands.ts";
import { createWall, DEFAULT_WALL_THICKNESS } from "./model/wall.ts";
import { walls } from "./model/document.ts";

function addWall(ed: Editor, ax: number, ay: number, bx: number, by: number) {
  ed.execute(new AddEntities([createWall({ x: ax, y: ay }, { x: bx, y: by }, DEFAULT_WALL_THICKNESS)]));
}

test("a fresh editor has one Ground floor", () => {
  const ed = new Editor();
  assert.equal(ed.floors.length, 1);
  assert.equal(ed.floors[0].name, "Ground floor");
  assert.equal(ed.activeFloorId, ed.floors[0].id);
});

test("addFloor creates an empty floor on top and switches to it", () => {
  const ed = new Editor();
  addWall(ed, 0, 0, 100, 0);
  const ground = ed.activeFloorId;

  ed.addFloor();
  assert.equal(ed.floors.length, 2);
  assert.notEqual(ed.activeFloorId, ground);
  assert.equal(walls(ed.doc).length, 0); // new floor is empty
  assert.equal(ed.canUndo, false); // history reset on switch
});

test("floors keep independent geometry across switches", () => {
  const ed = new Editor();
  addWall(ed, 0, 0, 100, 0); // ground
  const ground = ed.activeFloorId;

  ed.addFloor();
  const upper = ed.activeFloorId;
  addWall(ed, 0, 200, 100, 200); // upper

  assert.equal(walls(ed.doc).length, 1);
  ed.switchFloor(ground);
  assert.equal(walls(ed.doc).length, 1);
  assert.equal(walls(ed.doc)[0].a.y, 0);
  ed.switchFloor(upper);
  assert.equal(walls(ed.doc)[0].a.y, 200);
});

test("serialize/load round-trips every floor's geometry", () => {
  const src = new Editor();
  addWall(src, 0, 0, 100, 0);
  src.addFloor();
  addWall(src, 0, 200, 100, 200);
  const activeAtSave = src.activeFloorId;

  const data = src.serialize();
  assert.equal(data.version, 3);
  assert.ok(data.floors && data.floors.length === 2);

  const dst = new Editor();
  dst.load(data);
  assert.equal(dst.floors.length, 2);
  assert.equal(dst.activeFloorId, activeAtSave);
  assert.equal(walls(dst.doc)[0].a.y, 200); // active (upper) floor
  dst.switchFloor(dst.floors[0].id);
  assert.equal(walls(dst.doc)[0].a.y, 0); // ground floor
});

test("deleteFloor removes a floor and switches off the active one", () => {
  const ed = new Editor();
  addWall(ed, 0, 0, 100, 0);
  ed.addFloor(); // upper, now active
  const upper = ed.activeFloorId;

  ed.deleteFloor(upper);
  assert.equal(ed.floors.length, 1);
  assert.equal(walls(ed.doc)[0].a.y, 0); // back on ground

  // Cannot delete the last remaining floor.
  ed.deleteFloor(ed.activeFloorId);
  assert.equal(ed.floors.length, 1);
});

test("moveFloor reorders the stack", () => {
  const ed = new Editor();
  const ground = ed.activeFloorId;
  ed.addFloor();
  const upper = ed.activeFloorId;

  assert.deepEqual(ed.floors.map((f) => f.id), [ground, upper]);
  ed.moveFloor(upper, -1);
  assert.deepEqual(ed.floors.map((f) => f.id), [upper, ground]);
});
