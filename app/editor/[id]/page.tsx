"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import CanvasStage from "@/components/CanvasStage";
import { useSession } from "@/lib/supabase/useSession";

export default function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { configured, loading, user } = useSession();

  // Explicit local mode needs no session at all.
  const explicitLocal = id === "local";

  // Resolve the session first so the initial render matches server & client.
  if (!explicitLocal && loading) {
    return <div className="flex h-screen w-screen items-center justify-center text-sm text-stone-500">Loading…</div>;
  }

  // "local" = sketch without saving; also fall back to local if Supabase is off.
  const isLocal = explicitLocal || !configured;

  if (!isLocal && !user) {
    // Not signed in — send them home to sign in.
    router.replace("/");
    return null;
  }

  return (
    <main className="h-screen w-screen">
      <CanvasStage planId={isLocal ? null : id} canPersist={!isLocal} />
    </main>
  );
}
