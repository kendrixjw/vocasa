"use client";

// Public landing page. Anyone can view it and try the demo; saving requires an
// account. CTAs adapt to whether you are signed in.

import Link from "next/link";
import { useSession } from "@/lib/supabase/useSession";

export default function Landing() {
  const { configured, loading, user } = useSession();

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-stone-50 px-6 py-12 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/vocasa-lockup.png"
        alt="Vocasa"
        className="mb-6 h-[1600px] max-h-[80vh] w-auto max-w-full"
      />
      <p className="max-w-md text-base text-stone-600">
        The voice-powered drafting app. Say &ldquo;make a 15 by 20 living room&rdquo; and watch it appear, labeled
        and measured.
      </p>

      <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
        {!configured ? (
          <Link href="/editor/local" className="rounded-lg bg-brand px-6 py-2.5 text-sm font-medium text-white transition hover:bg-brand-hover">
            Start sketching
          </Link>
        ) : loading ? (
          <div className="h-10" />
        ) : user ? (
          <>
            <Link href="/dashboard" className="rounded-lg bg-brand px-6 py-2.5 text-sm font-medium text-white transition hover:bg-brand-hover">
              Go to your plans
            </Link>
            <Link href="/editor/local" className="rounded-lg px-6 py-2.5 text-sm font-medium text-brand ring-1 ring-stone-300 transition hover:bg-white">
              Open the demo
            </Link>
          </>
        ) : (
          <>
            <Link href="/signup" className="rounded-lg bg-brand px-6 py-2.5 text-sm font-medium text-white transition hover:bg-brand-hover">
              Get started
            </Link>
            <Link href="/login" className="rounded-lg px-6 py-2.5 text-sm font-medium text-brand ring-1 ring-stone-300 transition hover:bg-white">
              Log in
            </Link>
            <Link href="/editor/local" className="text-sm text-stone-500 hover:text-brand hover:underline">
              or try the demo
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
