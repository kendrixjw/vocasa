// Phase 18 - Bridge to the premium redesign modules.
//
// Once a plan exists, the user can branch off into the Design (room) or
// Landscaping (yard) add-ons: upload a real photo and get restyled,
// photorealistic concept RENDERS. Those renders are a separate paid,
// metered, image-to-image feature and are NOT part of v1 - so this component
// is only the bridge/entry point. It establishes the flow and keeps the two
// outputs visibly distinct: the plan is editable and to scale; redesign
// renders are inspirational images. No image-model call, no billing here.
"use client";

import { useCallback, useEffect, useState } from "react";

type ModuleKey = "design" | "landscaping";

const MODULES: { key: ModuleKey; title: string; blurb: string; accept: string }[] = [
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
  const [open, setOpen] = useState(false);
  const [module, setModule] = useState<ModuleKey | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // Release the object URL when it changes or the panel unmounts.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const reset = useCallback(() => {
    setModule(null);
    setPreview((p) => {
      if (p) URL.revokeObjectURL(p);
      return null;
    });
  }, []);

  const onPhoto = useCallback((file: File | undefined) => {
    if (!file) return;
    setPreview((p) => {
      if (p) URL.revokeObjectURL(p);
      return URL.createObjectURL(file);
    });
  }, []);

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
              <div className="text-xs font-semibold text-fuchsia-800">{active.title}</div>
              {preview ? (
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

              <div className="rounded-lg bg-amber-50 px-2 py-1.5 text-xs leading-snug text-amber-800 ring-1 ring-amber-200">
                Coming soon. Restyled renders launch as a paid add-on - your first 2 renders per module are free.
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={reset}
                  className="rounded-lg px-3 py-1 text-xs font-medium text-neutral-600 ring-1 ring-neutral-200 transition hover:bg-neutral-50"
                >
                  Back
                </button>
                <button
                  disabled
                  title="Available at launch"
                  className="rounded-lg bg-fuchsia-600 px-3 py-1 text-xs font-medium text-white opacity-50"
                >
                  Generate
                </button>
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
