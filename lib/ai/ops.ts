// The AI op vocabulary. The model emits ONLY a JSON array of these ops (never
// coordinates it computed itself, never images). Our resolver turns symbolic
// anchors/refs into concrete geometry. AI output is UNTRUSTED: validate against
// this schema, clamp sizes, never eval.

export type DoorSwing = "in" | "out" | "left" | "right";
export type Side = "north" | "south" | "east" | "west";
export type Along = "center" | "left" | "right" | number;

export type Anchor =
  | { at: "cursor" }
  | { room: string; against: Side | "center" }
  | { corner: "northeast" | "northwest" | "southeast" | "southwest"; room?: string }
  | { nextTo: Ref; side: "left" | "right" | "above" | "below" }
  | { x: number; y: number };

export type Ref =
  | { id: string }
  | { kind: string; room?: string }
  | { selection: true }
  | { last: true }
  | { wallOf: string; side: Side };

export type PointOrAnchor = { x: number; y: number } | Anchor;

export type Op =
  | { op: "createRoom"; name: string; width: number; height: number; anchor?: Anchor }
  | { op: "addWall"; from: PointOrAnchor; to: PointOrAnchor; thickness?: number }
  | { op: "addDoor"; wall: Ref; width?: number; along?: Along; swing?: DoorSwing }
  | { op: "addWindow"; wall: Ref; width?: number; along?: Along }
  | { op: "placeFurniture"; kind: string; anchor: Anchor; rotation?: number; width?: number; height?: number }
  | { op: "move"; target: Ref; to: Anchor }
  | { op: "resize"; target: Ref; width?: number; height?: number }
  | { op: "rotate"; target: Ref; degrees: number }
  | { op: "delete"; target: Ref }
  | { op: "rename"; target: Ref; name: string }
  | { op: "clarify"; question: string };

// Sane clamp ranges (inches / degrees).
export const LIMITS = {
  roomMin: 24,
  roomMax: 1200,
  furnMin: 6,
  furnMax: 600,
  openingMin: 12,
  openingMax: 120,
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

const SIDES = new Set(["north", "south", "east", "west"]);
const SWINGS = new Set(["in", "out", "left", "right"]);

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isAnchor(a: unknown): a is Anchor {
  if (!a || typeof a !== "object") return false;
  const o = a as Record<string, unknown>;
  if (o.at === "cursor") return true;
  if (typeof o.room === "string" && (o.against === "center" || SIDES.has(o.against as string))) return true;
  if (typeof o.corner === "string") return true;
  if (o.nextTo && (o.side === "left" || o.side === "right" || o.side === "above" || o.side === "below"))
    return isRef(o.nextTo);
  if (isNum(o.x) && isNum(o.y)) return true;
  return false;
}

function isRef(r: unknown): r is Ref {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  if (typeof o.id === "string") return true;
  if (typeof o.kind === "string") return true;
  if (o.selection === true) return true;
  if (o.last === true) return true;
  if (typeof o.wallOf === "string" && SIDES.has(o.side as string)) return true;
  return false;
}

function isPointOrAnchor(p: unknown): p is PointOrAnchor {
  if (p && typeof p === "object") {
    const o = p as Record<string, unknown>;
    if (isNum(o.x) && isNum(o.y)) return true;
  }
  return isAnchor(p);
}

export type ValidationResult = { ok: true; ops: Op[] } | { ok: false; error: string };

/**
 * Validate + clamp a raw parsed value into a well-formed op array. Anything
 * off-schema is rejected (the caller then asks the user to rephrase).
 */
export function validateOps(raw: unknown): ValidationResult {
  if (!Array.isArray(raw)) return { ok: false, error: "Expected a JSON array of operations." };
  const ops: Op[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return { ok: false, error: "Operation must be an object." };
    const o = item as Record<string, unknown>;
    switch (o.op) {
      case "createRoom":
        if (typeof o.name !== "string" || !isNum(o.width) || !isNum(o.height))
          return { ok: false, error: "createRoom needs name, width, height." };
        if (o.anchor !== undefined && !isAnchor(o.anchor))
          return { ok: false, error: "createRoom anchor is invalid." };
        ops.push({
          op: "createRoom",
          name: o.name.toLowerCase().trim(),
          width: clamp(o.width, LIMITS.roomMin, LIMITS.roomMax),
          height: clamp(o.height, LIMITS.roomMin, LIMITS.roomMax),
          anchor: (o.anchor as Anchor) ?? { at: "cursor" },
        });
        break;
      case "addWall":
        if (!isPointOrAnchor(o.from) || !isPointOrAnchor(o.to))
          return { ok: false, error: "addWall needs from and to." };
        ops.push({
          op: "addWall",
          from: o.from as PointOrAnchor,
          to: o.to as PointOrAnchor,
          thickness: isNum(o.thickness) ? clamp(o.thickness, 2, 24) : undefined,
        });
        break;
      case "addDoor":
        if (!isRef(o.wall)) return { ok: false, error: "addDoor needs a wall reference." };
        ops.push({
          op: "addDoor",
          wall: o.wall as Ref,
          width: isNum(o.width) ? clamp(o.width, LIMITS.openingMin, LIMITS.openingMax) : undefined,
          along: validAlong(o.along),
          swing: SWINGS.has(o.swing as string) ? (o.swing as DoorSwing) : undefined,
        });
        break;
      case "addWindow":
        if (!isRef(o.wall)) return { ok: false, error: "addWindow needs a wall reference." };
        ops.push({
          op: "addWindow",
          wall: o.wall as Ref,
          width: isNum(o.width) ? clamp(o.width, LIMITS.openingMin, LIMITS.openingMax) : undefined,
          along: validAlong(o.along),
        });
        break;
      case "placeFurniture":
        if (typeof o.kind !== "string" || !isAnchor(o.anchor))
          return { ok: false, error: "placeFurniture needs kind and anchor." };
        ops.push({
          op: "placeFurniture",
          kind: o.kind.toLowerCase().trim(),
          anchor: o.anchor as Anchor,
          rotation: isNum(o.rotation) ? o.rotation : undefined,
          width: isNum(o.width) ? clamp(o.width, LIMITS.furnMin, LIMITS.furnMax) : undefined,
          height: isNum(o.height) ? clamp(o.height, LIMITS.furnMin, LIMITS.furnMax) : undefined,
        });
        break;
      case "move":
        if (!isRef(o.target) || !isAnchor(o.to)) return { ok: false, error: "move needs target and to." };
        ops.push({ op: "move", target: o.target as Ref, to: o.to as Anchor });
        break;
      case "resize":
        if (!isRef(o.target)) return { ok: false, error: "resize needs a target." };
        ops.push({
          op: "resize",
          target: o.target as Ref,
          width: isNum(o.width) ? clamp(o.width, LIMITS.furnMin, LIMITS.furnMax) : undefined,
          height: isNum(o.height) ? clamp(o.height, LIMITS.furnMin, LIMITS.furnMax) : undefined,
        });
        break;
      case "rotate":
        if (!isRef(o.target) || !isNum(o.degrees)) return { ok: false, error: "rotate needs target and degrees." };
        ops.push({ op: "rotate", target: o.target as Ref, degrees: o.degrees });
        break;
      case "delete":
        if (!isRef(o.target)) return { ok: false, error: "delete needs a target." };
        ops.push({ op: "delete", target: o.target as Ref });
        break;
      case "rename":
        if (!isRef(o.target) || typeof o.name !== "string")
          return { ok: false, error: "rename needs target and name." };
        ops.push({ op: "rename", target: o.target as Ref, name: o.name.toLowerCase().trim() });
        break;
      case "clarify":
        if (typeof o.question !== "string") return { ok: false, error: "clarify needs a question." };
        ops.push({ op: "clarify", question: o.question });
        break;
      default:
        return { ok: false, error: `Unknown operation: ${String(o.op)}` };
    }
  }
  return { ok: true, ops };
}

function validAlong(a: unknown): Along | undefined {
  if (a === "center" || a === "left" || a === "right") return a;
  if (isNum(a)) return a;
  return undefined;
}
