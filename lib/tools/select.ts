// Select/drag tool. Handles walls (click-select, drag-move with endpoint join),
// rooms (click-select), and furniture (click-select, drag-move with wall/align
// snapping, plus rotate and resize grips). One clean, undoable command is
// committed on drop. ESC clears the selection.

import { worldToScreen, type Point } from "../viewport.ts";
import { EditOpening, SetFurnitureTransform, TranslateEntities } from "../commands.ts";
import type { FurnitureTransform } from "../commands.ts";
import { openings, rooms, walls } from "../model/document.ts";
import { hitTestWall } from "../model/wall.ts";
import { pointInRoom } from "../model/room.ts";
import { clampOffset, findWall, hitTestOpening, projectOffset } from "../model/opening.ts";
import type { Opening } from "../model/types.ts";
import {
  corners,
  furnitureHandles,
  hitTestFurniture,
  localToWorld,
  MIN_FURNITURE_SIZE,
  worldToLocal,
} from "../model/furniture.ts";
import { snapFurnitureMove, type Guide } from "../furniture/snap.ts";
import { nearestEndpoint } from "../snap.ts";
import type { Furniture, Wall } from "../model/types.ts";
import { drawSnapMarker } from "../render/overlay.ts";
import type { Editor } from "../editor.ts";
import type { PointerInfo, Tool } from "./tool.ts";

const HANDLE_HIT_PX = 9;
const ROTATE_STEP = (15 * Math.PI) / 180;

type WallDrag = {
  mode: "wall";
  origin: Point;
  ids: string[];
  originals: Map<string, { a: Point; b: Point }>;
  moved: boolean;
  joinScreen: Point | null;
};

type FurnDrag = {
  mode: "furn-move" | "furn-rotate" | "furn-resize";
  origin: Point;
  id: string;
  before: FurnitureTransform;
  corner?: number; // for resize: index of dragged corner
  fixedWorld?: Point; // for resize: opposite corner (kept fixed)
  moved: boolean;
  guides: Guide[];
};

type OpeningDrag = {
  mode: "opening-move";
  id: string;
  beforeOffset: number;
  moved: boolean;
};

type Drag = WallDrag | FurnDrag | OpeningDrag;

function tf(f: Furniture): FurnitureTransform {
  return { position: { ...f.position }, rotation: f.rotation, w: f.w, h: f.h };
}

export class SelectTool implements Tool {
  readonly name = "select";
  private drag: Drag | null = null;

  cursor(ed: Editor): string {
    if (this.drag?.mode === "furn-rotate") return "grabbing";
    if (this.drag && "moved" in this.drag && this.drag.moved) return "grabbing";
    return ed.selection.size > 0 ? "grab" : "default";
  }

  private selectedFurniture(ed: Editor): Furniture | null {
    if (ed.selection.size !== 1) return null;
    const id = [...ed.selection][0];
    const e = ed.doc.entities.find((x) => x.id === id);
    return e && e.type === "furniture" ? e : null;
  }

  private topFurnitureAt(ed: Editor, p: Point): Furniture | null {
    const fs = ed.doc.entities.filter((e): e is Furniture => e.type === "furniture");
    for (let i = fs.length - 1; i >= 0; i--) if (hitTestFurniture(fs[i], p, 0)) return fs[i];
    return null;
  }

  private topWallAt(ed: Editor, p: Point): Wall | null {
    const tol = ed.snapThresholdWorld();
    const ws = walls(ed.doc);
    for (let i = ws.length - 1; i >= 0; i--) if (hitTestWall(ws[i], p, tol)) return ws[i];
    return null;
  }

  private topOpeningAt(ed: Editor, p: Point): Opening | null {
    const tol = ed.snapThresholdWorld();
    const ops = openings(ed.doc);
    for (let i = ops.length - 1; i >= 0; i--) {
      const wall = findWall(ed.doc, ops[i].wallId);
      if (wall && hitTestOpening(ops[i], wall, p, tol)) return ops[i];
    }
    return null;
  }

  onPointerDown(e: PointerInfo, ed: Editor): void {
    if (e.button !== 0) return;

    // 1. Grips of the currently-selected furniture take priority.
    const sel = this.selectedFurniture(ed);
    if (sel) {
      const h = furnitureHandles(sel, ed.viewport);
      if (dist(e.screen, h.rotate) <= HANDLE_HIT_PX) {
        this.drag = { mode: "furn-rotate", origin: e.world, id: sel.id, before: tf(sel), moved: false, guides: [] };
        return;
      }
      for (let i = 0; i < h.corners.length; i++) {
        if (dist(e.screen, h.corners[i]) <= HANDLE_HIT_PX) {
          const opp = corners(sel)[(i + 2) % 4];
          this.drag = {
            mode: "furn-resize",
            origin: e.world,
            id: sel.id,
            before: tf(sel),
            corner: i,
            fixedWorld: opp,
            moved: false,
            guides: [],
          };
          return;
        }
      }
    }

    // 2. Furniture under cursor -> select + move.
    const furn = this.topFurnitureAt(ed, e.world);
    if (furn) {
      if (!ed.selection.has(furn.id)) ed.setSelection([furn.id]);
      this.drag = { mode: "furn-move", origin: e.world, id: furn.id, before: tf(furn), moved: false, guides: [] };
      ed.markDirty();
      return;
    }

    // 3. Door/window under cursor -> select + slide along its wall.
    const opening = this.topOpeningAt(ed, e.world);
    if (opening) {
      if (!ed.selection.has(opening.id)) ed.setSelection([opening.id]);
      this.drag = { mode: "opening-move", id: opening.id, beforeOffset: opening.offset, moved: false };
      ed.markDirty();
      return;
    }

    // 4. Wall under cursor -> select + move (with endpoint join).
    const wall = this.topWallAt(ed, e.world);
    if (wall) {
      if (!ed.selection.has(wall.id)) ed.setSelection([wall.id]);
      const ids = [...ed.selection].filter((id) => {
        const en = ed.doc.entities.find((x) => x.id === id);
        return en?.type === "wall";
      });
      const originals = new Map<string, { a: Point; b: Point }>();
      for (const w of walls(ed.doc)) if (ids.includes(w.id)) originals.set(w.id, { a: { ...w.a }, b: { ...w.b } });
      this.drag = { mode: "wall", origin: e.world, ids, originals, moved: false, joinScreen: null };
      ed.markDirty();
      return;
    }

    // 4. Room under cursor -> select (not draggable).
    const rs = rooms(ed.doc);
    for (let i = rs.length - 1; i >= 0; i--) {
      if (pointInRoom(rs[i], e.world)) {
        ed.setSelection([rs[i].id]);
        ed.markDirty();
        return;
      }
    }

    ed.setSelection([]);
    ed.markDirty();
  }

  onPointerMove(e: PointerInfo, ed: Editor): void {
    const d = this.drag;
    if (!d) return;

    if (d.mode === "wall") {
      this.moveWalls(d, e, ed);
      return;
    }

    if (d.mode === "opening-move") {
      const op = ed.doc.entities.find((x) => x.id === d.id);
      if (op && (op.type === "door" || op.type === "window")) {
        const wall = findWall(ed.doc, op.wallId);
        if (wall) {
          d.moved = true;
          op.offset = clampOffset(wall, op.width, projectOffset(wall, e.world));
          ed.markDirty();
        }
      }
      return;
    }

    const f = ed.doc.entities.find((x) => x.id === d.id);
    if (!f || f.type !== "furniture") return;
    d.moved = true;

    if (d.mode === "furn-move") {
      const proposed = {
        x: d.before.position.x + (e.world.x - d.origin.x),
        y: d.before.position.y + (e.world.y - d.origin.y),
      };
      const s = snapFurnitureMove(proposed, { ...f, ...d.before }, ed.doc, ed.snapThresholdWorld(), e.shiftKey);
      f.position = s.position;
      f.rotation = s.rotation;
      d.guides = s.guides;
    } else if (d.mode === "furn-rotate") {
      const ang = Math.atan2(e.world.y - f.position.y, e.world.x - f.position.x);
      let rot = ang + Math.PI / 2; // grip sits at local -Y (top)
      if (!e.shiftKey) rot = Math.round(rot / ROTATE_STEP) * ROTATE_STEP;
      f.rotation = rot;
    } else if (d.mode === "furn-resize" && d.fixedWorld) {
      const R = d.before.rotation;
      const local = worldToLocal({ ...f, position: d.fixedWorld, rotation: R } as Furniture, e.world);
      let w = Math.abs(local.x);
      let h = Math.abs(local.y);
      if (!e.shiftKey) {
        w = Math.round(w);
        h = Math.round(h);
      }
      w = Math.max(MIN_FURNITURE_SIZE, w);
      h = Math.max(MIN_FURNITURE_SIZE, h);
      // New center = fixed corner + half the (signed) local diagonal, back to world.
      const sgnx = Math.sign(local.x) || 1;
      const sgny = Math.sign(local.y) || 1;
      const centerLocal = { x: (sgnx * w) / 2, y: (sgny * h) / 2 };
      const centerWorld = localToWorld(
        { ...f, position: d.fixedWorld, rotation: R } as Furniture,
        centerLocal,
      );
      f.w = w;
      f.h = h;
      f.position = centerWorld;
    }
    ed.markDirty();
  }

  private moveWalls(d: WallDrag, e: PointerInfo, ed: Editor): void {
    let dx = e.world.x - d.origin.x;
    let dy = e.world.y - d.origin.y;
    if (!d.moved && Math.hypot(dx, dy) < ed.snapThresholdWorld() * 0.5) return;
    d.moved = true;

    d.joinScreen = null;
    const others = ed.endpoints().filter((c) => !ed.selection.has(c.ownerId));
    let bestDist = ed.snapThresholdWorld();
    let adjust: { ax: number; ay: number; at: Point } | null = null;
    for (const id of d.ids) {
      const orig = d.originals.get(id);
      if (!orig) continue;
      for (const base of [orig.a, orig.b]) {
        const moved = { x: base.x + dx, y: base.y + dy };
        const near = nearestEndpoint(moved, others, bestDist);
        if (near) {
          bestDist = Math.hypot(near.point.x - moved.x, near.point.y - moved.y);
          adjust = { ax: near.point.x - moved.x, ay: near.point.y - moved.y, at: near.point };
        }
      }
    }
    if (adjust) {
      dx += adjust.ax;
      dy += adjust.ay;
      d.joinScreen = worldToScreen(ed.viewport, adjust.at);
    }
    for (const w of walls(ed.doc)) {
      const orig = d.originals.get(w.id);
      if (!orig) continue;
      w.a = { x: orig.a.x + dx, y: orig.a.y + dy };
      w.b = { x: orig.b.x + dx, y: orig.b.y + dy };
    }
    ed.markDirty();
  }

  onPointerUp(_e: PointerInfo, ed: Editor): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;

    if (d.mode === "opening-move") {
      if (!d.moved) {
        ed.markDirty();
        return;
      }
      const op = ed.doc.entities.find((x) => x.id === d.id);
      if (op && (op.type === "door" || op.type === "window")) {
        const after = op.offset;
        op.offset = d.beforeOffset; // restore, then commit one clean command
        if (Math.abs(after - d.beforeOffset) > 1e-6) ed.execute(new EditOpening(d.id, { offset: after }));
      }
      ed.markDirty();
      return;
    }

    if (d.mode === "wall") {
      if (!d.moved) {
        ed.markDirty();
        return;
      }
      let dx = 0;
      let dy = 0;
      for (const w of walls(ed.doc)) {
        const orig = d.originals.get(w.id);
        if (orig) {
          dx = w.a.x - orig.a.x;
          dy = w.a.y - orig.a.y;
          break;
        }
      }
      for (const w of walls(ed.doc)) {
        const orig = d.originals.get(w.id);
        if (orig) {
          w.a = { ...orig.a };
          w.b = { ...orig.b };
        }
      }
      if (Math.hypot(dx, dy) > 1e-6) ed.execute(new TranslateEntities(d.ids, dx, dy));
      ed.markDirty();
      return;
    }

    // Furniture: commit one clean transform command.
    if (!d.moved) {
      ed.markDirty();
      return;
    }
    const f = ed.doc.entities.find((x) => x.id === d.id);
    if (f && f.type === "furniture") {
      const after = tf(f);
      // Restore, then execute so do()/undo() are clean.
      f.position = { ...d.before.position };
      f.rotation = d.before.rotation;
      f.w = d.before.w;
      f.h = d.before.h;
      ed.execute(new SetFurnitureTransform(d.id, after, d.before));
    }
    ed.markDirty();
  }

  onKeyDown(key: string, ed: Editor): void {
    if (key === "Escape") {
      ed.setSelection([]);
      ed.markDirty();
    }
  }

  cancel(ed: Editor): void {
    this.drag = null;
    ed.setSelection([]);
  }

  drawOverlay(ctx: CanvasRenderingContext2D, ed: Editor): void {
    // Wall join marker.
    if (this.drag?.mode === "wall" && this.drag.joinScreen) drawSnapMarker(ctx, this.drag.joinScreen);

    // Alignment guides during a furniture move.
    if (this.drag && "guides" in this.drag && this.drag.guides.length) {
      ctx.save();
      ctx.strokeStyle = "#f43f5e"; // rose-500
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      for (const g of this.drag.guides) {
        ctx.beginPath();
        if (g.axis === "x") {
          const s = worldToScreen(ed.viewport, { x: g.at, y: 0 });
          ctx.moveTo(s.x, 0);
          ctx.lineTo(s.x, ed.sizeInfo.height);
        } else {
          const s = worldToScreen(ed.viewport, { x: 0, y: g.at });
          ctx.moveTo(0, s.y);
          ctx.lineTo(ed.sizeInfo.width, s.y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    // Rotate/resize grips for a single selected furniture (not while dragging
    // a different mode).
    const sel = this.selectedFurniture(ed);
    if (sel) {
      const h = furnitureHandles(sel, ed.viewport);
      ctx.save();
      // Line from top edge to rotate grip.
      const topMid = { x: (h.corners[0].x + h.corners[1].x) / 2, y: (h.corners[0].y + h.corners[1].y) / 2 };
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(topMid.x, topMid.y);
      ctx.lineTo(h.rotate.x, h.rotate.y);
      ctx.stroke();
      // Corner squares.
      for (const c of h.corners) {
        ctx.beginPath();
        ctx.rect(c.x - 3.5, c.y - 3.5, 7, 7);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.strokeStyle = "#2563eb";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      // Rotate grip circle.
      ctx.beginPath();
      ctx.arc(h.rotate.x, h.rotate.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
  }
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
