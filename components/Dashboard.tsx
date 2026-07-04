// Plan dashboard: thumbnail grid of the signed-in user's saved plans, plus
// New plan / open / delete / sign out.
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { createPlan, deletePlan, listPlans, type PlanSummary } from "@/lib/persistence/plans";
import { blankPlan } from "@/lib/persistence/blank";

export default function Dashboard({ user }: { user: User }) {
  const router = useRouter();
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setPlans(await listPlans());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your plans.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const newPlan = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const id = await createPlan("Untitled plan", blankPlan(), null);
      router.push(`/editor/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create a plan.");
      setCreating(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this plan? This can't be undone.")) return;
    try {
      await deletePlan(id);
      setPlans((p) => (p ? p.filter((x) => x.id !== id) : p));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete the plan.");
    }
  };

  const signOut = async () => {
    await getSupabaseBrowserClient()?.auth.signOut();
  };

  return (
    <div className="min-h-full bg-stone-50">
      <header className="flex items-center justify-between border-b border-stone-200 bg-white px-6 py-4">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/vocasa-mark.svg" alt="" className="h-7 w-7" />
          <span className="text-lg font-semibold tracking-tight text-brand">Vocasa</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void newPlan()}
            disabled={creating}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-hover disabled:opacity-50"
          >
            {creating ? "Creating…" : "New plan"}
          </button>
          <button
            onClick={() => void signOut()}
            className="rounded-lg px-3 py-2 text-sm text-stone-600 ring-1 ring-stone-200 transition hover:bg-stone-100"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-stone-800">Your plans</h1>
          <p className="text-xs text-stone-500">{user.email}</p>
        </div>
        {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{error}</p>}

        {plans === null ? (
          <p className="text-sm text-stone-500">Loading…</p>
        ) : plans.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-12 text-center">
            <p className="text-stone-600">No plans yet.</p>
            <button onClick={() => void newPlan()} className="mt-3 text-sm font-medium text-brand hover:underline">
              Create your first plan →
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((p) => (
              <div key={p.id} className="group overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-stone-200 transition hover:shadow-md">
                <button onClick={() => router.push(`/editor/${p.id}`)} className="block w-full text-left">
                  <div className="flex aspect-[16/10] items-center justify-center bg-stone-100">
                    {p.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.thumbnail} alt={p.name} className="h-full w-full object-contain" />
                    ) : (
                      <span className="text-xs text-stone-400">No preview</span>
                    )}
                  </div>
                  <div className="px-4 py-3">
                    <div className="truncate text-sm font-medium text-stone-800">{p.name}</div>
                    <div className="text-xs text-stone-400">{new Date(p.updated_at).toLocaleString()}</div>
                  </div>
                </button>
                <div className="flex justify-end border-t border-stone-100 px-3 py-2">
                  <button onClick={() => void remove(p.id)} className="text-xs text-stone-400 transition hover:text-red-600">
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
