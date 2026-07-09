import { test } from "node:test";
import assert from "node:assert/strict";
import { Editor } from "../editor.ts";
import { AddEntities } from "../commands.ts";
import { validateOps } from "../ai/ops.ts";
import { resolveBatch } from "../ai/resolver.ts";
import { createDimension } from "../model/dimension.ts";
import { createAnnotation } from "../model/annotation.ts";
import { buildDxf } from "./dxf.ts";

function seeded(): Editor {
  const ed = new Editor();
  const v = validateOps([
    { op: "createRoom", name: "living room", width: 180, height: 240, anchor: { at: "cursor" } },
  ]);
  assert.ok(v.ok);
  if (v.ok) {
    const res = resolveBatch(v.ops, ed.doc, { x: 0, y: 0 }, []);
    if (res.kind === "ops") ed.execute(res.command);
  }
  ed.execute(
    new AddEntities([
      createDimension({ x: 0, y: 0 }, { x: 120, y: 0 }),
      createAnnotation({ x: 30, y: 30 }, "verify on site"),
    ]),
  );
  return ed;
}

test("buildDxf emits a well-formed R12 document", () => {
  const dxf = buildDxf(seeded().doc);
  assert.ok(dxf.startsWith("0\r\nSECTION"), "starts with a SECTION");
  assert.ok(dxf.includes("AC1009"), "declares R12");
  assert.ok(dxf.includes("$INSUNITS"), "sets units");
  assert.ok(dxf.includes("\r\nENTITIES\r\n"), "has an ENTITIES section");
  assert.ok(dxf.trimEnd().endsWith("EOF"), "ends with EOF");
});

test("buildDxf includes wall lines, the room name, dimension, and note", () => {
  const dxf = buildDxf(seeded().doc);
  assert.ok(dxf.includes("LINE"), "has LINE entities");
  assert.ok(dxf.includes("WALLS"), "walls layer");
  assert.ok(dxf.includes("living room"), "room name as TEXT");
  assert.ok(dxf.includes("DIMENSIONS"), "dimension layer");
  assert.ok(dxf.includes("verify on site"), "annotation text");
});

test("buildDxf defines the layers it references", () => {
  const dxf = buildDxf(seeded().doc);
  for (const layer of ["WALLS", "ROOMS", "DIMENSIONS", "NOTES"]) {
    assert.ok(dxf.includes(layer), `layer ${layer} present`);
  }
  // Balanced sections: one HEADER, one TABLES, one ENTITIES, one EOF.
  const sections = dxf.split("\r\nSECTION\r\n").length - 1;
  assert.equal(sections, 3);
});

test("buildDxf on an empty plan still produces a valid shell", () => {
  const dxf = buildDxf(new Editor().doc);
  assert.ok(dxf.includes("ENTITIES"));
  assert.ok(dxf.trimEnd().endsWith("EOF"));
});
