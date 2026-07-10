import { test } from "node:test";
import assert from "node:assert/strict";
import { productFor, creditsForPrice, CATALOG } from "./catalog.ts";

test("productFor resolves known keys and rejects unknown ones", () => {
  assert.equal(productFor("pack_30")?.credits, 30);
  assert.equal(productFor("tier_pro")?.mode, "subscription");
  assert.equal(productFor("nope"), null);
  assert.equal(productFor(""), null);
});

test("creditsForPrice maps a configured Stripe price back to its credits", () => {
  process.env.STRIPE_PRICE_TIER_STANDARD = "price_test_standard";
  assert.equal(creditsForPrice("price_test_standard"), CATALOG.tier_standard.credits);
  assert.equal(creditsForPrice("price_unknown"), null);
  assert.equal(creditsForPrice(null), null);
  delete process.env.STRIPE_PRICE_TIER_STANDARD;
});
