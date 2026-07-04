"use client";

// Deliberately OUTSIDE the (auth) group at a stable top-level route, because
// Supabase reset emails link here directly. The recovery tokens arrive in the
// URL FRAGMENT and must be consumed BEFORE any auth-state check or redirect
// (auth-packet LESSON 2). This route is also in proxy.ts PUBLIC_ROUTES so an
// unauthenticated user is never bounced to /login first (LESSON 1).

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyAuthError } from "@/lib/auth/messages";
import { AuthCard, inputClass, primaryBtnClass } from "@/components/auth/AuthCard";

type Status = "checking" | "ready" | "invalid" | "saving";

export default function ResetPasswordPage() {
  const router = useRouter();
  const client = getSupabaseBrowserClient();

  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Consume the recovery token FIRST, before anything else.
  useEffect(() => {
    if (!client) {
      setStatus("invalid");
      return;
    }
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");
    const type = hashParams.get("type");

    if (type === "recovery" && accessToken) {
      client.auth
        .setSession({ access_token: accessToken, refresh_token: refreshToken || "" })
        .then(({ error: err }) => {
          setStatus(err ? "invalid" : "ready");
        });
    } else {
      // No recovery token present: show the invalid state, do NOT redirect.
      setStatus("invalid");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const savePassword = async () => {
    if (!client) return;
    if (password.length < 6) {
      setError("Please pick a password with at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Those passwords do not match.");
      return;
    }
    setStatus("saving");
    setError(null);
    const { error: err } = await client.auth.updateUser({ password });
    if (err) {
      setError(friendlyAuthError(err.message));
      setStatus("ready");
      return;
    }
    router.push("/dashboard");
  };

  if (status === "checking") {
    return (
      <AuthCard title="One moment" subtitle="Verifying your reset link...">
        <div />
      </AuthCard>
    );
  }

  if (status === "invalid") {
    return (
      <AuthCard title="This link did not work" subtitle="It may have expired or already been used.">
        <div className="flex flex-col gap-3">
          <Link href="/forgot-password" className={primaryBtnClass + " text-center"}>
            Send a new reset link
          </Link>
          <Link href="/login" className="text-center text-xs text-stone-500 hover:underline">
            Back to log in
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Set a new password" subtitle="Choose a password for your account.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void savePassword();
        }}
        className="flex flex-col gap-3"
      >
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password (at least 6 characters)"
          autoComplete="new-password"
          required
          className={inputClass}
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm new password"
          autoComplete="new-password"
          required
          className={inputClass}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button type="submit" disabled={status === "saving"} className={primaryBtnClass}>
          {status === "saving" ? "Saving..." : "Save new password"}
        </button>
      </form>
    </AuthCard>
  );
}
