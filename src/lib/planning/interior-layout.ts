import { z } from "zod";
import { roomDraftSchema } from "./room-layout-schema";
import type { FloorProgram, PlanningCheck } from "./types";
import { polygonAreaSqm } from "./planning-massing";
import {
  GEOMETRY_EPS, planContains, planIntersectionArea, planRectangle,
  rotatePlanPoint, sharedPlanEdge, validPlanPolygon, type PlanPoint,
} from "./layout-geometry";

export const INTERIOR_LAYOUT_VERSION = "interior-screening-2026.1" as const;
export const DEFAULT_INTERIOR_SETTINGS = {
  wallThicknessM: 0.2, corridorWidthM: 1.2, coreWidthM: 3, coreDepthM: 3,
  doorWidthM: 0.9, minimumUnitWidthM: 2.4,
};
const pointSchema = z.object({ x: z.number().finite().min(-1e6).max(1e6), z: z.number().finite().min(-1e6).max(1e6) });
export const interiorSettingsSchema = z.object({
  wallThicknessM: z.number().min(0.05).max(0.6),
  corridorWidthM: z.number().min(0.8).max(4),
  coreWidthM: z.number().min(2).max(8),
  coreDepthM: z.number().min(2).max(8),
  doorWidthM: z.number().min(0.6).max(1.5),
  minimumUnitWidthM: z.number().min(1.5).max(8),
});
export type InteriorSettings = z.infer<typeof interiorSettingsSchema>;
export const interiorDraftSchema = z.object({
  version: z.literal(INTERIOR_LAYOUT_VERSION),
  sourceOutline: z.array(pointSchema).min(3).max(500),
  programBasis: z.string().max(20000),
  settings: interiorSettingsSchema,
  spaces: z.array(z.object({
    id: z.string().min(1).max(120), label: z.string().max(160),
    kind: z.enum(["unit", "core", "corridor"]), zoneId: z.string().max(120).optional(),
    center: pointSchema, widthM: z.number().positive().max(200),
    depthM: z.number().positive().max(200), rotationDeg: z.number().finite().min(-360).max(360),
  })).min(1).max(42),
  doors: z.array(z.object({
    from: z.string(), to: z.string(), center: pointSchema,
    widthM: z.number().positive().max(3),
  })).max(80),
  roomLayouts: z.array(roomDraftSchema).max(20).optional(),
});
export type InteriorDraft = z.infer<typeof interiorDraftSchema>;
export type InteriorSpace = InteriorDraft["spaces"][number];
export interface InteriorIssue { code: string; status: "fail" | "review" | "unknown"; message: string }
export interface InteriorAssessment {
  status: "preliminary-fit" | "conflict" | "missing";
  issues: InteriorIssue[];
  units: Array<{ id: string; label: string; clearAreaSqm: number; targetAreaSqm: number; connected: boolean }>;
  commonAreaSqm: number;
  unassignedAreaSqm: number;
  approvalStatus: "unverified";
}

export function interiorProgramBasis(floor: FloorProgram): string {
  return JSON.stringify(floor.zones.map(z => [z.id, z.useType, z.areaSqm, z.unitCount,
    z.parkingExclusiveAreaSqm ?? null, z.saleableAreaSqm ?? null, z.revenueModel ?? null]));
}
export function interiorSpacePolygon(space: InteriorSpace): PlanPoint[] {
  return planRectangle(space.center, space.widthM, space.depthM, space.rotationDeg);
}
function outlineKey(points: PlanPoint[]): string {
  return JSON.stringify(points.map(p => [Number(p.x.toFixed(5)), Number(p.z.toFixed(5))]));
}
function targets(floor: FloorProgram) {
  return floor.zones.filter(z => z.useType === "residential").flatMap(zone =>
    Number.isInteger(zone.unitCount) && zone.unitCount > 0 && zone.unitCount <= 20
      ? Array.from({ length: zone.unitCount }, (_, i) => ({
        zoneId: zone.id, id: `${zone.id}-${i}`, label: zone.unitCount === 1 ? zone.label ?? "주거 세대" : `${zone.label ?? "주거"} ${i + 1}`,
        area: (zone.parkingExclusiveAreaSqm ?? zone.saleableAreaSqm ?? zone.areaSqm) / zone.unitCount,
      })) : []);
}
function supportedProgram(floor: FloorProgram): boolean {
  const units = targets(floor);
  if (!floor.zones.some(z => z.useType === "residential")) return floor.zones.some(z => z.useType === "common" && z.areaSqm > 0) &&
    floor.zones.every(z => Number.isFinite(z.areaSqm) && z.areaSqm >= 0 && z.unitCount === 0 && ["common", "parking", "piloti"].includes(z.useType));
  return units.length > 0 && units.length <= 20 &&
    floor.zones.every(z => Number.isFinite(z.areaSqm) && z.areaSqm >= 0 &&
      (z.useType === "common" || (z.useType === "residential" && Number.isInteger(z.unitCount) && z.unitCount > 0))) &&
    units.every(u => Number.isFinite(u.area) && u.area > 0);
}
export function interiorDoorSegment(draft: InteriorDraft, door: InteriorDraft["doors"][number]): [PlanPoint, PlanPoint] | null {
  const a = draft.spaces.find(s => s.id === door.from), b = draft.spaces.find(s => s.id === door.to);
  if (!a || !b || a.id === b.id) return null;
  const edge = sharedPlanEdge(interiorSpacePolygon(a), interiorSpacePolygon(b));
  if (!edge) return null;
  const len = Math.hypot(edge[1].x - edge[0].x, edge[1].z - edge[0].z);
  const ux = (edge[1].x - edge[0].x) / len, uz = (edge[1].z - edge[0].z) / len;
  const along = (door.center.x - edge[0].x) * ux + (door.center.z - edge[0].z) * uz;
  const across = Math.abs((door.center.x - edge[0].x) * uz - (door.center.z - edge[0].z) * ux);
  const margin = draft.settings.wallThicknessM / 2;
  if (across > GEOMETRY_EPS || along - door.widthM / 2 < margin - GEOMETRY_EPS ||
      along + door.widthM / 2 > len - margin + GEOMETRY_EPS) return null;
  return [{ x: door.center.x - ux * door.widthM / 2, z: door.center.z - uz * door.widthM / 2 },
    { x: door.center.x + ux * door.widthM / 2, z: door.center.z + uz * door.widthM / 2 }];
}

export function reconnectInteriorDoors(draft: InteriorDraft): InteriorDraft {
  const doors: InteriorDraft["doors"] = [];
  const spaces = draft.spaces;
  for (let i = 0; i < spaces.length; i++) for (let j = i + 1; j < spaces.length; j++) {
    if (spaces[i].kind === "unit" && spaces[j].kind === "unit") continue;
    const edge = sharedPlanEdge(interiorSpacePolygon(spaces[i]), interiorSpacePolygon(spaces[j]));
    if (!edge || Math.hypot(edge[1].x - edge[0].x, edge[1].z - edge[0].z) < draft.settings.doorWidthM + draft.settings.wallThicknessM) continue;
    doors.push({ from: spaces[i].id, to: spaces[j].id, widthM: draft.settings.doorWidthM,
      center: { x: (edge[0].x + edge[1].x) / 2, z: (edge[0].z + edge[1].z) / 2 } });
  }
  return { ...draft, doors };
}

export function assessInteriorLayout(floor: FloorProgram, outline?: PlanPoint[]): InteriorAssessment {
  const result: InteriorAssessment = {
    status: "missing", issues: [], units: [], commonAreaSqm: 0, unassignedAreaSqm: 0, approvalStatus: "unverified",
  };
  const issue = (code: string, message: string, status: InteriorIssue["status"] = "fail") => result.issues.push({ code, message, status });
  if (!outline || !validPlanPolygon(outline)) {
    issue("outline-missing", "실제 층 외곽 좌표가 없어 실내 구획을 검증할 수 없습니다.", "unknown"); return result;
  }
  if (!floor.interiorLayout) {
    issue("layout-missing", "저장된 실내 구획이 없습니다.", "review"); return result;
  }
  const parsed = interiorDraftSchema.safeParse(floor.interiorLayout);
  if (!parsed.success) {
    result.status = "conflict"; issue("invalid-layout", "실내 구획의 숫자·형식이 올바르지 않습니다."); return result;
  }
  const draft = parsed.data;
  if (!supportedProgram(floor)) issue("unsupported-program", "주거·공용부 전용 검증 범위 밖이거나 세대수가 올바르지 않습니다.");
  if (draft.programBasis !== interiorProgramBasis(floor)) issue("stale-program", "세대수·면적 프로그램이 변경됐습니다. 구획을 다시 생성해야 합니다.");
  if (outlineKey(draft.sourceOutline) !== outlineKey(outline)) issue("stale-outline", "층 외곽·위치가 변경됐습니다. 구획을 다시 생성해야 합니다.");
  const units = targets(floor);
  const shapes = draft.spaces.map(interiorSpacePolygon);
  const ids = new Set<string>();
  const commonIds = new Set(draft.spaces.filter(s => s.kind !== "unit").map(s => s.id));
  const cores = draft.spaces.filter(s => s.kind === "core");
  if (cores.length !== 1) issue("core-count", "층당 하나의 공용 코어가 필요합니다.");
  const connections = new Map(draft.spaces.map(s => [s.id, new Set<string>()]));
  try {
    draft.spaces.forEach((space, i) => {
      if (ids.has(space.id)) issue("duplicate-space", "공간 ID가 중복됐습니다.");
      ids.add(space.id);
      if (!planContains(outline, shapes[i])) issue("outside", `${space.label}: 층 외곽을 벗어납니다.`);
      const clearWidth = Math.min(space.widthM, space.depthM) - draft.settings.wallThicknessM;
      const minimum = space.kind === "unit" ? draft.settings.minimumUnitWidthM :
        space.kind === "corridor" ? draft.settings.corridorWidthM : 0;
      if (clearWidth <= 0 || clearWidth + GEOMETRY_EPS < minimum) issue("clear-width", `${space.label}: 설정 유효폭이 부족합니다.`);
      if (space.kind === "core" && (space.widthM < draft.settings.coreWidthM || space.depthM < draft.settings.coreDepthM)) issue("core-size", "설정한 코어 크기를 확보하지 못했습니다.");
      if (space.kind !== "unit") result.commonAreaSqm += space.widthM * space.depthM;
      for (let j = 0; j < i; j++) if (planIntersectionArea(shapes[i], shapes[j]) > GEOMETRY_EPS) issue("overlap", `${space.label}과 ${draft.spaces[j].label}이 겹칩니다.`);
    });
    const commonBudget = floor.zones.filter(z => z.useType === "common").reduce((sum, z) => sum + z.areaSqm, 0);
    if (result.commonAreaSqm > commonBudget + 0.01) issue("common-area-shortfall", "코어·복도 구획이 프로그램의 공용부 면적보다 " + (result.commonAreaSqm - commonBudget).toFixed(2) + "㎡ 큽니다.");
    for (const door of draft.doors) {
      if (!interiorDoorSegment(draft, door) || door.widthM + GEOMETRY_EPS < draft.settings.doorWidthM) {
        issue("door-invalid", "문이 공유 벽에 없거나 설정 유효폭이 부족합니다."); continue;
      }
      connections.get(door.from)?.add(door.to); connections.get(door.to)?.add(door.from);
    }
    // Do not route one household's access through another household.
    const commonConnected = new Set(cores.map(s => s.id)), queue = [...commonConnected];
    while (queue.length) for (const next of connections.get(queue.shift()!) ?? []) {
      if (commonIds.has(next) && !commonConnected.has(next)) { commonConnected.add(next); queue.push(next); }
    }
    for (const space of draft.spaces.filter(s => s.kind !== "unit")) {
      if (!commonConnected.has(space.id)) issue("common-disconnected", `${space.label}: 코어 연결이 없습니다.`);
    }
    const placed = draft.spaces.filter(s => s.kind === "unit");
    if (placed.length !== units.length) issue("unit-count", "현재 프로그램과 구획의 세대수가 다릅니다.");
    units.forEach(target => {
      const space = placed.find(s => s.id === target.id && s.zoneId === target.zoneId);
      if (!space) { issue("unit-missing", `${target.label}: 연결된 세대 구획이 없습니다.`); return; }
      const clearArea = Math.max(0, space.widthM - draft.settings.wallThicknessM) * Math.max(0, space.depthM - draft.settings.wallThicknessM);
      const connected = [...connections.get(space.id) ?? []].some(id => commonConnected.has(id));
      result.units.push({ id: space.id, label: space.label, clearAreaSqm: clearArea, targetAreaSqm: target.area, connected });
      if (!connected) issue("unit-disconnected", `${space.label}: 다른 세대를 거치지 않는 공용부 출입문이 없습니다.`);
      if (clearArea + 0.01 < target.area) issue("exclusive-area-shortfall", `${space.label}: 계획 전용면적보다 ${(target.area - clearArea).toFixed(2)}㎡ 부족합니다.`);
    });
    result.unassignedAreaSqm = Math.max(0, polygonAreaSqm(outline) - draft.spaces.reduce((sum, s) => sum + s.widthM * s.depthM, 0));
  } catch { issue("invalid-geometry", "다각형 연산을 완료하지 못했습니다."); }
  result.status = result.issues.some(i => i.status === "fail") ? "conflict" : "preliminary-fit";
  issue("professional-review", "상세 실 구획과 피난·코어 연결은 별도 예비 검사 항목입니다. 창호·채광·문 여닫힘·승강기·구조·방화 성능·법정 피난 적합성은 미확정입니다. 유효면적은 벽 두께 가정값이며 법정 전용면적 확정값이 아닙니다.", "review");
  return result;
}

/** Bounded rectangular templates, never a proof that an irregular floor cannot be designed. */
export function generateInteriorDraft(floor: FloorProgram, outline: PlanPoint[], rawSettings: InteriorSettings): {
  draft: InteriorDraft | null; assessment: InteriorAssessment | null; message: string;
} {
  const parsed = interiorSettingsSchema.safeParse(rawSettings);
  if (!parsed.success || !supportedProgram(floor) || !validPlanPolygon(outline)) {
    return { draft: null, assessment: null, message: "유효한 주거·공용부 프로그램, 층 외곽과 설정값이 필요합니다." };
  }
  const settings = parsed.data, units = targets(floor);
  let longest = 0, baseAngle = 0;
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length], length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length > longest) { longest = length; baseAngle = Math.atan2(b.z - a.z, b.x - a.x) * 180 / Math.PI; }
  });
  let best: { draft: InteriorDraft; assessment: InteriorAssessment; score: number } | null = null;
  for (const angle of [baseAngle, baseAngle + 90].map(a => ((a + 180) % 360 + 360) % 360 - 180)) {
    const points = outline.map(p => rotatePlanPoint(p, -angle));
    const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
    const minZ = Math.min(...points.map(p => p.z)), maxZ = Math.max(...points.map(p => p.z));
    const width = maxX - minX, depth = maxZ - minZ;
    const band = Math.max(settings.coreWidthM, settings.corridorWidthM + settings.wallThicknessM);
    if (width <= band || depth <= settings.coreDepthM + settings.doorWidthM + settings.wallThicknessM) continue;
    for (const right of [false, true]) {
      const spaces: InteriorSpace[] = [];
      const add = (id: string, kind: InteriorSpace["kind"], x: number, z: number, w: number, d: number, label: string, zoneId?: string) => {
        spaces.push({ id, kind, center: rotatePlanPoint({ x: x + w / 2, z: z + d / 2 }, angle), widthM: w, depthM: d, rotationDeg: angle, label, zoneId });
      };
      const bandX = right ? maxX - band : minX;
      add("core", "core", bandX, minZ, band, settings.coreDepthM, "코어");
      add("corridor", "corridor", bandX, minZ + settings.coreDepthM, band, depth - settings.coreDepthM, "공용 복도");
      const areaSum = units.reduce((sum, u) => sum + u.area, 0);
      let cursor = minZ;
      for (const unit of units) {
        const d = depth * unit.area / areaSum;
        add(unit.id, "unit", right ? minX : minX + band, cursor, width - band, d, unit.label, unit.zoneId);
        cursor += d;
      }
      const draft = reconnectInteriorDoors({
        version: INTERIOR_LAYOUT_VERSION, sourceOutline: structuredClone(outline), programBasis: interiorProgramBasis(floor),
        settings: { ...settings }, spaces, doors: [],
      } satisfies InteriorDraft);
      const assessment = assessInteriorLayout({ ...floor, interiorLayout: draft }, outline);
      if (assessment.issues.some(i => i.code === "outside" || i.code === "overlap" || i.code === "invalid-geometry")) continue;
      const score = assessment.issues.filter(i => i.status === "fail").length * 1e6 +
        assessment.units.reduce((sum, u) => sum + Math.max(0, u.targetAreaSqm - u.clearAreaSqm), 0);
      if (!best || score < best.score) best = { draft, assessment, score };
    }
  }
  return best ? { ...best, message: best.assessment.status === "preliminary-fit" ? "구획 예비 검사를 통과했습니다. 상세 설계·승인은 미확정입니다." : "검토 후보를 만들었습니다. 면적·폭·문 연결의 충돌을 확인하세요." }
    : { draft: null, assessment: null, message: "현재 직사각형 템플릿에서 후보를 찾지 못했습니다. 건축 불가능 판정은 아닙니다." };
}

export function interiorPlanningCheck(floor: FloorProgram, outline?: PlanPoint[]): PlanningCheck {
  const result = assessInteriorLayout(floor, outline);
  return { code: `interior-layout:${floor.id}`, label: `${floor.label} 실내 구획`,
    status: result.status === "conflict" ? "fail" : result.status === "missing" ? "unknown" : "review",
    message: result.status === "preliminary-fit" ? "구획·출입문·계획 면적 예비 확인. 상세 실내 설계·피난·구조·전문가 승인 미확정." : result.issues[0]?.message ?? "구획 확인 필요",
    source: INTERIOR_LAYOUT_VERSION };
}
