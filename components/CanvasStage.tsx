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
import { requestPhotoOps, buildPhotoCommand, detectedWidthInches, type PhotoMode } from "@/lib/ai/photoImport";
import type { Op } from "@/lib/ai/ops";
import { VoiceRecognizer } from "@/lib/voice/speech";
import { getPlan, updatePlan, setShareToken } from "@/lib/persistence/plans";
import { siteUrl } from "@/lib/supabase/config";
import { isPlanData } from "@/lib/persistence/plan";
import { makeThumbnail } from "@/lib/persistence/thumbnail";
import { exportPng, exportPdf, exportDxf } from "@/lib/export/exportPlan";
import RedesignBridge from "@/components/RedesignBridge";
import DecorPanel from "@/components/DecorPanel";
import { rooms, walls } from "@/lib/model/document";
import { corners } from "@/lib/model/furniture";

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

  // Photo import: floorplan/sketch (Phase 16) or real-room photo (Phase 17).
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoOps, setPhotoOps] = useState<Op[] | null>(null);
  const [photoWidthFt, setPhotoWidthFt] = useState(20);
  const [photoMsg, setPhotoMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [photoMode, setPhotoMode] = useState<PhotoMode>("floorplan");
  // A picked file awaiting the user's choice of what kind of image it is.
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  // Inline text-note editor (Phase: dimensions & annotations). Open when the
  // annotation tool is placing a note or a note is double-clicked to edit.
  const [textEdit, setTextEdit] = useState<
    { id?: string; world: Point; left: number; top: number; value: string } | null
  >(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  const previewPhotoAt = useCallback(
    (ops: Op[], widthFt: number) => {
      const cmd = buildPhotoCommand(editor, ops, Math.max(1, widthFt) * 12);
      if (cmd) editor.previewCommand(cmd.command);
    },
    [editor],
  );

  const onPhotoFile = useCallback(
    async (file: File, mode: PhotoMode) => {
      if (photoBusy) return;
      if (editor.hasPreview) editor.rejectPreview();
      setPhotoOps(null);
      setPhotoMsg(null);
      setPhotoMode(mode);
      setPhotoBusy(true);
      try {
        const r = await requestPhotoOps(file, mode);
        if (r.kind === "error") {
          setPhotoMsg({ text: r.message, error: true });
        } else if (r.kind === "empty") {
          setPhotoMsg({
            text:
              mode === "room"
                ? "I couldn't read a room in that photo. Try a shot that shows the floor and the walls."
                : "I couldn't find a floorplan in that image. Try a clear, top-down shot.",
            error: true,
          });
        } else {
          const wft = Math.max(4, Math.round(detectedWidthInches(r.ops) / 12));
          setPhotoOps(r.ops);
          setPhotoWidthFt(wft);
          previewPhotoAt(r.ops, wft);
        }
      } catch {
        setPhotoMsg({ text: "Something went wrong importing that image.", error: true });
      } finally {
        setPhotoBusy(false);
      }
    },
    [editor, photoBusy, previewPhotoAt],
  );

  // The user picked a file; ask what kind it is, then import with that mode.
  const chooseKind = useCallback(
    (mode: PhotoMode) => {
      const file = pendingFile;
      setPendingFile(null);
      if (file) void onPhotoFile(file, mode);
    },
    [pendingFile, onPhotoFile],
  );

  const cancelPending = useCallback(() => setPendingFile(null), []);

  const changePhotoWidth = useCallback(
    (ft: number) => {
      setPhotoWidthFt(ft);
      if (photoOps) previewPhotoAt(photoOps, ft);
    },
    [photoOps, previewPhotoAt],
  );

  const applyPhoto = useCallback(() => {
    editor.acceptPreview();
    setPhotoOps(null);
    setPhotoMsg(null);
  }, [editor]);

  const discardPhoto = useCallback(() => {
    if (editor.hasPreview) editor.rejectPreview();
    setPhotoOps(null);
    setPhotoMsg(null);
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

  // --- Selection toolbar (Move / Mirror / Edit / Delete on a furniture) -----
  const [editingSel, setEditingSel] = useState(false);
  const selFurniture = editor.selectedFurniture;
  // Reset the inline edit panel whenever the selected item changes.
  useEffect(() => {
    setEditingSel(false);
  }, [selFurniture?.id]);

  const moveDrag = useRef<{ id: string; startScreen: Point; startPos: Point } | null>(null);
  const canvasScreen = useCallback((e: React.PointerEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);
  const onMoveHandleDown = useCallback(
    (e: React.PointerEvent) => {
      const f = editor.selectedFurniture;
      if (!f) return;
      e.preventDefault();
      moveDrag.current = { id: f.id, startScreen: canvasScreen(e), startPos: { ...f.position } };
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    [editor, canvasScreen],
  );
  const onMoveHandleMove = useCallback(
    (e: React.PointerEvent) => {
      const md = moveDrag.current;
      if (!md) return;
      const w0 = editor.toWorld(md.startScreen);
      const w1 = editor.toWorld(canvasScreen(e));
      const ent = editor.doc.entities.find((x) => x.id === md.id);
      if (ent && ent.type === "furniture") {
        ent.position = { x: md.startPos.x + (w1.x - w0.x), y: md.startPos.y + (w1.y - w0.y) };
        editor.onDirty?.();
        forceHud();
      }
    },
    [editor, canvasScreen],
  );
  const onMoveHandleUp = useCallback(
    (e: React.PointerEvent) => {
      const md = moveDrag.current;
      if (!md) return;
      moveDrag.current = null;
      (e.target as Element).releasePointerCapture?.(e.pointerId);
      const ent = editor.doc.entities.find((x) => x.id === md.id);
      if (ent && ent.type === "furniture") {
        const final = { ...ent.position };
        ent.position = { ...md.startPos }; // restore so the command captures a clean before/after
        editor.moveFurniture(md.id, final);
      }
    },
    [editor],
  );

  // --- Share link (read-only viewer + comments) ----------------------------
  const [shareToken, setShareTokenState] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const shareUrl = shareToken ? `${siteUrl()}/share/${shareToken}` : "";

  const createShareLink = useCallback(async () => {
    if (!planId || shareBusy) return;
    setShareBusy(true);
    try {
      const token = crypto.randomUUID();
      await setShareToken(planId, token);
      setShareTokenState(token);
    } finally {
      setShareBusy(false);
    }
  }, [planId, shareBusy]);

  const revokeShareLink = useCallback(async () => {
    if (!planId || shareBusy) return;
    setShareBusy(true);
    try {
      await setShareToken(planId, null);
      setShareTokenState(null);
      setCopied(false);
    } finally {
      setShareBusy(false);
    }
  }, [planId, shareBusy]);

  const copyShareUrl = useCallback(() => {
    if (!shareUrl) return;
    void navigator.clipboard?.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [shareUrl]);

  const doExport = useCallback(
    async (fmt: "png" | "pdf" | "dxf") => {
      setExportOpen(false);
      setExporting(true);
      try {
        if (fmt === "png") exportPng(editor, nameRef.current);
        else if (fmt === "dxf") exportDxf(editor, nameRef.current);
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
          setShareTokenState(rec.share_token);
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
  // Re-derived each HUD bump; gates the Phase 18 redesign bridge.
  const hasPlan = rooms(editor.doc).length > 0 || walls(editor.doc).length > 0;
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
    editor.onRequestText = (req) => {
      const s = editor.toScreen(req.world);
      setTextEdit({ id: req.id, world: req.world, left: s.x, top: s.y, value: req.text });
    };
  }, [editor]);

  // Focus the note input when it opens.
  useEffect(() => {
    if (textEdit) textInputRef.current?.focus();
  }, [textEdit]);

  const commitText = useCallback(() => {
    setTextEdit((te) => {
      if (!te) return null;
      const v = te.value.trim();
      if (te.id) editor.setAnnotationText(te.id, v);
      else if (v) editor.addAnnotation(te.world, v);
      return null;
    });
  }, [editor]);

  const cancelText = useCallback(() => setTextEdit(null), []);

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
  const localPoint = (e: React.PointerEvent | React.WheelEvent | React.MouseEvent): Point => {
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

  const onDoubleClick = (e: React.MouseEvent) => {
    const p = localPoint(e);
    editor.editAnnotationAt(p);
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
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* Inline text-note editor */}
      {textEdit && (
        <input
          ref={textInputRef}
          value={textEdit.value}
          onChange={(e) => setTextEdit((te) => (te ? { ...te, value: e.target.value } : te))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitText();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelText();
            }
          }}
          onBlur={commitText}
          placeholder="Type a note…"
          className="absolute z-20 -translate-x-1/2 -translate-y-1/2 rounded-md border border-brand bg-white px-2 py-1 text-sm text-neutral-800 shadow-lg outline-none"
          style={{ left: textEdit.left, top: textEdit.top, minWidth: 120 }}
        />
      )}

      {/* Floating action toolbar for a selected furniture item */}
      {selFurniture && (() => {
        const cs = corners(selFurniture).map((w) => editor.toScreen(w));
        const midX = (cs[0].x + cs[1].x + cs[2].x + cs[3].x) / 4;
        const topY = Math.min(cs[0].y, cs[1].y, cs[2].y, cs[3].y);
        return (
          <div
            className="absolute z-20 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-lg bg-white/97 p-0.5 shadow-lg ring-1 ring-neutral-200"
            style={{ left: midX, top: topY - 10 }}
          >
            <button
              onPointerDown={onMoveHandleDown}
              onPointerMove={onMoveHandleMove}
              onPointerUp={onMoveHandleUp}
              onPointerCancel={onMoveHandleUp}
              title="Drag to move (or use arrow keys)"
              className="flex cursor-move items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
            >
              <MoveIcon /> Move
            </button>
            <button
              onClick={() => editor.mirrorSelectedFurniture()}
              title="Mirror horizontally"
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
            >
              <MirrorIcon /> Mirror
            </button>
            <button
              onClick={() => setEditingSel((v) => !v)}
              title="Edit size and rotation"
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium hover:bg-neutral-100 ${editingSel ? "text-brand" : "text-neutral-700"}`}
            >
              <EditIcon /> Edit
            </button>
            <button
              onClick={() => editor.deleteSelection()}
              title="Delete (Del)"
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
            >
              <TrashIcon /> Delete
            </button>
          </div>
        );
      })()}

      {/* Top-left: plan name + save status (only when saving is available) */}
      {persisting && (
        <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-xl bg-white/95 px-2 py-1.5 shadow-lg ring-1 ring-neutral-200">
          <a
            href="/dashboard"
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

        {/* Design assist + photo import triggers */}
        <div className="flex justify-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) setPendingFile(f);
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={photoBusy || !!pendingFile}
            title="Import a floor plan, sketch, or room photo"
            className="flex items-center gap-1.5 rounded-lg bg-white/90 px-2.5 py-1 text-xs font-medium text-brand shadow ring-1 ring-stone-200 transition hover:bg-white disabled:opacity-50"
          >
            <PhotoIcon />
            {photoBusy ? "Reading…" : "Import photo"}
          </button>
          <button
            onClick={() => void runAssistNow()}
            disabled={assistBusy}
            title="Get design feedback and suggestions"
            className="flex items-center gap-1.5 rounded-lg bg-white/90 px-2.5 py-1 text-xs font-medium text-violet-700 shadow ring-1 ring-violet-200 transition hover:bg-white disabled:opacity-50"
          >
            <SparkleIcon />
            {assistBusy ? "Thinking…" : "Design assist"}
          </button>
          <DecorPanel editor={editor} />
          <RedesignBridge hasPlan={hasPlan} />
        </div>

        {/* Photo import: ask what kind of image was picked */}
        {pendingFile && (
          <div className="rounded-xl bg-white/97 px-3 py-2.5 text-sm text-neutral-700 shadow-lg ring-1 ring-stone-200">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-brand">
              What did you upload?
            </div>
            <div className="flex flex-col gap-1.5">
              <button
                onClick={() => chooseKind("floorplan")}
                className="rounded-lg px-3 py-1.5 text-left text-xs font-medium text-brand ring-1 ring-stone-200 transition hover:bg-stone-50"
              >
                A floor plan or sketch
                <span className="block font-normal text-neutral-500">Top-down drawing I&apos;ll trace exactly.</span>
              </button>
              <button
                onClick={() => chooseKind("room")}
                className="rounded-lg px-3 py-1.5 text-left text-xs font-medium text-brand ring-1 ring-stone-200 transition hover:bg-stone-50"
              >
                A photo of a real room
                <span className="block font-normal text-neutral-500">
                  I&apos;ll estimate the layout &mdash; verify the size afterward.
                </span>
              </button>
              <button
                onClick={cancelPending}
                className="self-end px-2 py-0.5 text-xs font-medium text-neutral-500 transition hover:text-neutral-700"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Photo import: error or scale-and-confirm panel */}
        {photoMsg && (
          <div
            className={`rounded-lg px-3 py-1.5 text-xs shadow ring-1 ${
              photoMsg.error ? "bg-red-50 text-red-700 ring-red-200" : "bg-white/95 text-neutral-700 ring-neutral-200"
            }`}
          >
            {photoMsg.text}
          </div>
        )}
        {photoOps && (
          <div className="rounded-xl bg-white/97 px-3 py-2.5 text-sm text-neutral-700 shadow-lg ring-1 ring-stone-200">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand">
              <PhotoIcon /> {photoMode === "room" ? "Estimated room" : "Imported floorplan"}
            </div>
            {photoMode === "room" && (
              <p className="mb-2 rounded-lg bg-amber-50 px-2 py-1 text-xs leading-snug text-amber-800 ring-1 ring-amber-200">
                This is an estimate from a single photo, not a measurement. Set a known dimension below and verify it
                against the real room.
              </p>
            )}
            <p className="mb-2 leading-snug">
              {photoMode === "room"
                ? "About how wide is this room? Measure one wall if you can — I'll scale the estimate to match."
                : "A photo has no scale. About how wide is the whole plan? I'll resize the preview to match."}
            </p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={4}
                max={200}
                value={photoWidthFt}
                onChange={(e) => changePhotoWidth(Number(e.target.value) || 0)}
                className="w-20 rounded-lg border border-stone-200 px-2 py-1 text-sm outline-none focus:border-brand"
              />
              <span className="text-xs text-neutral-500">feet wide</span>
            </div>
            <div className="mt-2.5 flex justify-end gap-2">
              <button
                onClick={discardPhoto}
                className="rounded-lg px-3 py-1 text-xs font-medium text-neutral-600 ring-1 ring-neutral-200 transition hover:bg-neutral-50"
              >
                Discard
              </button>
              <button
                onClick={applyPhoto}
                className="rounded-lg bg-brand px-3 py-1 text-xs font-medium text-white transition hover:bg-brand-hover"
              >
                Apply
              </button>
            </div>
          </div>
        )}

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
          <ToolButton
            active={editor.activeTool === "dimension"}
            onClick={() => editor.setTool("dimension")}
            title="Measure a dimension (D)"
          >
            Dimension
          </ToolButton>
          <ToolButton
            active={editor.activeTool === "annotation"}
            onClick={() => editor.setTool("annotation")}
            title="Add a text note (T)"
          >
            Note
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

      {/* Bottom-right: floor switcher */}
      <div className="absolute bottom-16 right-3">
        <FloorSwitcher editor={editor} onChange={forceHud} />
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
        {persisting && (
          <div className="relative">
            <button
              onClick={() => setShareOpen((o) => !o)}
              title="Create a read-only link to share this plan"
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium shadow ring-1 transition ${
                shareToken
                  ? "bg-white text-brand ring-brand/40 hover:bg-brand/5"
                  : "bg-white text-neutral-700 ring-neutral-200 hover:bg-white"
              }`}
            >
              <LinkIcon />
              {shareToken ? "Shared" : "Share link"}
            </button>
            {shareOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShareOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg bg-white p-3 shadow-lg ring-1 ring-neutral-200">
                  {shareToken ? (
                    <>
                      <p className="mb-2 text-xs text-neutral-500">
                        Anyone with this link can view (read-only) and comment.
                      </p>
                      <div className="mb-2 flex items-center gap-1.5">
                        <input
                          readOnly
                          value={shareUrl}
                          onFocus={(e) => e.target.select()}
                          className="min-w-0 flex-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-700 outline-none"
                        />
                        <button
                          onClick={copyShareUrl}
                          className="shrink-0 rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white transition hover:bg-brand-hover"
                        >
                          {copied ? "Copied" : "Copy"}
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <a
                          href={shareUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-medium text-brand hover:underline"
                        >
                          Open link →
                        </a>
                        <button
                          onClick={() => void revokeShareLink()}
                          disabled={shareBusy}
                          className="text-xs font-medium text-neutral-500 transition hover:text-red-600 disabled:opacity-50"
                        >
                          Turn off sharing
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="mb-2 text-xs text-neutral-500">
                        Create a link so anyone can view this plan (read-only) and leave comments. No account
                        needed to view.
                      </p>
                      <button
                        onClick={() => void createShareLink()}
                        disabled={shareBusy}
                        className="w-full rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-hover disabled:opacity-50"
                      >
                        {shareBusy ? "Creating…" : "Create share link"}
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        )}
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
                <button
                  onClick={() => void doExport("dxf")}
                  className="block w-full px-3 py-2 text-left text-sm text-neutral-700 transition hover:bg-neutral-100"
                >
                  Download DXF (CAD)
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
      {editor.selectedFurniture && editingSel && (
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

function MoveIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 9l-3 3 3 3" />
      <path d="M9 5l3-3 3 3" />
      <path d="M15 19l-3 3-3-3" />
      <path d="M19 9l3 3-3 3" />
      <path d="M2 12h20" />
      <path d="M12 2v20" />
    </svg>
  );
}

function MirrorIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v18" strokeDasharray="3 3" />
      <path d="M8 7l-4 5 4 5z" />
      <path d="M16 7l4 5-4 5z" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M6 6l1 14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-14" />
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

function LinkIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function PhotoIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M21 16l-5-5L5 20" />
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

function FloorSwitcher({ editor, onChange }: { editor: Editor; onChange: () => void }) {
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const floors = editor.floors;
  const activeId = editor.activeFloorId;
  // Display highest floor first (editor.floors is ordered low -> high).
  const topFirst = [...floors].reverse();

  const act = (fn: () => void) => {
    fn();
    onChange();
  };

  return (
    <div className="w-44 rounded-xl bg-white/95 p-2 shadow-lg ring-1 ring-neutral-200">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Floors</span>
        <button
          onClick={() => act(() => editor.addFloor())}
          title="Add a floor on top"
          className="rounded px-1.5 py-0.5 text-xs font-medium text-brand ring-1 ring-brand/30 transition hover:bg-brand/5"
        >
          + Add
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {topFirst.map((f) => {
          const isActive = f.id === activeId;
          const idx = floors.findIndex((x) => x.id === f.id);
          return (
            <div
              key={f.id}
              className={`flex items-center gap-1 rounded-lg px-1.5 py-1 text-sm ring-1 ${
                isActive ? "bg-brand text-white ring-brand" : "bg-white text-neutral-700 ring-neutral-200"
              }`}
            >
              {renaming?.id === f.id ? (
                <input
                  autoFocus
                  value={renaming.value}
                  onChange={(e) => setRenaming({ id: f.id, value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      act(() => editor.renameFloor(f.id, renaming.value));
                      setRenaming(null);
                    } else if (e.key === "Escape") {
                      setRenaming(null);
                    }
                  }}
                  onBlur={() => {
                    act(() => editor.renameFloor(f.id, renaming.value));
                    setRenaming(null);
                  }}
                  className="min-w-0 flex-1 rounded border border-neutral-300 px-1 py-0.5 text-sm text-neutral-800 outline-none"
                />
              ) : (
                <button
                  onClick={() => act(() => editor.switchFloor(f.id))}
                  onDoubleClick={() => setRenaming({ id: f.id, value: f.name })}
                  title="Click to switch, double-click to rename"
                  className="min-w-0 flex-1 truncate text-left font-medium"
                >
                  {f.name}
                </button>
              )}
              <button
                onClick={() => act(() => editor.moveFloor(f.id, 1))}
                disabled={idx >= floors.length - 1}
                title="Move up"
                className={`px-0.5 text-xs disabled:opacity-30 ${isActive ? "text-white/90" : "text-neutral-400 hover:text-neutral-700"}`}
              >
                ▲
              </button>
              <button
                onClick={() => act(() => editor.moveFloor(f.id, -1))}
                disabled={idx <= 0}
                title="Move down"
                className={`px-0.5 text-xs disabled:opacity-30 ${isActive ? "text-white/90" : "text-neutral-400 hover:text-neutral-700"}`}
              >
                ▼
              </button>
              <button
                onClick={() => act(() => editor.deleteFloor(f.id))}
                disabled={floors.length <= 1}
                title="Delete floor"
                className={`px-0.5 text-xs disabled:opacity-30 ${isActive ? "text-white/90" : "text-neutral-400 hover:text-red-600"}`}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </div>
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
