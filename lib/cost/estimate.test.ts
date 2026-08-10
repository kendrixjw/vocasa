import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_COST_SETTINGS,
  FINISHES,
  estimate,
  floorAreaSqFt,
  normalizeCostSettings,
  usd,
  usdCompact,
  type FloorEntities,
} from "./estimate.ts";
import type { Entity } from "../model/types.ts";
import { Editor } from "../editor.ts";
import { AddEntities } from "../commands.ts";
import { createWall, DEFAULT_WALL_THICKNESS } from "../model/wall.ts";

function room(areaSqFt: number, id = crypto.randomUUID()): Entity {
  return { id, type: "room", wallIds: [], name: "Room", poly: [], areaSqFt };
}

function sofa(id = crypto.randomUUID()): Entity {
  return { id, type: "furniture", kind: "sofa", position: { x: 0, y: 0 }, rotation: 0, w: 84, h: 36 };
}

function floor(entities: Entity[], name = "Ground floor"): FloorEntities {
  return { id: crypto.randomUUID(), name, entities };
}

// --- Area ------------------------------------------------------------------

test("floor area sums rooms and ignores every other entity type", () => {
  const entities = [room(200), room(120), sofa(), { id: "w", type: "wall", a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, thickness: 5 } as Entity];
  assert.equal(floorAreaSqFt(entities), 320);
});

test("an empty floor costs nothing", () => {
  const e = estimate([floor([])], DEFAULT_COST_SETTINGS);
  assert.equal(e.totalAreaSqFt, 0);
  assert.equal(e.total, 0);
  assert.equal(e.floors.length, 1);
});

test("no floors at all is still a valid zero estimate", () => {
  const e = estimate([], DEFAULT_COST_SETTINGS);
  assert.equal(e.total, 0);
  assert.deepEqual(e.floors, []);
});

// --- Money -----------------------------------------------------------------

test("standard new build: area x rate plus a per-item allowance", () => {
  // standard/build = 150 structure + 90 finishes = 240/sqft; item = 800.
  const e = estimate([floor([room(1000), sofa(), sofa()])], { finish: "standard", mode: "build" });
  assert.equal(e.rate, 240);
  assert.equal(e.totalAreaSqFt, 1000);
  assert.equal(e.totalItems, 2);
  assert.equal(e.total, 1000 * 240 + 2 * 800);
});

test("renovation is cheaper per sqft than new build for the same plan", () => {
  const plan = [floor([room(1500), sofa()])];
  const build = estimate(plan, { finish: "standard", mode: "build" });
  const reno = estimate(plan, { finish: "standard", mode: "reno" });
  assert.ok(reno.total < build.total);
  assert.equal(reno.totalAreaSqFt, build.totalAreaSqFt); // geometry is unchanged
});

test("finish level orders economy < standard < premium", () => {
  const plan = [floor([room(1200), sofa(), sofa(), sofa()])];
  const totals = FINISHES.map((f) => estimate(plan, { finish: f.id, mode: "build" }).total);
  assert.deepEqual(totals, [...totals].sort((a, b) => a - b));
  assert.equal(new Set(totals).size, 3);
});

test("categories break the total down without losing a dollar", () => {
  const e = estimate([floor([room(880), sofa()])], { finish: "premium", mode: "reno" });
  const sum = e.categories.reduce((s, c) => s + c.amount, 0);
  assert.equal(sum, e.total);
});

test("per-floor costs sum to the total across a multi-floor plan", () => {
  const e = estimate(
    [floor([room(900), sofa()], "Ground floor"), floor([room(700), sofa(), sofa()], "Upstairs")],
    { finish: "standard", mode: "build" },
  );
  assert.equal(e.floors.length, 2);
  assert.equal(e.totalAreaSqFt, 1600);
  assert.equal(e.totalItems, 3);
  assert.equal(e.floors.reduce((s, f) => s + f.cost, 0), e.total);
  assert.equal(e.floors[1].name, "Upstairs");
});

// --- Settings hygiene ------------------------------------------------------

test("unknown or missing stored settings fall back to the default", () => {
  assert.deepEqual(normalizeCostSettings(undefined), DEFAULT_COST_SETTINGS);
  assert.deepEqual(normalizeCostSettings({ finish: "gold", mode: "teleport" }), DEFAULT_COST_SETTINGS);
  assert.deepEqual(normalizeCostSettings({ finish: "premium", mode: "reno" }), { finish: "premium", mode: "reno" });
  // Partial input keeps the valid half.
  assert.deepEqual(normalizeCostSettings({ finish: "economy" }), { finish: "economy", mode: "build" });
});

// --- Formatting ------------------------------------------------------------

test("usd rounds to whole dollars with separators", () => {
  assert.equal(usd(1234.6), "$1,235");
  assert.equal(usd(0), "$0");
});

test("usdCompact abbreviates thousands and millions", () => {
  assert.equal(usdCompact(940), "$940");
  assert.equal(usdCompact(128_400), "$128k");
  assert.equal(usdCompact(1_440_000), "$1.4M");
});

// --- Editor integration ----------------------------------------------------

test("cost settings round-trip through serialize/load and bump the revision", () => {
  const ed = new Editor();
  assert.deepEqual(ed.costSettings, DEFAULT_COST_SETTINGS);

  const before = ed.revision;
  ed.setCostSettings({ finish: "premium", mode: "reno" });
  assert.ok(ed.revision > before, "changing settings must trigger autosave");

  const restored = new Editor();
  restored.load(ed.serialize());
  assert.deepEqual(restored.costSettings, { finish: "premium", mode: "reno" });
});

test("setting the same cost settings does not bump the revision", () => {
  const ed = new Editor();
  const before = ed.revision;
  ed.setCostSettings({ ...DEFAULT_COST_SETTINGS });
  assert.equal(ed.revision, before);
});

test("a plan saved before the estimator existed loads at the default settings", () => {
  const ed = new Editor();
  ed.setCostSettings({ finish: "economy", mode: "reno" });
  const legacy = ed.serialize();
  delete legacy.cost;

  ed.load(legacy);
  assert.deepEqual(ed.costSettings, DEFAULT_COST_SETTINGS);
});

test("estimating real drawn geometry picks up auto-detected rooms", () => {
  // A closed 120in x 120in box -> one 10ft x 10ft room -> 100 sqft.
  const ed = new Editor();
  const c: [number, number][] = [[0, 0], [120, 0], [120, 120], [0, 120]];
  ed.execute(
    new AddEntities(
      c.map((p, i) => {
        const q = c[(i + 1) % c.length];
        return createWall({ x: p[0], y: p[1] }, { x: q[0], y: q[1] }, DEFAULT_WALL_THICKNESS);
      }),
    ),
  );

  const e = estimate(ed.allFloorEntities(), { finish: "standard", mode: "build" });
  assert.equal(e.totalAreaSqFt, 100);
  assert.equal(e.total, 100 * 240);
});
