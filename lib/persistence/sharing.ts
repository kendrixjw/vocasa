// Public (anonymous) access to a SHARED plan, keyed by its share token. These
// call SECURITY DEFINER RPCs (see 0002_sharing.sql) so an anon visitor can only
// read/comment on the exact plan whose token they hold — no enumeration.
"use client";

import { getSupabaseBrowserClient } from "../supabase/client.ts";
import type { PlanData } from "./plan.ts";

export type SharedPlan = { id: string; name: string; data: PlanData };
export type SharedComment = {
  id: string;
  author_name: string;
  body: string;
  created_at: string;
};

function requireClient() {
  const client = getSupabaseBrowserClient();
  if (!client) throw new Error("Sharing isn't configured.");
  return client;
}

/** Resolve a shared plan by token, or null if the link is invalid/revoked. */
export async function getSharedPlan(token: string): Promise<SharedPlan | null> {
  const client = requireClient();
  const { data, error } = await client.rpc("get_shared_plan", { p_token: token });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return row ? (row as SharedPlan) : null;
}

export async function getSharedComments(token: string): Promise<SharedComment[]> {
  const client = requireClient();
  const { data, error } = await client.rpc("get_shared_comments", { p_token: token });
  if (error) throw new Error(error.message);
  return (data ?? []) as SharedComment[];
}

export async function addSharedComment(token: string, author: string, body: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc("add_shared_comment", {
    p_token: token,
    p_author: author,
    p_body: body,
  });
  if (error) throw new Error(error.message);
}
