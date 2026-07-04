// React hook exposing the current Supabase user (or null) and a loading flag.
// Subscribes to auth state changes so sign-in/out re-render instantly.
"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "./client.ts";
import { isSupabaseConfigured } from "./config.ts";

export type SessionState = {
  configured: boolean;
  loading: boolean;
  user: User | null;
};

export function useSession(): SessionState {
  const configured = isSupabaseConfigured();
  // Start `loading` true on BOTH server and client so the first render matches
  // (avoids a hydration mismatch); the effect resolves it right after mount.
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client) {
      setLoading(false);
      return;
    }
    let active = true;
    client.auth.getUser().then(({ data }) => {
      if (!active) return;
      setUser(data.user ?? null);
      setLoading(false);
    });
    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { configured, loading, user };
}
