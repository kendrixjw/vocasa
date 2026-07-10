// Service-role Supabase client — SERVER ONLY. Bypasses Row Level Security, so
// it must never be imported into client code or exposed to the browser. Used by
// the Stripe webhook, which has no user session and must write another user's
// render credits by their id.

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./config.ts";

export function getSupabaseAdminClient(): SupabaseClient | null {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !serviceKey) return null;
  return createClient(SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
