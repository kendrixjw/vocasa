// Scene indexing for the AI bridge: room bounds and named compass walls, so we
// can resolve "the north wall of the living room" to a concrete wall + face.
// Assumes roughly axis-aligned rectangular rooms (what createRoom produces);
// hand-drawn odd shapes classify best-effort.

import type { Bounds, Point } from "../viewport.ts";
import type { Document, Room, Wall } from "../model/types.ts";
import { rooms, walls } from "../model/document.ts";

export type Side = "north" | "south" | "east" | "west";

export type RoomInfo = {
  room: Room;
  bounds: Bounds; // world inches (wall centerlines)
  center: Point;
  thickness: number; // representative wall thickness
  wallBySide: Partial<Record<Side, string>>;
};

function polyBounds(poly: Point[]): Bounds {
  return {
    minX: Math.min(...poly.map((p) => p.x)),
    minY: Math.min(...poly.map((p) => p.y)),
    maxX: Math.max(...poly.map((p) => p.x)),
    maxY: Math.max(...poly.map((p) => p.y)),
  };
}

/** Classify each of a room's walls to a compass side (north = +Y / up). */
function classifyWalls(roomWalls: Wall[], center: Point): Partial<Record<Side, string>> {
  const out: Partial<Record<Side, string>> = {};
  for (const w of roomWalls) {
    const dx = Math.abs(w.b.x - w.a.x);
    const dy = Math.abs(w.b.y - w.a.y);
    const midY = (w.a.y + w.b.y) / 2;
    const midX = (w.a.x + w.b.x) / 2;
    if (dx >= dy) {
      // Horizontal wall -> north (above center) or south (below).
      if (midY >= center.y) out.north = w.id;
      else out.south = w.id;
    } else {
      // Vertical wall -> east (right) or west (left).
      if (midX >= center.x) out.east = w.id;
      else out.west = w.id;
    }
  }
  return out;
}

export function buildRoomIndex(doc: Document): RoomInfo[] {
  const byId = new Map(walls(doc).map((w) => [w.id, w]));
  return rooms(doc).map((room) => {
    const bounds = polyBounds(room.poly);
    const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    const roomWalls = room.wallIds.map((id) => byId.get(id)).filter((w): w is Wall => !!w);
    const thickness = roomWalls[0]?.thickness ?? 5;
    return { room, bounds, center, thickness, wallBySide: classifyWalls(roomWalls, center) };
  });
}

export function findRoomByName(index: RoomInfo[], name: string): RoomInfo | undefined {
  const n = name.toLowerCase().trim();
  return index.find((r) => r.room.name.toLowerCase() === n);
}
