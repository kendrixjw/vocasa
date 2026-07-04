// Place-furniture tool: armed with a `kind` (from the palette). A ghost of the
// block follows the cursor, snapping against walls; click to drop it, which
// commits an AddEntities command, selects the new block, and returns to the
// select tool. Esc cancels.

import type { Point } from "../viewport.ts";
import { AddEntities } from "../commands.ts";
import { createFurniture, drawFurniture } from "../model/furniture.ts";
import type { Furniture } from "../model/types.ts";
import { snapFurnitureMove } from "../furniture/snap.ts";
import { furnitureDef } from "../furniture/library.ts";
import type { Editor } from "../editor.ts";
import type { PointerInfo, Tool } from "./tool.ts";

export class PlaceFurnitureTool implements Tool {
  readonly name = "place";
  private kind = "sofa";
  private ghost: Furniture | null = null;

  setKind(kind: string): void {
    this.kind = kind;
    this.ghost = null;
  }

  cursor(): string {
    return "copy";
  }

  private snapped(at: Point, ed: Editor): Furniture {
    const base = createFurniture(this.kind, at);
    const s = snapFurnitureMove(at, base, ed.doc, ed.snapThresholdWorld(), false);
    return { ...base, position: s.position, rotation: s.rotation };
  }

  onPointerMove(e: PointerInfo, ed: Editor): void {
    this.ghost = this.snapped(e.world, ed);
    const label = furnitureDef(this.kind)?.label ?? this.kind;
    ed.setStatus(`Click to place ${label} — Esc to cancel`);
    ed.markDirty();
  }

  onPointerDown(e: PointerInfo, ed: Editor): void {
    if (e.button !== 0) return;
    const f = this.snapped(e.world, ed);
    ed.execute(new AddEntities([f]));
    ed.setSelection([f.id]);
    this.ghost = null;
    ed.setStatus("");
    ed.setTool("select");
  }

  onKeyDown(key: string, ed: Editor): void {
    if (key === "Escape") this.cancel(ed);
  }

  cancel(ed: Editor): void {
    this.ghost = null;
    ed.setStatus("");
    ed.markDirty();
  }

  drawOverlay(ctx: CanvasRenderingContext2D, ed: Editor): void {
    if (this.ghost) drawFurniture(ctx, this.ghost, ed.viewport, { ghost: true });
  }
}
