// Place-door / place-window tool. Hover over a wall; a ghost opening snaps to
// the nearest point on that wall. Click to drop it (anchored to the wall by
// offset). Esc cancels.

import type { Point } from "../viewport.ts";
import { AddEntities } from "../commands.ts";
import { walls } from "../model/document.ts";
import { distanceToWall } from "../model/wall.ts";
import {
  clampOffset,
  createDoor,
  createWindow,
  drawOpening,
  projectOffset,
} from "../model/opening.ts";
import type { Opening, Wall } from "../model/types.ts";
import type { Editor } from "../editor.ts";
import type { PointerInfo, Tool } from "./tool.ts";

export class PlaceOpeningTool implements Tool {
  readonly name = "opening";
  private kind: "door" | "window" = "door";
  private ghost: { opening: Opening; wall: Wall } | null = null;

  setKind(kind: "door" | "window"): void {
    this.kind = kind;
    this.ghost = null;
  }

  cursor(): string {
    return "copy";
  }

  private nearestWall(ed: Editor, p: Point): Wall | null {
    let best: Wall | null = null;
    let bestD = ed.snapThresholdWorld() * 3; // openings grab from a bit further
    for (const w of walls(ed.doc)) {
      const d = distanceToWall(w, p);
      if (d < bestD) {
        bestD = d;
        best = w;
      }
    }
    return best;
  }

  private build(ed: Editor, p: Point): { opening: Opening; wall: Wall } | null {
    const wall = this.nearestWall(ed, p);
    if (!wall) return null;
    const raw = projectOffset(wall, p);
    const opening =
      this.kind === "door" ? createDoor(wall.id, raw) : createWindow(wall.id, raw);
    opening.offset = clampOffset(wall, opening.width, raw);
    return { opening, wall };
  }

  onPointerMove(e: PointerInfo, ed: Editor): void {
    this.ghost = this.build(ed, e.world);
    ed.setStatus(
      this.ghost
        ? `Click to place ${this.kind} — Esc to cancel`
        : `Hover over a wall to place a ${this.kind}`,
    );
    ed.markDirty();
  }

  onPointerDown(e: PointerInfo, ed: Editor): void {
    if (e.button !== 0) return;
    const built = this.build(ed, e.world);
    if (!built) return;
    ed.execute(new AddEntities([built.opening]));
    ed.setSelection([built.opening.id]);
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
    if (this.ghost) {
      ctx.save();
      ctx.globalAlpha = 0.6;
      drawOpening(ctx, this.ghost.opening, this.ghost.wall, ed.viewport);
      ctx.restore();
    }
  }
}
