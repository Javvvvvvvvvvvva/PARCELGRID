import type { FloorProgram, PlanningCheck } from "./types";
import { assessInteriorLayout, interiorDoorSegment, type InteriorDraft, type InteriorIssue, type InteriorSpace } from "./interior-layout";
import { openingOnEdge, planContains, planIntersectionArea, planRectangle, rotatePlanPoint, type PlanPoint } from "./layout-geometry";
import { connectPathSpaces, pathDoorSegment, pathLength, pathSpaceShape, traceSpacePath } from "./interior-paths";
import { ROOM_LAYOUT_VERSION, roomDraftSchema, roomSettingsSchema, type RoomDraft, type RoomSettings, type RoomSpace } from "./room-layout-schema";

export interface RoomAssessment {
  status: "preliminary-fit" | "conflict" | "missing";
  approvalStatus: "unverified";
  issues: InteriorIssue[];
  rooms: Array<{ id: string; label: string; kind: RoomSpace["kind"]; clearAreaSqm: number; route: PlanPoint[] | null; candidateDistanceM: number | null }>;
  entryPoint: PlanPoint | null;
  clearAreaSqm: number;
  unitEnvelopeSqm: number;
}
const doorKey = (d: InteriorDraft["doors"][number]) => JSON.stringify([d.from, d.to, d.center.x, d.center.z, d.widthM]);
function validEntries(parent: InteriorDraft, unit: InteriorSpace) {
  return parent.doors.filter(door => {
    const other = door.from === unit.id ? door.to : door.to === unit.id ? door.from : null;
    return other && parent.spaces.some(s => s.id === other && s.kind !== "unit") && interiorDoorSegment(parent, door);
  });
}
export function roomParentBasis(parent: InteriorDraft, unit: InteriorSpace): string {
  return JSON.stringify({ unit: { id: unit.id, zoneId: unit.zoneId, center: unit.center, widthM: unit.widthM, depthM: unit.depthM, rotationDeg: unit.rotationDeg },
    wallThicknessM: parent.settings.wallThicknessM, entries: validEntries(parent, unit).map(doorKey).sort() });
}
export function roomEnvelope(parent: InteriorDraft, unit: InteriorSpace) {
  return planRectangle(unit.center, Math.max(0, unit.widthM - parent.settings.wallThicknessM),
    Math.max(0, unit.depthM - parent.settings.wallThicknessM), unit.rotationDeg);
}
export function roomEntryPoint(parent: InteriorDraft, unit: InteriorSpace, draft: RoomDraft): PlanPoint | null {
  if (!validEntries(parent, unit).some(d => doorKey(d) === doorKey(draft.entryDoor))) return null;
  const p = rotatePlanPoint({ x: draft.entryDoor.center.x - unit.center.x, z: draft.entryDoor.center.z - unit.center.z }, -unit.rotationDeg);
  const w = (unit.widthM - parent.settings.wallThicknessM) / 2, d = (unit.depthM - parent.settings.wallThicknessM) / 2;
  if (w <= 0 || d <= 0) return null;
  const r = rotatePlanPoint({ x: Math.max(-w, Math.min(w, p.x)), z: Math.max(-d, Math.min(d, p.z)) }, unit.rotationDeg);
  return { x: r.x + unit.center.x, z: r.z + unit.center.z };
}
export function reconnectRoomDoors(draft: RoomDraft): RoomDraft {
  const halls = new Set(draft.spaces.filter(s => s.kind === "hall").map(s => s.id));
  return { ...draft, doors: connectPathSpaces(draft.spaces, (a, b) => halls.has(a.id) || halls.has(b.id),
    draft.settings.doorWidthM, draft.settings.wallThicknessM) };
}

export function assessRoomLayout(floor: FloorProgram, unitId: string, outline?: PlanPoint[]): RoomAssessment {
  const result: RoomAssessment = { status: "missing", approvalStatus: "unverified", issues: [], rooms: [], entryPoint: null, clearAreaSqm: 0, unitEnvelopeSqm: 0 };
  const issue = (code: string, message: string, status: InteriorIssue["status"] = "fail") => result.issues.push({ code, message, status });
  const parent = floor.interiorLayout, unit = parent?.spaces.find(s => s.id === unitId && s.kind === "unit");
  if (!parent || !unit) { issue("parent-missing", "연결된 세대 구획이 없습니다.", "unknown"); return result; }
  const outer = assessInteriorLayout(floor, outline);
  if (outer.status !== "preliminary-fit") issue("parent-unverified", "상위 층 구획의 외곽·면적·출입문 검증이 완료되지 않았습니다.", outer.status === "conflict" ? "fail" : "unknown");
  const raw = parent.roomLayouts?.find(d => d.unitId === unitId);
  if (!raw) { issue("rooms-missing", "저장된 방·주방·욕실 구획이 없습니다.", "unknown"); return result; }
  const parsed = roomDraftSchema.safeParse(raw);
  if (!parsed.success) { result.status = "conflict"; issue("invalid-room-data", "상세 실 좌표·치수·문 데이터가 올바르지 않습니다."); return result; }
  const draft = parsed.data, wall = draft.settings.wallThicknessM;
  if (draft.parentBasis !== roomParentBasis(parent, unit)) issue("stale-parent", "세대 외곽·벽 두께 또는 현관이 변경됐습니다. 상세 구획을 다시 생성해야 합니다.");
  if (parent.roomLayouts?.filter(d => d.unitId === unitId).length !== 1) issue("duplicate-unit", "같은 세대의 상세 구획이 중복 저장됐습니다.");
  const envelope = roomEnvelope(parent, unit);
  result.unitEnvelopeSqm = Math.max(0, unit.widthM - parent.settings.wallThicknessM) * Math.max(0, unit.depthM - parent.settings.wallThicknessM);
  const count = (kind: RoomSpace["kind"]) => draft.spaces.filter(s => s.kind === kind).length;
  if (count("bedroom") !== draft.settings.bedrooms || count("living") !== 1 || count("bathroom") !== 1 || count("kitchen") !== 1 || count("hall") < 1) {
    issue("room-program", "침실 설정 수와 거실·주방·욕실·통로 구성을 확인해야 합니다.");
  }
  const ids = new Set<string>(), shapes = draft.spaces.map(pathSpaceShape);
  try {
    draft.spaces.forEach((space, i) => {
      if (ids.has(space.id)) issue("duplicate-room", "실 ID가 중복됐습니다.");
      ids.add(space.id);
      if (!planContains(envelope, shapes[i])) issue("room-outside", space.label + ": 세대 유효 외곽을 벗어납니다.");
      const width = Math.min(space.widthM, space.depthM) - wall;
      const minimumWidth = space.kind === "hall" ? draft.settings.hallWidthM : ["bedroom", "living"].includes(space.kind) ? 2 : 1.2;
      const clearAreaSqm = Math.max(0, space.widthM - wall) * Math.max(0, space.depthM - wall);
      const minimumArea = space.kind === "bedroom" ? draft.settings.minimumBedroomAreaSqm : space.kind === "living" ? draft.settings.minimumLivingAreaSqm :
        space.kind === "kitchen" ? 4 : space.kind === "bathroom" ? 3 : 0;
      if (width + 1e-5 < minimumWidth || clearAreaSqm + 1e-5 < minimumArea) issue("room-size", space.label + ": 모델의 유효폭·면적 가정이 부족합니다.");
      result.clearAreaSqm += clearAreaSqm;
      for (let j = 0; j < i; j++) if (planIntersectionArea(shapes[i], shapes[j]) > 1e-5) issue("room-overlap", space.label + "과 " + draft.spaces[j].label + "이 겹칩니다.");
      result.rooms.push({ id: space.id, label: space.label, kind: space.kind, clearAreaSqm, route: null, candidateDistanceM: null });
    });
    for (const door of draft.doors) {
      if (door.widthM + 1e-5 < draft.settings.doorWidthM || !pathDoorSegment(draft.spaces, door, wall)) issue("room-door", "실 출입문의 공유 벽·위치·유효폭을 확인해야 합니다.");
    }
    const entry = roomEntryPoint(parent, unit, draft);
    result.entryPoint = entry;
    const entrance = entry && draft.spaces.find(space => space.kind === "hall" && pathSpaceShape(space).some((p, i, shape) =>
      openingOnEdge([p, shape[(i + 1) % shape.length]], entry, draft.entryDoor.widthM, wall / 2)));
    if (!entrance || !entry) issue("entry-disconnected", "세대 현관이 내부 통로의 유효 개구부와 연결되지 않습니다.");
    else {
      const halls = new Set(draft.spaces.filter(s => s.kind === "hall").map(s => s.id));
      for (const room of result.rooms) {
        const space = draft.spaces.find(s => s.id === room.id)!;
        const route = traceSpacePath({ spaces: draft.spaces, doors: draft.doors, startId: room.id, targetId: entrance.id,
          transitIds: halls, wallM: wall, minimumDoorWidthM: draft.settings.doorWidthM });
        if (!route) { issue("room-disconnected", room.label + ": 다른 실을 통과하지 않는 현관 연결이 없습니다."); continue; }
        const corners = planRectangle(space.center, Math.max(0, space.widthM - wall), Math.max(0, space.depthM - wall), space.rotationDeg);
        room.route = [corners[0], ...route, entry];
        room.candidateDistanceM = pathLength(room.route);
      }
    }
  } catch { issue("room-geometry", "실 다각형 연산을 완료하지 못했습니다."); }
  result.status = result.issues.some(i => i.status === "fail") ? "conflict" : result.issues.some(i => i.status === "unknown") ? "missing" : "preliminary-fit";
  issue("room-scope", "치수는 설계 가정이며 경로는 가구 없는 중심선 후보입니다. 창호·채광·환기·급배수·방수·가구·문 여닫힘·법정 피난거리는 미검증입니다.", "review");
  return result;
}

export function generateRoomLayout(floor: FloorProgram, unitId: string, outline: PlanPoint[], raw: RoomSettings): { draft: RoomDraft | null; message: string } {
  const parsed = roomSettingsSchema.safeParse(raw), parent = floor.interiorLayout;
  const unit = parent?.spaces.find(s => s.id === unitId && s.kind === "unit");
  if (!parsed.success || !parent || !unit || assessInteriorLayout(floor, outline).status !== "preliminary-fit") {
    return { draft: null, message: "현재 층 구획의 외곽·면적·문 연결과 설정값을 먼저 확인해야 합니다." };
  }
  const settings = parsed.data;
  let best: { draft: RoomDraft; score: number } | null = null;
  for (const entryDoor of validEntries(parent, unit)) for (const turn of [0, 90, 180, 270]) {
    const angle = ((unit.rotationDeg + turn + 180) % 360 + 360) % 360 - 180;
    const points = roomEnvelope(parent, unit).map(p => rotatePlanPoint({ x: p.x - unit.center.x, z: p.z - unit.center.z }, -angle));
    const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
    const minZ = Math.min(...points.map(p => p.z)), maxZ = Math.max(...points.map(p => p.z));
    const entry = rotatePlanPoint({ x: entryDoor.center.x - unit.center.x, z: entryDoor.center.z - unit.center.z }, -angle);
    if (Math.abs(entry.z - minZ) > parent.settings.wallThicknessM / 2 + 1e-4) continue;
    const hall = Math.max(settings.hallWidthM + settings.wallThicknessM, entryDoor.widthM + settings.wallThicknessM);
    const crossZ = minZ + settings.serviceDepthM, rearZ = crossZ + hall;
    const leftWidth = entry.x - hall / 2 - minX, rightX = entry.x + hall / 2;
    if (leftWidth <= 0.1 || maxX - rightX <= 0.1 || maxZ - rearZ <= 0.1) continue;
    const spaces: RoomSpace[] = [];
    const add = (id: string, kind: RoomSpace["kind"], x: number, z: number, widthM: number, depthM: number, label: string) => {
      const center = rotatePlanPoint({ x: x + widthM / 2, z: z + depthM / 2 }, angle);
      spaces.push({ id, kind, label, center: { x: center.x + unit.center.x, z: center.z + unit.center.z }, widthM, depthM, rotationDeg: angle });
    };
    add("entry", "hall", entry.x - hall / 2, minZ, hall, settings.serviceDepthM, "현관 통로");
    add("cross-hall", "hall", minX, crossZ, maxX - minX, hall, "내부 통로");
    add("bathroom", "bathroom", minX, minZ, leftWidth, settings.serviceDepthM, "욕실");
    add("kitchen", "kitchen", rightX, minZ, maxX - rightX, settings.serviceDepthM, "주방");
    const bedroomWidth = (maxX - minX) / (settings.bedrooms + 1.2);
    for (let i = 0; i < settings.bedrooms; i++) add("bedroom-" + (i + 1), "bedroom", minX + i * bedroomWidth, rearZ, bedroomWidth, maxZ - rearZ, "침실 " + (i + 1));
    add("living", "living", minX + settings.bedrooms * bedroomWidth, rearZ, (maxX - minX) - settings.bedrooms * bedroomWidth, maxZ - rearZ,
      settings.bedrooms === 0 ? "거실·취침" : "거실");
    const draft = reconnectRoomDoors({ version: ROOM_LAYOUT_VERSION, unitId, parentBasis: roomParentBasis(parent, unit), settings: { ...settings },
      entryDoor: structuredClone(entryDoor), spaces, doors: [] });
    const assessment = assessRoomLayout({ ...floor, interiorLayout: { ...parent, roomLayouts: [draft] } }, unitId, outline);
    const score = assessment.issues.filter(i => i.status === "fail" || i.status === "unknown").length;
    if (!best || score < best.score) best = { draft, score };
  }
  return best ? { draft: best.draft, message: best.score ? "상세 구획 후보를 생성했습니다. 치수·출입 연결 충돌이 남아 있습니다." : "상세 구획 예비 확인. 법정 적합성·설비·전문가 승인은 미확정입니다." }
    : { draft: null, message: "현재 현관 위치에서 상세 구획 템플릿을 찾지 못했습니다. 설계 불가능 판정은 아닙니다." };
}

export function roomPlanningCheck(floor: FloorProgram, outline?: PlanPoint[]): PlanningCheck {
  const units = floor.interiorLayout?.spaces.filter(s => s.kind === "unit") ?? [];
  const results = units.map(u => assessRoomLayout(floor, u.id, outline));
  const orphan = floor.interiorLayout?.roomLayouts?.some(d => !units.some(u => u.id === d.unitId));
  const issues = results.flatMap(r => r.issues);
  return { code: "room-layout:" + floor.id, label: floor.label + " 상세 실·현관",
    status: orphan || issues.some(i => i.status === "fail") ? "fail" : !units.length || results.some(r => r.status === "missing") ? "unknown" : "review",
    message: orphan ? "삭제된 세대에 연결된 상세 구획이 남아 있습니다." : issues.find(i => i.status === "fail" || i.status === "unknown")?.message ??
      (units.length ? "실별 구획·현관 연결 예비 확인. 상세 설계·법정 피난 적합성·승인은 미확정입니다." : "세대별 상세 실 구획이 필요합니다."),
    source: ROOM_LAYOUT_VERSION };
}
