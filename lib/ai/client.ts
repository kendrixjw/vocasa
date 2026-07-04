// Client-side orchestration for a typed/spoken command:
//   snapshot -> POST /api/parse -> validate (untrusted!) -> resolve -> execute.
// Returns a plain-English result the UI shows. The command is applied as ONE
// undo step (ApplyAIBatch) inside the editor's history.

import type { Editor } from "../editor.ts";
import { buildSnapshot } from "./snapshot.ts";
import { validateOps } from "./ops.ts";
import { resolveBatch } from "./resolver.ts";

export type CommandOutcome =
  | { kind: "applied"; message: string }
  | { kind: "clarify"; message: string }
  | { kind: "error"; message: string };

export async function runCommand(editor: Editor, transcript: string): Promise<CommandOutcome> {
  const text = transcript.trim();
  if (!text) return { kind: "error", message: "Type a command first." };

  const cursor = editor.aiCursor;
  const selection = editor.selectionIds;
  const snapshot = buildSnapshot(editor.doc, cursor, selection);

  let res: Response;
  try {
    res = await fetch("/api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot, transcript: text }),
    });
  } catch {
    return { kind: "error", message: "Couldn't reach the server." };
  }

  let data: { ops?: unknown; clarify?: string; error?: string };
  try {
    data = await res.json();
  } catch {
    return { kind: "error", message: "The server returned an unexpected response." };
  }

  if (data.error) return { kind: "error", message: data.error };
  if (typeof data.clarify === "string") return { kind: "clarify", message: data.clarify };

  const validated = validateOps(data.ops);
  if (!validated.ok) return { kind: "error", message: validated.error };

  // Resolve against the CURRENT doc (fresh snapshot each call).
  const result = resolveBatch(validated.ops, editor.doc, cursor, selection);
  if (result.kind === "clarify") return { kind: "clarify", message: result.question };

  editor.execute(result.command);
  return { kind: "applied", message: result.summary };
}
