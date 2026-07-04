"use client";

// Gated dashboard. proxy.ts already redirects unauthenticated users to /login;
// this client guard is a backstop and provides the user object to <Dashboard>.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Dashboard from "@/components/Dashboard";
import { useSession } from "@/lib/supabase/useSession";

export default function DashboardPage() {
  const router = useRouter();
  const { loading, user } = useSession();

  useEffect(() => {
    if (!loading && !user) router.replace("/login?next=/dashboard");
  }, [loading, user, router]);

  if (loading || !user) {
    return <div className="flex h-screen w-screen items-center justify-center text-sm text-stone-500">Loading...</div>;
  }

  return (
    <div className="h-screen w-screen overflow-y-auto">
      <Dashboard user={user} />
    </div>
  );
}
