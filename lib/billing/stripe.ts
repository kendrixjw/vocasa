// Shared server-side Stripe client. Returns null when STRIPE_SECRET_KEY is
// unset so billing degrades gracefully (the app still renders for free-tier
// users and returns a clear 503 from billing routes).

import Stripe from "stripe";

let stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!stripe) stripe = new Stripe(key);
  return stripe;
}
