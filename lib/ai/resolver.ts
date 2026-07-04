// Client-side resolver: turn validated symbolic ops into concrete geometry and
// a single ApplyAIBatch command. Ops are simulated on a CLONE so later ops can
// reference entities created by earlier ones ("last", a room just made, etc.).
// If any reference fails to resolve, the whole batch becomes a clarify message
// rather than partially applying.

import type { Point } from "../viewport.ts";
import type { Document, Entity, Furniture, Wall } from "../model/types.ts";
import { furniture as furnitureOf } from "../model/document.ts";
import { createWall, DEFAULT_WALL_THICKNESS } from "../model/wall.ts";
import { createRoom as makeRoom, pointInRoom } from "../model/room.ts";
import { createFurniture, furnitureBounds } from "../model/furniture.ts";
import { furnitureDef } from "../furniture/library.ts";
import { clampOffset, createDoor, createWindow, wallLength } from "../model/opening.ts";
import {
  AddEntities,
  ApplyAIBatch,
  DeleteEntities,
  RenameRoom,
  SetFurnitureTransform,
} from "../commands.ts";
import type { Command } from "../history.ts";
import { buildRoomIndex, findRoomByName, type RoomInfo, type Side } from "./scene.ts";
import type { Along, Anchor, Op, Ref } from "./ops.ts";

export type ResolveResult =
  | { kind: "ops"; command: ApplyAIBatch; summary: string }
  | { kind: "clarify"; question: string };

class Clarify {
  readonly question: string;
  constructor(question: string) {
    this.question = question;
  }
}

function aliasKind(kind: string): string {
  const k = kind.replace(/\s+/g, "-");
  if (furnitureDef(k)) return k;
  const map: Record<string, string> = {
    couch: "sofa",
    bed: "bed-queen",
    "queen-bed": "bed-queen",
    "twin-bed": "bed-twin",
    "king-bed": "bed-queen",
    table: "dining-table",
    dining: "dining-table",
    "dining-table": "dining-table",
    chair: "dining-chair",
    "coffee-table": "coffee-table",
    tv: "tv-stand",
    television: "tv-stand",
    refrigerator: "fridge",
    range: "stove",
    bathtub: "tub",
    "area-rug": "rug",
  };
  return map[k] ?? k;
}

function prettyKind(kind: string): string {
  return furnitureDef(kind)?.label.toLowerCase() ?? kind.replace(/-/g, " ");
}

function dimFt(inches: number): string {
  const ft = inches / 12;
  return Number.isInteger(ft) ? String(ft) : (Math.round(ft * 10) / 10).toString();
}

export function resolveBatch(
  ops: Op[],
  doc: Document,
  cursor: Point,
  selection: string[],
): ResolveResult {
  const clone: Document = structuredClone(doc);
  const cmds: Command[] = [];
  let lastCreated: string | null = null;
  const phrases: string[] = [];

  const apply = (cmd: Command) => {
    cmds.push(cmd);
    cmd.do(clone);
  };
  const find = (id: string): Entity | undefined => clone.entities.find((e) => e.id === id);

  const resolveRef = (ref: Ref): Entity => {
    if ("id" in ref) {
      const e = find(ref.id);
      if (!e) throw new Clarify("I couldn't find that item.");
      return e;
    }
    if ("selection" in ref) {
      if (selection.length === 1) {
        const e = find(selection[0]);
        if (e) return e;
      }
      throw new Clarify(
        selection.length === 0 ? "Nothing is selected — tap the item first." : "Select just one item first.",
      );
    }
    if ("last" in ref) {
      if (lastCreated) {
        const e = find(lastCreated);
        if (e) return e;
      }
      throw new Clarify("I'm not sure what to act on.");
    }
    if ("wallOf" in ref) {
      const info = findRoomByName(buildRoomIndex(clone), ref.wallOf);
      if (!info) throw new Clarify(`I don't see a room called "${ref.wallOf}".`);
      const id = info.wallBySide[ref.side];
      if (!id) throw new Clarify(`I couldn't find the ${ref.side} wall of ${ref.wallOf}.`);
      return find(id)!;
    }
    // { kind, room? }
    const kind = aliasKind(ref.kind);
    let candidates = furnitureOf(clone).filter((f) => f.kind === kind);
    if (ref.room) {
      const info = findRoomByName(buildRoomIndex(clone), ref.room);
      if (info) candidates = candidates.filter((f) => pointInRoom(info.room, f.position));
    }
    if (candidates.length === 0) throw new Clarify(`I don't see a ${prettyKind(kind)}.`);
    if (candidates.length > 1) throw new Clarify(`There are multiple ${prettyKind(kind)}s — which one?`);
    return candidates[0];
  };

  const resolveWall = (ref: Ref): Wall => {
    const e = resolveRef(ref);
    if (e.type !== "wall") throw new Clarify("That isn't a wall.");
    return e;
  };

  // Anchor -> { position, rotation? }. `item` gives the size for flush/inset math.
  const resolveAnchor = (
    anchor: Anchor,
    item: { w: number; h: number },
  ): { position: Point; rotation?: number } => {
    if ("at" in anchor) return { position: { ...cursor } };
    if ("x" in anchor) return { position: { x: anchor.x, y: anchor.y } };

    if ("against" in anchor) {
      const info = roomOrClarify(anchor.room);
      if (anchor.against === "center") return { position: { ...info.center } };
      return againstWall(info, anchor.against, item);
    }
    if ("corner" in anchor) {
      const info = anchor.room
        ? roomOrClarify(anchor.room)
        : soleRoom();
      const b = info.bounds;
      const t = info.thickness / 2;
      const hw = item.w / 2;
      const hh = item.h / 2;
      const east = anchor.corner.includes("east");
      const north = anchor.corner.includes("north");
      return {
        position: {
          x: east ? b.maxX - t - hw : b.minX + t + hw,
          y: north ? b.maxY - t - hh : b.minY + t + hh,
        },
      };
    }
    // { nextTo, side }
    const other = resolveRef(anchor.nextTo);
    const oc = entityCenter(other);
    const oh = entityHalf(other);
    const gap = 6;
    const thisHalf = anchor.side === "left" || anchor.side === "right" ? item.w / 2 : item.h / 2;
    const otherHalf = anchor.side === "left" || anchor.side === "right" ? oh.x : oh.y;
    const d = otherHalf + thisHalf + gap;
    const pos = { ...oc };
    if (anchor.side === "right") pos.x += d;
    else if (anchor.side === "left") pos.x -= d;
    else if (anchor.side === "above") pos.y += d;
    else pos.y -= d;
    return { position: pos };
  };

  const roomOrClarify = (name: string): RoomInfo => {
    const info = findRoomByName(buildRoomIndex(clone), name);
    if (!info) throw new Clarify(`I don't see a room called "${name}".`);
    return info;
  };
  const soleRoom = (): RoomInfo => {
    const idx = buildRoomIndex(clone);
    if (idx.length === 1) return idx[0];
    throw new Clarify("Which room?");
  };

  const againstWall = (
    info: RoomInfo,
    side: Side,
    item: { w: number; h: number },
  ): { position: Point; rotation: number } => {
    const b = info.bounds;
    const t = info.thickness / 2;
    if (side === "north")
      return { position: { x: info.center.x, y: b.maxY - t - item.h / 2 }, rotation: 0 };
    if (side === "south")
      return { position: { x: info.center.x, y: b.minY + t + item.h / 2 }, rotation: 0 };
    if (side === "east")
      return { position: { x: b.maxX - t - item.h / 2, y: info.center.y }, rotation: Math.PI / 2 };
    return { position: { x: b.minX + t + item.h / 2, y: info.center.y }, rotation: Math.PI / 2 };
  };

  const offsetFrom = (wall: Wall, along: Along | undefined, width: number): number => {
    const len = wallLength(wall);
    let off: number;
    if (along === "left") off = width / 2 + 4;
    else if (along === "right") off = len - width / 2 - 4;
    else if (typeof along === "number") off = along;
    else off = len / 2; // center (default)
    return clampOffset(wall, width, off);
  };

  const sideOfWall = (wallId: string): Side | null => {
    for (const info of buildRoomIndex(clone)) {
      for (const s of ["north", "south", "east", "west"] as Side[]) {
        if (info.wallBySide[s] === wallId) return s;
      }
    }
    return null;
  };

  try {
    for (const op of ops) {
      switch (op.op) {
        case "clarify":
          return { kind: "clarify", question: op.question };

        case "createRoom": {
          const anchor = op.anchor ?? { at: "cursor" };
          const center =
            "x" in anchor ? { x: anchor.x, y: anchor.y } : { ...cursor };
          const hw = op.width / 2;
          const hh = op.height / 2;
          const sw = { x: center.x - hw, y: center.y - hh };
          const se = { x: center.x + hw, y: center.y - hh };
          const ne = { x: center.x + hw, y: center.y + hh };
          const nw = { x: center.x - hw, y: center.y + hh };
          const south = createWall(sw, se, DEFAULT_WALL_THICKNESS);
          const east = createWall(se, ne, DEFAULT_WALL_THICKNESS);
          const north = createWall(ne, nw, DEFAULT_WALL_THICKNESS);
          const west = createWall(nw, sw, DEFAULT_WALL_THICKNESS);
          const room = makeRoom(
            [south.id, east.id, north.id, west.id],
            op.name,
            [sw, se, ne, nw],
            (op.width * op.height) / 144,
          );
          apply(new AddEntities([south, east, north, west, room]));
          lastCreated = room.id;
          phrases.push(`created a ${dimFt(op.width)}×${dimFt(op.height)} ${op.name}`);
          break;
        }

        case "addWall": {
          const from = "x" in (op.from as Point) ? (op.from as Point) : resolveAnchor(op.from as Anchor, { w: 0, h: 0 }).position;
          const to = "x" in (op.to as Point) ? (op.to as Point) : resolveAnchor(op.to as Anchor, { w: 0, h: 0 }).position;
          const w = createWall(from, to, op.thickness ?? DEFAULT_WALL_THICKNESS);
          apply(new AddEntities([w]));
          lastCreated = w.id;
          phrases.push("added a wall");
          break;
        }

        case "placeFurniture": {
          const kind = aliasKind(op.kind);
          const def = furnitureDef(kind);
          const w = op.width ?? def?.defaultW ?? 24;
          const h = op.height ?? def?.defaultH ?? 24;
          const a = resolveAnchor(op.anchor, { w, h });
          const rot = op.rotation != null ? (op.rotation * Math.PI) / 180 : a.rotation ?? 0;
          const f = createFurniture(kind, a.position, rot);
          f.w = w;
          f.h = h;
          apply(new AddEntities([f]));
          lastCreated = f.id;
          const loc = "against" in op.anchor && op.anchor.against !== "center"
            ? ` on the ${op.anchor.against} wall`
            : "";
          phrases.push(`placed a ${prettyKind(kind)}${loc}`);
          break;
        }

        case "addDoor": {
          const wall = resolveWall(op.wall);
          const width = op.width ?? 32;
          const off = offsetFrom(wall, op.along, width);
          const door = createDoor(wall.id, off, width);
          if (op.swing) door.swing = op.swing;
          apply(new AddEntities([door]));
          lastCreated = door.id;
          const s = sideOfWall(wall.id);
          phrases.push(`added a door${s ? ` on the ${s} wall` : ""}`);
          break;
        }

        case "addWindow": {
          const wall = resolveWall(op.wall);
          const width = op.width ?? 36;
          const off = offsetFrom(wall, op.along, width);
          const win = createWindow(wall.id, off, width);
          apply(new AddEntities([win]));
          lastCreated = win.id;
          const s = sideOfWall(wall.id);
          phrases.push(`added a window${s ? ` on the ${s} wall` : ""}`);
          break;
        }

        case "move": {
          const f = furnitureTarget(resolveRef(op.target));
          const a = resolveAnchor(op.to, { w: f.w, h: f.h });
          const before = { position: { ...f.position }, rotation: f.rotation, w: f.w, h: f.h };
          const after = {
            position: a.position,
            rotation: a.rotation ?? f.rotation,
            w: f.w,
            h: f.h,
          };
          apply(new SetFurnitureTransform(f.id, after, before));
          phrases.push(`moved the ${prettyKind(f.kind)}`);
          break;
        }

        case "resize": {
          const f = furnitureTarget(resolveRef(op.target));
          const before = { position: { ...f.position }, rotation: f.rotation, w: f.w, h: f.h };
          const after = { ...before, w: op.width ?? f.w, h: op.height ?? f.h };
          apply(new SetFurnitureTransform(f.id, after, before));
          phrases.push(`resized the ${prettyKind(f.kind)}`);
          break;
        }

        case "rotate": {
          const f = furnitureTarget(resolveRef(op.target));
          const before = { position: { ...f.position }, rotation: f.rotation, w: f.w, h: f.h };
          const after = { ...before, rotation: f.rotation + (op.degrees * Math.PI) / 180 };
          apply(new SetFurnitureTransform(f.id, after, before));
          phrases.push(`rotated the ${prettyKind(f.kind)}`);
          break;
        }

        case "delete": {
          const e = resolveRef(op.target);
          if (e.type === "room") throw new Clarify("To remove a room, delete its walls.");
          apply(new DeleteEntities([e.id]));
          phrases.push(`deleted the ${e.type === "furniture" ? prettyKind(e.kind) : e.type}`);
          break;
        }

        case "rename": {
          const e = resolveRef(op.target);
          if (e.type !== "room") throw new Clarify("I can only rename rooms.");
          apply(new RenameRoom(e.id, op.name));
          phrases.push(`renamed a room to ${op.name}`);
          break;
        }
      }
    }
  } catch (err) {
    if (err instanceof Clarify) return { kind: "clarify", question: err.question };
    throw err;
  }

  if (cmds.length === 0) return { kind: "clarify", question: "I didn't catch a change to make." };

  const summary = capitalize(joinClauses(phrases)) + ".";
  return { kind: "ops", command: new ApplyAIBatch(cmds, summary), summary };
}

function furnitureTarget(e: Entity): Furniture {
  if (e.type !== "furniture") throw new Clarify("I can only move, resize, or rotate furniture right now.");
  return e;
}

function entityCenter(e: Entity): Point {
  if (e.type === "furniture") return e.position;
  if (e.type === "wall") return { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
  if (e.type === "room") {
    const xs = e.poly.map((p) => p.x);
    const ys = e.poly.map((p) => p.y);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  }
  return { x: 0, y: 0 };
}

function entityHalf(e: Entity): Point {
  if (e.type === "furniture") {
    const b = furnitureBounds(e);
    return { x: (b.maxX - b.minX) / 2, y: (b.maxY - b.minY) / 2 };
  }
  return { x: 0, y: 0 };
}

function joinClauses(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
