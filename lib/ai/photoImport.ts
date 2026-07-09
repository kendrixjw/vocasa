// Client orchestration for photo import (Phase 16):
//   file -> base64 -> /api/photo -> validated ops -> scale+recenter -> preview.
// The model estimates inches with correct proportions; the user then sets the
// real overall width and we uniformly rescale before committing.
"use client";

import type { Editor } from "../editor.ts";
import type { Point } from "../viewport.ts";
import { validateOps, type Op } from "./ops.ts";
import { resolveBatch } from "./resolver.ts";
import type { ApplyAIBatch } from "../commands.ts";

export type PhotoOpsResult =
  | { kind: "ops"; ops: Op[] }
  | { kind: "empty" }
  | { kind: "error"; message: string };

export async function fileToBase64(file: File): Promise<{ data: string; mediaType: string }> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return { data: btoa(binary), mediaType: file.type || "image/png" };
}

export async function requestPhotoOps(file: File): Promise<PhotoOpsResult> {
  let payload: { data: string; mediaType: string };
  try {
    payload = await fileToBase64(file);
  } catch {
    return { kind: "error", message: "Couldn't read that image." };
  }

  let res: Response;
  try {
    res = await fetch("/api/photo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: payload.data, mediaType: payload.mediaType }),
    });
  } catch {
    return { kind: "error", message: "Couldn't reach the server." };
  }

  let data: { ops?: unknown; error?: string };
  try {
    data = await res.json();
  } catch {
    return { kind: "error", message: "The server returned an unexpected response." };
  }
  if (data.error) return { kind: "error", message: data.error };

  const validated = validateOps(data.ops);
  if (!validated.ok) return { kind: "error", message: validated.error };
  if (validated.ops.length === 0) return { kind: "empty" };
  return { kind: "ops", ops: validated.ops };
}

// --- Scale + placement ----------------------------------------------------

type Box = { minX: number; minY: number; maxX: number; maxY: number };

/** Bounding box (inches, model space) of the imported rooms. */
function opsBounds(ops: Op[]): Box | null {
  let b: Box | null = null;
  const add = (x: number, y: number) => {
    if (!b) b = { minX: x, minY: y, maxX: x, maxY: y };
    else {
      b.minX = Math.min(b.minX, x);
      b.minY = Math.min(b.minY, y);
      b.maxX = Math.max(b.maxX, x);
      b.maxY = Math.max(b.maxY, y);
    }
  };
  for (const op of ops) {
    if (op.op === "createRoom" && op.anchor && "x" in op.anchor) {
      add(op.anchor.x - op.width / 2, op.anchor.y - op.height / 2);
      add(op.anchor.x + op.width / 2, op.anchor.y + op.height / 2);
    } else if (op.op === "addWall") {
      if ("x" in op.from) add(op.from.x, op.from.y);
      if ("x" in op.to) add(op.to.x, op.to.y);
    }
  }
  return b;
}

/** Width of the imported plan in inches, at model scale. */
export function detectedWidthInches(ops: Op[]): number {
  const b = opsBounds(ops);
  return b ? Math.max(b.maxX - b.minX, 1) : 0;
}

/** Scale all geometry by `factor` and recenter the plan on `cursor`. */
function transformOps(ops: Op[], factor: number, cursor: Point): Op[] {
  const scaled: Op[] = ops.map((op) => {
    switch (op.op) {
      case "createRoom": {
        const anchor =
          op.anchor && "x" in op.anchor
            ? { x: op.anchor.x * factor, y: op.anchor.y * factor }
            : op.anchor;
        return { ...op, width: op.width * factor, height: op.height * factor, anchor };
      }
      case "addWall": {
        const from = "x" in op.from ? { x: op.from.x * factor, y: op.from.y * factor } : op.from;
        const to = "x" in op.to ? { x: op.to.x * factor, y: op.to.y * factor } : op.to;
        return { ...op, from, to };
      }
      case "addDoor":
      case "addWindow":
        return {
          ...op,
          width: op.width != null ? op.width * factor : undefined,
          along: typeof op.along === "number" ? op.along * factor : op.along,
        };
      default:
        return op;
    }
  });

  // Recenter so the plan's center lands on the cursor.
  const b = opsBounds(scaled);
  if (!b) return scaled;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const dx = cursor.x - cx;
  const dy = cursor.y - cy;
  return scaled.map((op) => {
    if (op.op === "createRoom" && op.anchor && "x" in op.anchor) {
      return { ...op, anchor: { x: op.anchor.x + dx, y: op.anchor.y + dy } };
    }
    if (op.op === "addWall") {
      const from = "x" in op.from ? { x: op.from.x + dx, y: op.from.y + dy } : op.from;
      const to = "x" in op.to ? { x: op.to.x + dx, y: op.to.y + dy } : op.to;
      return { ...op, from, to };
    }
    return op;
  });
}

export type PhotoCommand = { command: ApplyAIBatch; summary: string };

/**
 * Build the (uncommitted) command for the imported plan scaled so its overall
 * width equals `realWidthInches`, centered on the editor's cursor.
 */
export function buildPhotoCommand(editor: Editor, ops: Op[], realWidthInches: number): PhotoCommand | null {
  const detected = detectedWidthInches(ops);
  const factor = detected > 0 ? realWidthInches / detected : 1;
  const cursor = editor.aiCursor;
  const placed = transformOps(ops, factor, cursor);
  const result = resolveBatch(placed, editor.doc, cursor, []);
  if (result.kind !== "ops") return null;
  return { command: result.command, summary: result.summary };
}
