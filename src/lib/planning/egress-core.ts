import { z } from "zod";
import type { FloorProgram, PlanningCheck, PlanningScenario } from "./types";
import { createPlanningGeometryBudget, polygonAreaSqm, type PlanningFloorMass } from "./planning-massing";
import type { LocalParcelPolygon } from "@/lib/geo/parcel-topology";
import { localParcelIntersectionArea, validateLocalParcelTopology } from "@/lib/geo/parcel-topology-geometry";
import { assessInteriorLayout, interiorDoorSegment, type InteriorDraft, type InteriorIssue } from "./interior-layout";
import { openingOnEdge, planContains, planIntersectionArea, planRectangle, sharedPlanEdge, validPlanPolygon, type PlanPoint } from "./layout-geometry";
import { pathLength, pathSpaceShape, traceSpacePath } from "./interior-paths";
import { assessRoomLayout } from "./room-layout";

export const EGRESS_VERSION = "egress-core-2026.1" as const;
export const egressSettingsSchema = z.object({
  flightWidthM: z.number().min(0.8).max(2.5), treadDepthM: z.number().min(0.2).max(0.4),
  maxRiserM: z.number().min(0.1).max(0.25), landingDepthM: z.number().min(0.8).max(2.5),
  wellGapM: z.number().min(0.1).max(1), wallThicknessM: z.number().min(0.1).max(0.5),
  minimumDoorWidthM: z.number().min(0.6).max(1.5),
});
/** These values are scenario assumptions, not a building-code classifier. */
export const DEFAULT_EGRESS_SETTINGS: z.infer<typeof egressSettingsSchema> = {
  flightWidthM: 1, treadDepthM: 0.26, maxRiserM: 0.18, landingDepthM: 1.2,
  wellGapM: 0.2, wallThicknessM: 0.15, minimumDoorWidthM: 0.8,
};
export const egressPlanSchema = z.object({
  version: z.literal(EGRESS_VERSION), settings: egressSettingsSchema,
  exit: z.object({
    floorId: z.string().min(1).max(120), spaceId: z.string().min(1).max(120),
    edgeIndex: z.number().int().min(0).max(3), offsetRatio: z.number().min(0).max(1),
    widthM: z.number().min(0.6).max(3), layoutBasis: z.string().min(1).max(60000),
  }).optional(),
});
export type EgressSettings = z.infer<typeof egressSettingsSchema>;
export type EgressPlan = z.infer<typeof egressPlanSchema>;
export type EgressFloorGeometry = Pick<PlanningFloorMass, "id" | "level" | "shape" | "baseHeightM">;
export interface EgressAssessment {
  status: "preliminary-chain" | "conflict" | "missing";
  approvalStatus: "unverified"; issues: InteriorIssue[];
  links: Array<{ lowerFloorId: string; upperFloorId: string; label: string; status: "fit" | "conflict" | "missing";
    stairShape: PlanPoint[]; risers: number; riserHeightM: number; widthM: number; depthM: number }>;
  routes: Array<{ floorId: string; unitId: string; roomId: string; label: string; points: PlanPoint[]; candidateDistanceM: number }>;
  exitLanding: PlanPoint[];
  exitPolygonIndex: number | null;
  groundRoute: PlanPoint[];
  checkedRooms: number;
  connectedFloors: string[];
}
export function groundExitBasis(draft: InteriorDraft): string {
  return JSON.stringify({ outline: draft.sourceOutline.map(p => [p.x, p.z]), program: draft.programBasis,
    settings: Object.entries(draft.settings).sort(([a], [b]) => a.localeCompare(b)),
    spaces: draft.spaces.map(s => [s.id, s.kind, s.zoneId ?? null, s.center.x, s.center.z, s.widthM, s.depthM, s.rotationDeg]),
    doors: draft.doors.map(d => [d.from, d.to, d.center.x, d.center.z, d.widthM]) });
}
export function stairReservation(heightM: number, raw: EgressSettings) {
  const parsed = egressSettingsSchema.safeParse(raw);
  if (!parsed.success || !Number.isFinite(heightM) || heightM <= 0 || heightM > 12) return null;
  const s = parsed.data, risers = Math.max(2, Math.ceil(heightM / s.maxRiserM / 2) * 2);
  return { risers, riserHeightM: heightM / risers,
    widthM: 2 * s.flightWidthM + s.wellGapM + 2 * s.wallThicknessM,
    depthM: (risers / 2 - 1) * s.treadDepthM + 2 * s.landingDepthM + 2 * s.wallThicknessM };
}
export function groundExitCandidates(floor: FloorProgram, outline: PlanPoint[]) {
  const draft = floor.interiorLayout;
  if (floor.level !== 1 || !draft || !validPlanPolygon(outline)) return [];
  return draft.spaces.filter(s => s.kind !== "unit").flatMap(space => pathSpaceShape(space).flatMap((p, edgeIndex, shape) => {
    const edge = sharedPlanEdge([p, shape[(edgeIndex + 1) % shape.length]], outline);
    return edge ? [{ spaceId: space.id, label: space.label + " 외벽 " + (edgeIndex + 1), edgeIndex, edge }] : [];
  }));
}

export interface EgressCoreInput {
  scenario: PlanningScenario; floors?: EgressFloorGeometry[]; parcelShape?: PlanPoint[];
  /** Authoritative when supplied, including empty or invalid topology. */
  parcelPolygons?: LocalParcelPolygon[];
  groundObstacles?: Array<{ id: string; shape: PlanPoint[] }>;
}

function emptyEgressAssessment(): EgressAssessment {
  return { status: "missing", approvalStatus: "unverified", issues: [], links: [], routes: [],
    exitLanding: [], exitPolygonIndex: null, groundRoute: [], checkedRooms: 0, connectedFloors: [] };
}

export function assessEgressCore(input: EgressCoreInput): EgressAssessment {
  try {
    return assessEgressWithinBudget(input, createPlanningGeometryBudget());
  } catch {
    return { ...emptyEgressAssessment(), issues: [{ code: "egress-geometry-budget", status: "unknown",
      message: "전체 대지·피난 연결의 계산 한도 또는 다각형 연산으로 검사를 완료하지 못했습니다. 전문·법적 승인은 미검증입니다." }] };
  }
}

function assessEgressWithinBudget(input: EgressCoreInput, checkBudget: () => void): EgressAssessment {
  const result = emptyEgressAssessment();
  const issue = (code: string, message: string, status: InteriorIssue["status"] = "fail") => result.issues.push({ code, message, status });
  const parsed = egressPlanSchema.safeParse(input.scenario.egressPlan ?? { version: EGRESS_VERSION, settings: DEFAULT_EGRESS_SETTINGS });
  if (!parsed.success) { issue("egress-input", "피난·계단 설정 데이터가 올바르지 않습니다."); result.status = "conflict"; return result; }
  const polygons = input.parcelPolygons === undefined ? [{ outer: input.parcelShape ?? [], holes: [] }] : input.parcelPolygons;
  const validParcel = validateLocalParcelTopology(polygons, checkBudget);
  if (!validParcel) issue("exit-parcel", "대지 전체 경계·구멍 자료가 없거나 올바르지 않아 출구 여유 공간을 검증할 수 없습니다.", "unknown");
  const contains = (polygon: LocalParcelPolygon, shape: PlanPoint[]) => {
    checkBudget();
    const area = polygonAreaSqm(shape);
    const covered = localParcelIntersectionArea([polygon], [{ outer: shape, holes: [] }]);
    checkBudget();
    return area > 1e-8 && Math.abs(area - covered) <= 1e-6;
  };
  const plan = parsed.data, settings = plan.settings;
  const floors = [...input.scenario.floorPrograms].sort((a, b) => a.level - b.level);
  if (!input.floors?.length) { issue("egress-geometry", "층 외곽·높이 좌표가 없어 연결을 검증할 수 없습니다.", "unknown"); return result; }
  const byId = new Map(input.floors.map(f => [f.id, f]));
  const valid = new Set<string>();
  const cores = new Map<string, NonNullable<FloorProgram["interiorLayout"]>["spaces"][number]>();
  const levels = new Set<number>();
  for (const floor of floors) {
    checkBudget();
    if (levels.has(floor.level) || floor.level === 0 || !Number.isInteger(floor.level)) issue("egress-level", "중복되거나 올바르지 않은 층 번호입니다.");
    levels.add(floor.level);
    const geometry = byId.get(floor.id), assessment = assessInteriorLayout(floor, geometry?.shape);
    if (!geometry || geometry.level !== floor.level || !Number.isFinite(geometry.baseHeightM)) issue("egress-floor-geometry", floor.label + ": 현재 층 좌표·높이가 없습니다.", "unknown");
    else if (assessment.status === "preliminary-fit") valid.add(floor.id);
    else issue("egress-floor-layout", floor.label + ": " + (assessment.issues[0]?.message ?? "층 구획 검증이 필요합니다."), assessment.status === "conflict" ? "fail" : "unknown");
    const core = floor.interiorLayout?.spaces.find(s => s.kind === "core");
    if (core) cores.set(floor.id, core);
  }
  for (let i = 1; i < floors.length; i++) {
    checkBudget();
    const lower = floors[i - 1], upper = floors[i], lowGeometry = byId.get(lower.id), upGeometry = byId.get(upper.id);
    const adjacent = upper.level - lower.level === 1 || (lower.level === -1 && upper.level === 1);
    const low = cores.get(lower.id), up = cores.get(upper.id);
    const reservation = lowGeometry && upGeometry ? stairReservation(upGeometry.baseHeightM - lowGeometry.baseHeightM, settings) : null;
    let fitted: PlanPoint[] | null = null;
    if (adjacent && low && up && reservation && valid.has(lower.id) && valid.has(upper.id)) {
      const lowWall = lower.interiorLayout!.settings.wallThicknessM, upWall = upper.interiorLayout!.settings.wallThicknessM;
      const lowClear = planRectangle(low.center, low.widthM - lowWall, low.depthM - lowWall, low.rotationDeg);
      const upClear = planRectangle(up.center, up.widthM - upWall, up.depthM - upWall, up.rotationDeg);
      for (const center of [low.center, up.center, { x: (low.center.x + up.center.x) / 2, z: (low.center.z + up.center.z) / 2 }]) {
        for (const angle of [low.rotationDeg, low.rotationDeg + 90, up.rotationDeg, up.rotationDeg + 90]) {
          const shape = planRectangle(center, reservation.widthM, reservation.depthM, angle);
          try { if (planContains(lowClear, shape) && planContains(upClear, shape)) fitted = shape; } catch { /* Report unresolved geometry below. */ }
          if (fitted) break;
        }
        if (fitted) break;
      }
    }
    const status = !adjacent || !low || !up || !reservation || !valid.has(lower.id) || !valid.has(upper.id) ? "missing" : fitted ? "fit" : "conflict";
    result.links.push({ lowerFloorId: lower.id, upperFloorId: upper.id, label: lower.label + " ↔ " + upper.label,
      status, stairShape: fitted ?? [], risers: reservation?.risers ?? 0, riserHeightM: reservation?.riserHeightM ?? 0,
      widthM: reservation?.widthM ?? 0, depthM: reservation?.depthM ?? 0 });
    if (status !== "fit") issue("core-link", lower.label + "과 " + upper.label + (status === "conflict"
      ? ": 같은 위치의 코어 유효 영역에 계단·참 예약 공간 후보를 수용하지 못했습니다. 다른 계단 형식은 별도 검토 대상입니다."
      : ": 중간층·코어·층고 자료가 없거나 구획 검증이 미완료입니다."), status === "conflict" ? "fail" : "unknown");
  }
  const ground = floors.find(f => f.level === 1), groundGeometry = ground && byId.get(ground.id);
  let exitConnected = false;
  if (!ground || !groundGeometry || !ground.interiorLayout || !plan.exit) issue("exit-missing", "지상 1층 공용부와 외부 출구 연결이 필요합니다.", "unknown");
  else {
    const draft = ground.interiorLayout, exit = plan.exit, core = cores.get(ground.id);
    const candidate = groundExitCandidates(ground, groundGeometry.shape).find(c => c.spaceId === exit.spaceId && c.edgeIndex === exit.edgeIndex);
    if (exit.floorId !== ground.id || exit.layoutBasis !== groundExitBasis(draft)) issue("exit-stale", "지상 층 구획이 변경됐습니다. 출구 후보를 다시 연결해야 합니다.");
    else if (!candidate || exit.widthM + 1e-5 < settings.minimumDoorWidthM) issue("exit-opening", "출구가 공용부 외벽에 없거나 입력 유효폭이 부족합니다.");
    else {
      const [a, b] = candidate.edge, center = { x: a.x + (b.x - a.x) * exit.offsetRatio, z: a.z + (b.z - a.z) * exit.offsetRatio };
      const segment = openingOnEdge(candidate.edge, center, exit.widthM, draft.settings.wallThicknessM / 2);
      const common = new Set(draft.spaces.filter(s => s.kind !== "unit").map(s => s.id));
      const route = core && traceSpacePath({ spaces: draft.spaces, doors: draft.doors, startId: core.id, targetId: exit.spaceId,
        transitIds: common, wallM: draft.settings.wallThicknessM, minimumDoorWidthM: settings.minimumDoorWidthM });
      if (!segment || !route || !valid.has(ground.id)) issue("exit-disconnected", "지상 코어에서 외부 출구까지 유효한 공용부·개구부 연결이 없습니다.");
      else {
        result.groundRoute = [...route, center];
        const space = draft.spaces.find(s => s.id === exit.spaceId)!;
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        let normal = { x: -(b.z - a.z) / length, z: (b.x - a.x) / length };
        if ((space.center.x - center.x) * normal.x + (space.center.z - center.z) * normal.z > 0) normal = { x: -normal.x, z: -normal.z };
        result.exitLanding = planRectangle({ x: center.x + normal.x * settings.landingDepthM / 2, z: center.z + normal.z * settings.landingDepthM / 2 },
          exit.widthM, settings.landingDepthM, Math.atan2(b.z - a.z, b.x - a.x) * 180 / Math.PI);
        if (validParcel) {
          try {
            const owner = polygons.findIndex(polygon => contains(polygon, groundGeometry.shape));
            exitConnected = owner >= 0 && contains(polygons[owner], result.exitLanding);
            if (exitConnected) result.exitPolygonIndex = owner;
            else issue("exit-outside", "지상층과 외부 출구 여유 공간이 같은 대지 구성요소 안에 있지 않거나 구멍·대지 경계를 침범합니다.");
          } catch (error) {
            if (error instanceof Error && error.name === "TimeoutError") throw error;
            issue("exit-geometry", "외부 출구 다각형 검사를 완료하지 못했습니다.", "unknown");
          }
        }
      }
    }
    if (input.groundObstacles) {
      try {
        const commons = draft.spaces.filter(s => s.kind !== "unit").map(pathSpaceShape);
        for (const obstacle of input.groundObstacles) {
          checkBudget();
          if (!validPlanPolygon(obstacle.shape)) { issue("obstacle-data", "지상 장애물 좌표를 확인해야 합니다.", "unknown"); exitConnected = false; continue; }
          if ([...commons, result.exitLanding].some(shape => shape.length >= 3 && planIntersectionArea(shape, obstacle.shape) > 1e-5)) {
            exitConnected = false; issue("pedestrian-obstacle", "지상 코어·공용부·출구 여유 공간과 " + obstacle.id + "이 겹칩니다.");
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") throw error;
        issue("pedestrian-geometry", "지상 장애물 간섭 검사를 완료하지 못했습니다.", "unknown"); exitConnected = false;
      }
    }
  }
  const reached = new Set<string>(exitConnected && ground ? [ground.id] : []);
  let grew = true;
  while (grew) {
    checkBudget();
    grew = false;
    for (const link of result.links.filter(l => l.status === "fit")) {
      if (reached.has(link.lowerFloorId) && !reached.has(link.upperFloorId)) { reached.add(link.upperFloorId); grew = true; }
      if (reached.has(link.upperFloorId) && !reached.has(link.lowerFloorId)) { reached.add(link.lowerFloorId); grew = true; }
    }
  }
  result.connectedFloors = [...reached];
  for (const floor of floors) {
    checkBudget();
    const parent = floor.interiorLayout, core = cores.get(floor.id);
    if (!parent || !core) continue;
    const common = new Set(parent.spaces.filter(s => s.kind !== "unit").map(s => s.id));
    for (const unit of parent.spaces.filter(s => s.kind === "unit")) {
      checkBudget();
      const rooms = assessRoomLayout(floor, unit.id, byId.get(floor.id)?.shape);
      if (rooms.status !== "preliminary-fit") issue("egress-rooms", floor.label + " " + unit.label + ": 상세 실·현관 연결 검증이 미완료입니다.", rooms.status === "conflict" ? "fail" : "unknown");
      const roomDraft = parent.roomLayouts?.find(d => d.unitId === unit.id), door = roomDraft?.entryDoor;
      if (roomDraft?.doors.some(d => d.widthM + 1e-5 < settings.minimumDoorWidthM)) issue("egress-room-width",
        floor.label + " " + unit.label + ": 실 출입문이 피난 경로의 가정 유효폭보다 좁습니다.");
      const commonId = door && (door.from === unit.id ? door.to : door.to === unit.id ? door.from : null);
      const commonRoute = commonId && common.has(commonId) && door && interiorDoorSegment(parent, door) && door.widthM + 1e-5 >= settings.minimumDoorWidthM
        ? traceSpacePath({ spaces: parent.spaces, doors: parent.doors, startId: commonId, targetId: core.id,
          transitIds: common, wallM: parent.settings.wallThicknessM, minimumDoorWidthM: settings.minimumDoorWidthM }) : null;
      for (const room of rooms.rooms.filter(r => r.kind !== "hall")) {
        result.checkedRooms++;
        if (!commonRoute || !room.route || !door || !reached.has(floor.id)) {
          issue("egress-room-chain", floor.label + " " + unit.label + " " + room.label + ": 지상 외부 출구까지의 개념 연결이 끊겼습니다.", "unknown"); continue;
        }
        const points = [...room.route, door.center, ...commonRoute];
        result.routes.push({ floorId: floor.id, unitId: unit.id, roomId: room.id,
          label: floor.label + " " + unit.label + " " + room.label, points, candidateDistanceM: pathLength(points) });
      }
    }
  }
  if (!result.checkedRooms) issue("egress-no-rooms", "검증할 상세 실 구획이 없습니다.", "unknown");
  result.status = result.issues.some(i => i.status === "fail") ? "conflict" :
    result.issues.some(i => i.status === "unknown") || !exitConnected ? "missing" : "preliminary-chain";
  issue("egress-scope", "한 개 코어의 개념 연결 검사입니다. 법정 직통계단 개수·보행거리·방화구획·피난계단 종류·문 여닫힘·계단참 출입 접속·머리높이·난간·구조·장애인 접근·도로까지 안전한 통로·전문가 승인은 미검증입니다.", "review");
  if (!input.groundObstacles) issue("egress-obstacles", "지상 주차·기둥·보행 간섭은 별도 검사와 실측 확인이 필요합니다.", "review");
  checkBudget();
  return result;
}
export function egressPlanningCheck(result: EgressAssessment): PlanningCheck {
  return { code: "egress-core", label: "피난·층간 코어 연결", status: result.status === "conflict" ? "fail" : result.status === "missing" ? "unknown" : "review",
    message: result.issues.find(i => i.status === "fail")?.message ?? result.issues.find(i => i.status === "unknown")?.message ??
      "실→현관→공용부→층간 코어→지상 출구 개념 연결 확인. 법정 피난 적합성·승인은 미확정입니다.", source: EGRESS_VERSION };
}
