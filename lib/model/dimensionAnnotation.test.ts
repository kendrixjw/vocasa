import { test } from "node:test";
import assert from "node:assert/strict";
import type { Viewport } from "../viewport.ts";
import { createDimension, dimensionLength, distanceToDimension, hitTestDimension } from "./dimension.ts";
import { createAnnotation, hitTestAnnotation } from "./annotation.ts";
import { Editor } from "../editor.ts";
import { AddEntities, EditAnnotation, TranslateEntities } from "../commands.ts";
import { annotations, dimensions } from "./document.ts";

const VP: Viewport = { originX: 0, originY: 0, scale: 1 };

test("dimensionLength measures the span", () => {
  const d = createDimension({ x: 0, y: 0 }, { x: 30, y: 40 });
  assert.equal(dimensionLength(d), 50);
});

test("hitTestDimension is true on the line, false far away", () => {
  const d = createDimension({ x: 0, y: 0 }, { x: 100, y: 0 });
  assert.ok(hitTestDimension(d, { x: 50, y: 2 }, 5));
  assert.ok(!hitTestDimension(d, { x: 50, y: 20 }, 5));
  // Beyond the segment ends does not hit.
  assert.ok(!hitTestDimension(d, { x: 130, y: 0 }, 5));
});

test("distanceToDimension respects the perpendicular offset", () => {
  const d = createDimension({ x: 0, y: 0 }, { x: 100, y: 0 }, 10);
  // Offset shifts the line +10 along the normal (0,1) here.
  assert.ok(Math.abs(distanceToDimension(d, { x: 50, y: 10 })) < 1e-6);
});

test("hitTestAnnotation hits near its anchor in screen space", () => {
  const a = createAnnotation({ x: 100, y: 50 }, "kitchen");
  // Anchor screen point is (100, -50) under the identity viewport.
  assert.ok(hitTestAnnotation(a, { x: 100, y: -50 }, VP));
  assert.ok(!hitTestAnnotation(a, { x: 100, y: -120 }, VP));
});

test("TranslateEntities moves a dimension and an annotation, and undoes", () => {
  const ed = new Editor();
  const dim = createDimension({ x: 0, y: 0 }, { x: 100, y: 0 });
  const note = createAnnotation({ x: 10, y: 10 }, "here");
  ed.execute(new AddEntities([dim, note]));
  ed.execute(new TranslateEntities([dim.id, note.id], 5, -3));

  assert.deepEqual(dimensions(ed.doc)[0].from, { x: 5, y: -3 });
  assert.deepEqual(dimensions(ed.doc)[0].to, { x: 105, y: -3 });
  assert.deepEqual(annotations(ed.doc)[0].position, { x: 15, y: 7 });

  ed.undo();
  assert.deepEqual(dimensions(ed.doc)[0].from, { x: 0, y: 0 });
  assert.deepEqual(annotations(ed.doc)[0].position, { x: 10, y: 10 });
});

test("EditAnnotation changes text reversibly", () => {
  const ed = new Editor();
  const note = createAnnotation({ x: 0, y: 0 }, "old");
  ed.execute(new AddEntities([note]));
  ed.execute(new EditAnnotation(note.id, "new"));
  assert.equal(annotations(ed.doc)[0].text, "new");
  ed.undo();
  assert.equal(annotations(ed.doc)[0].text, "old");
});

test("serialized plans round-trip dimensions and annotations", () => {
  const src = new Editor();
  src.execute(
    new AddEntities([
      createDimension({ x: 0, y: 0 }, { x: 120, y: 0 }),
      createAnnotation({ x: 60, y: 20 }, "note"),
    ]),
  );
  const data = src.serialize();
  assert.equal(data.version, 2);

  const dst = new Editor();
  dst.load(data);
  assert.equal(dimensions(dst.doc).length, 1);
  assert.equal(annotations(dst.doc).length, 1);
  assert.equal(annotations(dst.doc)[0].text, "note");
});
