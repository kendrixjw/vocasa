// Create a Stripe Checkout Session for a render-credit pack or a subscription
// tier. Authenticated: the session is tied to the signed-in user via
// client_reference_id + metadata so the webhook can credit the right account.
// Returns { url } for the client to redirect to.

import { getStripe } from "@/lib/billing/stripe.ts";
import { productFor, priceIdFor } from "@/lib/billing/catalog.ts";
import { getSupabaseServerClient } from "@/lib/supabase/server.ts";
import { siteUrl } from "@/lib/supabase/config.ts";

export const runtime = "nodejs";

type Body = { product?: unknown };

export async function POST(req: Request): Promise<Response> {
  const stripe = getStripe();
  if (!stripe) {
    return Response.json({ error: "Billing isn't configured on this server yet." }, { status: 503 });
  }

  const supabase = await getSupabaseServerClient();
  const {
    data: { user } = { user: null },
  } = (await supabase?.auth.getUser()) ?? { data: { user: null } };
  if (!user) {
    return Response.json({ error: "Please sign in to buy credits." }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const product = productFor(typeof body.product === "string" ? body.product : "");
  if (!product) {
    return Response.json({ error: "Unknown product." }, { status: 400 });
  }
  const price = priceIdFor(product);
  if (!price) {
    return Response.json({ error: "That product isn't available right now." }, { status: 400 });
  }

  // Prefer an existing Stripe customer for this user so purchases and any
  // subscription live under one account.
  const { data: existing } = await supabase!
    .from("render_customers")
    .select("stripe_customer_id")
    .maybeSingle();
  const customerId = (existing?.stripe_customer_id as string | undefined) ?? undefined;

  const base = siteUrl() || new URL(req.url).origin;
  try {
    const session = await stripe.checkout.sessions.create({
      mode: product.mode,
      line_items: [{ price, quantity: 1 }],
      ...(customerId ? { customer: customerId } : { customer_email: user.email ?? undefined }),
      client_reference_id: user.id,
      // Packs are fulfilled from checkout.session.completed using this metadata;
      // subscriptions are fulfilled from invoice.paid using the price -> credits
      // map, so stamp userId on the subscription too.
      metadata: { userId: user.id, credits: String(product.credits), product: product.key },
      ...(product.mode === "subscription"
        ? { subscription_data: { metadata: { userId: user.id } } }
        : {}),
      success_url: `${base}/dashboard?billing=success`,
      cancel_url: `${base}/dashboard?billing=cancelled`,
    });
    return Response.json({ url: session.url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Couldn't start checkout.";
    return Response.json({ error: msg }, { status: 502 });
  }
}
