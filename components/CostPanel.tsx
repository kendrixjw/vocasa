// Rough cost estimate for the current plan. Reads the same room polygons the
// canvas draws (so the area matches the square footage shown on each room) and
// multiplies by a finish rate. Finish/mode are saved with the plan.
//
// Estimates only — no AI, no network. Everything here is local arithmetic.
"use client";

import { useMemo, useState } from "react";
import type { Editor } from "@/lib/editor";
import { FINISHES, MODES, estimate, usd, type FinishId, type ModeId } from "@/lib/cost/estimate";
import CostSummary, { CostDisclaimer } from "@/components/CostSummary";

export default function CostPanel({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const { finish, mode } = editor.costSettings;

  // editor.revision bumps on every content mutation and on settings changes;
  // the host re-renders on change, so this recomputes exactly when it should.
  const est = useMemo(
    () => estimate(editor.allFloorEntities(), editor.costSettings),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, editor.revision],
  );

  const empty = est.totalAreaSqFt === 0;

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Rough build / renovation cost"
        className="flex items-center gap-1.5 rounded-lg bg-white/90 px-2.5 py-1 text-xs font-medium text-amber-700 shadow ring-1 ring-amber-200 transition hover:bg-white"
      >
        <TagIcon />
        {empty ? "Cost" : usd(est.total)}
      </button>

      {open && (
        <div className="w-80 rounded-xl bg-white/97 px-3 py-2.5 text-sm text-neutral-700 shadow-lg ring-1 ring-amber-200">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700">
            <TagIcon /> Cost estimate
          </div>

          <div className="mb-2 flex gap-1.5">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => editor.setCostSettings({ mode: m.id as ModeId })}
                className={`flex-1 rounded-lg px-2 py-1 text-xs font-medium transition ${
                  mode === m.id
                    ? "bg-amber-600 text-white"
                    : "text-neutral-600 ring-1 ring-stone-200 hover:bg-stone-50"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="mb-2.5 flex gap-1.5">
            {FINISHES.map((f) => (
              <button
                key={f.id}
                onClick={() => editor.setCostSettings({ finish: f.id as FinishId })}
                title={`${f.label} finish`}
                className={`flex-1 rounded-lg px-2 py-1 text-xs font-medium transition ${
                  finish === f.id
                    ? "bg-stone-800 text-white"
                    : "text-neutral-600 ring-1 ring-stone-200 hover:bg-stone-50"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {empty ? (
            <p className="py-1 text-xs text-neutral-500">
              Draw some walls — the estimate follows the enclosed rooms.
            </p>
          ) : (
            <div className="border-t border-stone-100 pt-2">
              <CostSummary est={est} />
            </div>
          )}

          <CostDisclaimer />
        </div>
      )}
    </div>
  );
}

function TagIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12.6 2.7a2 2 0 0 0-1.4-.6H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.5 8.5a2 2 0 0 0 2.8 0l7.2-7.2a2 2 0 0 0 0-2.8Z" />
      <circle cx="7" cy="7" r="1.2" />
    </svg>
  );
}
