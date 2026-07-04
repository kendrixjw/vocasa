"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { siteUrl } from "@/lib/supabase/config";
import { friendlyAuthError } from "@/lib/auth/messages";
import { AuthCard, inputClass, primaryBtnClass } from "@/components/auth/AuthCard";

function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const client = getSupabaseBrowserClient();

  const signUp = async () => {
    if (!client || pending) return;
    if (password.length < 6) {
      setError("Please pick a password with at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Those passwords do not match.");
      return;
    }
    setPending(true);
    setError(null);
    setNotice(null);

    const mail = email.trim();
    const { data, error: err } = await client.auth.signUp({
      email: mail,
      password,
      options: { emailRedirectTo: `${siteUrl()}/dashboard` },
    });
    if (err) {
      setError(friendlyAuthError(err.message));
      setPending(false);
      return;
    }
    // With email confirmation OFF, signUp returns a session -> straight into the app.
    if (data.session) {
      router.push(next);
      return;
    }
    // Otherwise try an immediate sign-in (works when confirmation is not required).
    const { error: signInErr } = await client.auth.signInWithPassword({ email: mail, password });
    if (!signInErr) {
      router.push(next);
      return;
    }
    setNotice("Account created. Check your email to confirm, then log in.");
    setPending(false);
  };

  return (
    <AuthCard title="Create your account" subtitle="Sketch rooms with your voice and save them.">
      {!client && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
          Sign-up is not configured on this deployment.
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void signUp();
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
          placeholder="Password (at least 6 characters)"
          autoComplete="new-password"
          required
          className={inputClass}
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm password"
          autoComplete="new-password"
          required
          className={inputClass}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        {notice && <p className="text-xs text-emerald-600">{notice}</p>}
        <button type="submit" disabled={pending || !client} className={primaryBtnClass}>
          {pending ? "Creating account..." : "Create account"}
        </button>
      </form>

      <p className="mt-4 text-xs text-stone-500">
        Already have an account?{" "}
        <Link href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="text-brand hover:underline">
          Log in
        </Link>
      </p>
    </AuthCard>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}
