// Serialized plan shape stored in Supabase `plans.data` (jsonb). Versioned so we
// can migrate old saves. Geometry is the document's entities plus the saved
// viewport and units.

import type { Entity } from "../model/types.ts";
import type { Viewport } from "../viewport.ts";

export const PLAN_VERSION = 1 as const;

export type PlanData = {
  version: number;
  units: "imperial";
  entities: Entity[];
  viewport: Viewport;
};

/** Best-effort validation of untrusted plan JSON loaded from storage. */
export function isPlanData(v: unknown): v is PlanData {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.version === "number" &&
    Array.isArray(o.entities) &&
    !!o.viewport &&
    typeof o.viewport === "object"
  );
}
