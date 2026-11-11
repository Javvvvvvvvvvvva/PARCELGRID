import { planRectangle } from "./layout-geometry";
import { parkingGeometryParts } from "./parking-geometry-parts";
import type { PlanningParkingGeometrySnapshot } from "./planning-parking-geometry";

export function parkingEgressObstacles(parking: PlanningParkingGeometrySnapshot | null) {
  if (!parking?.frontage.sourceMatched) return undefined;
  return [
    ...parking.layout.stalls.map(stall => ({ id: stall.id, shape: stall.corners })),
    ...parkingGeometryParts(parking.layout).flatMap(part => [
      ...(part.aisleShape.length >= 3 ? [{ id: `${part.id} 주차 통로`, shape: part.aisleShape }] : []),
      ...part.columns.map((point, index) => ({ id: `${part.id} 가정 기둥 ${index + 1}`,
        shape: planRectangle(point, parking.circulation.profile?.columnWidthM ?? 0.4,
          parking.circulation.profile?.columnWidthM ?? 0.4) })),
    ]),
  ];
}
