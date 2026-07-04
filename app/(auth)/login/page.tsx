"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { siteUrl } from "@/lib/supabase/config";
import { friendlyAuthError } from "@/lib/auth/messages";
import { AuthCard, inputClass, primaryBtnClass } from "@/components/auth/AuthCard";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicSent, setMagicSent] = useState(false);

  const client = getSupabaseBrowserClient();

  const loginWithPassword = async () => {
    if (!client || pending) return;
    setPending(true);
    setError(null);
    const { error: err } = await client.auth.signInWithPassword({ email: email.trim(), password });
    if (err) {
      setError(friendlyAuthError(err.message));
      setPending(false);
    } else {
      router.push(next);
    }
  };

  const sendMagicLink = async () => {
    if (!client || !email.trim() || pending) return;
    setPending(true);
    setError(null);
    const { error: err } = await client.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${siteUrl()}${next.startsWith("/") ? next : "/dashboard"}` },
    });
    setPending(false);
    if (err) setError(friendlyAuthError(err.message));
    else setMagicSent(true);
  };

  return (
    <AuthCard title="Welcome back" subtitle="Log in to open your saved plans.">
      {!client && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
          Sign-in is not configured on this deployment.
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void loginWithPassword();
        }}
        className="flex flex-col gap-3"
      >
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          required
          className={inputClass}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="current-password"
          required
          className={inputClass}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button type="submit" disabled={pending || !client} className={primaryBtnClass}>
          {pending ? "Logging in..." : "Log in"}
        </button>
      </form>

      <div className="mt-4 flex items-center justify-between text-xs">
        <Link href="/forgot-password" className="text-brand hover:underline">
          Forgot your password?
        </Link>
        <Link href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="text-stone-500 hover:underline">
          Create an account
        </Link>
      </div>

      <div className="mt-5 border-t border-stone-100 pt-4">
        {magicSent ? (
          <p className="text-xs text-emerald-600">Check your inbox for a one-time sign-in link.</p>
        ) : (
          <button
            onClick={() => void sendMagicLink()}
            disabled={pending || !client || !email.trim()}
            className="text-xs text-stone-500 hover:text-brand hover:underline disabled:opacity-50"
          >
            Or email me a magic link instead
          </button>
        )}
      </div>
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
