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
import { createDocument, type Annotation, type Document, type Entity, type FloorInfo, type Furniture, type Opening, type Room } from "./model/types.ts";
import { allEndpoints, annotations, dimensions, extents, furniture, openings, rooms, walls } from "./model/document.ts";
import type { NamedPoint } from "./model/document.ts";
import { drawWall } from "./model/wall.ts";
import { drawRoom, pointInRoom } from "./model/room.ts";
import { drawFurniture, MIN_FURNITURE_SIZE } from "./model/furniture.ts";
import { drawOpening, findWall } from "./model/opening.ts";
import { drawDimension } from "./model/dimension.ts";
import { createAnnotation, drawAnnotation, hitTestAnnotation } from "./model/annotation.ts";
import { syncRooms } from "./rooms/sync.ts";
import { History } from "./history.ts";
import type { Command } from "./history.ts";
import { AddEntities, DeleteEntities, EditAnnotation, EditOpening, MirrorFurniture, RenameRoom, SetFurnitureTransform, TranslateEntities } from "./commands.ts";
import type { OpeningPatch } from "./commands.ts";
import type { PointerInfo, Tool } from "./tools/tool.ts";
import { PLAN_VERSION, type FloorData, type PlanData } from "./persistence/plan.ts";
import { SelectTool } from "./tools/select.ts";
import { DrawWallTool } from "./tools/drawWall.ts";
import { PlaceFurnitureTool } from "./tools/placeFurniture.ts";
import { PlaceOpeningTool } from "./tools/placeOpening.ts";
import { DimensionTool } from "./tools/drawDimension.ts";
import { AnnotationTool } from "./tools/placeAnnotation.ts";

/** A request from the annotation tool for the host to open a text editor. */
export type TextEditRequest = { id?: string; world: Point; text: string };

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
  /** Set by the host: open an inline text editor for a note. */
  onRequestText: (req: TextEditRequest) => void = () => {};

  constructor() {
    this.tools = {
      select: new SelectTool(),
      wall: new DrawWallTool(),
      place: new PlaceFurnitureTool(),
      opening: new PlaceOpeningTool(),
      dimension: new DimensionTool(),
      annotation: new AnnotationTool(),
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
  toScreen(world: Point): Point {
    return worldToScreen(this.viewport, world);
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

  /** Entities of every floor (active from doc.entities, others from stash). */
  private floorEntities(id: string): Entity[] {
    return id === this.doc.activeFloorId ? this.doc.entities : this.doc.stash[id] ?? [];
  }

  /** Serialize the current plan for storage (version 3, multi-floor). */
  serialize(): PlanData {
    const floors: FloorData[] = this.doc.floors.map((f) => ({
      id: f.id,
      name: f.name,
      entities: structuredClone(this.floorEntities(f.id)),
    }));
    return {
      version: PLAN_VERSION,
      units: "imperial",
      viewport: { ...this.viewport },
      floors,
      activeFloorId: this.doc.activeFloorId,
    };
  }

  /** Replace the current plan from stored data. Clears history & selection. */
  load(data: PlanData): void {
    this.doc = createDocument();

    // Normalize to the multi-floor form. Legacy v1/v2 saves have a single
    // `entities` array -> load as one "Ground floor".
    let floors: FloorData[];
    let activeId: string;
    if (data.floors && data.floors.length > 0) {
      floors = data.floors.map((f) => ({ id: f.id, name: f.name, entities: structuredClone(f.entities) }));
      activeId =
        data.activeFloorId && floors.some((f) => f.id === data.activeFloorId)
          ? data.activeFloorId
          : floors[0].id;
    } else {
      const id = this.doc.floors[0].id;
      floors = [{ id, name: "Ground floor", entities: structuredClone(data.entities ?? []) }];
      activeId = id;
    }

    this.doc.floors = floors.map((f) => ({ id: f.id, name: f.name }));
    this.doc.activeFloorId = activeId;
    this.doc.stash = {};
    for (const f of floors) {
      if (f.id === activeId) this.doc.entities = f.entities;
      else this.doc.stash[f.id] = f.entities;
    }

    const activeCount = this.doc.entities.length;
    if (activeCount > 0 && data.viewport && data.viewport.scale > 0) {
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

  // --- Room editing (rooms are derived from walls) -------------------------

  /** Wall ids of `room` that are also part of another room (a shared boundary). */
  private roomSharedWalls(room: Room): Set<string> {
    const mine = new Set(room.wallIds);
    const shared = new Set<string>();
    for (const r of rooms(this.doc)) {
      if (r.id === room.id) continue;
      for (const wid of r.wallIds) if (mine.has(wid)) shared.add(wid);
    }
    return shared;
  }

  /** A room can be moved rigidly only when it's standalone: no wall shared with
   *  another room, and no outside wall attached at any of its corners (moving
   *  would otherwise distort a neighbour or tear the loop open). */
  roomIsMovable(room: Room): boolean {
    if (this.roomSharedWalls(room).size > 0) return false;
    const mine = new Set(room.wallIds);
    const ws = walls(this.doc);
    const roomWalls = ws.filter((w) => mine.has(w.id));
    const outside = ws.filter((w) => !mine.has(w.id));
    const TOL = 0.75; // matches the loop-detector's endpoint merge tolerance
    for (const w of roomWalls) {
      for (const p of [w.a, w.b]) {
        for (const o of outside) {
          for (const q of [o.a, o.b]) {
            if (Math.hypot(p.x - q.x, p.y - q.y) <= TOL) return false;
          }
        }
      }
    }
    return true;
  }

  /** Snapshot a room's wall endpoints so a live drag can set absolute positions. */
  roomWallSnapshot(room: Room): Map<string, { a: Point; b: Point }> {
    const mine = new Set(room.wallIds);
    const snap = new Map<string, { a: Point; b: Point }>();
    for (const w of walls(this.doc)) {
      if (mine.has(w.id)) snap.set(w.id, { a: { ...w.a }, b: { ...w.b } });
    }
    return snap;
  }

  /** Live-move a room's walls to snapshot + delta and re-sync (no history). */
  dragRoom(snap: Map<string, { a: Point; b: Point }>, dx: number, dy: number): void {
    for (const e of this.doc.entities) {
      if (e.type !== "wall") continue;
      const s = snap.get(e.id);
      if (s) {
        e.a = { x: s.a.x + dx, y: s.a.y + dy };
        e.b = { x: s.b.x + dx, y: s.b.y + dy };
      }
    }
    this.refreshRooms();
    this.onDirty();
  }

  /** Commit a room move as one undo step. Restores the snapshot first so the
   *  command captures a clean before/after. */
  commitRoomMove(room: Room, snap: Map<string, { a: Point; b: Point }>, dx: number, dy: number): void {
    for (const e of this.doc.entities) {
      if (e.type !== "wall") continue;
      const s = snap.get(e.id);
      if (s) {
        e.a = { ...s.a };
        e.b = { ...s.b };
      }
    }
    if (dx === 0 && dy === 0) {
      this.refreshRooms();
      this.onDirty();
      return;
    }
    this.execute(new TranslateEntities([...snap.keys()], dx, dy));
  }

  /** Delete a room by removing its walls — but keep any wall shared with a
   *  neighbouring room so that neighbour survives. */
  deleteRoom(id: string): void {
    const room = this.doc.entities.find((e) => e.id === id);
    if (!room || room.type !== "room") return;
    const shared = this.roomSharedWalls(room);
    const ids = room.wallIds.filter((w) => !shared.has(w));
    if (ids.length === 0) return; // fully enclosed by neighbours; nothing safe to remove
    this.selection.clear();
    this.execute(new DeleteEntities(ids));
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

  // --- Annotations (text notes) -------------------------------------------

  /** Called by the annotation tool: ask the host to open a text editor for a
   * new note at `world`. */
  requestAnnotation(world: Point): void {
    this.onRequestText({ world: { ...world }, text: "" });
  }

  /** The topmost annotation hit at the given screen/world point, if any. */
  annotationAt(screen: Point): Annotation | null {
    const as = annotations(this.doc);
    for (let i = as.length - 1; i >= 0; i--) {
      if (hitTestAnnotation(as[i], screen, this.viewport)) return as[i];
    }
    return null;
  }

  /** Double-click on a note: ask the host to edit its text in place. */
  editAnnotationAt(screen: Point): boolean {
    const a = this.annotationAt(screen);
    if (!a) return false;
    this.onRequestText({ id: a.id, world: { ...a.position }, text: a.text });
    return true;
  }

  /** Commit a new note (no-op if blank). */
  addAnnotation(world: Point, text: string): void {
    const t = text.trim();
    if (!t) return;
    this.execute(new AddEntities([createAnnotation(world, t)]));
  }

  /** Commit an edit to an existing note; blank text deletes it. */
  setAnnotationText(id: string, text: string): void {
    const e = this.doc.entities.find((x) => x.id === id);
    if (!e || e.type !== "annotation") return;
    const t = text.trim();
    if (!t) {
      this.selection.delete(id);
      this.execute(new DeleteEntities([id]));
      return;
    }
    if (t === e.text) return;
    this.execute(new EditAnnotation(id, t));
  }

  // --- Floors --------------------------------------------------------------
  // Switching floors swaps the active entity array (stash model) and resets
  // history — undo does not cross floors (by design).

  get floors(): FloorInfo[] {
    return this.doc.floors;
  }
  get activeFloorId(): string {
    return this.doc.activeFloorId;
  }

  private resetTransient(): void {
    this.history = new History();
    this.selection = new Set();
    this.pending = null;
  }

  switchFloor(id: string): void {
    if (id === this.doc.activeFloorId || !this.doc.floors.some((f) => f.id === id)) return;
    this.doc.stash[this.doc.activeFloorId] = this.doc.entities;
    this.doc.entities = this.doc.stash[id] ?? [];
    delete this.doc.stash[id];
    this.doc.activeFloorId = id;
    this.resetTransient();
    syncRooms(this.doc);
    this._revision++;
    this.onChange();
    this.onDirty();
  }

  /** Add a new empty floor on top and switch to it. */
  addFloor(name?: string): void {
    const id = crypto.randomUUID();
    const n = name?.trim() || `Floor ${this.doc.floors.length + 1}`;
    this.doc.stash[this.doc.activeFloorId] = this.doc.entities;
    this.doc.floors.push({ id, name: n });
    this.doc.entities = [];
    this.doc.activeFloorId = id;
    this.resetTransient();
    syncRooms(this.doc);
    this._revision++;
    this.onChange();
    this.onDirty();
  }

  renameFloor(id: string, name: string): void {
    const t = name.trim();
    const f = this.doc.floors.find((x) => x.id === id);
    if (!f || !t || f.name === t) return;
    f.name = t;
    this._revision++;
    this.onChange();
    this.onDirty();
  }

  /** Delete a floor (min one floor stays). Deleting the active floor switches
   * to the one below it. */
  deleteFloor(id: string): void {
    if (this.doc.floors.length <= 1) return;
    const idx = this.doc.floors.findIndex((f) => f.id === id);
    if (idx < 0) return;
    const wasActive = id === this.doc.activeFloorId;
    this.doc.floors.splice(idx, 1);
    delete this.doc.stash[id];
    if (wasActive) {
      const next = this.doc.floors[Math.max(0, idx - 1)];
      this.doc.entities = this.doc.stash[next.id] ?? [];
      delete this.doc.stash[next.id];
      this.doc.activeFloorId = next.id;
      this.resetTransient();
      syncRooms(this.doc);
    }
    this._revision++;
    this.onChange();
    this.onDirty();
  }

  /** Move a floor up (+1) or down (-1) in the stack; affects underlay order. */
  moveFloor(id: string, dir: -1 | 1): void {
    const idx = this.doc.floors.findIndex((f) => f.id === id);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= this.doc.floors.length) return;
    const arr = this.doc.floors;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    this._revision++;
    this.onChange();
    this.onDirty();
  }

  /** Entities of the floor directly below the active one (ghost underlay). */
  private underlayEntities(): Entity[] | null {
    const idx = this.doc.floors.findIndex((f) => f.id === this.doc.activeFloorId);
    if (idx <= 0) return null;
    const below = this.doc.floors[idx - 1];
    return this.doc.stash[below.id] ?? [];
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

  /** Mirror the selected furniture horizontally (undoable). */
  mirrorSelectedFurniture(): void {
    const f = this.selectedFurniture;
    if (!f) return;
    this.execute(new MirrorFurniture(f.id));
  }

  /** Move a furniture block to an absolute new center (undoable). Used by the
   *  toolbar Move handle and arrow-key nudging. */
  moveFurniture(id: string, position: Point): void {
    const e = this.doc.entities.find((x) => x.id === id);
    if (!e || e.type !== "furniture") return;
    if (e.position.x === position.x && e.position.y === position.y) return;
    const before = { position: { ...e.position }, rotation: e.rotation, w: e.w, h: e.h };
    const after = { position: { ...position }, rotation: e.rotation, w: e.w, h: e.h };
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
    if (!mod && (e.key === "d" || e.key === "D")) {
      this.setTool("dimension");
      return true;
    }
    if (!mod && (e.key === "t" || e.key === "T")) {
      this.setTool("annotation");
      return true;
    }
    // Arrow keys nudge the selected furniture (1", or 10" with Shift).
    if (e.key.startsWith("Arrow")) {
      const f = this.selectedFurniture;
      if (f) {
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
        const dy = e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0;
        if (dx || dy) {
          this.moveFurniture(f.id, { x: f.position.x + dx, y: f.position.y + dy });
          return true;
        }
      }
    }
    this.tool.onKeyDown?.(e.key, this);
    return false;
  }

  // --- Rendering (single path) --------------------------------------------
  render(ctx: CanvasRenderingContext2D): void {
    this.renderScene(ctx, this.viewport, this.size, { chrome: true, grid: true, background: COLOR_BG });
  }

  /**
   * Render the plan into an arbitrary context/size (e.g. an offscreen canvas for
   * a dashboard thumbnail or a shareable export), fitting the whole plan and
   * omitting overlays/selection. `grid` and `background` let exports render a
   * clean, grid-free image on white.
   */
  renderThumbnail(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    dpr = 1,
    opts?: { grid?: boolean; background?: string },
  ): void {
    const vp = fitToBounds(extents(this.doc) ?? DEFAULT_BOUNDS, { width, height });
    this.renderScene(ctx, vp, { width, height, dpr }, {
      chrome: false,
      grid: opts?.grid ?? true,
      background: opts?.background ?? COLOR_BG,
    });
  }

  private renderScene(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    size: { width: number; height: number; dpr: number },
    opts: { chrome: boolean; grid: boolean; background: string },
  ): void {
    const { width, height, dpr } = size;
    const withChrome = opts.chrome;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, width, height);

    if (opts.grid) this.drawGrid(ctx, vp, size);

    // Ghost of the floor below (interactive view only), for cross-floor
    // alignment. Drawn faint, beneath the active floor's geometry.
    if (withChrome) {
      const below = this.underlayEntities();
      if (below) this.drawUnderlay(ctx, below, vp);
    }

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
    // Dimensions and text notes draw on top of the plan.
    for (const d of dimensions(this.doc)) {
      drawDimension(ctx, d, vp, { selected: sel(d.id) });
    }
    for (const a of annotations(this.doc)) {
      drawAnnotation(ctx, a, vp, { selected: sel(a.id) });
    }

    // Overlays: in-progress entity, snap markers, guides (interactive only).
    if (withChrome) this.tool.drawOverlay?.(ctx, this);

    ctx.restore();
  }

  /** Faint outline of the floor below: wall segments only, no fills or labels. */
  private drawUnderlay(ctx: CanvasRenderingContext2D, entities: Entity[], vp: Viewport): void {
    ctx.save();
    ctx.strokeStyle = "rgba(120,113,108,0.28)"; // stone-500 @ ~28%
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    for (const e of entities) {
      if (e.type !== "wall") continue;
      const a = worldToScreen(vp, e.a);
      const b = worldToScreen(vp, e.b);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
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
