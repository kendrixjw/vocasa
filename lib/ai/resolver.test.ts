import { test } from "node:test";
import assert from "node:assert/strict";
import { createDocument } from "../model/types.ts";
import { validateOps } from "./ops.ts";
import { resolveBatch } from "./resolver.ts";
import { furniture, rooms, openings, walls } from "../model/document.ts";
import { buildRoomIndex } from "./scene.ts";
import type { Document } from "../model/types.ts";
import type { Op } from "./ops.ts";

const CURSOR = { x: 0, y: 0 };

function ops(raw: unknown): Op[] {
  const v = validateOps(raw);
  assert.ok(v.ok, v.ok ? "" : v.error);
  return v.ok ? v.ops : [];
}

function apply(doc: Document, raw: unknown, selection: string[] = []) {
  const res = resolveBatch(ops(raw), doc, CURSOR, selection);
  if (res.kind === "ops") res.command.do(doc);
  return res;
}

test('"make a living room fifteen by twenty" builds a 4-wall room named living room', () => {
  const doc = createDocument();
  const res = apply(doc, [
    { op: "createRoom", name: "living room", width: 180, height: 240, anchor: { at: "cursor" } },
  ]);
  assert.equal(res.kind, "ops");
  assert.equal(walls(doc).length, 4);
  assert.equal(rooms(doc).length, 1);
  assert.equal(rooms(doc)[0].name, "living room");
  const idx = buildRoomIndex(doc)[0];
  assert.equal(Math.round(idx.bounds.maxX - idx.bounds.minX), 180);
  assert.equal(Math.round(idx.bounds.maxY - idx.bounds.minY), 240);
});

test("sofa against the north wall lands flush inside, near the top", () => {
  const doc = createDocument();
  apply(doc, [{ op: "createRoom", name: "living room", width: 180, height: 240, anchor: { at: "cursor" } }]);
  apply(doc, [{ op: "placeFurniture", kind: "sofa", anchor: { room: "living room", against: "north" } }]);

  const f = furniture(doc);
  assert.equal(f.length, 1);
  const idx = buildRoomIndex(doc)[0];
  const sofa = f[0];
  // Centered horizontally on the room center.
  assert.ok(Math.abs(sofa.position.x - idx.center.x) < 1);
  // Near (but inside) the north wall — top half of the room.
  assert.ok(sofa.position.y < idx.bounds.maxY);
  assert.ok(sofa.position.y > idx.center.y);
});

test("addDoor via wallOf attaches a door to the south wall", () => {
  const doc = createDocument();
  apply(doc, [{ op: "createRoom", name: "living room", width: 180, height: 240, anchor: { at: "cursor" } }]);
  const res = apply(doc, [
    { op: "addDoor", wall: { wallOf: "living room", side: "south" }, width: 36, along: "center" },
  ]);
  assert.equal(res.kind, "ops");
  const os = openings(doc);
  assert.equal(os.length, 1);
  assert.equal(os[0].type, "door");
  const southId = buildRoomIndex(doc)[0].wallBySide.south;
  assert.equal(os[0].wallId, southId);
});

test("move selection to the northeast corner repositions the furniture", () => {
  const doc = createDocument();
  apply(doc, [{ op: "createRoom", name: "living room", width: 180, height: 240, anchor: { at: "cursor" } }]);
  apply(doc, [{ op: "placeFurniture", kind: "nightstand", anchor: { at: "cursor" } }]);
  const id = furniture(doc)[0].id;

  const idx = buildRoomIndex(doc)[0];
  apply(doc, [{ op: "move", target: { selection: true }, to: { corner: "northeast" } }], [id]);
  const f = furniture(doc)[0];
  assert.ok(f.position.x > idx.center.x, "moved toward east");
  assert.ok(f.position.y > idx.center.y, "moved toward north");
});

test("ambiguous reference (two sofas) resolves to a clarify", () => {
  const doc = createDocument();
  apply(doc, [{ op: "createRoom", name: "living room", width: 240, height: 240, anchor: { at: "cursor" } }]);
  apply(doc, [{ op: "placeFurniture", kind: "sofa", anchor: { at: "cursor" } }]);
  apply(doc, [{ op: "placeFurniture", kind: "sofa", anchor: { x: 50, y: 50 } }]);

  const res = resolveBatch(
    ops([{ op: "move", target: { kind: "sofa" }, to: { corner: "northeast" } }]),
    doc,
    CURSOR,
    [],
  );
  assert.equal(res.kind, "clarify");
});

test("failed reference converts the whole batch to a clarify (no partial apply)", () => {
  const doc = createDocument();
  apply(doc, [{ op: "createRoom", name: "living room", width: 180, height: 240, anchor: { at: "cursor" } }]);
  const before = doc.entities.length;
  // 'last' with nothing created this batch + a furniture ref that doesn't exist.
  const res = resolveBatch(
    ops([{ op: "move", target: { kind: "desk" }, to: { at: "cursor" } }]),
    doc,
    CURSOR,
    [],
  );
  assert.equal(res.kind, "clarify");
  assert.equal(doc.entities.length, before, "nothing was applied");
});

test("intra-batch reference: place then move 'last' works in one batch", () => {
  const doc = createDocument();
  apply(doc, [{ op: "createRoom", name: "bedroom", width: 144, height: 144, anchor: { at: "cursor" } }]);
  const res = apply(doc, [
    { op: "placeFurniture", kind: "bed", anchor: { room: "bedroom", against: "north" } },
    { op: "rotate", target: { last: true }, degrees: 90 },
  ]);
  assert.equal(res.kind, "ops");
  assert.equal(furniture(doc).length, 1);
});
