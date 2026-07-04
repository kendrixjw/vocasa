// Central place to read Supabase env. Both are PUBLIC values (the anon key is
// safe to ship — Row Level Security enforces per-user access). When unset, the
// app runs in local-only mode: sketch freely, no save/load.

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function isSupabaseConfigured(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
}
