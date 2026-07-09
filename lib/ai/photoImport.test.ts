import { test } from "node:test";
import assert from "node:assert/strict";
import { createDocument } from "../model/types.ts";
import { Editor } from "../editor.ts";
import { validateOps } from "./ops.ts";
import { detectedWidthInches, buildPhotoCommand } from "./photoImport.ts";
import { walls } from "../model/document.ts";

function ops(raw: unknown) {
  const v = validateOps(raw);
  assert.ok(v.ok, v.ok ? "" : v.error);
  return v.ok ? v.ops : [];
}

const TWO_ROOMS = ops([
  { op: "createRoom", name: "a", width: 100, height: 100, anchor: { x: 0, y: 0 } },
  { op: "createRoom", name: "b", width: 100, height: 100, anchor: { x: 100, y: 0 } },
]);

test("detectedWidthInches spans the full plan bounding box", () => {
  // room a: x in [-50,50]; room b: x in [50,150] -> overall width 200
  assert.equal(detectedWidthInches(TWO_ROOMS), 200);
});

test("buildPhotoCommand scales the plan to the requested real width", () => {
  const editor = new Editor();
  const built = buildPhotoCommand(editor, TWO_ROOMS, 400); // detected 200 -> factor 2
  assert.ok(built);
  if (!built) return;
  built.command.do(editor.doc);

  const ws = walls(editor.doc);
  assert.ok(ws.length >= 8); // 4 walls per room
  let minX = Infinity;
  let maxX = -Infinity;
  for (const w of ws) {
    minX = Math.min(minX, w.a.x, w.b.x);
    maxX = Math.max(maxX, w.a.x, w.b.x);
  }
  assert.ok(Math.abs(maxX - minX - 400) < 1, `expected width ~400, got ${maxX - minX}`);
});

test("buildPhotoCommand centers the plan on the editor cursor", () => {
  const editor = new Editor();
  const built = buildPhotoCommand(editor, TWO_ROOMS, 240);
  assert.ok(built);
  if (!built) return;
  built.command.do(editor.doc);

  const ws = walls(editor.doc);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const w of ws) {
    minX = Math.min(minX, w.a.x, w.b.x);
    maxX = Math.max(maxX, w.a.x, w.b.x);
    minY = Math.min(minY, w.a.y, w.b.y);
    maxY = Math.max(maxY, w.a.y, w.b.y);
  }
  const c = editor.aiCursor;
  assert.ok(Math.abs((minX + maxX) / 2 - c.x) < 1, "centered x");
  assert.ok(Math.abs((minY + maxY) / 2 - c.y) < 1, "centered y");
});

void createDocument;
