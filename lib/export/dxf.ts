// DXF export for pros who want a real CAD file. Emits ASCII R12 (AC1009) DXF —
// the most widely importable flavor — using LINE + TEXT entities on organized
// layers. World units are inches (+Y up), which map straight to DXF model space
// with no flip. Only the ACTIVE floor is exported (like PNG/PDF).

import type { Document } from "../model/types.ts";
import type { Point } from "../viewport.ts";
import { walls, rooms, furniture, openings, dimensions, annotations } from "../model/document.ts";
import { corners } from "../model/furniture.ts";
import { findWall, openingFrame } from "../model/opening.ts";
import { dimensionLength } from "../model/dimension.ts";
import { formatFeetInches } from "../units.ts";

// AutoCAD Color Index per layer.
const LAYERS: { name: string; color: number }[] = [
  { name: "WALLS", color: 7 },
  { name: "ROOMS", color: 8 },
  { name: "DOORS", color: 3 },
  { name: "WINDOWS", color: 5 },
  { name: "FURNITURE", color: 6 },
  { name: "DIMENSIONS", color: 1 },
  { name: "NOTES", color: 2 },
];

function num(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return (Math.round(n * 1e4) / 1e4).toString();
}

class DxfWriter {
  private out: string[] = [];
  pair(code: number | string, value: string | number): void {
    this.out.push(String(code));
    this.out.push(String(value));
  }
  line(layer: string, a: Point, b: Point): void {
    this.pair(0, "LINE");
    this.pair(8, layer);
    this.pair(10, num(a.x));
    this.pair(20, num(a.y));
    this.pair(30, 0);
    this.pair(11, num(b.x));
    this.pair(21, num(b.y));
    this.pair(31, 0);
  }
  /** Connect consecutive points with LINEs; `close` links last→first. */
  polyline(layer: string, pts: Point[], close: boolean): void {
    if (pts.length < 2) return;
    for (let i = 0; i < pts.length - 1; i++) this.line(layer, pts[i], pts[i + 1]);
    if (close) this.line(layer, pts[pts.length - 1], pts[0]);
  }
  text(layer: string, at: Point, height: number, value: string): void {
    this.pair(0, "TEXT");
    this.pair(8, layer);
    this.pair(10, num(at.x));
    this.pair(20, num(at.y));
    this.pair(30, 0);
    this.pair(40, num(height));
    this.pair(1, sanitizeText(value));
    this.pair(72, 1); // horizontal center
    this.pair(11, num(at.x));
    this.pair(21, num(at.y));
    this.pair(31, 0);
  }
  toString(): string {
    return this.out.join("\r\n") + "\r\n";
  }
}

/** DXF TEXT can't contain raw control chars; keep it to printable ASCII-ish. */
function sanitizeText(s: string): string {
  return s.replace(/[\r\n]+/g, " ").slice(0, 200);
}

/** Rectangle outline (4 corners) of a wall, using its thickness. */
function wallRect(a: Point, b: Point, thickness: number): Point[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (thickness / 2);
  const ny = (dx / len) * (thickness / 2);
  return [
    { x: a.x + nx, y: a.y + ny },
    { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny },
    { x: a.x - nx, y: a.y - ny },
  ];
}

export function buildDxf(doc: Document): string {
  const w = new DxfWriter();

  // --- HEADER ---
  w.pair(0, "SECTION");
  w.pair(2, "HEADER");
  w.pair(9, "$ACADVER");
  w.pair(1, "AC1009");
  w.pair(9, "$INSUNITS");
  w.pair(70, 1); // inches
  w.pair(0, "ENDSEC");

  // --- TABLES (layer definitions) ---
  w.pair(0, "SECTION");
  w.pair(2, "TABLES");
  w.pair(0, "TABLE");
  w.pair(2, "LAYER");
  w.pair(70, LAYERS.length);
  for (const layer of LAYERS) {
    w.pair(0, "LAYER");
    w.pair(2, layer.name);
    w.pair(70, 0);
    w.pair(62, layer.color);
    w.pair(6, "CONTINUOUS");
  }
  w.pair(0, "ENDTAB");
  w.pair(0, "ENDSEC");

  // --- ENTITIES ---
  w.pair(0, "SECTION");
  w.pair(2, "ENTITIES");

  for (const wall of walls(doc)) {
    w.polyline("WALLS", wallRect(wall.a, wall.b, wall.thickness), true);
  }
  for (const room of rooms(doc)) {
    if (room.poly.length >= 3) w.polyline("ROOMS", room.poly, true);
    const c = roomLabelPoint(room.poly);
    if (c) w.text("ROOMS", c, 9, room.name);
  }
  for (const op of openings(doc)) {
    const wall = findWall(doc, op.wallId);
    if (!wall) continue;
    const f = openingFrame(wall, op.offset);
    const half = op.width / 2;
    const a = { x: f.center.x - f.dir.x * half, y: f.center.y - f.dir.y * half };
    const b = { x: f.center.x + f.dir.x * half, y: f.center.y + f.dir.y * half };
    w.line(op.type === "door" ? "DOORS" : "WINDOWS", a, b);
  }
  for (const fu of furniture(doc)) {
    w.polyline("FURNITURE", corners(fu), true);
  }
  for (const d of dimensions(doc)) {
    w.line("DIMENSIONS", d.from, d.to);
    const mid = { x: (d.from.x + d.to.x) / 2, y: (d.from.y + d.to.y) / 2 };
    w.text("DIMENSIONS", mid, 6, formatFeetInches(dimensionLength(d)));
  }
  for (const a of annotations(doc)) {
    if (a.text) w.text("NOTES", a.position, 8, a.text);
  }

  w.pair(0, "ENDSEC");
  w.pair(0, "EOF");
  return w.toString();
}

/** Simple centroid of a polygon ring for label placement. */
function roomLabelPoint(poly: Point[]): Point | null {
  if (poly.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}
