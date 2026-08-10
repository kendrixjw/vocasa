// Rough build / renovation cost estimate (USD), split into line items.
//
// Deliberately a back-of-envelope model: area x $/sqft plus a flat allowance per
// furniture item. Areas come from the room polygons the wall graph already
// derives (`Room.areaSqFt`), so an L-shaped room costs what it actually covers
// rather than its bounding box.
//
// Pure functions over entity arrays — no Editor, no React, no network.

import type { Entity } from "../model/types.ts";

export type FinishId = "economy" | "standard" | "premium";
export type ModeId = "build" | "reno";

export type Finish = {
  id: FinishId;
  label: string;
  /** $/sqft, split so the breakdown can show where the money goes. */
  build: { structure: number; finishes: number };
  reno: { structure: number; finishes: number };
  /** Flat $ allowance per furniture item. */
  item: number;
};

export const FINISHES: readonly Finish[] = [
  { id: "economy", label: "Economy", build: { structure: 85, finishes: 45 }, reno: { structure: 30, finishes: 30 }, item: 350 },
  { id: "standard", label: "Standard", build: { structure: 150, finishes: 90 }, reno: { structure: 55, finishes: 55 }, item: 800 },
  { id: "premium", label: "Premium", build: { structure: 250, finishes: 170 }, reno: { structure: 90, finishes: 110 }, item: 1800 },
];

export const MODES: readonly { id: ModeId; label: string }[] = [
  { id: "build", label: "New build" },
  { id: "reno", label: "Renovation" },
];

export type CostSettings = { finish: FinishId; mode: ModeId };

export const DEFAULT_COST_SETTINGS: CostSettings = { finish: "standard", mode: "build" };

/** Coerce untrusted stored settings to a known finish/mode. */
export function normalizeCostSettings(v: unknown): CostSettings {
  const o = (v ?? {}) as Record<string, unknown>;
  const finish = FINISHES.some((f) => f.id === o.finish)
    ? (o.finish as FinishId)
    : DEFAULT_COST_SETTINGS.finish;
  const mode = MODES.some((m) => m.id === o.mode) ? (o.mode as ModeId) : DEFAULT_COST_SETTINGS.mode;
  return { finish, mode };
}

/** A floor's geometry, as the estimator needs it. */
export type FloorEntities = { id: string; name: string; entities: Entity[] };

export type FloorEstimate = {
  id: string;
  name: string;
  areaSqFt: number;
  items: number;
  cost: number;
};

export type CostCategory = { key: string; label: string; amount: number };

export type Estimate = {
  /** Combined $/sqft actually applied (structure + finishes). */
  rate: number;
  totalAreaSqFt: number;
  totalItems: number;
  total: number;
  floors: FloorEstimate[];
  categories: CostCategory[];
};

/** Enclosed floor area of one floor, in square feet. Rooms are non-overlapping
 *  faces of the wall graph, so summing them double-counts nothing. */
export function floorAreaSqFt(entities: Entity[]): number {
  let sum = 0;
  for (const e of entities) {
    if (e.type === "room") sum += e.areaSqFt;
  }
  return sum;
}

function furnitureCount(entities: Entity[]): number {
  let n = 0;
  for (const e of entities) {
    if (e.type === "furniture") n++;
  }
  return n;
}

export function estimate(floors: FloorEntities[], settings: CostSettings): Estimate {
  const finish = FINISHES.find((f) => f.id === settings.finish) ?? FINISHES[1];
  const rates = settings.mode === "reno" ? finish.reno : finish.build;
  const rate = rates.structure + rates.finishes;

  let totalAreaSqFt = 0;
  let totalItems = 0;

  const perFloor = floors.map((f) => {
    const areaSqFt = floorAreaSqFt(f.entities);
    const items = furnitureCount(f.entities);
    totalAreaSqFt += areaSqFt;
    totalItems += items;
    return {
      id: f.id,
      name: f.name,
      areaSqFt: Math.round(areaSqFt),
      items,
      cost: Math.round(areaSqFt * rate + items * finish.item),
    };
  });

  const structure = Math.round(totalAreaSqFt * rates.structure);
  const finishes = Math.round(totalAreaSqFt * rates.finishes);
  const furniture = Math.round(totalItems * finish.item);

  return {
    rate,
    totalAreaSqFt: Math.round(totalAreaSqFt),
    totalItems,
    total: structure + finishes + furniture,
    floors: perFloor,
    categories: [
      { key: "structure", label: "Structure & shell", amount: structure },
      { key: "finishes", label: "Finishes & fixtures", amount: finishes },
      { key: "furniture", label: "Furniture & decor", amount: furniture },
    ],
  };
}

/** Whole dollars with thousands separators, e.g. `$128,400`. */
export function usd(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

/** Compact dollars for tight spots, e.g. `$128k`, `$1.4M`. */
export function usdCompact(n: number): string {
  const v = Math.round(n);
  if (v >= 1_000_000) return "$" + (v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1) + "M";
  if (v >= 1_000) return "$" + Math.round(v / 1000) + "k";
  return "$" + v;
}
