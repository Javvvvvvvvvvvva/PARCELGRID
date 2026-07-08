import type { BuildingProgram, Parcel } from "./types";
import type { EnvelopePlan } from "@/lib/stores/project-store";
export function planToProgram(plan: EnvelopePlan, parcel: Parcel): BuildingProgram | null {
  if (!plan.scenarioType) return null;
  return { type: plan.scenarioType, far: plan.farPct, bcr: parcel.maxBCR, floorsAbove: plan.floors, floorsBelow: 0, units: { residential: 0, retail: 0 }, mix: { residentialSale: 1, residentialLease: 0, retail: 0 } };
}
