// Document-level queries. Mutations go through commands (lib/commands.ts).

import type { Bounds, Point } from "../viewport.ts";
import type { Document, Entity, Furniture, Opening, Room, Wall } from "./types.ts";
import { wallBounds, wallEndpoints } from "./wall.ts";
import { furnitureBounds } from "./furniture.ts";

export function findEntity(doc: Document, id: string): Entity | undefined {
  return doc.entities.find((e) => e.id === id);
}

export function walls(doc: Document): Wall[] {
  return doc.entities.filter((e): e is Wall => e.type === "wall");
}

export function rooms(doc: Document): Room[] {
  return doc.entities.filter((e): e is Room => e.type === "room");
}

export function furniture(doc: Document): Furniture[] {
  return doc.entities.filter((e): e is Furniture => e.type === "furniture");
}

export function openings(doc: Document): Opening[] {
  return doc.entities.filter((e): e is Opening => e.type === "door" || e.type === "window");
}

/** An endpoint of some entity, tagged with its owner (for snap/join). */
export type NamedPoint = { point: Point; ownerId: string };

/** All wall endpoints in the document — snap/join candidates. */
export function allEndpoints(doc: Document): NamedPoint[] {
  const out: NamedPoint[] = [];
  for (const w of walls(doc)) {
    for (const p of wallEndpoints(w)) out.push({ point: p, ownerId: w.id });
  }
  return out;
}

/**
 * World bounds enclosing every entity (with wall thickness), or null when the
 * document is empty.
 */
export function extents(doc: Document): Bounds | null {
  let b: Bounds | null = null;
  const merge = (wb: Bounds) => {
    b = b
      ? {
          minX: Math.min(b.minX, wb.minX),
          minY: Math.min(b.minY, wb.minY),
          maxX: Math.max(b.maxX, wb.maxX),
          maxY: Math.max(b.maxY, wb.maxY),
        }
      : wb;
  };
  for (const w of walls(doc)) merge(wallBounds(w));
  for (const f of furniture(doc)) merge(furnitureBounds(f));
  return b;
}
