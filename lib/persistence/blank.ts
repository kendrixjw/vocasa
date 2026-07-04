import { PLAN_VERSION, type PlanData } from "./plan.ts";

/** An empty plan (fits to default framing when opened). */
export function blankPlan(): PlanData {
  return {
    version: PLAN_VERSION,
    units: "imperial",
    entities: [],
    viewport: { originX: 0, originY: 0, scale: 0 },
  };
}
