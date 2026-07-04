// Data-driven furniture library. Each entry has real-world default dimensions
// (inches) and a vector icon drawer. The drawer paints centered at (0,0)
// spanning [-hw,-hh] .. [hw,hh] in the CURRENT canvas space (already translated
// / rotated / in screen pixels), so the same function renders on the plan and
// in the palette. Adding a block is just adding a row here.

export type IconDraw = (ctx: CanvasRenderingContext2D, hw: number, hh: number) => void;

export type FurnitureDef = {
  kind: string;
  label: string;
  category: string;
  defaultW: number; // inches
  defaultH: number; // inches
  icon: IconDraw;
};

const FILL = "#f5f5f4"; // stone-100
const STROKE = "#a8a29e"; // stone-400
const DETAIL = "#c4c1bd";

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, rr);
}

function body(ctx: CanvasRenderingContext2D, hw: number, hh: number, fill = FILL, r?: number) {
  rrect(ctx, -hw, -hh, hw * 2, hh * 2, r ?? Math.min(8, hw * 0.4, hh * 0.4));
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = STROKE;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = DETAIL;
  ctx.lineWidth = 1.25;
  ctx.stroke();
}

function circle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill?: string) {
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(0, r), 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.strokeStyle = DETAIL;
  ctx.lineWidth = 1.25;
  ctx.stroke();
}

// --- Icon drawers ---------------------------------------------------------

const sofa: IconDraw = (ctx, hw, hh) => {
  body(ctx, hw, hh);
  // Back cushion along the top (−y) edge, two seat cushions below.
  rrect(ctx, -hw * 0.86, -hh * 0.9, hw * 1.72, hh * 0.5, 3);
  ctx.fillStyle = "#ececeb";
  ctx.fill();
  ctx.strokeStyle = STROKE;
  ctx.stroke();
  line(ctx, 0, -hh * 0.35, 0, hh * 0.85);
};

const chairSeat: IconDraw = (ctx, hw, hh) => {
  body(ctx, hw, hh);
  rrect(ctx, -hw * 0.9, -hh * 0.95, hw * 1.8, hh * 0.35, 2);
  ctx.fillStyle = "#ececeb";
  ctx.fill();
  ctx.strokeStyle = STROKE;
  ctx.stroke();
};

const bed: IconDraw = (ctx, hw, hh) => {
  body(ctx, hw, hh, "#f7f7f6");
  // Pillows at the head (−y), blanket line across.
  const pw = hw * 0.8;
  rrect(ctx, -hw * 0.9, -hh * 0.88, pw, hh * 0.4, 3);
  ctx.fillStyle = "#ececeb";
  ctx.fill();
  ctx.strokeStyle = STROKE;
  ctx.stroke();
  rrect(ctx, hw * 0.1, -hh * 0.88, pw, hh * 0.4, 3);
  ctx.fill();
  ctx.stroke();
  line(ctx, -hw, -hh * 0.35, hw, -hh * 0.35);
};

const table: IconDraw = (ctx, hw, hh) => {
  body(ctx, hw, hh, "#f7f7f6");
  rrect(ctx, -hw * 0.82, -hh * 0.82, hw * 1.64, hh * 1.64, 3);
  ctx.strokeStyle = DETAIL;
  ctx.lineWidth = 1;
  ctx.stroke();
};

const appliance: IconDraw = (ctx, hw, hh) => {
  body(ctx, hw, hh, "#f0f0ef");
  line(ctx, -hw, -hh * 0.55, hw, -hh * 0.55);
};

const stove: IconDraw = (ctx, hw, hh) => {
  body(ctx, hw, hh, "#f0f0ef");
  const r = Math.min(hw, hh) * 0.28;
  circle(ctx, -hw * 0.45, -hh * 0.45, r);
  circle(ctx, hw * 0.45, -hh * 0.45, r);
  circle(ctx, -hw * 0.45, hh * 0.45, r);
  circle(ctx, hw * 0.45, hh * 0.45, r);
};

const sink: IconDraw = (ctx, hw, hh) => {
  body(ctx, hw, hh, "#f0f0ef");
  rrect(ctx, -hw * 0.6, -hh * 0.5, hw * 1.2, hh * 1.0, 4);
  ctx.strokeStyle = DETAIL;
  ctx.lineWidth = 1.25;
  ctx.stroke();
  circle(ctx, 0, -hh * 0.72, Math.min(hw, hh) * 0.12);
};

const toilet: IconDraw = (ctx, hw, hh) => {
  // Tank at the back (−y), bowl (oval) toward +y.
  rrect(ctx, -hw * 0.8, -hh, hw * 1.6, hh * 0.5, 3);
  ctx.fillStyle = FILL;
  ctx.fill();
  ctx.strokeStyle = STROKE;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, hh * 0.25, hw * 0.7, hh * 0.6, 0, 0, Math.PI * 2);
  ctx.fillStyle = FILL;
  ctx.fill();
  ctx.stroke();
};

const tub: IconDraw = (ctx, hw, hh) => {
  body(ctx, hw, hh, "#f0f0ef");
  ctx.beginPath();
  ctx.ellipse(0, hh * 0.05, hw * 0.72, hh * 0.72, 0, 0, Math.PI * 2);
  ctx.strokeStyle = DETAIL;
  ctx.lineWidth = 1.25;
  ctx.stroke();
};

const shelves: IconDraw = (ctx, hw, hh) => {
  body(ctx, hw, hh, "#f2efe9");
  for (let i = 1; i < 3; i++) line(ctx, -hw, -hh + (hh * 2 * i) / 3, hw, -hh + (hh * 2 * i) / 3);
};

const tv: IconDraw = (ctx, hw, hh) => {
  rrect(ctx, -hw, -hh * 0.7, hw * 2, hh * 1.4, 3);
  ctx.fillStyle = "#44403c";
  ctx.fill();
  ctx.strokeStyle = STROKE;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  line(ctx, -hw * 0.3, hh * 0.7, hw * 0.3, hh * 0.7);
};

const rug: IconDraw = (ctx, hw, hh) => {
  ctx.save();
  ctx.setLineDash([6, 4]);
  rrect(ctx, -hw, -hh, hw * 2, hh * 2, 4);
  ctx.fillStyle = "rgba(214,211,209,0.25)";
  ctx.fill();
  ctx.strokeStyle = STROKE;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
  ctx.setLineDash([]);
  rrect(ctx, -hw * 0.8, -hh * 0.8, hw * 1.6, hh * 1.6, 3);
  ctx.strokeStyle = DETAIL;
  ctx.lineWidth = 1;
  ctx.stroke();
};

const plant: IconDraw = (ctx, hw, hh) => {
  // Pot (trapezoid-ish) with round foliage.
  const r = Math.min(hw, hh);
  circle(ctx, 0, -hh * 0.1, r * 0.85, "#e7efe4");
  rrect(ctx, -hw * 0.4, hh * 0.35, hw * 0.8, hh * 0.6, 2);
  ctx.fillStyle = "#e7e5e4";
  ctx.fill();
  ctx.strokeStyle = STROKE;
  ctx.lineWidth = 1.25;
  ctx.stroke();
};

const desk: IconDraw = (ctx, hw, hh) => {
  body(ctx, hw, hh, "#f2efe9");
  rrect(ctx, hw * 0.2, -hh * 0.8, hw * 0.75, hh * 1.6, 2);
  ctx.strokeStyle = DETAIL;
  ctx.lineWidth = 1;
  ctx.stroke();
};

// --- Library --------------------------------------------------------------

export const FURNITURE: FurnitureDef[] = [
  { kind: "sofa", label: "Sofa", category: "Living", defaultW: 84, defaultH: 36, icon: sofa },
  { kind: "loveseat", label: "Loveseat", category: "Living", defaultW: 60, defaultH: 36, icon: sofa },
  { kind: "armchair", label: "Armchair", category: "Living", defaultW: 34, defaultH: 34, icon: chairSeat },
  { kind: "coffee-table", label: "Coffee table", category: "Living", defaultW: 48, defaultH: 24, icon: table },
  { kind: "tv-stand", label: "TV stand", category: "Living", defaultW: 60, defaultH: 18, icon: tv },
  { kind: "rug", label: "Rug", category: "Living", defaultW: 96, defaultH: 60, icon: rug },
  { kind: "plant", label: "Plant", category: "Living", defaultW: 24, defaultH: 24, icon: plant },
  { kind: "bookshelf", label: "Bookshelf", category: "Living", defaultW: 36, defaultH: 12, icon: shelves },
  { kind: "bed-queen", label: "Queen bed", category: "Bedroom", defaultW: 60, defaultH: 80, icon: bed },
  { kind: "bed-twin", label: "Twin bed", category: "Bedroom", defaultW: 39, defaultH: 75, icon: bed },
  { kind: "nightstand", label: "Nightstand", category: "Bedroom", defaultW: 20, defaultH: 20, icon: table },
  { kind: "dresser", label: "Dresser", category: "Bedroom", defaultW: 60, defaultH: 18, icon: shelves },
  { kind: "desk", label: "Desk", category: "Bedroom", defaultW: 48, defaultH: 24, icon: desk },
  { kind: "dining-table", label: "Dining table", category: "Kitchen", defaultW: 60, defaultH: 36, icon: table },
  { kind: "dining-chair", label: "Dining chair", category: "Kitchen", defaultW: 18, defaultH: 18, icon: chairSeat },
  { kind: "fridge", label: "Fridge", category: "Kitchen", defaultW: 36, defaultH: 30, icon: appliance },
  { kind: "stove", label: "Stove", category: "Kitchen", defaultW: 30, defaultH: 30, icon: stove },
  { kind: "sink", label: "Sink", category: "Kitchen", defaultW: 30, defaultH: 22, icon: sink },
  { kind: "toilet", label: "Toilet", category: "Bath", defaultW: 20, defaultH: 28, icon: toilet },
  { kind: "tub", label: "Bathtub", category: "Bath", defaultW: 60, defaultH: 30, icon: tub },
  { kind: "vanity", label: "Vanity", category: "Bath", defaultW: 36, defaultH: 21, icon: sink },
];

const BY_KIND = new Map(FURNITURE.map((f) => [f.kind, f]));

export function furnitureDef(kind: string): FurnitureDef | undefined {
  return BY_KIND.get(kind);
}
