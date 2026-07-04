import { test } from "node:test";
import assert from "node:assert/strict";
import { createDocument } from "../model/types.ts";
import { createWall } from "../model/wall.ts";
import { rooms } from "../model/document.ts";
import { syncRooms } from "./sync.ts";
import { RenameRoom } from "../commands.ts";
import type { Point } from "../viewport.ts";

function squareDoc() {
  const doc = createDocument();
  const p: Point[] = [
    { x: 0, y: 0 },
    { x: 120, y: 0 },
    { x: 120, y: 120 },
    { x: 0, y: 120 },
  ];
  doc.entities.push(
    createWall(p[0], p[1]),
    createWall(p[1], p[2]),
    createWall(p[2], p[3]),
    createWall(p[3], p[0]),
  );
  return doc;
}

test("syncRooms creates one room with area in sq ft and a default name", () => {
  const doc = squareDoc();
  syncRooms(doc);
  const rs = rooms(doc);
  assert.equal(rs.length, 1);
  assert.ok(Math.abs(rs[0].areaSqFt - 100) < 1e-6);
  assert.equal(rs[0].name, "Room 1");
});

test("syncRooms preserves name + id when a wall moves (same wall set)", () => {
  const doc = squareDoc();
  syncRooms(doc);
  const room = rooms(doc)[0];
  room.name = "Kitchen";
  const id = room.id;

  // Move the whole square right by 60in (all four walls shift).
  for (const w of doc.entities) {
    if (w.type === "wall") {
      w.a.x += 60;
      w.b.x += 60;
    }
  }
  syncRooms(doc);
  const after = rooms(doc);
  assert.equal(after.length, 1);
  assert.equal(after[0].id, id);
  assert.equal(after[0].name, "Kitchen");
});

test("syncRooms removes the room when the loop is broken", () => {
  const doc = squareDoc();
  syncRooms(doc);
  assert.equal(rooms(doc).length, 1);
  // Delete one wall.
  doc.entities = doc.entities.filter((e) => e.type !== "wall" || e !== doc.entities.find((x) => x.type === "wall"));
  syncRooms(doc);
  assert.equal(rooms(doc).length, 0);
});

test("RenameRoom command undoes", () => {
  const doc = squareDoc();
  syncRooms(doc);
  const room = rooms(doc)[0];
  const cmd = new RenameRoom(room.id, "Living Room");
  cmd.do(doc);
  assert.equal(rooms(doc)[0].name, "Living Room");
  cmd.undo(doc);
  assert.equal(rooms(doc)[0].name, "Room 1");
});
