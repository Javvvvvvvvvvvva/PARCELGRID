import type { PlanningParking } from "@/lib/planning/types";

export const DEFAULT_PARKING_LAYOUT: Required<
  Pick<
    PlanningParking,
    | "orientation"
    | "stallWidthM"
    | "stallDepthM"
    | "aisleWidthM"
    | "entryWidthM"
    | "coreAreaSqm"
    | "columnLossPct"
  >
> = {
  orientation: "auto",
  stallWidthM: 2.5,
  stallDepthM: 5,
  aisleWidthM: 6,
  entryWidthM: 3,
  coreAreaSqm: 10,
  columnLossPct: 8,
};
