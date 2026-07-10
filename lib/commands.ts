// Concrete commands. Each is reversible and self-contained.

import type { Command } from "./history.ts";
import type { Document, DoorSwing, Entity } from "./model/types.ts";
import type { Point } from "./viewport.ts";

export type FurnitureTransform = { position: Point; rotation: number; w: number; h: number };

/** A batch of AI-generated ops applied as ONE undo step. */
export class ApplyAIBatch implements Command {
  readonly label: string;
  private readonly cmds: Command[];
  constructor(cmds: Command[], label = "AI edit") {
    this.cmds = cmds;
    this.label = label;
  }
  do(doc: Document): void {
    for (const c of this.cmds) c.do(doc);
  }
  undo(doc: Document): void {
    for (let i = this.cmds.length - 1; i >= 0; i--) this.cmds[i].undo(doc);
  }
}

export class AddEntities implements Command {
  readonly label: string;
  private readonly entities: Entity[];
  constructor(entities: Entity[]) {
    this.entities = entities;
    this.label = entities.length === 1 ? `Add ${entities[0].type}` : `Add ${entities.length} items`;
  }
  do(doc: Document): void {
    doc.entities.push(...this.entities);
  }
  undo(doc: Document): void {
    const ids = new Set(this.entities.map((e) => e.id));
    doc.entities = doc.entities.filter((e) => !ids.has(e.id));
  }
}

export class DeleteEntities implements Command {
  readonly label: string;
  private readonly ids: string[];
  // Remember each removed entity with its original index so undo restores order.
  private removed: { entity: Entity; index: number }[] = [];
  constructor(ids: string[]) {
    this.ids = ids;
    this.label = ids.length === 1 ? "Delete item" : `Delete ${ids.length} items`;
  }
  do(doc: Document): void {
    const idset = new Set(this.ids);
    // Cascade: deleting a wall also deletes doors/windows anchored to it, so
    // they undo together as one step.
    const deletedWalls = new Set(
      doc.entities.filter((e) => idset.has(e.id) && e.type === "wall").map((e) => e.id),
    );
    for (const e of doc.entities) {
      if ((e.type === "door" || e.type === "window") && deletedWalls.has(e.wallId)) idset.add(e.id);
    }
    this.removed = [];
    for (let i = doc.entities.length - 1; i >= 0; i--) {
      if (idset.has(doc.entities[i].id)) {
        this.removed.push({ entity: doc.entities[i], index: i });
        doc.entities.splice(i, 1);
      }
    }
  }
  undo(doc: Document): void {
    // Reinsert ascending by original index so positions are exact.
    for (const r of [...this.removed].sort((x, y) => x.index - y.index)) {
      doc.entities.splice(r.index, 0, r.entity);
    }
  }
}

/** Rename a room. Undoable so name edits behave like any other change. */
export class RenameRoom implements Command {
  readonly label = "Rename room";
  private readonly id: string;
  private readonly newName: string;
  private oldName = "";
  constructor(id: string, newName: string) {
    this.id = id;
    this.newName = newName;
  }
  do(doc: Document): void {
    const r = doc.entities.find((e) => e.id === this.id);
    if (r && r.type === "room") {
      this.oldName = r.name;
      r.name = this.newName;
    }
  }
  undo(doc: Document): void {
    const r = doc.entities.find((e) => e.id === this.id);
    if (r && r.type === "room") r.name = this.oldName;
  }
}

/** Set a furniture block's full transform (move / rotate / resize) reversibly. */
export class SetFurnitureTransform implements Command {
  readonly label = "Transform furniture";
  private readonly id: string;
  private readonly after: FurnitureTransform;
  private readonly before: FurnitureTransform;
  constructor(id: string, after: FurnitureTransform, before: FurnitureTransform) {
    this.id = id;
    this.after = after;
    this.before = before;
  }
  private set(doc: Document, t: FurnitureTransform): void {
    const e = doc.entities.find((x) => x.id === this.id);
    if (e && e.type === "furniture") {
      e.position = { ...t.position };
      e.rotation = t.rotation;
      e.w = t.w;
      e.h = t.h;
    }
  }
  do(doc: Document): void {
    this.set(doc, this.after);
  }
  undo(doc: Document): void {
    this.set(doc, this.before);
  }
}

/** Toggle a furniture block's horizontal mirror. Self-inverse: undo re-toggles. */
export class MirrorFurniture implements Command {
  readonly label = "Mirror furniture";
  private readonly id: string;
  constructor(id: string) {
    this.id = id;
  }
  private toggle(doc: Document): void {
    const e = doc.entities.find((x) => x.id === this.id);
    if (e && e.type === "furniture") e.flipX = !e.flipX;
  }
  do(doc: Document): void {
    this.toggle(doc);
  }
  undo(doc: Document): void {
    this.toggle(doc);
  }
}

/** Edit a door/window's offset, width, and/or swing (undoable). */
export type OpeningPatch = { offset?: number; width?: number; swing?: DoorSwing };

export class EditOpening implements Command {
  readonly label = "Edit opening";
  private readonly id: string;
  private readonly patch: OpeningPatch;
  private before: OpeningPatch = {};
  constructor(id: string, patch: OpeningPatch) {
    this.id = id;
    this.patch = patch;
  }
  do(doc: Document): void {
    const e = doc.entities.find((x) => x.id === this.id);
    if (!e || (e.type !== "door" && e.type !== "window")) return;
    this.before = { offset: e.offset, width: e.width };
    if (e.type === "door") this.before.swing = e.swing;
    if (this.patch.offset != null) e.offset = this.patch.offset;
    if (this.patch.width != null) e.width = this.patch.width;
    if (this.patch.swing != null && e.type === "door") e.swing = this.patch.swing;
  }
  undo(doc: Document): void {
    const e = doc.entities.find((x) => x.id === this.id);
    if (!e || (e.type !== "door" && e.type !== "window")) return;
    if (this.before.offset != null) e.offset = this.before.offset;
    if (this.before.width != null) e.width = this.before.width;
    if (this.before.swing != null && e.type === "door") e.swing = this.before.swing;
  }
}

/** Set an annotation's text (undoable). Empty text deletes nothing here — the
 * caller decides whether to delete an emptied note. */
export class EditAnnotation implements Command {
  readonly label = "Edit note";
  private readonly id: string;
  private readonly newText: string;
  private oldText = "";
  constructor(id: string, newText: string) {
    this.id = id;
    this.newText = newText;
  }
  do(doc: Document): void {
    const e = doc.entities.find((x) => x.id === this.id);
    if (e && e.type === "annotation") {
      this.oldText = e.text;
      e.text = this.newText;
    }
  }
  undo(doc: Document): void {
    const e = doc.entities.find((x) => x.id === this.id);
    if (e && e.type === "annotation") e.text = this.oldText;
  }
}

/** Translate a set of entities by a world-space delta (inches). */
export class TranslateEntities implements Command {
  readonly label = "Move";
  private readonly ids: string[];
  private readonly dx: number;
  private readonly dy: number;
  constructor(ids: string[], dx: number, dy: number) {
    this.ids = ids;
    this.dx = dx;
    this.dy = dy;
  }
  private shift(doc: Document, sign: number): void {
    const idset = new Set(this.ids);
    const ddx = this.dx * sign;
    const ddy = this.dy * sign;
    for (const e of doc.entities) {
      if (!idset.has(e.id)) continue;
      if (e.type === "wall") {
        e.a.x += ddx;
        e.a.y += ddy;
        e.b.x += ddx;
        e.b.y += ddy;
      } else if (e.type === "dimension") {
        e.from.x += ddx;
        e.from.y += ddy;
        e.to.x += ddx;
        e.to.y += ddy;
      } else if (e.type === "annotation") {
        e.position.x += ddx;
        e.position.y += ddy;
      }
    }
  }
  do(doc: Document): void {
    this.shift(doc, 1);
  }
  undo(doc: Document): void {
    this.shift(doc, -1);
  }
}
