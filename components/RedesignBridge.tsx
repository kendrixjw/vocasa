// Phase 18 + redesign phase 5 - the premium redesign modules, wired.
//
// Once a plan exists, the user can branch into the Design (room) or Landscaping
// (yard) add-ons: upload a real photo and get a restyled, photorealistic
// concept RENDER back. Renders are a separate paid, metered, image-to-image
// feature (POST /api/redesign): the first 2 per module are free, then each
// costs a credit. The two outputs stay visibly distinct - the plan is editable
// and to scale; renders are inspirational images that are neither.
"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/supabase/useSession";
import { requestRedesign, fetchRenderQuota, type RenderQuota } from "@/lib/ai/redesign";
import type { RedesignModule } from "@/lib/ai/redesignPrompt";
import { startCheckout } from "@/lib/billing/checkout";
import type { ProductKey } from "@/lib/billing/catalog";

const BUY_OPTIONS: { key: ProductKey; label: string }[] = [
  { key: "pack_30", label: "30 credits" },
  { key: "pack_100", label: "100 credits" },
  { key: "tier_standard", label: "40/mo plan" },
  { key: "tier_pro", label: "100/mo plan" },
];

const MODULES: { key: RedesignModule; title: string; blurb: string; accept: string }[] = [
  {
    key: "design",
    title: "Design - room redesign",
    blurb: "Upload a photo of a real room; get restyled concepts (paint, furniture, decor, materials).",
    accept: "a room",
  },
  {
    key: "landscaping",
    title: "Landscaping - yard redesign",
    blurb: "Upload a photo of a yard or exterior; get restyled landscape concepts (plants, hardscape, paths).",
    accept: "a yard or exterior",
  },
];

export default function RedesignBridge({ hasPlan }: { hasPlan: boolean }) {
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const [module, setModule] = useState<RedesignModule | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [style, setStyle] = useState("");

  const [quota, setQuota] = useState<RenderQuota | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ url: string; source: "free" | "credit" } | null>(null);
  const [error, setError] = useState<{ message: string; outOfCredits: boolean } | null>(null);
  const [buying, setBuying] = useState(false);

  const buy = useCallback(async (product: ProductKey) => {
    setBuying(true);
    try {
      await startCheckout(product);
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "Couldn't start checkout.", outOfCredits: false });
      setBuying(false);
    }
  }, []);

  // Release the object URL when it changes or the panel unmounts.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  // Load remaining free renders + credits whenever a module is chosen.
  useEffect(() => {
    if (!module || !user) {
      setQuota(null);
      return;
    }
    let active = true;
    fetchRenderQuota(module).then((q) => {
      if (active) setQuota(q);
    });
    return () => {
      active = false;
    };
  }, [module, user]);

  const clearPhoto = useCallback(() => {
    setFile(null);
    setPreview((p) => {
      if (p) URL.revokeObjectURL(p);
      return null;
    });
    setResult(null);
    setError(null);
  }, []);

  const reset = useCallback(() => {
    setModule(null);
    setStyle("");
    clearPhoto();
  }, [clearPhoto]);

  const onPhoto = useCallback((f: File | undefined) => {
    if (!f) return;
    setError(null);
    setResult(null);
    setFile(f);
    setPreview((p) => {
      if (p) URL.revokeObjectURL(p);
      return URL.createObjectURL(f);
    });
  }, []);

  const generate = useCallback(async () => {
    if (!module || !file || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await requestRedesign(module, style, file);
    if (res.kind === "render") {
      setResult({ url: res.url, source: res.source });
      const q = await fetchRenderQuota(module);
      setQuota(q);
    } else {
      setError({ message: res.message, outOfCredits: res.code === "insufficient_credits" });
    }
    setBusy(false);
  }, [module, file, style, busy]);

  const active = MODULES.find((m) => m.key === module) ?? null;

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        onClick={() => {
          setOpen((v) => !v);
          if (open) reset();
        }}
        disabled={!hasPlan}
        title={hasPlan ? "Turn this plan into redesign concepts" : "Create a plan first"}
        className="flex items-center gap-1.5 rounded-lg bg-white/90 px-2.5 py-1 text-xs font-medium text-fuchsia-700 shadow ring-1 ring-fuchsia-200 transition hover:bg-white disabled:opacity-50"
      >
        <WandIcon />
        Redesign
      </button>

      {open && hasPlan && (
        <div className="w-72 rounded-xl bg-white/97 px-3 py-2.5 text-sm text-neutral-700 shadow-lg ring-1 ring-fuchsia-200">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-fuchsia-700">
            <WandIcon /> Redesign concepts
            <span className="ml-auto rounded-full bg-fuchsia-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-normal text-fuchsia-700">
              Premium
            </span>
          </div>
          <p className="mb-2 rounded-lg bg-fuchsia-50 px-2 py-1 text-xs leading-snug text-fuchsia-800 ring-1 ring-fuchsia-100">
            These are inspirational, photorealistic images - not editable and not to scale. Your plan stays the precise,
            to-scale drawing; renders are a separate visualization.
          </p>

          {!active && (
            <div className="flex flex-col gap-1.5">
              {MODULES.map((m) => (
                <button
                  key={m.key}
                  onClick={() => setModule(m.key)}
                  className="rounded-lg px-3 py-1.5 text-left text-xs font-medium text-fuchsia-800 ring-1 ring-fuchsia-100 transition hover:bg-fuchsia-50"
                >
                  {m.title}
                  <span className="block font-normal text-neutral-500">{m.blurb}</span>
                </button>
              ))}
            </div>
          )}

          {active && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-fuchsia-800">
                {active.title}
                {quota && (
                  <span className="ml-auto font-normal text-neutral-500">
                    {quota.freeRemaining > 0
                      ? `${quota.freeRemaining} free left`
                      : `${quota.credits} credit${quota.credits === 1 ? "" : "s"}`}
                  </span>
                )}
              </div>

              {!user && (
                <div className="rounded-lg bg-amber-50 px-2 py-1.5 text-xs leading-snug text-amber-800 ring-1 ring-amber-200">
                  Sign in to generate renders.
                </div>
              )}

              {result ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={result.url}
                    alt="Redesign concept render"
                    className="w-full rounded-lg ring-1 ring-stone-200"
                  />
                  <div className="flex items-center justify-between text-xs text-neutral-500">
                    <span>{result.source === "free" ? "Free render" : "1 credit used"}</span>
                    <a
                      href={result.url}
                      download={`redesign-${active.key}.png`}
                      className="font-medium text-fuchsia-700 hover:underline"
                    >
                      Download
                    </a>
                  </div>
                  <button
                    onClick={clearPhoto}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-fuchsia-800 ring-1 ring-fuchsia-100 transition hover:bg-fuchsia-50"
                  >
                    Try another photo
                  </button>
                </>
              ) : preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview}
                  alt="Attached photo preview"
                  className="max-h-40 w-full rounded-lg object-cover ring-1 ring-stone-200"
                />
              ) : (
                <label className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed border-fuchsia-200 px-3 py-4 text-center text-xs text-neutral-500 transition hover:bg-fuchsia-50">
                  <span className="font-medium text-fuchsia-700">Attach a photo of {active.accept}</span>
                  <span>JPEG, PNG, or WEBP</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      onPhoto(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}

              {!result && (
                <input
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  placeholder="Style, e.g. warm mid-century, coastal"
                  className="rounded-lg bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-800 outline-none ring-1 ring-neutral-200 placeholder:text-neutral-400 focus:ring-fuchsia-300"
                />
              )}

              {error && (
                <div className="rounded-lg bg-red-50 px-2 py-1.5 text-xs leading-snug text-red-700 ring-1 ring-red-200">
                  {error.outOfCredits
                    ? "You're out of free renders and credits for this module."
                    : error.message}
                </div>
              )}

              {user && (error?.outOfCredits || (quota && quota.freeRemaining === 0 && quota.credits === 0)) && (
                <div className="rounded-lg bg-fuchsia-50 px-2 py-1.5 ring-1 ring-fuchsia-100">
                  <div className="mb-1 text-xs font-medium text-fuchsia-800">Buy render credits</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {BUY_OPTIONS.map((o) => (
                      <button
                        key={o.key}
                        onClick={() => buy(o.key)}
                        disabled={buying}
                        className="rounded-lg bg-white px-2 py-1 text-xs font-medium text-fuchsia-700 ring-1 ring-fuchsia-200 transition hover:bg-fuchsia-100 disabled:opacity-50"
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  onClick={reset}
                  className="rounded-lg px-3 py-1 text-xs font-medium text-neutral-600 ring-1 ring-neutral-200 transition hover:bg-neutral-50"
                >
                  Back
                </button>
                {!result && (
                  <button
                    onClick={generate}
                    disabled={!file || busy || !user}
                    className="rounded-lg bg-fuchsia-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-fuchsia-500 disabled:opacity-50"
                  >
                    {busy ? "Rendering…" : "Generate"}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WandIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 4V2" />
      <path d="M15 16v-2" />
      <path d="M8 9h2" />
      <path d="M20 9h2" />
      <path d="M17.8 11.8 19 13" />
      <path d="M15 9h.01" />
      <path d="M17.8 6.2 19 5" />
      <path d="m3 21 9-9" />
      <path d="M12.2 6.2 11 5" />
    </svg>
  );
}
