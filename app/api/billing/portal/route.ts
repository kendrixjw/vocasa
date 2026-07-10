// Open the Stripe billing portal so a user can manage or cancel their
// subscription and see invoices. Authenticated; looks up their Stripe customer
// and returns a { url } to redirect to.

import { getStripe } from "@/lib/billing/stripe.ts";
import { getSupabaseServerClient } from "@/lib/supabase/server.ts";
import { siteUrl } from "@/lib/supabase/config.ts";

export const runtime = "nodejs";

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
    return Response.json({ error: "Please sign in." }, { status: 401 });
  }

  const { data: row } = await supabase!
    .from("render_customers")
    .select("stripe_customer_id")
    .maybeSingle();
  const customerId = row?.stripe_customer_id as string | undefined;
  if (!customerId) {
    return Response.json({ error: "No billing account yet — buy credits first." }, { status: 404 });
  }

  const base = siteUrl() || new URL(req.url).origin;
  try {
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${base}/dashboard`,
    });
    return Response.json({ url: portal.url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Couldn't open the billing portal.";
    return Response.json({ error: msg }, { status: 502 });
  }
}
