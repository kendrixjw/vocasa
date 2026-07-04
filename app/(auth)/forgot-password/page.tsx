"use client";

import { useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { siteUrl } from "@/lib/supabase/config";
import { friendlyAuthError } from "@/lib/auth/messages";
import { AuthCard, inputClass, primaryBtnClass } from "@/components/auth/AuthCard";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const client = getSupabaseBrowserClient();

  const sendReset = async () => {
    if (!client || !email.trim() || pending) return;
    setPending(true);
    setError(null);
    // redirectTo must EXACTLY match a Supabase Redirect URL (auth-packet LESSON 3).
    const { error: err } = await client.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${siteUrl()}/reset-password`,
    });
    setPending(false);
    if (err) setError(friendlyAuthError(err.message));
    else setSent(true);
  };

  return (
    <AuthCard title="Forgot your password? No problem." subtitle="We will email you a link to set a new one.">
      {sent ? (
        <div className="flex flex-col gap-3">
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
            Check your inbox for a password reset link.
          </p>
          <Link href="/login" className="text-xs text-brand hover:underline">
            Back to log in
          </Link>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendReset();
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
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button type="submit" disabled={pending || !client} className={primaryBtnClass}>
            {pending ? "Sending..." : "Email me a reset link"}
          </button>
          <Link href="/login" className="text-xs text-stone-500 hover:underline">
            Back to log in
          </Link>
        </form>
      )}
    </AuthCard>
  );
}
