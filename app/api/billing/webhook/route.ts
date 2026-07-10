// Stripe webhook — the ONLY writer of render credits. Verifies the signature,
// dedupes by event id, then fulfills:
//   * checkout.session.completed (mode=payment) -> grant a credit pack
//   * checkout.session.completed                -> record the customer mapping
//   * invoice.paid (subscription)               -> grant the tier's monthly credits
// Runs under the Supabase service role (no user session), so it can credit any
// user by id. Always returns 200 for handled/duplicate events so Stripe stops
// retrying; returns 400 only when the signature can't be verified.

import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe.ts";
import { getSupabaseAdminClient } from "@/lib/supabase/admin.ts";
import { creditsForPrice } from "@/lib/billing/catalog.ts";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const admin = getSupabaseAdminClient();
  if (!stripe || !secret || !admin) {
    return Response.json({ error: "Billing isn't configured." }, { status: 503 });
  }

  const sig = req.headers.get("stripe-signature");
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig ?? "", secret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "bad signature";
    return Response.json({ error: `Webhook signature failed: ${msg}` }, { status: 400 });
  }

  // Idempotency: first insert wins; a duplicate delivery is acknowledged and skipped.
  const dedupe = await admin.from("stripe_events").insert({ id: event.id });
  if (dedupe.error) {
    return Response.json({ received: true, duplicate: true });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId ?? session.client_reference_id ?? null;
      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;

      if (userId && customerId) {
        await admin.from("render_customers").upsert(
          { owner: userId, stripe_customer_id: customerId, updated_at: new Date().toISOString() },
          { onConflict: "owner" },
        );
      }
      // One-time packs are fulfilled here; subscriptions are fulfilled on invoice.paid.
      if (session.mode === "payment" && userId) {
        const credits = Number(session.metadata?.credits ?? 0);
        if (credits > 0) {
          await admin.rpc("add_render_credits", { p_owner: userId, p_amount: credits });
        }
      }
    } else if (event.type === "invoice.paid") {
      const invoice = event.data.object as Stripe.Invoice;
      const inv = invoice as unknown as {
        subscription?: string | { id: string };
        lines?: { data?: Array<{ price?: { id?: string } | null }> };
      };
      const subId = typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;
      if (subId) {
        const sub = await stripe.subscriptions.retrieve(subId);
        const userId = sub.metadata?.userId ?? null;
        const priceId = sub.items.data[0]?.price?.id ?? inv.lines?.data?.[0]?.price?.id ?? null;
        const credits = creditsForPrice(priceId);
        if (userId && credits) {
          await admin.rpc("add_render_credits", { p_owner: userId, p_amount: credits });
        }
      }
    }
  } catch (err) {
    // Fulfillment failed after we recorded the event; drop the dedupe row so a
    // Stripe retry can re-attempt cleanly.
    await admin.from("stripe_events").delete().eq("id", event.id);
    const msg = err instanceof Error ? err.message : "fulfillment error";
    return Response.json({ error: msg }, { status: 500 });
  }

  return Response.json({ received: true });
}
