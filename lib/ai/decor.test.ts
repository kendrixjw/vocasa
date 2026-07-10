import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDecor, searchUrl } from "./decor.ts";

test("normalizeDecor keeps valid swatches and drops bad hex / empty names", () => {
  const s = normalizeDecor({
    style: "warm mid-century",
    palette: [
      { name: "Clay", hex: "#B5651D" },
      { name: "Bad", hex: "not-a-hex" },
      { name: "", hex: "#ffffff" },
      { name: "Sage", hex: "#9CAF88" },
    ],
    materials: [{ name: "white oak", note: "flooring" }, { name: "" }],
    items: [{ name: "walnut sideboard", note: "under the window" }],
  });
  assert.equal(s.style, "warm mid-century");
  assert.deepEqual(
    s.palette.map((p) => p.name),
    ["Clay", "Sage"],
  );
  assert.equal(s.palette[0].hex, "#b5651d"); // lowercased
  assert.equal(s.materials.length, 1);
  assert.equal(s.items[0].name, "walnut sideboard");
});

test("normalizeDecor tolerates junk and clamps array sizes", () => {
  const s = normalizeDecor({ palette: "nope", materials: null, items: undefined });
  assert.deepEqual(s.palette, []);
  assert.deepEqual(s.materials, []);
  assert.deepEqual(s.items, []);

  const many = normalizeDecor({
    palette: Array.from({ length: 20 }, (_, i) => ({ name: `c${i}`, hex: "#010203" })),
  });
  assert.ok(many.palette.length <= 8);
});

test("searchUrl builds an encoded shopping search, not a product URL", () => {
  const url = searchUrl("brushed brass sconce");
  assert.ok(url.startsWith("https://www.google.com/search?tbm=shop&q="));
  assert.ok(url.includes("brushed%20brass%20sconce"));
});
