// Semantic entity model. Entities are plain serializable objects; all behavior
// (draw, hit-test, snap-points, bbox) lives in per-type helpers, never on the
// objects — so a Document can be JSON-stringified straight to Supabase later.

import type { Point } from "../viewport.ts";

export type EntityBase = { id: string };

// Inches. Positive Y is north/up (see lib/viewport.ts).
export type Wall = EntityBase & {
  type: "wall";
  a: Point;
  b: Point;
  thickness: number; // inches
};

// Rooms are DERIVED from the walls that enclose them. `wallIds` + `name` are
// the semantic anchor; `poly` and `areaSqFt` are cached derived geometry,
// recomputed whenever walls change (see lib/rooms/sync.ts).
export type Room = EntityBase & {
  type: "room";
  wallIds: string[];
  name: string;
  poly: Point[]; // derived cache: ordered corner ring, world inches
  areaSqFt: number; // derived cache
};

// A furniture block. `position` is the CENTER (world inches); `rotation` is in
// radians, counter-clockwise (world/Y-up). `w`/`h` are the unrotated footprint.
export type Furniture = EntityBase & {
  type: "furniture";
  kind: string; // key into the furniture library
  position: Point;
  rotation: number; // radians, CCW
  w: number; // inches
  h: number; // inches
  flipX?: boolean; // mirrored horizontally in its own frame (footprint is symmetric)
};

export type DoorSwing = "in" | "out" | "left" | "right";

// Doors and windows are ANCHORED to a wall by `offset` (inches along the wall
// from endpoint `a`). They store no absolute coordinates, so moving the wall
// moves them. Geometry is derived from the wall each frame (see model/opening).
export type Door = EntityBase & {
  type: "door";
  wallId: string;
  offset: number; // inches along the wall from a
  width: number; // inches
  swing: DoorSwing;
};

export type Window = EntityBase & {
  type: "window";
  wallId: string;
  offset: number;
  width: number;
};

// A dimension line: measures the distance between two world points. Endpoints
// snap to wall corners when drawn but store absolute coordinates (snap-on-place,
// like furniture) — they do not track walls afterward. `offset` shifts the line
// perpendicular to the measured span (inches); 0 draws it on the span.
export type Dimension = EntityBase & {
  type: "dimension";
  from: Point;
  to: Point;
  offset: number;
};

// A free text note placed on the canvas. `position` is the anchor (world
// inches); `rotation` is in radians (reserved; 0 for now).
export type Annotation = EntityBase & {
  type: "annotation";
  position: Point;
  text: string;
  rotation: number;
};

// The union grows in later phases (label).
export type Entity = Wall | Room | Furniture | Door | Window | Dimension | Annotation;
export type Opening = Door | Window;

// A floor is a named layer of the plan. Ordered low → high (index 0 is the
// lowest floor). The ACTIVE floor's entities live in `Document.entities` so all
// tools/commands/rooms operate on it unchanged; inactive floors are held in
// `Document.stash` keyed by floor id and swapped in on switch.
export type FloorInfo = { id: string; name: string };

export type Document = {
  version: 1;
  units: "imperial";
  entities: Entity[]; // the active floor's live entities
  floors: FloorInfo[]; // all floors, ordered low → high
  activeFloorId: string;
  stash: Record<string, Entity[]>; // non-active floors' entities, by floor id
};

export function createDocument(): Document {
  const id = crypto.randomUUID();
  return {
    version: 1,
    units: "imperial",
    entities: [],
    floors: [{ id, name: "Ground floor" }],
    activeFloorId: id,
    stash: {},
  };
}
