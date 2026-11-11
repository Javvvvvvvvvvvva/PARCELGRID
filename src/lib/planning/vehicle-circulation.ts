import { z } from "zod";
import { parkingFrontageInwardNormal, parkingFrontageMatchesPolygon, type ParkingComponentLayout, type ParkingLayoutResult } from "./parking-layout";
import type { PlanningParking } from "./types";
import { createPlanningGeometryBudget, polygonAreaSqm, polygonCentroid } from "./planning-massing";
import type { LocalParcelPolygon } from "@/lib/geo/parcel-topology";
import { localParcelIntersectionArea, openParcelRing, validateLocalParcelTopology } from "@/lib/geo/parcel-topology-geometry";
import {
  planContains, planHull, planIntersectionArea, planRectangle,
  rotatePlanPoint, validPlanPolygon, type PlanPoint,
} from "./layout-geometry";

export const VEHICLE_SCREENING_VERSION = "vehicle-screening-2026.1" as const;
export const vehicleProfileSchema = z.object({
  widthM: z.number().min(1.4).max(2.6),
  lengthM: z.number().min(3).max(7),
  wheelbaseM: z.number().min(1.8).max(4.5),
  rearOverhangM: z.number().min(0.3).max(1.8),
  minRearAxleRadiusM: z.number().min(3).max(12),
  clearanceM: z.number().min(0.05).max(1),
  columnWidthM: z.number().min(0.2).max(1.2),
}).refine(v => v.lengthM > v.wheelbaseM + v.rearOverhangM, "전방 오버행이 필요합니다.");
export type VehicleProfile = z.infer<typeof vehicleProfileSchema>;
/** Design assumptions, not a statutory vehicle or a manufacturer's turning-circle specification. */
export const DEFAULT_VEHICLE_PROFILE: VehicleProfile = {
  widthM: 1.85, lengthM: 4.6, wheelbaseM: 2.7, rearOverhangM: 1,
  minRearAxleRadiusM: 5, clearanceM: 0.1, columnWidthM: 0.4,
};
export interface VehiclePose { rearAxle: PlanPoint; headingRad: number }
export interface VehiclePathResult {
  status: "clear-candidate" | "conflict" | "no-template-fit" | "unavailable";
  reason: string;
  poses: VehiclePose[];
  sweptAreas: PlanPoint[][];
  collisions: string[];
  distanceM: number;
}
export interface VehicleCirculationAssessment {
  version: typeof VEHICLE_SCREENING_VERSION;
  status: "preliminary" | "review" | "unknown" | "not-applicable";
  approvalStatus: "unverified";
  profile: VehicleProfile | null;
  stalls: Array<VehiclePathResult & { stallId: string; componentId?: string; polygonIndex?: number }>;
  clearCandidateCount: number;
  requiredCars: number;
  uncheckedStalls: number;
  limitations: string[];
}
const distance = (a: PlanPoint, b: PlanPoint) => Math.hypot(a.x - b.x, a.z - b.z);
const add = (a: PlanPoint, b: PlanPoint, scale = 1): PlanPoint => ({ x: a.x + b.x * scale, z: a.z + b.z * scale });
function direction(a: PlanPoint, b: PlanPoint): PlanPoint {
  const d = distance(a, b);
  return { x: (b.x - a.x) / d, z: (b.z - a.z) / d };
}
function emptyPath(status: VehiclePathResult["status"], reason: string): VehiclePathResult {
  return { status, reason, poses: [], sweptAreas: [], collisions: [], distanceM: 0 };
}

/** Tangent circular fillets model a continuous rear-axle trajectory with a bounded turning radius. */
export function buildVehiclePoses(points: PlanPoint[], radiusM: number): VehiclePose[] | null {
  if (points.length < 2 || points.length > 12 || !Number.isFinite(radiusM) || radiusM < 3 || radiusM > 12 ||
      points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.z) || Math.abs(p.x) > 1e6 || Math.abs(p.z) > 1e6)) return null;
  const vertices = points.filter((p, i) => i === 0 || distance(p, points[i - 1]) > 1e-6);
  if (vertices.length < 2 || vertices.slice(1).reduce((sum, p, i) => sum + distance(p, vertices[i]), 0) > 150) return null;
  const corners: Array<{ start: PlanPoint; end: PlanPoint; center: PlanPoint; turn: number; trim: number } | null> = vertices.map(() => null);
  for (let i = 1; i < vertices.length - 1; i++) {
    const incoming = direction(vertices[i - 1], vertices[i]), outgoing = direction(vertices[i], vertices[i + 1]);
    const turn = Math.atan2(incoming.x * outgoing.z - incoming.z * outgoing.x, incoming.x * outgoing.x + incoming.z * outgoing.z);
    if (Math.abs(turn) < 1e-6) continue;
    if (Math.abs(turn) > Math.PI - 0.05) return null;
    const trim = radiusM * Math.tan(Math.abs(turn) / 2);
    const start = add(vertices[i], incoming, -trim), end = add(vertices[i], outgoing, trim);
    const center = add(start, { x: -incoming.z, z: incoming.x }, Math.sign(turn) * radiusM);
    corners[i] = { start, end, center, turn, trim };
  }
  for (let i = 0; i < vertices.length - 1; i++) {
    if ((corners[i]?.trim ?? 0) + (corners[i + 1]?.trim ?? 0) > distance(vertices[i], vertices[i + 1]) - 1e-5) return null;
  }
  const poses: VehiclePose[] = [];
  const push = (rearAxle: PlanPoint, headingRad: number) => {
    if (!poses.length || distance(poses.at(-1)!.rearAxle, rearAxle) > 1e-7) poses.push({ rearAxle, headingRad });
  };
  for (let i = 0; i < vertices.length - 1; i++) {
    const start = corners[i]?.end ?? vertices[i], end = corners[i + 1]?.start ?? vertices[i + 1];
    const heading = Math.atan2(end.z - start.z, end.x - start.x);
    const count = Math.max(1, Math.ceil(distance(start, end) / 0.35));
    for (let step = 0; step <= count; step++) push({
      x: start.x + (end.x - start.x) * step / count, z: start.z + (end.z - start.z) * step / count,
    }, heading);
    const corner = corners[i + 1];
    if (corner) {
      const startAngle = Math.atan2(corner.start.z - corner.center.z, corner.start.x - corner.center.x);
      const countArc = Math.ceil(Math.abs(corner.turn) * radiusM / 0.35);
      for (let step = 1; step <= countArc; step++) {
        const angle = startAngle + corner.turn * step / countArc;
        push({ x: corner.center.x + radiusM * Math.cos(angle), z: corner.center.z + radiusM * Math.sin(angle) },
          heading + corner.turn * step / countArc);
      }
    }
  }
  return poses;
}

export function vehicleFootprint(pose: VehiclePose, vehicle: VehicleProfile, extraM = 0): PlanPoint[] {
  const centerOffset = vehicle.lengthM / 2 - vehicle.rearOverhangM;
  return planRectangle(add(pose.rearAxle, { x: Math.cos(pose.headingRad), z: Math.sin(pose.headingRad) }, centerOffset),
    vehicle.lengthM + 2 * (vehicle.clearanceM + extraM), vehicle.widthM + 2 * (vehicle.clearanceM + extraM),
    pose.headingRad * 180 / Math.PI);
}
function bounds(shape: PlanPoint[]) {
  return { minX: Math.min(...shape.map(p => p.x)), maxX: Math.max(...shape.map(p => p.x)),
    minZ: Math.min(...shape.map(p => p.z)), maxZ: Math.max(...shape.map(p => p.z)) };
}
function overlaps(a: PlanPoint[], b: PlanPoint[]) {
  const aa = bounds(a), bb = bounds(b);
  return aa.maxX > bb.minX && aa.minX < bb.maxX && aa.maxZ > bb.minZ && aa.minZ < bb.maxZ &&
    planIntersectionArea(a, b) > 1e-5;
}

interface VehiclePathInput {
  waypoints: PlanPoint[]; vehicle: VehicleProfile; parcel?: PlanPoint[];
  /** Authoritative even when empty or invalid. */
  parcelPolygons?: LocalParcelPolygon[];
  obstacles: Array<{ id: string; shape: PlanPoint[] }>; destination?: PlanPoint[];
}

export function screenVehiclePath(input: VehiclePathInput): VehiclePathResult {
  const checkBudget = createPlanningGeometryBudget();
  try {
    const polygons = input.parcelPolygons === undefined ? [{ outer: input.parcel ?? [], holes: [] }] : input.parcelPolygons;
    if (!validateLocalParcelTopology(polygons, checkBudget)) return emptyPath("unavailable", "대지 전체 경계·구멍 자료가 올바르지 않습니다.");
    return screenValidatedVehiclePath(input, polygons, checkBudget);
  } catch { return emptyPath("unavailable", "회전궤적 검사의 계산 한도 또는 경계 자료를 확인해야 합니다."); }
}

function screenValidatedVehiclePath(input: VehiclePathInput, polygons: LocalParcelPolygon[], checkBudget: () => void): VehiclePathResult {
  checkBudget();
  const parsed = vehicleProfileSchema.safeParse(input.vehicle);
  if (!parsed.success || input.obstacles.length > 1000 || input.obstacles.some(o => { checkBudget(); return !validPlanPolygon(o.shape); }) ||
      (input.destination && !validPlanPolygon(input.destination))) return emptyPath("unavailable", "차량 제원·경계·장애물 좌표를 확인해야 합니다.");
  const v = parsed.data;
  const poses = buildVehiclePoses(input.waypoints, v.minRearAxleRadiusM);
  if (!poses) return emptyPath("no-template-fit", "이 전진 경로 후보는 설정 회전반경을 확보하지 못했습니다. 다른 진입·후진 조합은 별도 검토 대상입니다.");
  const sweptAreas: PlanPoint[][] = [], collisions = new Set<string>();
  let travelled = 0;
  try {
    for (let i = 1; i < poses.length; i++) {
      checkBudget();
      const a = poses[i - 1], b = poses[i];
      travelled += distance(a.rearAxle, b.rearAxle);
      const angle = Math.abs(Math.atan2(Math.sin(b.headingRad - a.headingRad), Math.cos(b.headingRad - a.headingRad)));
      // Expand the endpoint hull by a conservative circular-arc sagitta bound, avoiding gaps between samples.
      const cornerRadius = Math.hypot(v.lengthM + v.clearanceM, v.widthM / 2 + v.clearanceM);
      const pad = (v.minRearAxleRadiusM + cornerRadius) * (1 - Math.cos(angle / 2)) + 1e-5;
      const sweep = planHull([...vehicleFootprint(a, v, pad), ...vehicleFootprint(b, v, pad)]);
      sweptAreas.push(sweep);
      const area = polygonAreaSqm(sweep);
      if (area <= 1e-8 || Math.abs(area - localParcelIntersectionArea([{ outer: sweep, holes: [] }], polygons)) > 1e-6) collisions.add("대지 경계");
      for (const obstacle of input.obstacles) {
        checkBudget();
        if (overlaps(sweep, obstacle.shape)) collisions.add(obstacle.id);
      }
    }
    if (input.destination && !planContains(input.destination, vehicleFootprint(poses.at(-1)!, v))) collisions.add("주차면 유효 폭·깊이");
    checkBudget();
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") throw error;
    return emptyPath("unavailable", "회전궤적 다각형 연산을 완료하지 못했습니다.");
  }
  return { status: collisions.size ? "conflict" : "clear-candidate",
    reason: collisions.size ? `후보 경로 간섭: ${[...collisions].join(", ")}` : "대지 내부 후보 궤적에서 설정 차량·여유폭 간섭이 발견되지 않았습니다.",
    poses, sweptAreas, collisions: [...collisions], distanceM: travelled };
}

function projectToEdge(p: PlanPoint, edge: [PlanPoint, PlanPoint]): PlanPoint {
  const dx = edge[1].x - edge[0].x, dz = edge[1].z - edge[0].z, squared = dx * dx + dz * dz;
  const ratio = Math.max(0, Math.min(1, ((p.x - edge[0].x) * dx + (p.z - edge[0].z) * dz) / squared));
  return { x: edge[0].x + dx * ratio, z: edge[0].z + dz * ratio };
}
export function assessVehicleCirculation(input: {
  layout: ParkingLayoutResult; parcel?: PlanPoint[]; frontEdge?: [PlanPoint, PlanPoint] | null; parking: PlanningParking;
  /** Authoritative even when empty or invalid. */
  parcelPolygons?: LocalParcelPolygon[];
}): VehicleCirculationAssessment {
  const parsed = vehicleProfileSchema.safeParse(input.parking.vehicleProfile ?? DEFAULT_VEHICLE_PROFILE);
  const result: VehicleCirculationAssessment = {
    version: VEHICLE_SCREENING_VERSION, status: "unknown", approvalStatus: "unverified", profile: parsed.success ? parsed.data : null,
    stalls: [], clearCandidateCount: 0, requiredCars: input.layout.requiredCars, uncheckedStalls: input.layout.stalls.length,
    limitations: [
      "차량 제원·후륜축 최소 회전반경·기둥 폭은 설계 가정입니다. 제조사 최소 회전지름과 같은 값이 아닙니다.",
      "공식 경계·실측 기둥·보행로·출입구 위치·도로 유효폭·보도 횡단·허가·전문가 승인은 미확정입니다.",
      "검사는 대지 내부 전진 진입과 동일 궤적 후진 복귀 후보에 한정합니다. 외부 도로 회전, 전진 출차, 다단 후진·경사·높이·실시간 조향은 검증하지 않습니다.",
      "후보 실패는 배치 전체의 불가능 판정이 아닙니다. 간섭 없음도 최종 주차 가능 대수로 자동 반영하지 않습니다.",
    ],
  };
  if (input.parking.strategy === "none" && input.layout.requiredCars === 0) {
    result.status = "not-applicable"; return result;
  }
  if (!parsed.success || !["surface", "piloti", "mixed"].includes(input.parking.strategy) || input.layout.stalls.length === 0 ||
      input.layout.generationStatus !== "complete") {
    result.limitations.unshift("경계·구성요소별 도로 접면·주차면 또는 지원되는 지상/필로티 배치가 필요합니다.");
    return result;
  }
  const v = parsed.data, ratio = input.parking.entryOffsetRatio ?? 0.5;
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) return result;
  const checkBudget = createPlanningGeometryBudget();
  try {
  const polygons = input.parcelPolygons === undefined ? [{ outer: input.parcel ?? [], holes: [] }] : input.parcelPolygons;
  if (!validateLocalParcelTopology(polygons, checkBudget)) {
    result.limitations.unshift("대지 전체 경계·구멍 자료가 비어 있거나 올바르지 않습니다."); return result;
  }
  type RouteLayout = Pick<ParkingComponentLayout, "id" | "polygonIndex" | "frontage" | "stalls" | "accessMode" |
    "orientationDeg" | "aisleShape" | "entryPath" | "coreShape" | "columns" | "obstacles">;
  let components: RouteLayout[] = input.layout.components;
  if (!components?.length) {
    if (input.parcelPolygons !== undefined || polygons.length !== 1 || !input.frontEdge || input.layout.accessMode === "mixed") return result;
    const edge = input.frontEdge;
    const edgeIndex = openParcelRing(polygons[0].outer).findIndex((_, index) => parkingFrontageMatchesPolygon({
      polygonIndex: 0, ringIndex: 0, edgeIndex: index, edge,
    }, polygons));
    if (edgeIndex < 0) return result;
    components = [{ ...input.layout, id: "legacy", polygonIndex: 0, frontage: { polygonIndex: 0, ringIndex: 0, edgeIndex, edge },
      obstacles: [
        ...(input.layout.exclusionShape.length ? [{ id: "건물", shape: input.layout.exclusionShape }] : []),
        ...(input.layout.coreShape.length ? [{ id: "주차 코어", shape: input.layout.coreShape }] : []),
        ...input.layout.columns.map((c, i) => ({ id: `가정 기둥 ${i + 1}`, shape: planRectangle(c, v.columnWidthM, v.columnWidthM) })),
      ] }];
  }
  if (components.length > 400 || input.layout.stalls.length > 1000) return result;
  const ids = components.flatMap(component => component.stalls.map(stall => stall.id));
  if (new Set(ids).size !== ids.length || ids.length !== input.layout.stalls.length ||
      input.layout.stalls.some(stall => !ids.includes(stall.id))) return result;
  for (const component of components) {
  checkBudget();
  if (result.stalls.length >= 20) break;
  const frontage = component.frontage, polygon = polygons[component.polygonIndex];
  if (!frontage || frontage.polygonIndex !== component.polygonIndex || !parkingFrontageMatchesPolygon(frontage, polygons)) {
    for (const stall of component.stalls.slice(0, 20 - result.stalls.length)) result.stalls.push({
      ...emptyPath("unavailable", "주차 구성요소에 속한 실제 외곽 도로 접면이 없습니다."),
      stallId: stall.id, componentId: component.id, polygonIndex: component.polygonIndex,
    });
    continue;
  }
  const edge = frontage.edge;
  const inward = parkingFrontageInwardNormal(frontage, polygons)!;
  const gate = component.entryPath[0] ?? add(edge[0], { x: edge[1].x - edge[0].x, z: edge[1].z - edge[0].z }, ratio);
  const fixed = [
    ...component.obstacles,
    ...components.filter(other => other !== component && other.polygonIndex === component.polygonIndex).flatMap(other => [
      ...(other.coreShape.length ? [{ id: `${other.id}-core`, shape: other.coreShape }] : []),
      ...other.columns.map((c, i) => ({ id: `${other.id}-column-${i}`, shape: planRectangle(c, v.columnWidthM, v.columnWidthM) })),
    ]),
  ];
  for (const stall of component.stalls.slice(0, 20 - result.stalls.length)) {
    checkBudget();
    const ownership = { stallId: stall.id, componentId: component.id, polygonIndex: component.polygonIndex };
    let forward = inward;
    let waypoints: PlanPoint[];
    if (component.accessMode === "direct-frontage") {
      const entry = projectToEdge(stall.center, edge);
      forward = direction(entry, stall.center);
      const rear = add(stall.center, forward, -(v.lengthM / 2 - v.rearOverhangM));
      const start = add(entry, forward, v.rearOverhangM + v.clearanceM + 0.01);
      if ((rear.x - start.x) * forward.x + (rear.z - start.z) * forward.z < 0.01) {
        result.stalls.push({ ...emptyPath("no-template-fit", "주차면 안에 차량 전체를 넣고 이동할 내부 구간이 부족합니다. 도로와 연속된 궤적 검토가 필요합니다."), ...ownership }); continue;
      }
      waypoints = [start, rear];
    } else if (component.accessMode === "internal-aisle" && component.aisleShape.length >= 3) {
      const angle = component.orientationDeg;
      const aisleCenter = rotatePlanPoint(polygonCentroid(component.aisleShape), -angle);
      const stallPoint = rotatePlanPoint(stall.center, -angle);
      forward = rotatePlanPoint({ x: 0, z: stallPoint.z >= aisleCenter.z ? 1 : -1 }, angle);
      const start = add(gate, inward, v.rearOverhangM + v.clearanceM + 0.01);
      const startPoint = rotatePlanPoint(start, -angle);
      waypoints = [start,
        rotatePlanPoint({ x: startPoint.x, z: aisleCenter.z }, angle),
        rotatePlanPoint({ x: stallPoint.x, z: aisleCenter.z }, angle),
        add(stall.center, forward, -(v.lengthM / 2 - v.rearOverhangM))];
    } else {
      result.stalls.push({ ...emptyPath("unavailable", "내부 차로 형상이 없습니다."), ...ownership }); continue;
    }
    const obstacles = [...fixed, ...components.filter(other => other.polygonIndex === component.polygonIndex).flatMap(other => other.stalls).filter(other => other.id !== stall.id)
      .map(other => ({ id: `다른 주차면 ${other.id}`, shape: other.corners }))];
    const path = screenValidatedVehiclePath({ waypoints, vehicle: v, obstacles, destination: stall.corners }, [polygon], checkBudget);
    result.stalls.push({ ...path, ...ownership });
  }
  }
  result.uncheckedStalls = input.layout.stalls.length - result.stalls.length;
  result.clearCandidateCount = result.stalls.filter(s => s.status === "clear-candidate").length;
  result.status = result.stalls.some(s => s.status === "unavailable") ? "unknown" :
    result.stalls.length > 0 && result.clearCandidateCount === input.layout.stalls.length ? "preliminary" : "review";
  } catch {
    result.status = "unknown";
    result.clearCandidateCount = result.stalls.filter(s => s.status === "clear-candidate").length;
    result.uncheckedStalls = input.layout.stalls.length - result.stalls.length;
    result.limitations.unshift("전체 구성요소에 공유된 계산 한도 또는 다각형 연산으로 검사를 완료하지 못했습니다.");
  }
  return result;
}
