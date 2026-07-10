// Client helper: start a Stripe Checkout for a credit pack or subscription tier
// and redirect the browser to it. Throws with a readable message on failure so
// the caller can surface it.

import type { ProductKey } from "./catalog.ts";

export async function startCheckout(product: ProductKey): Promise<void> {
  const res = await fetch("/api/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product }),
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) {
    throw new Error(data.error ?? "Couldn't start checkout.");
  }
  window.location.href = data.url;
}
