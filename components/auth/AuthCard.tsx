// Shared chrome for the auth pages: centered card, brand mark + wordmark,
// title/subtitle. ASCII-safe copy only (special Unicode has caused hydration
// errors on auth pages before).
"use client";

import type { ReactNode } from "react";

export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-stone-50 p-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg ring-1 ring-stone-200">
        <div className="mb-5 flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/vocasa-mark.svg" alt="" className="h-7 w-7" />
          <span className="text-lg font-semibold tracking-tight text-brand">Vocasa</span>
        </div>
        <h1 className="text-xl font-semibold text-stone-800">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-stone-500">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

// Shared field/button classes so the auth pages stay consistent.
export const inputClass =
  "w-full rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none focus:border-brand";
export const primaryBtnClass =
  "w-full rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-hover disabled:opacity-50";
