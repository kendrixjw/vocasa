"use client";

import Link from "next/link";
import AuthGate from "@/components/AuthGate";
import Dashboard from "@/components/Dashboard";
import { useSession } from "@/lib/supabase/useSession";

export default function Home() {
  const { configured, loading, user } = useSession();

  // Check loading FIRST so the initial render is identical on server & client.
  if (loading) {
    return <div className="flex h-screen w-screen items-center justify-center text-sm text-stone-500">Loading…</div>;
  }

  // Supabase not set up: run the app locally with no save/load.
  if (!configured) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-stone-50 p-6">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-lg ring-1 ring-stone-200">
          <h1 className="text-2xl font-semibold text-stone-800">Vocasa</h1>
          <p className="mt-2 text-sm text-stone-500">
            Saving isn&apos;t configured yet, but you can still sketch. Add Supabase keys to enable your plan
            dashboard.
          </p>
          <Link
            href="/editor/local"
            className="mt-6 inline-block rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-hover"
          >
            Start sketching →
          </Link>
        </div>
      </div>
    );
  }

  if (!user) return <AuthGate />;

  return (
    <div className="h-screen w-screen overflow-y-auto">
      <Dashboard user={user} />
    </div>
  );
}
