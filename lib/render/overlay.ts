// Shared overlay drawing helpers (screen space). Used by tools for previews,
// snap markers, and measurement labels.

import type { Point } from "../viewport.ts";

const ACCENT = "#2563eb"; // blue-600

/** A small diamond marker at a snapped point. */
export function drawSnapMarker(ctx: CanvasRenderingContext2D, s: Point): void {
  const r = 5;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(s.x, s.y - r);
  ctx.lineTo(s.x + r, s.y);
  ctx.lineTo(s.x, s.y + r);
  ctx.lineTo(s.x - r, s.y);
  ctx.closePath();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** A rounded pill of text (e.g. a length readout) centered at a screen point. */
export function drawPillLabel(
  ctx: CanvasRenderingContext2D,
  s: Point,
  text: string,
): void {
  ctx.save();
  ctx.font = "12px ui-monospace, monospace";
  const padX = 6;
  const w = ctx.measureText(text).width + padX * 2;
  const h = 18;
  const x = s.x - w / 2;
  const y = s.y - h / 2;
  const r = 6;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.strokeStyle = "#e7e5e4";
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#1c1917";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, s.x, s.y + 0.5);
  ctx.restore();
}
