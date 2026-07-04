// Draw-wall tool: click to drop points, chaining walls end-to-end. Each segment
// snaps to existing endpoints (auto-join) or to 45° angle locks. ESC or
// right-click ends the chain. Shift disables snapping.

import { worldToScreen, type Point } from "../viewport.ts";
import { AddEntities } from "../commands.ts";
import { createWall, DEFAULT_WALL_THICKNESS, drawWall } from "../model/wall.ts";
import { snapForDraw, type SnapResult } from "../snap.ts";
import { formatFeetInches } from "../units.ts";
import { drawPillLabel, drawSnapMarker } from "../render/overlay.ts";
import type { Editor } from "../editor.ts";
import type { PointerInfo, Tool } from "./tool.ts";

export class DrawWallTool implements Tool {
  readonly name = "wall";
  private start: Point | null = null; // last committed endpoint (chain anchor)
  private preview: SnapResult | null = null;

  cursor(): string {
    return "crosshair";
  }

  private resolve(e: PointerInfo, ed: Editor): SnapResult {
    return snapForDraw(
      e.world,
      this.start,
      ed.endpoints(),
      ed.snapThresholdWorld(),
      e.shiftKey,
    );
  }

  onPointerDown(e: PointerInfo, ed: Editor): void {
    // Right-click ends the current chain.
    if (e.button === 2) {
      this.cancel(ed);
      return;
    }
    if (e.button !== 0) return;

    const snap = this.resolve(e, ed);
    if (!this.start) {
      this.start = snap.point;
    } else {
      // Ignore zero-length segments (double click on the same point).
      if (Math.hypot(snap.point.x - this.start.x, snap.point.y - this.start.y) > 1e-6) {
        ed.execute(new AddEntities([createWall(this.start, snap.point, DEFAULT_WALL_THICKNESS)]));
      }
      this.start = snap.point; // chain from here
    }
    this.preview = snap;
    ed.markDirty();
  }

  onPointerMove(e: PointerInfo, ed: Editor): void {
    this.preview = this.resolve(e, ed);
    if (this.start) {
      const len = Math.hypot(
        this.preview.point.x - this.start.x,
        this.preview.point.y - this.start.y,
      );
      ed.setStatus(`Wall length ${formatFeetInches(len)} — click to place, Esc to finish`);
    }
    ed.markDirty();
  }

  onKeyDown(key: string, ed: Editor): void {
    if (key === "Escape") this.cancel(ed);
  }

  cancel(ed: Editor): void {
    this.start = null;
    this.preview = null;
    ed.setStatus("");
    ed.markDirty();
  }

  drawOverlay(ctx: CanvasRenderingContext2D, ed: Editor): void {
    const vp = ed.viewport;

    // Ghost of the segment being drawn.
    if (this.start && this.preview) {
      const ghost = createWall(this.start, this.preview.point, DEFAULT_WALL_THICKNESS);
      ctx.save();
      ctx.globalAlpha = 0.5;
      drawWall(ctx, ghost, vp);
      ctx.restore();

      // Length label at the segment midpoint.
      const mid = worldToScreen(vp, {
        x: (this.start.x + this.preview.point.x) / 2,
        y: (this.start.y + this.preview.point.y) / 2,
      });
      const len = Math.hypot(
        this.preview.point.x - this.start.x,
        this.preview.point.y - this.start.y,
      );
      if (len > 0) drawPillLabel(ctx, { x: mid.x, y: mid.y - 14 }, formatFeetInches(len));
    }

    // Snap marker at the current target (endpoint join is the important cue).
    if (this.preview && this.preview.kind !== "none") {
      drawSnapMarker(ctx, worldToScreen(vp, this.preview.point));
    }
  }
}
