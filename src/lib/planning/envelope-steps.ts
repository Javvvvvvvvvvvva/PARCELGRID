import type { BuildableArea, LngLat } from "@/lib/finance/buildable-area";
import { projectParcelPolygons } from "@/lib/geo/parcel-envelope";
import { localParcelArea } from "@/lib/geo/parcel-topology-geometry";
import type { PlanningEnvelopeStep } from "./planning-massing";

/** Preserve empty levels and all clipped components. Never substitute another floor or the parcel. */
export function planningEnvelopeSteps(
  floors: Array<{ level: number }>,
  above: BuildableArea,
  basement: BuildableArea,
  origin: LngLat,
): PlanningEnvelopeStep[] {
  return floors.map(({ level }) => {
    const result = level < 0 ? basement : above;
    const step = level > 0 ? above.stepped3D.find(candidate => candidate.floor === level) : undefined;
    const source = level < 0 ? basement.buildable2DPolygons : step?.polygons;
    const polygons = source ? projectParcelPolygons(source, origin) : [];
    return {
      level,
      polygons,
      shape: polygons.length === 1 && !polygons[0].holes.length ? polygons[0].outer : [],
      envelopeAreaSqm: localParcelArea(polygons),
      requiredSetbackM: step?.requiredSetbackM ?? 0,
      envelopeAvailable: result.geometryStatus === "available" && source !== undefined,
    };
  });
}
