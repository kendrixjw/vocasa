import { test } from "node:test";
import assert from "node:assert/strict";
import { ROOM_TEMPLATES, findTemplate, templateEntities } from "./templates.ts";
import { Editor } from "../editor.ts";
import { furniture, rooms, walls } from "../model/document.ts";
import { furnitureBounds } from "../model/furniture.ts";
import { furnitureDef } from "../furniture/library.ts";

// --- The templates themselves ----------------------------------------------

test("every template item names a kind that exists in the furniture library", () => {
  for (const tpl of ROOM_TEMPLATES) {
    for (const it of tpl.items) {
      assert.ok(furnitureDef(it.kind), `${tpl.key}: unknown furniture kind "${it.kind}"`);
    }
  }
});

test("template keys are unique", () => {
  const keys = ROOM_TEMPLATES.map((t) => t.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("every item fits inside its room's walls", () => {
  for (const tpl of ROOM_TEMPLATES) {
    const entities = templateEntities(tpl, { x: 0, y: 0 });
    for (const f of entities.filter((e) => e.type === "furniture")) {
      const b = furnitureBounds(f);
      assert.ok(b.minX >= 0, `${tpl.key}/${f.kind} crosses the west wall`);
      assert.ok(b.minY >= 0, `${tpl.key}/${f.kind} crosses the south wall`);
      assert.ok(b.maxX <= tpl.width * 12, `${tpl.key}/${f.kind} crosses the east wall`);
      assert.ok(b.maxY <= tpl.height * 12, `${tpl.key}/${f.kind} crosses the north wall`);
    }
  }
});

test("no two items in a template overlap (a rug may sit under anything)", () => {
  for (const tpl of ROOM_TEMPLATES) {
    const items = templateEntities(tpl, { x: 0, y: 0 }).filter((e) => e.type === "furniture");
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (items[i].kind === "rug" || items[j].kind === "rug") continue;
        const a = furnitureBounds(items[i]);
        const b = furnitureBounds(items[j]);
        const overlaps = a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
        assert.ok(!overlaps, `${tpl.key}: ${items[i].kind} overlaps ${items[j].kind}`);
      }
    }
  }
});

test("templateEntities offsets everything by the origin", () => {
  const tpl = findTemplate("bedroom")!;
  const at0 = templateEntities(tpl, { x: 0, y: 0 }).filter((e) => e.type === "furniture");
  const at100 = templateEntities(tpl, { x: 100, y: 250 }).filter((e) => e.type === "furniture");
  for (let i = 0; i < at0.length; i++) {
    assert.equal(at100[i].position.x, at0[i].position.x + 100);
    assert.equal(at100[i].position.y, at0[i].position.y + 250);
  }
});

// --- Through the editor ----------------------------------------------------

test("dropping a template adds a closed room with the template's name", () => {
  const ed = new Editor();
  ed.addRoomTemplate("kitchen");

  assert.equal(walls(ed.doc).length, 4);
  const rs = rooms(ed.doc);
  assert.equal(rs.length, 1);
  // The seeded name must survive syncRooms rather than becoming "Room 1".
  assert.equal(rs[0].name, "Kitchen");
  assert.equal(rs[0].areaSqFt, 120); // 12 x 10
  assert.equal(furniture(ed.doc).length, 4);
});

test("the room area is measured by the wall graph, not copied from the template", () => {
  const ed = new Editor();
  ed.addRoomTemplate("living"); // 16 x 14
  assert.equal(rooms(ed.doc)[0].areaSqFt, 224);
});

test("a template is a single undo step that fully reverses", () => {
  const ed = new Editor();
  ed.addRoomTemplate("bathroom");
  assert.equal(ed.doc.entities.length > 0, true);

  ed.undo();
  assert.equal(walls(ed.doc).length, 0);
  assert.equal(rooms(ed.doc).length, 0);
  assert.equal(furniture(ed.doc).length, 0);

  ed.redo();
  assert.equal(walls(ed.doc).length, 4);
  assert.equal(rooms(ed.doc)[0].name, "Bathroom");
});

test("a second template lands clear of the first", () => {
  const ed = new Editor();
  ed.addRoomTemplate("bedroom");
  const firstMaxX = Math.max(...walls(ed.doc).map((w) => Math.max(w.a.x, w.b.x)));

  ed.addRoomTemplate("office");
  const rs = rooms(ed.doc);
  assert.equal(rs.length, 2, "the two rooms must not merge into one loop");
  assert.deepEqual(rs.map((r) => r.name).sort(), ["Bedroom", "Home office"]);

  const office = rs.find((r) => r.name === "Home office")!;
  const officeMinX = Math.min(...office.poly.map((p) => p.x));
  assert.ok(officeMinX > firstMaxX, "the new room must start east of the old one");
});

test("each template drops distinct rooms that keep their own names", () => {
  const ed = new Editor();
  for (const tpl of ROOM_TEMPLATES) ed.addRoomTemplate(tpl.key);
  const names = rooms(ed.doc).map((r) => r.name).sort();
  assert.deepEqual(names, ROOM_TEMPLATES.map((t) => t.label).sort());
});

test("the new room is selected so it can be renamed or moved immediately", () => {
  const ed = new Editor();
  ed.addRoomTemplate("dining");
  assert.deepEqual(ed.selectionIds, [rooms(ed.doc)[0].id]);
});

test("an unknown template key is a no-op", () => {
  const ed = new Editor();
  ed.addRoomTemplate("ballroom");
  assert.equal(ed.doc.entities.length, 0);
  assert.equal(ed.canUndo, false);
});

test("templates survive a save/load round-trip with their names", () => {
  const ed = new Editor();
  ed.addRoomTemplate("kitchen");

  const restored = new Editor();
  restored.load(ed.serialize());
  assert.equal(rooms(restored.doc)[0].name, "Kitchen");
  assert.equal(furniture(restored.doc).length, 4);
});
