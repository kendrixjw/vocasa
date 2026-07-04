// Client-side design assist: snapshot -> POST /api/assist -> { notes, ops? }.
// Any proposed ops are validated + resolved into an ApplyAIBatch, but NOT
// executed — the caller previews them and lets the user accept or reject.
// Assist, not autopilot.

import type { Editor } from "../editor.ts";
import type { ApplyAIBatch } from "../commands.ts";
import { buildSnapshot } from "./snapshot.ts";
import { validateOps } from "./ops.ts";
import { resolveBatch } from "./resolver.ts";

export type AssistResult =
  | { kind: "advice"; notes: string }
  | { kind: "proposal"; notes: string; summary: string; command: ApplyAIBatch }
  | { kind: "error"; message: string };

export async function runAssist(editor: Editor, request: string): Promise<AssistResult> {
  const cursor = editor.aiCursor;
  const selection = editor.selectionIds;
  const snapshot = buildSnapshot(editor.doc, cursor, selection);

  let res: Response;
  try {
    res = await fetch("/api/assist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot, request }),
    });
  } catch {
    return { kind: "error", message: "Couldn't reach the server." };
  }

  let data: { notes?: string; ops?: unknown; error?: string };
  try {
    data = await res.json();
  } catch {
    return { kind: "error", message: "The server returned an unexpected response." };
  }

  if (data.error) return { kind: "error", message: data.error };
  const notes = typeof data.notes === "string" ? data.notes : "Here's what I think.";

  // No proposed changes -> pure advice.
  const raw = Array.isArray(data.ops) ? data.ops : [];
  if (raw.length === 0) return { kind: "advice", notes };

  const validated = validateOps(raw);
  if (!validated.ok) return { kind: "advice", notes }; // bad ops -> just show the advice

  const resolved = resolveBatch(validated.ops, editor.doc, cursor, selection);
  if (resolved.kind !== "ops") return { kind: "advice", notes };

  return { kind: "proposal", notes, summary: resolved.summary, command: resolved.command };
}
