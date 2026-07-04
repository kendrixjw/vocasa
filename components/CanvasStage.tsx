"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { Point } from "@/lib/viewport";
import { Editor } from "@/lib/editor";
import { formatFeetInches } from "@/lib/units";
import { formatSqFt } from "@/lib/model/room";
import { FURNITURE, furnitureDef, type IconDraw } from "@/lib/furniture/library";
import type { PointerInfo } from "@/lib/tools/tool";
import { runCommand, type CommandOutcome } from "@/lib/ai/client";
import { runAssist } from "@/lib/ai/assist";
import { VoiceRecognizer } from "@/lib/voice/speech";
import { getPlan, updatePlan } from "@/lib/persistence/plans";
import { isPlanData } from "@/lib/persistence/plan";
import { makeThumbnail } from "@/lib/persistence/thumbnail";
import { exportPng, exportPdf } from "@/lib/export/exportPlan";

type PersistenceProps = {
  /** When set (and enabled), the plan loads from / autosaves to this row. */
  planId?: string | null;
  canPersist?: boolean;
};

export default function CanvasStage({ planId = null, canPersist = false }: PersistenceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  if (editorRef.current === null) editorRef.current = new Editor();
  const editor = editorRef.current;

  const persisting = canPersist && !!planId;

  const dirtyRef = useRef(true);
  const rafRef = useRef<number | null>(null);

  // Pan interaction (viewport-level, not a tool).
  const panningRef = useRef(false);
  const spaceRef = useRef(false);
  const lastPtrRef = useRef<Point>({ x: 0, y: 0 });

  const [cursorWorld, setCursorWorld] = useState<Point | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [placeKind, setPlaceKind] = useState<string | null>(null);
  const [openingKind, setOpeningKind] = useState<"door" | "window">("door");

  // AI command bar.
  const [command, setCommand] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiFeedback, setAiFeedback] = useState<{ kind: CommandOutcome["kind"]; message: string } | null>(null);
  const aiBusyRef = useRef(false);

  const submitCommand = useCallback(
    async (override?: string) => {
      const text = (override ?? command).trim();
      if (!text || aiBusyRef.current) return;
      aiBusyRef.current = true;
      setAiBusy(true);
      setAiFeedback(null);
      try {
        const outcome = await runCommand(editor, text);
        setAiFeedback({ kind: outcome.kind, message: outcome.message });
        if (outcome.kind === "applied") setCommand("");
      } catch {
        setAiFeedback({ kind: "error", message: "Something went wrong." });
      } finally {
        aiBusyRef.current = false;
        setAiBusy(false);
      }
    },
    [command, editor],
  );

  // Voice capture (Phase 7): the mic is just a transcript source into the same
  // op bridge. Live interim text fills the input; the final utterance auto-runs.
  const [listening, setListening] = useState(false);
  const [micSupported, setMicSupported] = useState(false);
  const recognizerRef = useRef<VoiceRecognizer | null>(null);

  useEffect(() => {
    const rec = new VoiceRecognizer({
      onStart: () => setListening(true),
      onEnd: () => setListening(false),
      onInterim: (t) => setCommand(t),
      onFinal: (t) => {
        setCommand(t);
        void submitCommand(t);
      },
      onError: (message) => {
        setListening(false);
        setAiFeedback({ kind: "error", message });
      },
    });
    recognizerRef.current = rec;
    setMicSupported(rec.supported);
    return () => rec.abort();
  }, [submitCommand]);

  const toggleMic = useCallback(() => {
    const rec = recognizerRef.current;
    if (!rec) return;
    if (rec.listening) rec.stop();
    else {
      setAiFeedback(null);
      setCommand("");
      rec.start();
    }
  }, []);

  // Design assist (Phase 8): suggestions + preview-accept. Never auto-commits.
  const [assistBusy, setAssistBusy] = useState(false);
  const [assist, setAssist] = useState<{
    notes: string;
    error?: boolean;
    proposal?: { summary: string };
  } | null>(null);

  const runAssistNow = useCallback(async () => {
    if (assistBusy) return;
    if (editor.hasPreview) editor.rejectPreview();
    setAssist(null);
    setAssistBusy(true);
    try {
      const r = await runAssist(editor, command.trim());
      if (r.kind === "error") setAssist({ notes: r.message, error: true });
      else if (r.kind === "advice") setAssist({ notes: r.notes });
      else {
        editor.previewCommand(r.command);
        setAssist({ notes: r.notes, proposal: { summary: r.summary } });
      }
    } catch {
      setAssist({ notes: "Something went wrong.", error: true });
    } finally {
      setAssistBusy(false);
    }
  }, [assistBusy, editor, command]);

  const acceptProposal = useCallback(() => {
    editor.acceptPreview();
    setAssist(null);
  }, [editor]);
  const dismissAssist = useCallback(() => {
    if (editor.hasPreview) editor.rejectPreview();
    setAssist(null);
  }, [editor]);

  // --- Persistence (Phase 9): load + debounced autosave to Supabase ---------
  const [planName, setPlanName] = useState("Untitled plan");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const loadedRef = useRef(false);
  const savedRevRef = useRef(-1);
  const savedNameRef = useRef(planName);
  const nameRef = useRef(planName);
  nameRef.current = planName;

  const doSave = useCallback(async () => {
    if (!persisting || !planId) return;
    setSaveStatus("saving");
    try {
      await updatePlan(planId, {
        name: nameRef.current.trim() || "Untitled plan",
        data: editor.serialize(),
        thumbnail: makeThumbnail(editor),
      });
      savedRevRef.current = editor.revision;
      savedNameRef.current = nameRef.current;
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
    }
  }, [persisting, planId, editor]);

  // Keep a stable handle so the (mount-time) keydown listener can Ctrl+S save.
  const doSaveRef = useRef(doSave);
  doSaveRef.current = doSave;

  // --- Export (Phase 10): clean PNG / PDF to share --------------------------
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const doExport = useCallback(
    async (fmt: "png" | "pdf") => {
      setExportOpen(false);
      setExporting(true);
      try {
        if (fmt === "png") exportPng(editor, nameRef.current);
        else await exportPdf(editor, nameRef.current);
      } finally {
        setExporting(false);
      }
    },
    [editor],
  );

  // Load the plan when the id changes.
  useEffect(() => {
    loadedRef.current = false;
    if (!persisting || !planId) {
      loadedRef.current = true;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const rec = await getPlan(planId);
        if (cancelled) return;
        if (rec) {
          setPlanName(rec.name);
          if (isPlanData(rec.data)) editor.load(rec.data);
        }
      } finally {
        if (!cancelled) {
          savedRevRef.current = editor.revision;
          savedNameRef.current = nameRef.current;
          loadedRef.current = true;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [persisting, planId, editor]);

  // Debounced autosave: watch the content revision (re-read each render via HUD)
  // and the plan name.
  const revision = editor.revision;
  useEffect(() => {
    if (!persisting || !loadedRef.current) return;
    if (editor.hasPreview) return; // don't persist an un-accepted preview
    if (revision === savedRevRef.current && planName === savedNameRef.current) return;
    const t = setTimeout(() => void doSave(), 2000);
    return () => clearTimeout(t);
  }, [revision, planName, persisting, editor, doSave]);
  // Bump to re-read editor-derived HUD state on structural changes.
  const [, forceHud] = useReducer((n: number) => n + 1, 0);

  // Wire editor callbacks once.
  useEffect(() => {
    editor.onDirty = () => {
      dirtyRef.current = true;
    };
    editor.onChange = () => forceHud();
  }, [editor]);

  // --- rAF render loop (single render path) --------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const loop = () => {
      if (dirtyRef.current && ctx) {
        dirtyRef.current = false;
        editor.render(ctx);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [editor]);

  // --- Sizing / DPR --------------------------------------------------------
  const applySize = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const width = wrap.clientWidth;
    const height = wrap.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    editor.setSize(width, height, dpr);
  }, [editor]);

  useEffect(() => {
    applySize();
    const ro = new ResizeObserver(() => applySize());
    if (wrapRef.current) ro.observe(wrapRef.current);
    window.addEventListener("resize", applySize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", applySize);
    };
  }, [applySize]);

  // --- Pointer input -------------------------------------------------------
  const localPoint = (e: React.PointerEvent | React.WheelEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const toInfo = (e: React.PointerEvent, screen: Point): PointerInfo => ({
    screen,
    world: editor.toWorld(screen),
    button: e.button,
    shiftKey: e.shiftKey,
  });

  const onPointerDown = (e: React.PointerEvent) => {
    const p = localPoint(e);
    canvasRef.current?.setPointerCapture(e.pointerId);
    // Middle mouse, or left+space, pans the viewport.
    if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
      e.preventDefault();
      panningRef.current = true;
      lastPtrRef.current = p;
      forceHud();
      return;
    }
    editor.pointerDown(toInfo(e, p));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = localPoint(e);
    if (panningRef.current) {
      editor.pan(p.x - lastPtrRef.current.x, p.y - lastPtrRef.current.y);
      lastPtrRef.current = p;
    } else {
      editor.pointerMove(toInfo(e, p));
    }
    setCursorWorld(editor.toWorld(p));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const p = localPoint(e);
    canvasRef.current?.releasePointerCapture(e.pointerId);
    if (panningRef.current) {
      panningRef.current = false;
      forceHud();
      return;
    }
    editor.pointerUp(toInfo(e, p));
  };

  const onWheel = (e: React.WheelEvent) => {
    const p = localPoint(e);
    editor.zoom(p, Math.exp(-e.deltaY * 0.0015));
    setCursorWorld(editor.toWorld(p));
  };

  // --- Keyboard ------------------------------------------------------------
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (e.code === "Space" && !spaceRef.current) {
        spaceRef.current = true;
        setSpaceHeld(true);
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        void doSaveRef.current();
        return;
      }
      if (e.key === "f" || e.key === "F") {
        editor.fit();
        return;
      }
      if (editor.keyDown(e)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceRef.current = false;
        setSpaceHeld(false);
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [editor]);

  const panning = panningRef.current;
  const cursorStyle = panning ? "grabbing" : spaceHeld ? "grab" : editor.cursor;
  const zoomPct = Math.round(editor.viewport.scale * 100);

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block touch-none"
        style={{ cursor: cursorStyle }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* Top-left: plan name + save status (only when saving is available) */}
      {persisting && (
        <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-xl bg-white/95 px-2 py-1.5 shadow-lg ring-1 ring-neutral-200">
          <a
            href="/"
            title="Back to your plans"
            className="flex items-center gap-1.5 rounded-lg px-1 py-0.5 transition hover:bg-neutral-100"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/vocasa-mark.svg" alt="" className="h-6 w-6" />
            <span className="text-sm font-semibold tracking-tight text-brand">Vocasa</span>
          </a>
          <input
            value={planName}
            onChange={(e) => setPlanName(e.target.value)}
            onBlur={() => void doSave()}
            aria-label="Plan name"
            className="w-40 rounded-lg bg-transparent px-1.5 py-1 text-sm font-medium text-neutral-800 outline-none focus:bg-neutral-100"
          />
          <span className="w-14 text-right text-[11px] text-neutral-400">
            {saveStatus === "saving"
              ? "Saving…"
              : saveStatus === "saved"
                ? "Saved"
                : saveStatus === "error"
                  ? "Save failed"
                  : ""}
          </span>
          <button
            onClick={() => void doSave()}
            disabled={saveStatus === "saving"}
            title="Save now (Ctrl+S)"
            className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700 transition hover:bg-neutral-200 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      )}

      {/* Top-left: brand lockup in local mode (no plan bar to host it). */}
      {!persisting && (
        <div className="absolute left-3 top-3 z-10 flex items-center rounded-xl bg-white/95 px-2 py-1.5 shadow-lg ring-1 ring-neutral-200">
          <a
            href="/"
            title="Vocasa — home"
            className="flex items-center gap-1.5 rounded-lg px-1 py-0.5 transition hover:bg-neutral-100"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/vocasa-mark.svg" alt="" className="h-6 w-6" />
            <span className="text-sm font-semibold tracking-tight text-brand">Vocasa</span>
          </a>
        </div>
      )}

      {/* Top-center: AI command bar (typed for now; mic comes in Phase 7) */}
      <div className="absolute left-1/2 top-3 flex w-[28rem] max-w-[calc(100%-6rem)] -translate-x-1/2 flex-col gap-1">
        <div className="flex items-center gap-2 rounded-xl bg-white/95 px-2 py-1.5 shadow-lg ring-1 ring-neutral-200">
          {micSupported && (
            <button
              onClick={toggleMic}
              disabled={aiBusy}
              title={listening ? "Stop listening" : "Speak a command"}
              aria-label={listening ? "Stop listening" : "Speak a command"}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition disabled:opacity-40 ${
                listening
                  ? "animate-pulse bg-red-500 text-white"
                  : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
              }`}
            >
              <MicIcon />
            </button>
          )}
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submitCommand();
              }
            }}
            placeholder={listening ? "Listening…" : 'Try: "make a living room 15 by 20"'}
            disabled={aiBusy}
            className="min-w-0 flex-1 bg-transparent px-2 py-1 text-sm text-neutral-800 outline-none placeholder:text-neutral-400"
          />
          <button
            onClick={() => void submitCommand()}
            disabled={aiBusy || !command.trim()}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-hover disabled:opacity-40"
          >
            {aiBusy ? "…" : "Run"}
          </button>
        </div>
        {aiFeedback && (
          <div
            className={`rounded-lg px-3 py-1.5 text-xs shadow ring-1 ${
              aiFeedback.kind === "applied"
                ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                : aiFeedback.kind === "clarify"
                  ? "bg-amber-50 text-amber-800 ring-amber-200"
                  : "bg-red-50 text-red-700 ring-red-200"
            }`}
          >
            {aiFeedback.message}
          </div>
        )}

        {/* Design assist trigger */}
        <div className="flex justify-end">
          <button
            onClick={() => void runAssistNow()}
            disabled={assistBusy}
            title="Get design feedback and suggestions"
            className="flex items-center gap-1.5 rounded-lg bg-white/90 px-2.5 py-1 text-xs font-medium text-violet-700 shadow ring-1 ring-violet-200 transition hover:bg-white disabled:opacity-50"
          >
            <SparkleIcon />
            {assistBusy ? "Thinking…" : "Design assist"}
          </button>
        </div>

        {/* Assist result / preview panel */}
        {assist && (
          <div
            className={`rounded-xl px-3 py-2.5 text-sm shadow-lg ring-1 ${
              assist.error
                ? "bg-red-50 text-red-700 ring-red-200"
                : "bg-white/97 text-neutral-700 ring-violet-200"
            }`}
          >
            {!assist.error && (
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-violet-600">
                <SparkleIcon /> Design assist
              </div>
            )}
            <p className="whitespace-pre-line leading-snug">{assist.notes}</p>
            {assist.proposal && (
              <div className="mt-2 rounded-lg bg-violet-50 px-2.5 py-1.5 text-xs text-violet-800 ring-1 ring-violet-200">
                Proposed: {assist.proposal.summary} <span className="text-violet-500">(previewing on canvas)</span>
              </div>
            )}
            <div className="mt-2.5 flex justify-end gap-2">
              {assist.proposal ? (
                <>
                  <button
                    onClick={dismissAssist}
                    className="rounded-lg px-3 py-1 text-xs font-medium text-neutral-600 ring-1 ring-neutral-200 transition hover:bg-neutral-50"
                  >
                    Discard
                  </button>
                  <button
                    onClick={acceptProposal}
                    className="rounded-lg bg-violet-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-violet-500"
                  >
                    Apply
                  </button>
                </>
              ) : (
                <button
                  onClick={dismissAssist}
                  className="rounded-lg px-3 py-1 text-xs font-medium text-neutral-600 ring-1 ring-neutral-200 transition hover:bg-neutral-50"
                >
                  Got it
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Left toolbar + furniture palette */}
      <div className="absolute bottom-16 left-3 top-16 flex w-44 flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <ToolButton
            active={editor.activeTool === "select"}
            onClick={() => editor.setTool("select")}
            title="Select / move (V)"
          >
            Select
          </ToolButton>
          <ToolButton
            active={editor.activeTool === "wall"}
            onClick={() => editor.setTool("wall")}
            title="Draw wall (W)"
          >
            Wall
          </ToolButton>
          <ToolButton
            active={editor.activeTool === "opening" && openingKind === "door"}
            onClick={() => {
              setOpeningKind("door");
              editor.placeOpening("door");
            }}
            title="Add door"
          >
            Door
          </ToolButton>
          <ToolButton
            active={editor.activeTool === "opening" && openingKind === "window"}
            onClick={() => {
              setOpeningKind("window");
              editor.placeOpening("window");
            }}
            title="Add window"
          >
            Window
          </ToolButton>
        </div>
        <FurniturePalette
          activeKind={editor.activeTool === "place" ? placeKind : null}
          onPick={(kind) => {
            setPlaceKind(kind);
            editor.placeFurniture(kind);
          }}
        />
      </div>

      {/* Top-right: history + fit */}
      <div className="absolute right-3 top-3 flex items-center gap-2">
        <ChromeButton onClick={() => editor.undo()} disabled={!editor.canUndo} title="Undo (Ctrl+Z)">
          Undo
        </ChromeButton>
        <ChromeButton onClick={() => editor.redo()} disabled={!editor.canRedo} title="Redo (Ctrl+Shift+Z)">
          Redo
        </ChromeButton>
        <ChromeButton onClick={() => editor.fit()} title="Fit to extents (F)">
          Fit
        </ChromeButton>
        <div className="relative">
          <button
            onClick={() => setExportOpen((o) => !o)}
            disabled={exporting}
            title="Export a shareable picture"
            className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white shadow ring-1 ring-brand transition hover:bg-brand-hover disabled:opacity-50"
          >
            <ShareIcon />
            {exporting ? "Exporting…" : "Share"}
          </button>
          {exportOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
              <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg bg-white py-1 shadow-lg ring-1 ring-neutral-200">
                <button
                  onClick={() => void doExport("png")}
                  className="block w-full px-3 py-2 text-left text-sm text-neutral-700 transition hover:bg-neutral-100"
                >
                  Download PNG
                </button>
                <button
                  onClick={() => void doExport("pdf")}
                  className="block w-full px-3 py-2 text-left text-sm text-neutral-700 transition hover:bg-neutral-100"
                >
                  Download PDF
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Right: properties panel for the current selection */}
      {editor.selectedRoom && (
        <RoomPanel
          key={editor.selectedRoom.id}
          name={editor.selectedRoom.name}
          areaSqFt={editor.selectedRoom.areaSqFt}
          onRename={(next) => editor.renameRoom(editor.selectedRoom!.id, next)}
        />
      )}
      {editor.selectedFurniture && (
        <FurniturePanel
          key={editor.selectedFurniture.id}
          kind={editor.selectedFurniture.kind}
          w={editor.selectedFurniture.w}
          h={editor.selectedFurniture.h}
          rotation={editor.selectedFurniture.rotation}
          onEdit={(patch) => editor.editFurniture(editor.selectedFurniture!.id, patch)}
        />
      )}
      {editor.selectedOpening && (
        <OpeningPanel
          key={editor.selectedOpening.id}
          type={editor.selectedOpening.type}
          width={editor.selectedOpening.width}
          swing={editor.selectedOpening.type === "door" ? editor.selectedOpening.swing : undefined}
          onEdit={(patch) => editor.editOpening(editor.selectedOpening!.id, patch)}
        />
      )}

      {/* Bottom status bar */}
      <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-3 rounded-lg bg-white/90 px-3 py-1.5 font-mono text-xs text-neutral-600 shadow ring-1 ring-neutral-200">
        <span>
          x: <span className="text-neutral-900">{cursorWorld ? formatFeetInches(cursorWorld.x) : "—"}</span>
        </span>
        <span>
          y: <span className="text-neutral-900">{cursorWorld ? formatFeetInches(cursorWorld.y) : "—"}</span>
        </span>
        <span className="text-neutral-300">|</span>
        <span>zoom: {zoomPct}%</span>
        {cursorWorld &&
          (() => {
            const room = editor.roomAt(cursorWorld);
            return room ? (
              <>
                <span className="text-neutral-300">|</span>
                <span className="text-neutral-900">
                  {room.name}: {formatSqFt(room.areaSqFt)}
                </span>
              </>
            ) : null;
          })()}
        {editor.statusText && (
          <>
            <span className="text-neutral-300">|</span>
            <span className="text-neutral-500">{editor.statusText}</span>
          </>
        )}
      </div>

      <div className="pointer-events-none absolute bottom-3 right-3 rounded-lg bg-white/80 px-3 py-1.5 text-xs text-neutral-500 shadow ring-1 ring-neutral-200">
        Space/middle-drag pan · scroll zoom · F fit · Esc cancel
      </div>
    </div>
  );
}

function FurnitureIcon({
  draw,
  aspect,
}: {
  draw: IconDraw;
  aspect: number; // defaultW / defaultH
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = 44;
    const H = 32;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // Fit the block's aspect ratio inside the box with padding.
    const pad = 6;
    let hw = (W - pad * 2) / 2;
    let hh = hw / aspect;
    if (hh > (H - pad * 2) / 2) {
      hh = (H - pad * 2) / 2;
      hw = hh * aspect;
    }
    ctx.save();
    ctx.translate(W / 2, H / 2);
    draw(ctx, hw, hh);
    ctx.restore();
  }, [draw, aspect]);
  return <canvas ref={ref} style={{ width: 44, height: 32 }} />;
}

function FurniturePalette({
  activeKind,
  onPick,
}: {
  activeKind: string | null;
  onPick: (kind: string) => void;
}) {
  const categories = Array.from(new Set(FURNITURE.map((f) => f.category)));
  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-xl bg-white/90 p-2 shadow ring-1 ring-neutral-200">
      {categories.map((cat) => (
        <div key={cat} className="mb-2">
          <div className="px-1 py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
            {cat}
          </div>
          {FURNITURE.filter((f) => f.category === cat).map((f) => (
            <button
              key={f.kind}
              onClick={() => onPick(f.kind)}
              title={`Place ${f.label}`}
              className={`flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs transition ${
                activeKind === f.kind
                  ? "bg-brand-50 text-brand ring-1 ring-brand/30"
                  : "text-neutral-700 hover:bg-neutral-100"
              }`}
            >
              <FurnitureIcon draw={f.icon} aspect={f.defaultW / f.defaultH} />
              <span className="truncate">{f.label}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function FurniturePanel({
  kind,
  w,
  h,
  rotation,
  onEdit,
}: {
  kind: string;
  w: number;
  h: number;
  rotation: number;
  onEdit: (patch: { w?: number; h?: number; rotationDeg?: number }) => void;
}) {
  const label = furnitureDef(kind)?.label ?? kind;
  const deg = Math.round((((rotation * 180) / Math.PI) % 360 + 360) % 360);
  return (
    <div className="absolute right-3 top-16 w-56 rounded-xl bg-white/95 p-4 shadow-lg ring-1 ring-neutral-200">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">Furniture</div>
      <div className="mb-3 text-sm font-medium text-neutral-800">{label}</div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Width (in)" value={Math.round(w)} onCommit={(v) => onEdit({ w: v })} />
        <NumberField label="Depth (in)" value={Math.round(h)} onCommit={(v) => onEdit({ h: v })} />
      </div>
      <div className="mt-2">
        <NumberField label="Rotation (°)" value={deg} onCommit={(v) => onEdit({ rotationDeg: v })} />
      </div>
      <div className="mt-3 text-xs text-neutral-500">
        {formatFeetInches(w)} × {formatFeetInches(h)}
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (Number.isFinite(n)) onCommit(n);
    else setText(String(value));
  };
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-neutral-500">{label}</span>
      <input
        value={text}
        inputMode="numeric"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="w-full rounded-lg border border-neutral-200 px-2 py-1.5 text-sm outline-none focus:border-brand"
      />
    </label>
  );
}

const SWINGS = ["in", "out", "left", "right"] as const;

function OpeningPanel({
  type,
  width,
  swing,
  onEdit,
}: {
  type: "door" | "window";
  width: number;
  swing?: string;
  onEdit: (patch: { width?: number; swing?: (typeof SWINGS)[number] }) => void;
}) {
  return (
    <div className="absolute right-3 top-16 w-56 rounded-xl bg-white/95 p-4 shadow-lg ring-1 ring-neutral-200">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
        {type === "door" ? "Door" : "Window"}
      </div>
      <NumberField label="Width (in)" value={Math.round(width)} onCommit={(v) => onEdit({ width: v })} />
      <div className="mt-2 text-xs text-neutral-500">{formatFeetInches(width)}</div>
      {type === "door" && (
        <div className="mt-3">
          <span className="mb-1 block text-xs text-neutral-500">Swing</span>
          <div className="flex gap-1">
            {SWINGS.map((s) => (
              <button
                key={s}
                onClick={() => onEdit({ swing: s })}
                className={`flex-1 rounded-md px-1 py-1 text-xs capitalize transition ${
                  swing === s ? "bg-brand text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RoomPanel({
  name,
  areaSqFt,
  onRename,
}: {
  name: string;
  areaSqFt: number;
  onRename: (next: string) => void;
}) {
  const [value, setValue] = useState(name);
  const commit = () => {
    if (value.trim() && value.trim() !== name) onRename(value);
  };
  return (
    <div className="absolute right-3 top-16 w-56 rounded-xl bg-white/95 p-4 shadow-lg ring-1 ring-neutral-200">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">Room</div>
      <label className="mb-1 block text-xs text-neutral-500">Name</label>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="w-full rounded-lg border border-neutral-200 px-2 py-1.5 text-sm outline-none focus:border-brand"
      />
      <div className="mt-3 flex items-baseline justify-between">
        <span className="text-xs text-neutral-500">Area</span>
        <span className="font-mono text-sm text-neutral-900">{formatSqFt(areaSqFt)}</span>
      </div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="22" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.6" y1="10.6" x2="15.4" y2="6.4" />
      <line x1="8.6" y1="13.4" x2="15.4" y2="17.6" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.9 5.6L19.5 9.5 13.9 11.4 12 17l-1.9-5.6L4.5 9.5l5.6-1.9z" />
      <path d="M18.5 14l.8 2.3 2.3.8-2.3.8-.8 2.3-.8-2.3-2.3-.8 2.3-.8z" />
    </svg>
  );
}

function ToolButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-20 rounded-lg px-3 py-2 text-sm font-medium shadow ring-1 transition ${
        active
          ? "bg-brand text-white ring-brand"
          : "bg-white/90 text-neutral-700 ring-neutral-200 hover:bg-white"
      }`}
    >
      {children}
    </button>
  );
}

function ChromeButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded-lg bg-white/90 px-3 py-1.5 text-sm font-medium text-neutral-700 shadow ring-1 ring-neutral-200 enabled:hover:bg-white disabled:opacity-40"
    >
      {children}
    </button>
  );
}
