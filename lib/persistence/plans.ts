// CRUD for the `plans` table via the browser Supabase client. RLS guarantees a
// user only ever touches their own rows, so no owner filter is needed here
// (the insert sets owner from the session).
"use client";

import { getSupabaseBrowserClient } from "../supabase/client.ts";
import type { PlanData } from "./plan.ts";

export type PlanSummary = {
  id: string;
  name: string;
  thumbnail: string | null;
  updated_at: string;
  share_token: string | null;
};

export type PlanRecord = {
  id: string;
  name: string;
  data: PlanData;
  share_token: string | null;
};

function requireClient() {
  const client = getSupabaseBrowserClient();
  if (!client) throw new Error("Saving isn't configured.");
  return client;
}

export async function listPlans(): Promise<PlanSummary[]> {
  const client = requireClient();
  const { data, error } = await client
    .from("plans")
    .select("id, name, thumbnail, updated_at, share_token")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as PlanSummary[];
}

export async function getPlan(id: string): Promise<PlanRecord | null> {
  const client = requireClient();
  const { data, error } = await client
    .from("plans")
    .select("id, name, data, share_token")
    .eq("id", id)
    .single();
  if (error) {
    if (error.code === "PGRST116") return null; // no row
    throw new Error(error.message);
  }
  return data as PlanRecord;
}

export async function createPlan(
  name: string,
  data: PlanData,
  thumbnail: string | null,
): Promise<string> {
  const client = requireClient();
  const { data: user } = await client.auth.getUser();
  const owner = user.user?.id;
  if (!owner) throw new Error("You're not signed in.");
  const { data: row, error } = await client
    .from("plans")
    .insert({ owner, name, data, thumbnail })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (row as { id: string }).id;
}

export async function updatePlan(
  id: string,
  patch: { name?: string; data?: PlanData; thumbnail?: string | null },
): Promise<void> {
  const client = requireClient();
  const { error } = await client
    .from("plans")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deletePlan(id: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.from("plans").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Enable sharing (set a token) or revoke it (null). Owner-only via RLS. */
export async function setShareToken(id: string, token: string | null): Promise<void> {
  const client = requireClient();
  const { error } = await client.from("plans").update({ share_token: token }).eq("id", id);
  if (error) throw new Error(error.message);
}
