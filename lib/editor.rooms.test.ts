import { test } from "node:test";
import assert from "node:assert/strict";
import { Editor } from "./editor.ts";
import { AddEntities } from "./commands.ts";
import { createWall, DEFAULT_WALL_THICKNESS } from "./model/wall.ts";
import { rooms, walls } from "./model/document.ts";

function square(ed: Editor, x0: number, y0: number, x1: number, y1: number) {
  ed.execute(
    new AddEntities([
      createWall({ x: x0, y: y0 }, { x: x1, y: y0 }, DEFAULT_WALL_THICKNESS),
      createWall({ x: x1, y: y0 }, { x: x1, y: y1 }, DEFAULT_WALL_THICKNESS),
      createWall({ x: x1, y: y1 }, { x: x0, y: y1 }, DEFAULT_WALL_THICKNESS),
      createWall({ x: x0, y: y1 }, { x: x0, y: y0 }, DEFAULT_WALL_THICKNESS),
    ]),
  );
}

test("an isolated room is movable and moves rigidly", () => {
  const ed = new Editor();
  square(ed, 0, 0, 120, 120);
  const room = rooms(ed.doc)[0];
  assert.ok(ed.roomIsMovable(room));

  const snap = ed.roomWallSnapshot(room);
  ed.commitRoomMove(room, snap, 50, 20);
  // Every wall shifted by the delta; area unchanged.
  const moved = rooms(ed.doc)[0];
  assert.ok(Math.abs(moved.areaSqFt - room.areaSqFt) < 1e-6);
  const ws = walls(ed.doc);
  assert.ok(ws.every((w) => w.a.x >= 50 - 1e-6 && w.a.y >= 20 - 1e-6));

  ed.undo();
  assert.ok(walls(ed.doc).some((w) => Math.abs(w.a.x) < 1e-6)); // back at origin
});

test("deleteRoom removes the room's walls", () => {
  const ed = new Editor();
  square(ed, 0, 0, 120, 120);
  const room = rooms(ed.doc)[0];
  assert.equal(walls(ed.doc).length, 4);
  ed.deleteRoom(room.id);
  assert.equal(walls(ed.doc).length, 0);
  assert.equal(rooms(ed.doc).length, 0);
  ed.undo();
  assert.equal(walls(ed.doc).length, 4);
});

test("a room sharing a wall with a neighbour is not movable", () => {
  const ed = new Editor();
  // Two rooms side by side sharing the x=120 wall.
  square(ed, 0, 0, 120, 120);
  square(ed, 120, 0, 240, 120);
  const rs = rooms(ed.doc);
  assert.equal(rs.length, 2);
  assert.ok(!ed.roomIsMovable(rs[0]));
  assert.ok(!ed.roomIsMovable(rs[1]));
});
