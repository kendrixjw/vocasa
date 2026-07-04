// Reconcile Room entities with the currently-detected wall loops. Called after
// any wall change (add/delete/move) and after undo/redo. Because rooms are a
// pure function of the walls, this is idempotent — the room set is always
// correct regardless of how we got here.
//
// Names are preserved across edits by matching a detected loop to an existing
// room via wall-set overlap (Jaccard). Moving a wall keeps the same wallIds, so
// the room (and its name) survives; splitting/merging creates new rooms.

import type { Document, Room } from "../model/types.ts";
import { walls } from "../model/document.ts";
import { createRoom } from "../model/room.ts";
import { detectLoops } from "./detect.ts";

const MATCH_THRESHOLD = 0.5;

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function nextRoomName(used: Set<string>): string {
  let k = 1;
  while (used.has(`Room ${k}`)) k++;
  return `Room ${k}`;
}

/** Mutate `doc` so its Room entities exactly match the detected loops. */
export function syncRooms(doc: Document): void {
  const loops = detectLoops(walls(doc));
  const existing = doc.entities.filter((e): e is Room => e.type === "room");
  const nonRooms = doc.entities.filter((e) => e.type !== "room");

  const usedIds = new Set<string>();
  const matched: Room[] = [];
  const unmatched: (typeof loops)[number][] = [];

  for (const loop of loops) {
    const lset = new Set(loop.wallIds);
    let best: Room | null = null;
    let bestScore = 0;
    for (const r of existing) {
      if (usedIds.has(r.id)) continue;
      const s = jaccard(lset, new Set(r.wallIds));
      if (s > bestScore) {
        bestScore = s;
        best = r;
      }
    }
    if (best && bestScore >= MATCH_THRESHOLD) {
      usedIds.add(best.id);
      best.wallIds = [...loop.wallIds];
      best.poly = loop.poly.map((p) => ({ ...p }));
      best.areaSqFt = loop.areaSqIn / 144;
      matched.push(best);
    } else {
      unmatched.push(loop);
    }
  }

  const usedNames = new Set(matched.map((r) => r.name));
  const created = unmatched.map((loop) => {
    const name = nextRoomName(usedNames);
    usedNames.add(name);
    return createRoom(loop.wallIds, name, loop.poly, loop.areaSqIn / 144);
  });

  doc.entities = [...nonRooms, ...matched, ...created];
}
