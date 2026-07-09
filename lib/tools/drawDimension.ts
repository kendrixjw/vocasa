// Dimension tool: click a start point, then an end point, to drop a dimension
// line. Both points snap to existing wall endpoints (Shift disables). Each pair
// makes one dimension (no chaining). ESC cancels an in-progress measure.

import { worldToScreen, type Point } from "../viewport.ts";
import { AddEntities } from "../commands.ts";
import { createDimension, drawDimension } from "../model/dimension.ts";
import { nearestEndpoint } from "../snap.ts";
import { formatFeetInches } from "../units.ts";
import { drawPillLabel, drawSnapMarker } from "../render/overlay.ts";
import type { Editor } from "../editor.ts";
import type { PointerInfo, Tool } from "./tool.ts";

export class DimensionTool implements Tool {
  readonly name = "dimension";
  private start: Point | null = null;
  private target: Point | null = null;
  private snapped = false;

  cursor(): string {
    return "crosshair";
  }

  private resolve(e: PointerInfo, ed: Editor): { point: Point; snapped: boolean } {
    if (e.shiftKey) return { point: { ...e.world }, snapped: false };
    const ep = nearestEndpoint(e.world, ed.endpoints(), ed.snapThresholdWorld());
    return ep ? { point: { ...ep.point }, snapped: true } : { point: { ...e.world }, snapped: false };
  }

  onPointerDown(e: PointerInfo, ed: Editor): void {
    if (e.button === 2) {
      this.cancel(ed);
      return;
    }
    if (e.button !== 0) return;
    const r = this.resolve(e, ed);
    if (!this.start) {
      this.start = r.point;
      this.target = r.point;
    } else {
      if (Math.hypot(r.point.x - this.start.x, r.point.y - this.start.y) > 1) {
        ed.execute(new AddEntities([createDimension(this.start, r.point)]));
      }
      this.start = null;
      this.target = null;
      ed.setStatus("");
    }
    ed.markDirty();
  }

  onPointerMove(e: PointerInfo, ed: Editor): void {
    const r = this.resolve(e, ed);
    this.target = r.point;
    this.snapped = r.snapped;
    if (this.start) {
      const len = Math.hypot(r.point.x - this.start.x, r.point.y - this.start.y);
      ed.setStatus(`Dimension ${formatFeetInches(len)} — click to place, Esc to cancel`);
    } else {
      ed.setStatus("Click the first point of the dimension");
    }
    ed.markDirty();
  }

  onKeyDown(key: string, ed: Editor): void {
    if (key === "Escape") this.cancel(ed);
  }

  cancel(ed: Editor): void {
    this.start = null;
    this.target = null;
    ed.setStatus("");
    ed.markDirty();
  }

  drawOverlay(ctx: CanvasRenderingContext2D, ed: Editor): void {
    const vp = ed.viewport;
    if (this.start && this.target) {
      const ghost = createDimension(this.start, this.target);
      ctx.save();
      ctx.globalAlpha = 0.7;
      drawDimension(ctx, ghost, vp);
      ctx.restore();
    } else if (this.target) {
      const mid = worldToScreen(vp, this.target);
      drawPillLabel(ctx, { x: mid.x, y: mid.y - 16 }, "start");
    }
    if (this.snapped && this.target) {
      drawSnapMarker(ctx, worldToScreen(vp, this.target));
    }
  }
}
