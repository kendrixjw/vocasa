// Magic-link (email OTP) sign-in. Consumer-friendly: no password to remember.
// Shown when Supabase is configured but nobody is signed in.
"use client";

import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function AuthGate() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  const sendLink = async () => {
    const client = getSupabaseBrowserClient();
    if (!client || !email.trim()) return;
    setStatus("sending");
    const { error } = await client.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined },
    });
    if (error) {
      setStatus("error");
      setMessage(error.message);
    } else {
      setStatus("sent");
      setMessage("Check your inbox for a sign-in link.");
    }
  };

  return (
    <div className="flex h-full w-full items-center justify-center bg-stone-50 p-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg ring-1 ring-stone-200">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/vocasa-lockup.png"
          alt="Vocasa"
          className="mx-auto mb-4 h-20 w-auto"
        />
        <p className="mt-1 text-center text-sm text-stone-500">
          Sketch a room with your voice. Sign in to save your plans.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void sendLink()}
            placeholder="you@example.com"
            disabled={status === "sending" || status === "sent"}
            className="rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <button
            onClick={() => void sendLink()}
            disabled={status === "sending" || status === "sent" || !email.trim()}
            className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-hover disabled:opacity-50"
          >
            {status === "sending" ? "Sending…" : status === "sent" ? "Link sent" : "Email me a sign-in link"}
          </button>
          {message && (
            <p className={`text-xs ${status === "error" ? "text-red-600" : "text-emerald-600"}`}>{message}</p>
          )}
        </div>
      </div>
    </div>
  );
}
