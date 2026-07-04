import { test } from "node:test";
import assert from "node:assert/strict";
import { createDocument } from "./model/types.ts";
import { createWall } from "./model/wall.ts";
import { AddEntities, DeleteEntities, TranslateEntities } from "./commands.ts";
import { History } from "./history.ts";

test("AddEntities do/undo adds then removes", () => {
  const doc = createDocument();
  const w = createWall({ x: 0, y: 0 }, { x: 100, y: 0 });
  const cmd = new AddEntities([w]);
  cmd.do(doc);
  assert.equal(doc.entities.length, 1);
  cmd.undo(doc);
  assert.equal(doc.entities.length, 0);
});

test("DeleteEntities restores entities at original indices", () => {
  const doc = createDocument();
  const a = createWall({ x: 0, y: 0 }, { x: 10, y: 0 });
  const b = createWall({ x: 10, y: 0 }, { x: 20, y: 0 });
  const c = createWall({ x: 20, y: 0 }, { x: 30, y: 0 });
  doc.entities.push(a, b, c);
  const cmd = new DeleteEntities([b.id]);
  cmd.do(doc);
  assert.deepEqual(doc.entities.map((e) => e.id), [a.id, c.id]);
  cmd.undo(doc);
  assert.deepEqual(doc.entities.map((e) => e.id), [a.id, b.id, c.id]);
});

test("TranslateEntities moves both endpoints and reverses exactly", () => {
  const doc = createDocument();
  const w = createWall({ x: 0, y: 0 }, { x: 100, y: 50 });
  doc.entities.push(w);
  const cmd = new TranslateEntities([w.id], 12, -24);
  cmd.do(doc);
  assert.deepEqual(w.a, { x: 12, y: -24 });
  assert.deepEqual(w.b, { x: 112, y: 26 });
  cmd.undo(doc);
  assert.deepEqual(w.a, { x: 0, y: 0 });
  assert.deepEqual(w.b, { x: 100, y: 50 });
});

test("History undo/redo round-trips document state", () => {
  const doc = createDocument();
  const hist = new History();
  const w = createWall({ x: 0, y: 0 }, { x: 100, y: 0 });
  hist.execute(doc, new AddEntities([w]));
  assert.equal(doc.entities.length, 1);
  assert.ok(hist.canUndo && !hist.canRedo);

  hist.undo(doc);
  assert.equal(doc.entities.length, 0);
  assert.ok(!hist.canUndo && hist.canRedo);

  hist.redo(doc);
  assert.equal(doc.entities.length, 1);

  // A new command after undo clears the redo stack.
  hist.undo(doc);
  hist.execute(doc, new AddEntities([createWall({ x: 0, y: 0 }, { x: 1, y: 1 })]));
  assert.ok(!hist.canRedo);
});
