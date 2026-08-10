import { test } from "node:test";
import assert from "node:assert/strict";
import { bookletFilename, bookletPages, fitBox } from "./booklet.ts";
import { Editor } from "../editor.ts";
import { rooms } from "../model/document.ts";

// --- Page plan --------------------------------------------------------------

test("one page per floor, ground floor first", () => {
  const ed = new Editor();
  ed.addRoomTemplate("kitchen");
  ed.addFloor("Upstairs");
  ed.addRoomTemplate("bedroom");

  const pages = bookletPages(ed.allFloorEntities());
  assert.equal(pages.length, 2);
  assert.deepEqual(pages.map((p) => p.name), ["Ground floor", "Upstairs"]);
});

test("each page carries that floor's own area, not the whole plan's", () => {
  const ed = new Editor();
  ed.addRoomTemplate("kitchen"); // 12 x 10 = 120
  ed.addFloor("Upstairs");
  ed.addRoomTemplate("living"); // 16 x 14 = 224

  const pages = bookletPages(ed.allFloorEntities());
  assert.equal(pages[0].areaSqFt, 120);
  assert.equal(pages[1].areaSqFt, 224);
});

test("an empty floor still gets a page, flagged empty", () => {
  const ed = new Editor();
  ed.addRoomTemplate("office");
  ed.addFloor("Attic"); // left blank

  const pages = bookletPages(ed.allFloorEntities());
  assert.equal(pages.length, 2);
  assert.equal(pages[0].empty, false);
  assert.equal(pages[1].empty, true);
  assert.equal(pages[1].areaSqFt, 0);
});

test("a single-floor plan produces a single page", () => {
  const ed = new Editor();
  ed.addRoomTemplate("bathroom");
  assert.equal(bookletPages(ed.allFloorEntities()).length, 1);
});

test("page floorIds match the editor's floors", () => {
  const ed = new Editor();
  ed.addFloor("Upstairs");
  const pages = bookletPages(ed.allFloorEntities());
  assert.deepEqual(pages.map((p) => p.floorId), ed.floors.map((f) => f.id));
});

// --- Rendering a floor must not disturb editor state ------------------------

test("rendering a non-active floor leaves history, selection and active floor intact", () => {
  const ed = new Editor();
  ed.addRoomTemplate("kitchen");
  const ground = ed.activeFloorId;
  ed.addFloor("Upstairs");
  ed.addRoomTemplate("bedroom");

  const activeBefore = ed.activeFloorId;
  const selectionBefore = ed.selectionIds;
  const canUndoBefore = ed.canUndo;
  const revisionBefore = ed.revision;

  // Render the OTHER floor. Without a canvas this still exercises the swap and
  // its restore path via floorBounds, which reads the same entity array.
  const groundBounds = ed.floorBounds(ground);
  assert.ok(groundBounds, "the ground floor should have content");

  assert.equal(ed.activeFloorId, activeBefore);
  assert.deepEqual(ed.selectionIds, selectionBefore);
  assert.equal(ed.canUndo, canUndoBefore);
  assert.equal(ed.revision, revisionBefore);
  // The active floor's own geometry is still there and undo still works.
  assert.equal(rooms(ed.doc)[0].name, "Bedroom");
  ed.undo();
  assert.equal(rooms(ed.doc).length, 0);
});

test("floorBounds is per-floor and null for an empty floor", () => {
  const ed = new Editor();
  ed.addRoomTemplate("bathroom"); // 8 x 6 ft
  const ground = ed.activeFloorId;
  ed.addFloor("Attic");
  const attic = ed.activeFloorId;

  assert.equal(ed.floorBounds(attic), null);

  const b = ed.floorBounds(ground)!;
  assert.ok(b);
  // 8ft x 6ft of walls, plus wall thickness on each side.
  assert.ok(b.maxX - b.minX >= 96 && b.maxX - b.minX <= 96 + 12);
  assert.ok(b.maxY - b.minY >= 72 && b.maxY - b.minY <= 72 + 12);
});

// --- Layout maths -----------------------------------------------------------

test("fitBox preserves aspect ratio", () => {
  const r = fitBox(200, 100, 50, 50);
  assert.equal(r.width / r.height, 2);
});

test("fitBox never exceeds either bound", () => {
  for (const [w, h] of [[300, 100], [100, 300], [50, 50], [1800, 1000]]) {
    const r = fitBox(w, h, 400, 250);
    assert.ok(r.width <= 400 + 1e-9, `width ${r.width} > 400`);
    assert.ok(r.height <= 250 + 1e-9, `height ${r.height} > 250`);
  }
});

test("fitBox fills the constraining axis exactly", () => {
  // Wide image into a wide box -> width-constrained.
  const wide = fitBox(400, 100, 200, 200);
  assert.equal(wide.width, 200);
  // Tall image -> height-constrained.
  const tall = fitBox(100, 400, 200, 200);
  assert.equal(tall.height, 200);
});

test("fitBox degrades safely on a zero-sized image", () => {
  assert.deepEqual(fitBox(0, 0, 100, 100), { width: 0, height: 0 });
});

// --- Filename ---------------------------------------------------------------

test("booklet filenames are file-safe and suffixed", () => {
  assert.equal(bookletFilename("My House!"), "my-house-booklet.pdf");
  assert.equal(bookletFilename("  "), "plan-booklet.pdf");
  assert.equal(bookletFilename("Beach   Cottage"), "beach-cottage-booklet.pdf");
});
