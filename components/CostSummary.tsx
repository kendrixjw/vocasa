// Presentational cost breakdown: headline total, category bars, per-floor split.
// Pure — takes a computed Estimate and renders it. Shared by the editor's
// CostPanel (which adds the finish/mode controls) and the read-only ShareViewer.
"use client";

import type { Estimate } from "@/lib/cost/estimate";
import { usd } from "@/lib/cost/estimate";

export default function CostSummary({ est }: { est: Estimate }) {
  const max = Math.max(1, ...est.categories.map((c) => c.amount));

  return (
    <>
      <div className="flex items-baseline justify-between">
        <span className="text-2xl font-semibold tabular-nums text-neutral-900">{usd(est.total)}</span>
        <span className="text-[11px] text-neutral-500">
          {est.totalAreaSqFt.toLocaleString("en-US")} sq ft · ${est.rate}/sq ft
        </span>
      </div>

      <div className="mt-2.5 space-y-1.5">
        {est.categories.map((c) => (
          <div key={c.key}>
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-neutral-600">{c.label}</span>
              <span className="tabular-nums text-neutral-800">{usd(c.amount)}</span>
            </div>
            <div className="mt-0.5 h-1 rounded-full bg-stone-100">
              <div className="h-1 rounded-full bg-amber-500" style={{ width: `${(c.amount / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>

      {est.floors.length > 1 && (
        <div className="mt-2.5 border-t border-stone-100 pt-2">
          <div className="mb-1 text-xs font-semibold text-neutral-500">By floor</div>
          <ul className="space-y-0.5">
            {est.floors.map((f) => (
              <li key={f.id} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate text-neutral-700">{f.name}</span>
                <span className="shrink-0 text-neutral-400">{f.areaSqFt.toLocaleString("en-US")} sq ft</span>
                <span className="shrink-0 tabular-nums text-neutral-800">{usd(f.cost)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/** The standard caveat. Shown wherever an estimate is. */
export function CostDisclaimer() {
  return (
    <p className="mt-2 text-[11px] leading-snug text-neutral-400">
      A rough order-of-magnitude figure from floor area and item count — not a bid. Excludes land,
      permits, and site work.
    </p>
  );
}
