// Vocasa viewport: world<->screen coordinate transforms.
//
// This module is the foundation everything else depends on, so it is kept
// pure (no DOM, no React) and unit-tested.
//
// Coordinate conventions:
//  - World space is in INCHES. Positive X points right (east), positive Y
//    points UP (north) — the natural orientation for a floor plan.
//  - Screen space is in CSS PIXELS. Positive X points right, positive Y points
//    DOWN, matching the canvas. The Y axis is therefore flipped between the
//    two spaces.
//  - `scale` is screen pixels per world inch (always > 0).
//  - `originX`/`originY` are the SCREEN pixel coordinates of the world origin
//    (0, 0). Storing the origin in screen space makes pan a simple additive
//    translation and keeps zoom-to-cursor exact.

export type Point = { x: number; y: number };

export type Viewport = {
  originX: number;
  originY: number;
  scale: number;
};

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export type Size = { width: number; height: number };

/** Convert a world-space point (inches) to a screen-space point (pixels). */
export function worldToScreen(vp: Viewport, w: Point): Point {
  return {
    x: vp.originX + w.x * vp.scale,
    y: vp.originY - w.y * vp.scale,
  };
}

/** Convert a screen-space point (pixels) to a world-space point (inches). */
export function screenToWorld(vp: Viewport, s: Point): Point {
  return {
    x: (s.x - vp.originX) / vp.scale,
    y: (vp.originY - s.y) / vp.scale,
  };
}

/** Pan by a screen-pixel delta (e.g. mouse drag movement). */
export function pan(vp: Viewport, dxScreen: number, dyScreen: number): Viewport {
  return { ...vp, originX: vp.originX + dxScreen, originY: vp.originY + dyScreen };
}

// Zoom is clamped so we never invert or lose all precision.
export const MIN_SCALE = 0.02; // ~0.24 px per foot — very zoomed out
export const MAX_SCALE = 20; // 20 px per inch — very zoomed in

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Zoom around a fixed screen anchor (the cursor). The world point currently
 * under `anchor` stays under `anchor` after the zoom, so the drawing appears
 * to scale toward/away from the cursor.
 *
 * `factor` > 1 zooms in, < 1 zooms out.
 */
export function zoomAt(vp: Viewport, anchor: Point, factor: number): Viewport {
  const newScale = clampScale(vp.scale * factor);
  if (newScale === vp.scale) return vp;
  // World point under the anchor must be invariant. Derive the origin that
  // keeps worldToScreen(W) === anchor at the new scale.
  const w = screenToWorld(vp, anchor);
  return {
    scale: newScale,
    originX: anchor.x - w.x * newScale,
    originY: anchor.y + w.y * newScale,
  };
}

/**
 * Build a viewport that fits `bounds` (world inches) inside a viewport of
 * `size` pixels, with `padding` pixels of margin on every side. Centers the
 * bounds in the available space.
 */
export function fitToBounds(bounds: Bounds, size: Size, padding = 48): Viewport {
  const worldW = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const worldH = Math.max(bounds.maxY - bounds.minY, 1e-6);
  const availW = Math.max(size.width - padding * 2, 1);
  const availH = Math.max(size.height - padding * 2, 1);
  const scale = clampScale(Math.min(availW / worldW, availH / worldH));

  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  // Place the world center at the screen center.
  return {
    scale,
    originX: size.width / 2 - cx * scale,
    originY: size.height / 2 + cy * scale,
  };
}
