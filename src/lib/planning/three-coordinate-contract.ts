import type { LocalPlanPoint } from "@/lib/planning/planning-massing";

export interface ThreeShapePoint {
  x: number;
  y: number;
}

/**
 * Planning 좌표는 동쪽 +X, 북쪽 -Z다.
 * THREE.Shape의 Y는 rotateX(-PI/2) 뒤 world -Z가 되므로 부호를 반전해 넣어야
 * 직접 그린 Line([x, y, z])과 Shape/ExtrudeGeometry가 같은 위치에 놓인다.
 */
export function planningPointToThreeShape(
  point: LocalPlanPoint
): ThreeShapePoint {
  return { x: point.x, y: -point.z };
}

/** rotateX(-PI/2) 적용 뒤의 수평 world 좌표 계약. */
export function threeShapePointToPlanningWorld(
  point: ThreeShapePoint
): LocalPlanPoint {
  return { x: point.x, z: -point.y };
}
