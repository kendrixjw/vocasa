// Build the compact scene snapshot sent to the model alongside the transcript.
// Coordinates are rounded integers (inches). Lean by design — only what's needed
// to resolve references.

import type { Point } from "../viewport.ts";
import type { Document } from "../model/types.ts";
import { furniture, openings, walls } from "../model/document.ts";
import { buildRoomIndex } from "./scene.ts";

const r = Math.round;
const rp = (p: Point) => ({ x: r(p.x), y: r(p.y) });

export function buildSnapshot(doc: Document, cursor: Point, selection: string[]): unknown {
  const index = buildRoomIndex(doc);

  return {
    units: "inches",
    cursor: rp(cursor),
    selection,
    rooms: index.map((info) => ({
      id: info.room.id,
      name: info.room.name,
      bounds: {
        x: r(info.bounds.minX),
        y: r(info.bounds.minY),
        w: r(info.bounds.maxX - info.bounds.minX),
        h: r(info.bounds.maxY - info.bounds.minY),
      },
      walls: info.wallBySide,
    })),
    walls: walls(doc).map((w) => ({ id: w.id, a: rp(w.a), b: rp(w.b), thickness: r(w.thickness) })),
    doors: openings(doc)
      .filter((o) => o.type === "door")
      .map((d) => ({ id: d.id, wall: d.wallId, width: r(d.width) })),
    windows: openings(doc)
      .filter((o) => o.type === "window")
      .map((w) => ({ id: w.id, wall: w.wallId, width: r(w.width) })),
    furniture: furniture(doc).map((f) => ({
      id: f.id,
      kind: f.kind,
      position: rp(f.position),
      rotation: r((f.rotation * 180) / Math.PI),
    })),
  };
}
