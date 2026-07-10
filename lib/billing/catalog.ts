// Render-credit catalog. Maps friendly product keys to a Stripe Price (by env
// var, so no live IDs are committed) and the number of credits the purchase
// grants. Packs are one-time; tiers are subscriptions that grant their monthly
// render allotment on every paid invoice (unused credits roll over).
//
// Set the matching STRIPE_PRICE_* env vars to the Price IDs from your Stripe
// dashboard. Products whose price env is unset are simply hidden/rejected.

export type ProductKey = "pack_30" | "pack_100" | "tier_standard" | "tier_pro";

export type Product = {
  key: ProductKey;
  label: string;
  mode: "payment" | "subscription";
  priceEnv: string; // name of the env var holding the Stripe Price ID
  credits: number; // credits granted per purchase (packs) or per cycle (tiers)
};

export const CATALOG: Record<ProductKey, Product> = {
  pack_30: { key: "pack_30", label: "30 render credits", mode: "payment", priceEnv: "STRIPE_PRICE_PACK_30", credits: 30 },
  pack_100: { key: "pack_100", label: "100 render credits", mode: "payment", priceEnv: "STRIPE_PRICE_PACK_100", credits: 100 },
  tier_standard: { key: "tier_standard", label: "Standard — 40 renders/mo", mode: "subscription", priceEnv: "STRIPE_PRICE_TIER_STANDARD", credits: 40 },
  tier_pro: { key: "tier_pro", label: "Pro — 100 renders/mo", mode: "subscription", priceEnv: "STRIPE_PRICE_TIER_PRO", credits: 100 },
};

export function productFor(key: string): Product | null {
  return (CATALOG as Record<string, Product>)[key] ?? null;
}

export function priceIdFor(p: Product): string | undefined {
  return process.env[p.priceEnv];
}

/** Credits granted for a given Stripe Price ID (used by the webhook for
 *  subscription invoices, where we only know the price, not the product key). */
export function creditsForPrice(priceId: string | null | undefined): number | null {
  if (!priceId) return null;
  for (const p of Object.values(CATALOG)) {
    if (process.env[p.priceEnv] === priceId) return p.credits;
  }
  return null;
}
