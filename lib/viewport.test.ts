import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fitToBounds,
  pan,
  screenToWorld,
  worldToScreen,
  zoomAt,
  type Viewport,
} from "./viewport.ts";

const approx = (a: number, b: number, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${a} !== ${b}`);

const approxPt = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  approx(a.x, b.x);
  approx(a.y, b.y);
};

test("worldToScreen applies scale and flips Y", () => {
  const vp: Viewport = { originX: 100, originY: 200, scale: 2 };
  approxPt(worldToScreen(vp, { x: 0, y: 0 }), { x: 100, y: 200 });
  approxPt(worldToScreen(vp, { x: 10, y: 5 }), { x: 120, y: 190 });
});

test("screenToWorld is the exact inverse of worldToScreen", () => {
  const vp: Viewport = { originX: 37, originY: -12, scale: 0.83 };
  for (const w of [
    { x: 0, y: 0 },
    { x: 123.4, y: -56.7 },
    { x: -1000, y: 2000 },
  ]) {
    approxPt(screenToWorld(vp, worldToScreen(vp, w)), w);
  }
});

test("pan shifts origin by screen delta and moves world under cursor", () => {
  const vp: Viewport = { originX: 0, originY: 0, scale: 4 };
  const before = screenToWorld(vp, { x: 50, y: 50 });
  const panned = pan(vp, 20, -10);
  // After panning right/up in screen space, the same screen pixel shows a
  // point that is 20/scale to the LEFT and 10/scale up.
  const after = screenToWorld(panned, { x: 50, y: 50 });
  approx(after.x, before.x + -20 / 4);
  approx(after.y, before.y + -10 / 4);
});

test("zoomAt keeps the world point under the anchor invariant", () => {
  const vp: Viewport = { originX: 300, originY: 250, scale: 1.5 };
  const anchor = { x: 640, y: 360 };
  const worldBefore = screenToWorld(vp, anchor);
  for (const factor of [1.25, 0.8, 3, 0.1]) {
    const zoomed = zoomAt(vp, anchor, factor);
    // The world point that was under the cursor is still under the cursor.
    approxPt(screenToWorld(zoomed, anchor), worldBefore);
  }
});

test("zoomAt clamps scale within bounds", () => {
  const vp: Viewport = { originX: 0, originY: 0, scale: 1 };
  const wayIn = zoomAt(vp, { x: 0, y: 0 }, 1e6);
  assert.ok(wayIn.scale <= 20 + 1e-9);
  const wayOut = zoomAt(vp, { x: 0, y: 0 }, 1e-6);
  assert.ok(wayOut.scale >= 0.02 - 1e-9);
});

test("fitToBounds centers bounds and respects padding", () => {
  const bounds = { minX: 0, minY: 0, maxX: 480, maxY: 360 };
  const size = { width: 1000, height: 800 };
  const vp = fitToBounds(bounds, size, 50);

  // The world center maps to the screen center.
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  approxPt(worldToScreen(vp, { x: cx, y: cy }), {
    x: size.width / 2,
    y: size.height / 2,
  });

  // Bounds fit within the padded area.
  const tl = worldToScreen(vp, { x: bounds.minX, y: bounds.maxY });
  const br = worldToScreen(vp, { x: bounds.maxX, y: bounds.minY });
  assert.ok(tl.x >= 50 - 1e-6 && tl.y >= 50 - 1e-6);
  assert.ok(br.x <= size.width - 50 + 1e-6 && br.y <= size.height - 50 + 1e-6);
});
