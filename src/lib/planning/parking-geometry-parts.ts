import type { ParkingComponentLayout, ParkingLayoutResult } from "./parking-layout";

export type ParkingGeometryPart = Pick<ParkingComponentLayout,
  "id" | "source" | "targetShape" | "exclusionShape" | "aisleShape" | "coreShape" | "columns" |
  "stalls" | "entryPaths" | "frontage" | "accessMode">;

/** Legacy snapshots may omit components; explicit empty components must stay empty. */
export function parkingGeometryParts(layout: ParkingLayoutResult): ParkingGeometryPart[] {
  if (layout.components !== undefined) return Array.isArray(layout.components) ? layout.components : [];
  return [{ ...layout, id: "legacy", frontage: null,
    entryPaths: layout.entryPath.length >= 2 ? [{ points: layout.entryPath }] : [] }];
}
