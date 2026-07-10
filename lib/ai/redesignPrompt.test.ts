import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRedesignPrompt } from "./redesignPrompt.ts";

test("buildRedesignPrompt keeps the room's architecture for the design module", () => {
  const p = buildRedesignPrompt("design", "warm mid-century");
  assert.match(p, /restyle, do not rebuild/i);
  assert.match(p, /warm mid-century/);
  assert.match(p, /architecture, windows, doors/i);
});

test("buildRedesignPrompt uses landscaping intent for yards", () => {
  const p = buildRedesignPrompt("landscaping", "");
  assert.match(p, /plants, hardscape, paths/i);
  // No style given -> falls back to a tasteful default, not an empty quote.
  assert.match(p, /No specific style/i);
  assert.doesNotMatch(p, /""/);
});

test("buildRedesignPrompt never asks for text/measurements in the image", () => {
  const p = buildRedesignPrompt("design", "coastal");
  assert.match(p, /Do not add text, watermarks, labels, or measurements/i);
  assert.match(p, /photorealistic/i);
});
