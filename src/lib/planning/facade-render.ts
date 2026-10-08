import type { FacadeFace } from "./facade-quantities";
import type { PlanningMaterialSelection, PlanningFacadeMaterial } from "./types";

/** Symbolic, original patterns in meters; not a product or price specification. */
export const FACADE_PATTERN_METERS: Record<PlanningFacadeMaterial, [number, number]> = {
  unselected: [1, 1], "brick-veneer": [0.44, 0.15], "exposed-concrete": [1.2, 0.6],
  "metal-panel": [0.6, 1.2], "standard-render": [0.25, 0.25],
};
export function facadeSurfacePatches(face: FacadeFace, materials: PlanningMaterialSelection) {
  const assignment = materials.faceAssignments?.[face.id];
  if (assignment?.exposure === "shared" || assignment?.exposure === "unknown") return [];
  const slices = assignment?.material ? [{ material: assignment.material, share: 1 }] : [
    { material: materials.primaryFacadeMaterial, share: materials.primaryFacadeSharePct / 100 },
    { material: materials.secondaryFacadeMaterial, share: 1 - materials.primaryFacadeSharePct / 100 },
  ];
  let heightOffset = 0;
  return slices.flatMap(({ material, share }) => {
    const base = face.baseHeightM + heightOffset;
    const height = face.heightM * share;
    heightOffset += height;
    if (material === "unselected" || height <= 0) return [];
    const [tileW, tileH] = FACADE_PATTERN_METERS[material];
    return [{ material, base, top: base + height, u: face.lengthM / tileW, v: height / tileH, vOffset: base / tileH }];
  });
}
