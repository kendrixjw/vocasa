// Command pattern + undo/redo history. The model mutates ONLY inside a
// Command's do()/undo(), so manual edits and (later) AI batches all undo the
// same way.

import type { Document } from "./model/types.ts";

export interface Command {
  readonly label: string;
  do(doc: Document): void;
  undo(doc: Document): void;
}

export class History {
  private done: Command[] = [];
  private undone: Command[] = [];

  /** Apply a command and record it, clearing the redo stack. */
  execute(doc: Document, cmd: Command): void {
    cmd.do(doc);
    this.done.push(cmd);
    this.undone = [];
  }

  /** Record an ALREADY-applied command (e.g. an accepted preview) without re-doing it. */
  record(cmd: Command): void {
    this.done.push(cmd);
    this.undone = [];
  }

  undo(doc: Document): boolean {
    const cmd = this.done.pop();
    if (!cmd) return false;
    cmd.undo(doc);
    this.undone.push(cmd);
    return true;
  }

  redo(doc: Document): boolean {
    const cmd = this.undone.pop();
    if (!cmd) return false;
    cmd.do(doc);
    this.done.push(cmd);
    return true;
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }
  get canRedo(): boolean {
    return this.undone.length > 0;
  }
  get undoLabel(): string | null {
    return this.done.at(-1)?.label ?? null;
  }
  get redoLabel(): string | null {
    return this.undone.at(-1)?.label ?? null;
  }
}
