// Ready-made rooms. Picking one drops real walls + furniture as a single undo
// step (see lib/rooms/templates.ts) — a starting point to edit, not a fixed
// asset.
"use client";

import { useState } from "react";
import type { Editor } from "@/lib/editor";
import { ROOM_TEMPLATES } from "@/lib/rooms/templates";

export default function TemplatePanel({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Drop in a ready-made room"
        className="flex items-center gap-1.5 rounded-lg bg-white/90 px-2.5 py-1 text-xs font-medium text-sky-700 shadow ring-1 ring-sky-200 transition hover:bg-white"
      >
        <RoomIcon />
        Rooms
      </button>

      {open && (
        <div className="w-64 rounded-xl bg-white/97 px-3 py-2.5 text-sm text-neutral-700 shadow-lg ring-1 ring-sky-200">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-sky-700">
            <RoomIcon /> Ready-made rooms
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {ROOM_TEMPLATES.map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  editor.addRoomTemplate(t.key);
                  setOpen(false);
                }}
                className="rounded-lg px-2 py-1.5 text-left ring-1 ring-stone-200 transition hover:bg-sky-50 hover:ring-sky-300"
              >
                <div className="text-xs font-medium text-neutral-800">{t.label}</div>
                <div className="text-[11px] text-neutral-400">
                  {t.width}′ × {t.height}′
                </div>
              </button>
            ))}
          </div>

          <p className="mt-2 text-[11px] leading-snug text-neutral-400">
            Dropped clear of what you&apos;ve already drawn. Real walls and furniture — move,
            resize, or rename anything.
          </p>
        </div>
      )}
    </div>
  );
}

function RoomIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 14h7v7" />
    </svg>
  );
}
