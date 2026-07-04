import { test } from "node:test";
import assert from "node:assert/strict";
import { Editor } from "../editor.ts";
import { validateOps } from "../ai/ops.ts";
import { resolveBatch } from "../ai/resolver.ts";
import { rooms, furniture } from "../model/document.ts";
import { isPlanData, PLAN_VERSION } from "./plan.ts";

function seedRoom(editor: Editor) {
  const v = validateOps([
    { op: "createRoom", name: "living room", width: 180, height: 240, anchor: { at: "cursor" } },
    { op: "placeFurniture", kind: "sofa", anchor: { room: "living room", against: "north" } },
  ]);
  assert.ok(v.ok);
  if (!v.ok) return;
  const res = resolveBatch(v.ops, editor.doc, { x: 0, y: 0 }, []);
  assert.equal(res.kind, "ops");
  if (res.kind === "ops") editor.execute(res.command);
}

test("serialize produces versioned plan data", () => {
  const e = new Editor();
  seedRoom(e);
  const data = e.serialize();
  assert.equal(data.version, PLAN_VERSION);
  assert.equal(data.units, "imperial");
  assert.ok(isPlanData(data));
  assert.ok(data.entities.length >= 5); // 4 walls + room + sofa
});

test("load restores a serialized plan into a fresh editor", () => {
  const src = new Editor();
  seedRoom(src);
  const data = src.serialize();

  const dst = new Editor();
  dst.load(data);

  assert.equal(rooms(dst.doc).length, 1);
  assert.equal(rooms(dst.doc)[0].name, "living room");
  assert.equal(furniture(dst.doc).length, 1);
  // Loading clears history (fresh document, nothing to undo).
  assert.equal(dst.canUndo, false);
});

test("isPlanData rejects junk", () => {
  assert.equal(isPlanData(null), false);
  assert.equal(isPlanData({ version: 1 }), false);
  assert.equal(isPlanData({ version: 1, entities: [], viewport: {} }), true);
});
