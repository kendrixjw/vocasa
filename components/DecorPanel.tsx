// Decor / style suggestions (richer decor roadmap item). Text-based AI scheme:
// palette + materials + furnishing ideas for the current plan, optionally seeded
// by a style phrase and/or a reference photo. Furnishing ideas link to retailer
// SEARCHES (honest, not fabricated product pages). Distinct from the premium
// Redesign render bridge — these are free text suggestions, not images.
"use client";

import { useCallback, useRef, useState } from "react";
import type { Editor } from "@/lib/editor";
import { requestDecor, searchUrl, type DecorScheme } from "@/lib/ai/decor";

export default function DecorPanel({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheme, setScheme] = useState<DecorScheme | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const suggest = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await requestDecor(editor, style, file);
      if (r.kind === "error") setError(r.message);
      else setScheme(r.scheme);
    } catch {
      setError("Something went wrong getting suggestions.");
    } finally {
      setBusy(false);
    }
  }, [busy, editor, style, file]);

  const copyHex = (hex: string) => {
    void navigator.clipboard?.writeText(hex);
    setCopied(hex);
    setTimeout(() => setCopied((c) => (c === hex ? null : c)), 1200);
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Get decor and color suggestions"
        className="flex items-center gap-1.5 rounded-lg bg-white/90 px-2.5 py-1 text-xs font-medium text-emerald-700 shadow ring-1 ring-emerald-200 transition hover:bg-white"
      >
        <SwatchIcon />
        Decor ideas
      </button>

      {open && (
        <div className="w-80 rounded-xl bg-white/97 px-3 py-2.5 text-sm text-neutral-700 shadow-lg ring-1 ring-emerald-200">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700">
            <SwatchIcon /> Decor &amp; style
          </div>

          <input
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            placeholder="Vibe, e.g. warm mid-century, coastal"
            className="mb-2 w-full rounded-lg border border-stone-200 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-500"
          />

          <div className="mb-2 flex items-center gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded-lg px-2 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-50"
            >
              {file ? "Change photo" : "Attach style photo"}
            </button>
            {file && (
              <>
                <span className="max-w-[9rem] truncate text-xs text-neutral-500">{file.name}</span>
                <button onClick={() => setFile(null)} className="text-xs text-neutral-400 hover:text-neutral-700">
                  clear
                </button>
              </>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </div>

          <button
            onClick={() => void suggest()}
            disabled={busy}
            className="w-full rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? "Styling…" : "Suggest decor"}
          </button>

          <p className="mt-2 text-[11px] leading-snug text-neutral-400">
            AI style suggestions. Colors are approximate; links are searches, not endorsements.
          </p>

          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

          {scheme && (
            <div className="mt-2 space-y-3 border-t border-stone-100 pt-2">
              {scheme.style && <p className="text-sm italic text-neutral-600">{scheme.style}</p>}

              {scheme.palette.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-semibold text-neutral-500">Palette</div>
                  <div className="flex flex-wrap gap-2">
                    {scheme.palette.map((s) => (
                      <button
                        key={s.hex + s.name}
                        onClick={() => copyHex(s.hex)}
                        title={`${s.name} ${s.hex} — click to copy`}
                        className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 ring-1 ring-stone-200 transition hover:bg-stone-50"
                      >
                        <span className="h-5 w-5 rounded ring-1 ring-black/10" style={{ backgroundColor: s.hex }} />
                        <span className="text-xs text-neutral-700">{copied === s.hex ? "Copied" : s.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {scheme.materials.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-semibold text-neutral-500">Materials &amp; finishes</div>
                  <ul className="space-y-0.5">
                    {scheme.materials.map((m, i) => (
                      <li key={i} className="text-xs text-neutral-700">
                        <span className="font-medium">{m.name}</span>
                        {m.note && <span className="text-neutral-500"> — {m.note}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {scheme.items.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-semibold text-neutral-500">Furnishings &amp; decor</div>
                  <ul className="space-y-1">
                    {scheme.items.map((it, i) => (
                      <li key={i} className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="text-neutral-700">
                          <span className="font-medium">{it.name}</span>
                          {it.note && <span className="text-neutral-500"> — {it.note}</span>}
                        </span>
                        <a
                          href={searchUrl(it.name)}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 font-medium text-emerald-700 hover:underline"
                        >
                          Search
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SwatchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 13.5V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v9.5a4.5 4.5 0 1 1-8 0Z" />
      <path d="M6 17.5h.01" />
      <path d="M10.5 8.5 14 5a2 2 0 0 1 2.8 0l2.7 2.7a2 2 0 0 1 0 2.8L12 18" />
    </svg>
  );
}
