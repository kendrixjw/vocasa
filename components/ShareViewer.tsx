// Public read-only plan viewer (share/collaborate). Renders a shared plan by
// token: pan/zoom/fit + floor switching, no editing tools, plus an anonymous
// comments sidebar. Everything goes through the token-scoped RPCs so no auth is
// required and only this one plan is reachable.
"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Editor } from "@/lib/editor";
import type { Point } from "@/lib/viewport";
import { isPlanData } from "@/lib/persistence/plan";
import {
  addSharedComment,
  getSharedComments,
  getSharedPlan,
  type SharedComment,
} from "@/lib/persistence/sharing";

type Status = "loading" | "ready" | "notfound" | "error";

export default function ShareViewer({ token }: { token: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  if (editorRef.current === null) editorRef.current = new Editor();
  const editor = editorRef.current;

  const [status, setStatus] = useState<Status>("loading");
  const [planName, setPlanName] = useState("Shared plan");
  const [, forceHud] = useReducer((n: number) => n + 1, 0);
  const dirtyRef = useRef(true);

  // --- Load the plan -------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const plan = await getSharedPlan(token);
        if (cancelled) return;
        if (!plan) {
          setStatus("notfound");
          return;
        }
        setPlanName(plan.name);
        if (isPlanData(plan.data)) editor.load(plan.data);
        editor.fit();
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, editor]);

  // --- Render loop + sizing ------------------------------------------------
  useEffect(() => {
    editor.onDirty = () => {
      dirtyRef.current = true;
    };
    editor.onChange = () => forceHud();
  }, [editor]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    let raf = 0;
    const loop = () => {
      if (dirtyRef.current && ctx) {
        dirtyRef.current = false;
        editor.render(ctx);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [editor]);

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

  // --- Pan / zoom only (no tools) ------------------------------------------
  const panning = useRef(false);
  const last = useRef<Point>({ x: 0, y: 0 });
  const localPoint = (e: React.PointerEvent | React.WheelEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const onPointerDown = (e: React.PointerEvent) => {
    canvasRef.current?.setPointerCapture(e.pointerId);
    panning.current = true;
    last.current = localPoint(e);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!panning.current) return;
    const p = localPoint(e);
    editor.pan(p.x - last.current.x, p.y - last.current.y);
    last.current = p;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    canvasRef.current?.releasePointerCapture(e.pointerId);
    panning.current = false;
  };
  const onWheel = (e: React.WheelEvent) => {
    editor.zoom(localPoint(e), Math.exp(-e.deltaY * 0.0015));
  };

  if (status === "notfound") {
    return <Centered title="Link not found" body="This share link is invalid or has been turned off." />;
  }
  if (status === "error") {
    return <Centered title="Something went wrong" body="Couldn't load this plan. Try again later." />;
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-stone-50">
      <header className="flex items-center gap-3 border-b border-stone-200 bg-white px-4 py-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/vocasa-mark.svg" alt="" className="h-6 w-6" />
        <span className="text-sm font-semibold tracking-tight text-brand">Vocasa</span>
        <span className="mx-1 text-stone-300">/</span>
        <span className="truncate text-sm font-medium text-stone-700">{planName}</span>
        <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-500">
          Read-only
        </span>
        <div className="ml-auto flex items-center gap-2">
          <FloorButtons editor={editor} onChange={forceHud} />
          <button
            onClick={() => editor.fit()}
            className="rounded-lg bg-white px-2.5 py-1 text-xs font-medium text-stone-600 ring-1 ring-stone-200 transition hover:bg-stone-100"
          >
            Fit
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div ref={wrapRef} className="relative min-w-0 flex-1">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 block touch-none"
            style={{ cursor: panning.current ? "grabbing" : "grab" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
          />
          {status === "loading" && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-stone-400">
              Loading…
            </div>
          )}
        </div>
        <CommentsPanel token={token} />
      </div>
    </div>
  );
}

function FloorButtons({ editor, onChange }: { editor: Editor; onChange: () => void }) {
  const floors = editor.floors;
  if (floors.length <= 1) return null;
  return (
    <div className="flex items-center gap-1">
      {[...floors].reverse().map((f) => (
        <button
          key={f.id}
          onClick={() => {
            editor.switchFloor(f.id);
            editor.fit();
            onChange();
          }}
          className={`rounded-md px-2 py-1 text-xs font-medium transition ${
            f.id === editor.activeFloorId
              ? "bg-brand text-white"
              : "bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-stone-100"
          }`}
        >
          {f.name}
        </button>
      ))}
    </div>
  );
}

function CommentsPanel({ token }: { token: string }) {
  const [comments, setComments] = useState<SharedComment[] | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setComments(await getSharedComments(token));
    } catch {
      setComments([]);
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = async () => {
    if (busy) return;
    if (!name.trim() || !body.trim()) {
      setError("Add your name and a comment.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addSharedComment(token, name, body);
      setBody("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't post your comment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="flex w-80 flex-col border-l border-stone-200 bg-white">
      <div className="border-b border-stone-100 px-4 py-3 text-sm font-semibold text-stone-700">
        Comments
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {comments === null ? (
          <p className="text-xs text-stone-400">Loading…</p>
        ) : comments.length === 0 ? (
          <p className="text-xs text-stone-400">No comments yet. Be the first.</p>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="rounded-lg bg-stone-50 px-3 py-2 ring-1 ring-stone-100">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-semibold text-stone-700">{c.author_name}</span>
                <span className="shrink-0 text-[10px] text-stone-400">
                  {new Date(c.created_at).toLocaleDateString()}
                </span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-stone-700">{c.body}</p>
            </div>
          ))
        )}
      </div>
      <div className="border-t border-stone-100 px-4 py-3">
        {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder="Your name"
          className="mb-2 w-full rounded-lg border border-stone-200 px-2.5 py-1.5 text-sm outline-none focus:border-brand"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={2000}
          rows={3}
          placeholder="Add a comment…"
          className="mb-2 w-full resize-none rounded-lg border border-stone-200 px-2.5 py-1.5 text-sm outline-none focus:border-brand"
        />
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="w-full rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-hover disabled:opacity-50"
        >
          {busy ? "Posting…" : "Post comment"}
        </button>
      </div>
    </aside>
  );
}

function Centered({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-2 bg-stone-50 px-6 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/vocasa-mark.svg" alt="" className="mb-2 h-10 w-10" />
      <h1 className="text-lg font-semibold text-stone-800">{title}</h1>
      <p className="max-w-sm text-sm text-stone-500">{body}</p>
      <a href="/" className="mt-3 text-sm font-medium text-brand hover:underline">
        Go to Vocasa →
      </a>
    </div>
  );
}
