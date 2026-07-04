import { test } from "node:test";
import assert from "node:assert/strict";
import { validateOps, LIMITS } from "./ops.ts";

test("validateOps accepts a well-formed createRoom", () => {
  const r = validateOps([
    { op: "createRoom", name: "Living Room", width: 180, height: 240, anchor: { at: "cursor" } },
  ]);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.ops[0].op, "createRoom");
    // name is lowercased
    assert.equal((r.ops[0] as { name: string }).name, "living room");
  }
});

test("validateOps clamps oversize rooms and furniture", () => {
  const r = validateOps([
    { op: "createRoom", name: "huge", width: 99999, height: 1, anchor: { at: "cursor" } },
    { op: "placeFurniture", kind: "sofa", anchor: { at: "cursor" }, width: 99999, height: 1 },
  ]);
  assert.ok(r.ok);
  if (r.ok) {
    const room = r.ops[0] as { width: number; height: number };
    assert.equal(room.width, LIMITS.roomMax);
    assert.equal(room.height, LIMITS.roomMin);
    const f = r.ops[1] as { width: number; height: number };
    assert.equal(f.width, LIMITS.furnMax);
    assert.equal(f.height, LIMITS.furnMin);
  }
});

test("validateOps rejects unknown op", () => {
  const r = validateOps([{ op: "nuke", target: { id: "x" } }]);
  assert.equal(r.ok, false);
});

test("validateOps rejects non-array", () => {
  assert.equal(validateOps({ op: "createRoom" }).ok, false);
});

test("validateOps rejects createRoom missing dims", () => {
  assert.equal(validateOps([{ op: "createRoom", name: "x" }]).ok, false);
});

test("validateOps accepts wallOf ref for addDoor", () => {
  const r = validateOps([
    { op: "addDoor", wall: { wallOf: "living room", side: "south" }, width: 36, along: "center" },
  ]);
  assert.ok(r.ok);
});

test("validateOps passes through clarify", () => {
  const r = validateOps([{ op: "clarify", question: "which one?" }]);
  assert.ok(r.ok);
  if (r.ok) assert.equal((r.ops[0] as { question: string }).question, "which one?");
});
