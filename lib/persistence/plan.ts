// Serialized plan shape stored in Supabase `plans.data` (jsonb). Versioned so we
// can migrate old saves. Geometry is the document's entities plus the saved
// viewport and units.

import type { Entity } from "../model/types.ts";
import type { Viewport } from "../viewport.ts";

// v2 added dimension + annotation entities (additive).
// v3 added multiple floors: `floors` + `activeFloorId`. Older v1/v2 saves have a
// single `entities` array and load as one "Ground floor" (see editor.load).
export const PLAN_VERSION = 3 as const;

export type FloorData = { id: string; name: string; entities: Entity[] };

export type PlanData = {
  version: number;
  units: "imperial";
  viewport: Viewport;
  // v3 multi-floor form:
  floors?: FloorData[];
  activeFloorId?: string;
  // legacy v1/v2 single-floor form:
  entities?: Entity[];
};

/** Best-effort validation of untrusted plan JSON loaded from storage. */
export function isPlanData(v: unknown): v is PlanData {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  const hasGeometry = Array.isArray(o.entities) || Array.isArray(o.floors);
  return (
    typeof o.version === "number" &&
    hasGeometry &&
    !!o.viewport &&
    typeof o.viewport === "object"
  );
}
