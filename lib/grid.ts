// Adaptive grid spacing. Picks a "nice" spacing in inches so grid lines stay a
// comfortable distance apart on screen regardless of zoom.

export type GridSpacing = {
  minor: number; // inches between minor lines
  major: number; // inches between major (emphasized) lines
};

// Nice spacings in inches, ascending. Based on feet so labels feel natural:
// 1", 3", 6", 1', 2', 5', 10', 25', 50', 100', ...
const NICE_INCHES = [1, 3, 6, 12, 24, 60, 120, 300, 600, 1200, 3000, 6000, 12000];

/**
 * Choose grid spacing given the current scale (screen px per inch). Aims for
 * minor lines roughly `targetPx` apart on screen. Major lines are 5x the minor
 * spacing (or the next nice value up), so ~every 5th line is emphasized.
 */
export function pickGridSpacing(scale: number, targetPx = 24): GridSpacing {
  const targetInches = targetPx / scale;
  let minor = NICE_INCHES[NICE_INCHES.length - 1];
  for (const n of NICE_INCHES) {
    if (n >= targetInches) {
      minor = n;
      break;
    }
  }
  const idx = NICE_INCHES.indexOf(minor);
  // Major line every 5 minor lines, snapped to a nice value where possible.
  const major = minor * 5;
  void idx;
  return { minor, major };
}
