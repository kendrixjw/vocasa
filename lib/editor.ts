// The controller/engine. Owns the document, history, viewport, active tool,
// selection, and the single render() path. Framework-agnostic: the React shell
// forwards input and reads state through the change listener.

import {
  fitToBounds,
  pan as panViewport,
  screenToWorld,
  worldToScreen,
  zoomAt,
  type Bounds,
  type Point,
  type Viewport,
} from "./viewport.ts";
import { pickGridSpacing } from "./grid.ts";
import { createDocument, type Document, type Furniture, type Opening, type Room } from "./model/types.ts";
import { allEndpoints, extents, furniture, openings, rooms, walls } from "./model/document.ts";
import type { NamedPoint } from "./model/document.ts";
import { drawWall } from "./model/wall.ts";
import { drawRoom, pointInRoom } from "./model/room.ts";
import { drawFurniture, MIN_FURNITURE_SIZE } from "./model/furniture.ts";
import { drawOpening, findWall } from "./model/opening.ts";
import { syncRooms } from "./rooms/sync.ts";
import { History } from "./history.ts";
import type { Command } from "./history.ts";
import { DeleteEntities, EditOpening, RenameRoom, SetFurnitureTransform } from "./commands.ts";
import type { OpeningPatch } from "./commands.ts";
import type { PointerInfo, Tool } from "./tools/tool.ts";
import { PLAN_VERSION, type PlanData } from "./persistence/plan.ts";
import { SelectTool } from "./tools/select.ts";
import { DrawWallTool } from "./tools/drawWall.ts";
import { PlaceFurnitureTool } from "./tools/placeFurniture.ts";
import { PlaceOpeningTool } from "./tools/placeOpening.ts";

// Framing used by fit-to-extents when the document is empty (40ft x 30ft).
const DEFAULT_BOUNDS: Bounds = { minX: 0, minY: 0, maxX: 480, maxY: 360 };

const COLOR_BG = "#fafaf9";
const COLOR_MINOR = "#e7e5e4";
const COLOR_MAJOR = "#d6d3d1";
const COLOR_AXIS = "#a8a29e";

const SNAP_PX = 10; // snap threshold in screen pixels

export class Editor {
  doc: Document = createDocument();
  viewport: Viewport = { originX: 0, originY: 0, scale: 1 };
  selection = new Set<string>();

  private history = new History();
  private tools: Record<string, Tool>;
  private activeToolName = "select";
  private size = { width: 0, height: 0, dpr: 1 };
  private fitted = false;
  private status = "";

  /** Set by the host: schedule a redraw. */
  onDirty: () => void = () => {};
  /** Set by the host: structural change (tool/selection/history/status). */
  onChange: () => void = () => {};

  constructor() {
    this.tools = {
      select: new SelectTool(),
      wall: new DrawWallTool(),
      place: new PlaceFurnitureTool(),
      opening: new PlaceOpeningTool(),
    };
  }

  // --- Accessors used by tools & host -------------------------------------
  get tool(): Tool {
    return this.tools[this.activeToolName];
  }
  get activeTool(): string {
    return this.activeToolName;
  }
  get statusText(): string {
    return this.status;
  }
  get canUndo(): boolean {
    return this.history.canUndo;
  }
  get canRedo(): boolean {
    return this.history.canRedo;
  }
  get cursor(): string {
    return this.tool.cursor(this);
  }

  markDirty(): void {
    this.onDirty();
  }
  setStatus(text: string): void {
    if (text !== this.status) {
      this.status = text;
      this.onChange();
    }
  }
  setSelection(ids: string[]): void {
    this.selection = new Set(ids);
    this.onChange();
  }
  endpoints(): NamedPoint[] {
    return allEndpoints(this.doc);
  }
  snapThresholdWorld(): number {
    return SNAP_PX / this.viewport.scale;
  }
  toWorld(screen: Point): Point {
    return screenToWorld(this.viewport, screen);
  }

  /** World point used as the "cursor" for typed/voice AI commands: viewport center. */
  get aiCursor(): Point {
    return screenToWorld(this.viewport, { x: this.size.width / 2, y: this.size.height / 2 });
  }
  /** Current selection as an id array (for AI ref resolution). */
  get selectionIds(): string[] {
    return [...this.selection];
  }

  // Bumps on every content mutation; the persistence layer watches it for autosave.
  private _revision = 0;
  get revision(): number {
    return this._revision;
  }

  /** Rooms are derived from walls; recompute them after any change. */
  private refreshRooms(): void {
    syncRooms(this.doc);
    this._revision++;
  }

  /** World bounds of the drawn content (falls back to default framing when empty). */
  get contentBounds(): Bounds {
    return extents(this.doc) ?? DEFAULT_BOUNDS;
  }

  /** Serialize the current plan for storage (version 1). */
  serialize(): PlanData {
    return {
      version: PLAN_VERSION,
      units: "imperial",
      entities: structuredClone(this.doc.entities),
      viewport: { ...this.viewport },
    };
  }

  /** Replace the current plan from stored data. Clears history & selection. */
  load(data: PlanData): void {
    this.doc = createDocument();
    this.doc.entities = structuredClone(data.entities);
    // Adopt the saved viewport for non-empty plans; a fresh/empty plan fits to
    // the default framing on first resize instead.
    if (data.entities.length > 0 && data.viewport && data.viewport.scale > 0) {
      this.viewport = { ...data.viewport };
      this.fitted = true;
    } else {
      this.fitted = false;
    }
    this.history = new History();
    this.selection = new Set();
    this.pending = null;
    syncRooms(this.doc);
    this._revision++;
    this.onChange();
    this.onDirty();
  }

  execute(cmd: Command): void {
    if (this.pending) this.rejectPreview();
    this.history.execute(this.doc, cmd);
    this.refreshRooms();
    this.onChange();
    this.onDirty();
  }

  // --- Design-assist preview: apply live so it renders, but keep it OUT of
  // history until the user accepts. Reject reverts it. Never auto-commits.
  private pending: Command | null = null;

  get hasPreview(): boolean {
    return this.pending !== null;
  }

  previewCommand(cmd: Command): void {
    if (this.pending) this.rejectPreview();
    cmd.do(this.doc);
    this.pending = cmd;
    this.refreshRooms();
    this.pruneSelection();
    this.onChange();
    this.onDirty();
  }

  acceptPreview(): void {
    if (!this.pending) return;
    this.history.record(this.pending);
    this.pending = null;
    this._revision++;
    this.onChange();
    this.onDirty();
  }

  rejectPreview(): void {
    if (!this.pending) return;
    this.pending.undo(this.doc);
    this.pending = null;
    this.refreshRooms();
    this.pruneSelection();
    this.onChange();
    this.onDirty();
  }

  undo(): void {
    if (this.pending) this.rejectPreview();
    if (this.history.undo(this.doc)) {
      this.refreshRooms();
      this.pruneSelection();
      this.onChange();
      this.onDirty();
    }
  }
  redo(): void {
    if (this.history.redo(this.doc)) {
      this.refreshRooms();
      this.pruneSelection();
      this.onChange();
      this.onDirty();
    }
  }

  renameRoom(id: string, name: string): void {
    const trimmed = name.trim();
    const room = this.doc.entities.find((e) => e.id === id);
    if (!trimmed || !room || room.type !== "room" || room.name === trimmed) return;
    this.execute(new RenameRoom(id, trimmed));
  }

  /** The topmost room containing world point `p`, if any (for the status bar). */
  roomAt(p: Point): Room | null {
    const rs = rooms(this.doc);
    for (let i = rs.length - 1; i >= 0; i--) if (pointInRoom(rs[i], p)) return rs[i];
    return null;
  }

  /** The single selected room, if exactly one room is selected (for the panel). */
  get selectedRoom(): Room | null {
    if (this.selection.size !== 1) return null;
    const id = [...this.selection][0];
    const e = this.doc.entities.find((x) => x.id === id);
    return e && e.type === "room" ? e : null;
  }

  /** The single selected furniture block, if any (for the panel). */
  get selectedFurniture(): Furniture | null {
    if (this.selection.size !== 1) return null;
    const id = [...this.selection][0];
    const e = this.doc.entities.find((x) => x.id === id);
    return e && e.type === "furniture" ? e : null;
  }

  /** Arm the place-furniture tool with `kind` (called from the palette). */
  placeFurniture(kind: string): void {
    const tool = this.tools.place as PlaceFurnitureTool;
    tool.setKind(kind);
    this.setTool("place");
  }

  /** Arm the place-opening tool for a door or window. */
  placeOpening(kind: "door" | "window"): void {
    const tool = this.tools.opening as PlaceOpeningTool;
    tool.setKind(kind);
    this.setTool("opening");
  }

  /** The single selected door/window, if any (for the panel). */
  get selectedOpening(): Opening | null {
    if (this.selection.size !== 1) return null;
    const id = [...this.selection][0];
    const e = this.doc.entities.find((x) => x.id === id);
    return e && (e.type === "door" || e.type === "window") ? e : null;
  }

  editOpening(id: string, patch: OpeningPatch): void {
    const e = this.doc.entities.find((x) => x.id === id);
    if (!e || (e.type !== "door" && e.type !== "window")) return;
    this.execute(new EditOpening(id, patch));
  }

  /** Panel edit: set a furniture block's size and/or rotation (undoable). */
  editFurniture(id: string, patch: { w?: number; h?: number; rotationDeg?: number }): void {
    const e = this.doc.entities.find((x) => x.id === id);
    if (!e || e.type !== "furniture") return;
    const before = { position: { ...e.position }, rotation: e.rotation, w: e.w, h: e.h };
    const after = {
      position: { ...e.position },
      rotation: patch.rotationDeg != null ? (patch.rotationDeg * Math.PI) / 180 : e.rotation,
      w: patch.w != null ? Math.max(MIN_FURNITURE_SIZE, patch.w) : e.w,
      h: patch.h != null ? Math.max(MIN_FURNITURE_SIZE, patch.h) : e.h,
    };
    if (after.w === before.w && after.h === before.h && after.rotation === before.rotation) return;
    this.execute(new SetFurnitureTransform(id, after, before));
  }

  private pruneSelection(): void {
    const alive = new Set(this.doc.entities.map((e) => e.id));
    for (const id of [...this.selection]) if (!alive.has(id)) this.selection.delete(id);
  }

  deleteSelection(): void {
    // Rooms are derived — you delete a room by deleting its walls, not the
    // room itself. Only delete real geometry (walls).
    const ids = [...this.selection].filter((id) => {
      const e = this.doc.entities.find((x) => x.id === id);
      return e && e.type !== "room";
    });
    if (ids.length === 0) return;
    this.selection.clear();
    this.execute(new DeleteEntities(ids));
  }

  setTool(name: string): void {
    if (name === this.activeToolName || !this.tools[name]) return;
    this.tool.cancel?.(this);
    this.activeToolName = name;
    this.status = "";
    this.onChange();
    this.onDirty();
  }

  // --- Viewport ops -------------------------------------------------------
  setSize(width: number, height: number, dpr: number): void {
    this.size = { width, height, dpr };
    if (!this.fitted && width > 0 && height > 0) {
      this.viewport = fitToBounds(DEFAULT_BOUNDS, { width, height });
      this.fitted = true;
      this.onChange();
    }
    this.onDirty();
  }
  get sizeInfo(): { width: number; height: number; dpr: number } {
    return this.size;
  }

  pan(dx: number, dy: number): void {
    this.viewport = panViewport(this.viewport, dx, dy);
    this.onDirty();
  }
  zoom(anchor: Point, factor: number): void {
    this.viewport = zoomAt(this.viewport, anchor, factor);
    this.onChange(); // zoom % HUD
    this.onDirty();
  }
  fit(): void {
    const { width, height } = this.size;
    if (width === 0 || height === 0) return;
    this.viewport = fitToBounds(extents(this.doc) ?? DEFAULT_BOUNDS, { width, height });
    this.onChange();
    this.onDirty();
  }

  // --- Input routing ------------------------------------------------------
  pointerDown(e: PointerInfo): void {
    this.tool.onPointerDown?.(e, this);
  }
  pointerMove(e: PointerInfo): void {
    this.tool.onPointerMove?.(e, this);
  }
  pointerUp(e: PointerInfo): void {
    this.tool.onPointerUp?.(e, this);
  }

  /** Returns true if the key was handled (host should not also act on it). */
  keyDown(e: KeyboardEvent): boolean {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") {
      if (e.shiftKey) this.redo();
      else this.undo();
      return true;
    }
    if (mod && e.key.toLowerCase() === "y") {
      this.redo();
      return true;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      this.deleteSelection();
      return true;
    }
    if (e.key === "Escape") {
      this.tool.onKeyDown?.("Escape", this);
      if (this.activeToolName !== "select") this.setTool("select");
      return true;
    }
    if (!mod && (e.key === "v" || e.key === "V")) {
      this.setTool("select");
      return true;
    }
    if (!mod && (e.key === "w" || e.key === "W")) {
      this.setTool("wall");
      return true;
    }
    this.tool.onKeyDown?.(e.key, this);
    return false;
  }

  // --- Rendering (single path) --------------------------------------------
  render(ctx: CanvasRenderingContext2D): void {
    this.renderScene(ctx, this.viewport, this.size, true);
  }

  /**
   * Render the plan into an arbitrary context/size (e.g. an offscreen canvas for
   * a dashboard thumbnail), fitting the whole plan and omitting overlays/selection.
   */
  renderThumbnail(ctx: CanvasRenderingContext2D, width: number, height: number, dpr = 1): void {
    const vp = fitToBounds(extents(this.doc) ?? DEFAULT_BOUNDS, { width, height });
    this.renderScene(ctx, vp, { width, height, dpr }, false);
  }

  private renderScene(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    size: { width: number; height: number; dpr: number },
    withChrome: boolean,
  ): void {
    const { width, height, dpr } = size;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, width, height);

    this.drawGrid(ctx, vp, size);

    // Render order (per spec): rooms (filled tint + name + sqft) behind walls,
    // then walls, then later phases' doors/windows/furniture/labels.
    const sel = (id: string) => withChrome && this.selection.has(id);
    for (const r of rooms(this.doc)) {
      drawRoom(ctx, r, vp, { selected: sel(r.id) });
    }
    for (const w of walls(this.doc)) {
      drawWall(ctx, w, vp, { selected: sel(w.id) });
    }
    // Doors/windows sit in the wall band, drawn after walls, before furniture.
    for (const op of openings(this.doc)) {
      const wall = findWall(this.doc, op.wallId);
      if (wall) drawOpening(ctx, op, wall, vp, { selected: sel(op.id) });
    }
    for (const f of furniture(this.doc)) {
      drawFurniture(ctx, f, vp, { selected: sel(f.id) });
    }

    // Overlays: in-progress entity, snap markers, guides (interactive only).
    if (withChrome) this.tool.drawOverlay?.(ctx, this);

    ctx.restore();
  }

  private drawGrid(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    size: { width: number; height: number },
  ): void {
    const { width, height } = size;
    const tl = screenToWorld(vp, { x: 0, y: 0 });
    const br = screenToWorld(vp, { x: width, y: height });
    const minX = Math.min(tl.x, br.x);
    const maxX = Math.max(tl.x, br.x);
    const minY = Math.min(tl.y, br.y);
    const maxY = Math.max(tl.y, br.y);
    const { minor, major } = pickGridSpacing(vp.scale);

    const lines = (step: number, color: string, lw: number) => {
      ctx.beginPath();
      for (let wx = Math.floor(minX / step) * step; wx <= maxX; wx += step) {
        const a = worldToScreen(vp, { x: wx, y: minY });
        const b = worldToScreen(vp, { x: wx, y: maxY });
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      for (let wy = Math.floor(minY / step) * step; wy <= maxY; wy += step) {
        const a = worldToScreen(vp, { x: minX, y: wy });
        const b = worldToScreen(vp, { x: maxX, y: wy });
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.stroke();
    };

    lines(minor, COLOR_MINOR, 1);
    lines(major, COLOR_MAJOR, 1);

    // World axes emphasized.
    ctx.beginPath();
    const ya = worldToScreen(vp, { x: 0, y: minY });
    const yb = worldToScreen(vp, { x: 0, y: maxY });
    ctx.moveTo(ya.x, ya.y);
    ctx.lineTo(yb.x, yb.y);
    const xa = worldToScreen(vp, { x: minX, y: 0 });
    const xb = worldToScreen(vp, { x: maxX, y: 0 });
    ctx.moveTo(xa.x, xa.y);
    ctx.lineTo(xb.x, xb.y);
    ctx.strokeStyle = COLOR_AXIS;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}
