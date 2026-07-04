// Room helpers: construction, geometry (centroid, containment), and rendering.
// Rooms are derived; these operate on the cached polygon.

import type { Point, Viewport } from "../viewport.ts";
import { worldToScreen } from "../viewport.ts";
import type { Room } from "./types.ts";

const ROOM_FILL = "rgba(37, 99, 235, 0.06)"; // soft blue tint
const ROOM_FILL_SELECTED = "rgba(37, 99, 235, 0.14)";
const ROOM_EDGE_SELECTED = "#2563eb";
const NAME_COLOR = "#1c1917";
const AREA_COLOR = "#78716c";

export function createRoom(
  wallIds: string[],
  name: string,
  poly: Point[],
  areaSqFt: number,
): Room {
  return {
    id: crypto.randomUUID(),
    type: "room",
    wallIds: [...wallIds],
    name,
    poly: poly.map((p) => ({ ...p })),
    areaSqFt,
  };
}

/** Area-weighted polygon centroid (world inches). Falls back to vertex mean. */
export function roomCentroid(room: Room): Point {
  const poly = room.poly;
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    const n = poly.length || 1;
    return {
      x: poly.reduce((s, p) => s + p.x, 0) / n,
      y: poly.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  a *= 0.5;
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/** Ray-casting point-in-polygon test (world coords). */
export function pointInRoom(room: Room, p: Point): boolean {
  const poly = room.poly;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const intersects =
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function formatSqFt(areaSqFt: number): string {
  return `${Math.round(areaSqFt)} sq ft`;
}

/** Fill the room and label it with name + live square footage (screen space). */
export function drawRoom(
  ctx: CanvasRenderingContext2D,
  room: Room,
  vp: Viewport,
  opts: { selected?: boolean } = {},
): void {
  if (room.poly.length < 3) return;

  ctx.beginPath();
  const first = worldToScreen(vp, room.poly[0]);
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < room.poly.length; i++) {
    const s = worldToScreen(vp, room.poly[i]);
    ctx.lineTo(s.x, s.y);
  }
  ctx.closePath();
  ctx.fillStyle = opts.selected ? ROOM_FILL_SELECTED : ROOM_FILL;
  ctx.fill();
  if (opts.selected) {
    ctx.strokeStyle = ROOM_EDGE_SELECTED;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  const c = worldToScreen(vp, roomCentroid(room));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = NAME_COLOR;
  ctx.font = "600 14px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(room.name, c.x, c.y - 8);
  ctx.fillStyle = AREA_COLOR;
  ctx.font = "12px ui-monospace, monospace";
  ctx.fillText(formatSqFt(room.areaSqFt), c.x, c.y + 9);
}
