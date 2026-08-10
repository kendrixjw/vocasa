// Ready-made rooms: four walls plus a sensible furniture arrangement, dropped in
// one step. Ported from the Vocasa2 prototype's presets, rebuilt on this repo's
// model — walls are real walls, so a template room is immediately editable, its
// area is measured by the same face traversal as everything else, and dragging a
// wall reflows it.
//
// Layout is authored in FEET on a room-local frame: (0,0) is the room's
// south-west inside corner, +x east, +y north (matching world Y-up). Furniture
// coordinates are the item's CENTER, which is what Furniture.position stores.
// Sizes come from the furniture library so a template never disagrees with the
// palette.

import type { Entity, Room } from "../model/types.ts";
import type { Point } from "../viewport.ts";
import { createWall, DEFAULT_WALL_THICKNESS } from "../model/wall.ts";
import { createRoom } from "../model/room.ts";
import { createFurniture } from "../model/furniture.ts";

export type TemplateItem = {
  kind: string; // key into the furniture library
  /** Center of the item, feet from the room's SW inside corner. */
  x: number;
  y: number;
  /** Degrees CCW. Omitted = 0. */
  rotation?: number;
};

export type RoomTemplate = {
  key: string;
  label: string;
  /** Inside dimensions, feet. */
  width: number;
  height: number;
  items: TemplateItem[];
};

export const ROOM_TEMPLATES: readonly RoomTemplate[] = [
  {
    key: "kitchen",
    label: "Kitchen",
    width: 12,
    height: 10,
    items: [
      // Appliance run along the north wall, island in the middle.
      { kind: "fridge", x: 1.5, y: 8.75 },
      { kind: "stove", x: 4.5, y: 8.75 },
      { kind: "sink", x: 7.5, y: 9.08 },
      { kind: "dining-table", x: 6, y: 4 },
    ],
  },
  {
    key: "bathroom",
    label: "Bathroom",
    width: 8,
    height: 6,
    items: [
      { kind: "tub", x: 2.75, y: 4.75 },
      { kind: "toilet", x: 7, y: 4.83 },
      { kind: "vanity", x: 2, y: 0.88 },
    ],
  },
  {
    key: "bedroom",
    label: "Bedroom",
    width: 12,
    height: 12,
    items: [
      // Bed centered against the north wall, flanked by nightstands.
      { kind: "bed-queen", x: 6, y: 8.6 },
      { kind: "nightstand", x: 2.4, y: 11.1 },
      { kind: "nightstand", x: 9.6, y: 11.1 },
      { kind: "dresser", x: 6, y: 0.75 },
    ],
  },
  {
    key: "living",
    label: "Living room",
    width: 16,
    height: 14,
    items: [
      // Rug first so it renders beneath the seating group.
      { kind: "rug", x: 8, y: 5 },
      { kind: "sofa", x: 8, y: 1.5 },
      { kind: "coffee-table", x: 8, y: 5 },
      { kind: "armchair", x: 3, y: 5 },
      { kind: "tv-stand", x: 8, y: 13.25 },
      { kind: "plant", x: 14.5, y: 12.5 },
    ],
  },
  {
    key: "dining",
    label: "Dining",
    width: 12,
    height: 10,
    items: [
      { kind: "dining-table", x: 6, y: 5 },
      { kind: "dining-chair", x: 4.75, y: 7.25 },
      { kind: "dining-chair", x: 7.25, y: 7.25 },
      { kind: "dining-chair", x: 4.75, y: 2.75 },
      { kind: "dining-chair", x: 7.25, y: 2.75 },
      { kind: "dresser", x: 6, y: 0.75 },
    ],
  },
  {
    key: "office",
    label: "Home office",
    width: 10,
    height: 10,
    items: [
      { kind: "desk", x: 5, y: 8.5 },
      { kind: "dining-chair", x: 5, y: 6.5 },
      { kind: "bookshelf", x: 0.6, y: 5, rotation: 90 },
      { kind: "plant", x: 9, y: 1 },
    ],
  },
];

export function findTemplate(key: string): RoomTemplate | undefined {
  return ROOM_TEMPLATES.find((t) => t.key === key);
}

/**
 * Entities for `tpl` with its SW inside corner at `origin` (world inches).
 *
 * Includes a pre-built Room carrying the template's name and the four wall ids.
 * That matters: rooms are normally derived, and syncRooms names anything new
 * "Room N". By seeding a room whose wallIds exactly match the loop these walls
 * form, the sync's overlap match scores 1.0, so it adopts the loop's geometry
 * and KEEPS the name — which is how "Kitchen" survives instead of "Room 3".
 * The seeded poly/area are placeholders; syncRooms overwrites both.
 */
export function templateEntities(tpl: RoomTemplate, origin: Point): Entity[] {
  const w = tpl.width * 12;
  const h = tpl.height * 12;

  // Corners CCW from the SW, on the wall centerlines.
  const corners: Point[] = [
    { x: origin.x, y: origin.y },
    { x: origin.x + w, y: origin.y },
    { x: origin.x + w, y: origin.y + h },
    { x: origin.x, y: origin.y + h },
  ];
  const walls = corners.map((c, i) =>
    createWall(c, corners[(i + 1) % corners.length], DEFAULT_WALL_THICKNESS),
  );

  const room: Room = createRoom(
    walls.map((wall) => wall.id),
    tpl.label,
    corners,
    tpl.width * tpl.height,
  );

  const items = tpl.items.map((it) =>
    createFurniture(
      it.kind,
      { x: origin.x + it.x * 12, y: origin.y + it.y * 12 },
      ((it.rotation ?? 0) * Math.PI) / 180,
    ),
  );

  return [...walls, room, ...items];
}
