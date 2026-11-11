import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { assessInteriorLayout, interiorDoorSegment, interiorDraftSchema, type InteriorIssue } from "./interior-layout";
import { pathDoorSegment, pathSpaceShape } from "./interior-paths";
import { GEOMETRY_EPS, sharedPlanEdge, validPlanPolygon, type PlanPoint } from "./layout-geometry";
import { assessRoomLayout } from "./room-layout";
import type { FloorProgram, PlanningScenario } from "./types";

export const QUANTITY_TAKEOFF_VERSION = "quantity-takeoff-2026.2" as const;
export const QUANTITY_ITEM_IDS = ["partitionLengthM", "interiorDoorCount", "entryDoorCount", "dryFloorAreaSqm",
  "wetFloorAreaSqm", "kitchenCount", "bathroomCount"] as const;
export type QuantityItemId = typeof QUANTITY_ITEM_IDS[number];

export interface QuantityTakeoff {
  version: typeof QUANTITY_TAKEOFF_VERSION;
  status: "preliminary" | "missing" | "conflict";
  basis: string;
  items: Array<{ id: QuantityItemId; label: string; unit: "m" | "m2" | "count"; quantity: number | null; detail: string }>;
  issues: string[];
  limitations: string[];
}

const ITEM_METADATA: Record<QuantityItemId, { label: string; unit: "m" | "m2" | "count"; detail: string }> = {
  partitionLengthM: { label: "세대 내부 칸막이 길이", unit: "m", detail: "실 사이 공유 벽선의 합집합 길이. 문 개구부를 차감하지 않은 총길이이며 외곽·공용부·코어 벽은 제외합니다." },
  interiorDoorCount: { label: "세대 내부 문", unit: "count", detail: "상세 실 사이의 물리적 개구부 수. 현관 사본은 포함하지 않습니다." },
  entryDoorCount: { label: "세대 현관문", unit: "count", detail: "층 구획에 저장된 실제 세대-공용부 출입문 수. 공용부끼리의 문·공용 출구 및 상세 실의 현관 사본은 제외하며 세대당 하나로 제한하지 않습니다." },
  dryFloorAreaSqm: { label: "세대 건식 바닥 면적", unit: "m2", detail: "욕실을 제외한 세대 내 실의 벽 두께 가정 차감 유효면적. 주방도 건식으로 분류하며 공용부 바닥은 제외합니다." },
  wetFloorAreaSqm: { label: "세대 욕실 바닥 면적", unit: "m2", detail: "욕실의 벽 두께 가정 차감 유효면적. 실제 방수 시공면적이나 벽 방수 면적이 아닙니다." },
  kitchenCount: { label: "주방", unit: "count", detail: "검증된 세대 상세 실 구획의 주방 수. 기기·배관 수량은 제외합니다." },
  bathroomCount: { label: "욕실", unit: "count", detail: "검증된 세대 상세 실 구획의 욕실 수. 위생기구·배관 수량은 제외합니다." },
};

const identifier = z.string().trim().min(1).max(200);
const scalar = z.number().finite().min(0).max(1e9);
const floorSchema = z.object({
  id: identifier, label: z.string().max(160), level: z.number().int().min(-32).max(32).refine(n => n !== 0),
  floorHeightM: z.number().finite().positive().max(12), footprintScalePct: z.number().finite().positive().max(100), northSetbackM: scalar,
  zones: z.array(z.object({
    id: identifier, label: z.string().max(160).optional(),
    useType: z.enum(["residential", "retail", "office", "parking", "piloti", "common", "mechanical", "storage", "other"]),
    areaSqm: scalar, unitCount: z.number().finite().int().min(0).max(500),
    revenueModel: z.enum(["sale", "lease", "non-revenue"]).optional(),
    saleableAreaSqm: scalar.optional(), rentableAreaSqm: scalar.optional(), parkingExclusiveAreaSqm: scalar.optional(),
  }).passthrough()).min(1).max(32),
  interiorLayout: z.unknown().optional(),
}).passthrough();
const scenarioSchema = z.object({
  id: identifier, projectId: identifier.optional(), floorPrograms: z.array(floorSchema).min(1).max(32),
  placement: z.object({ rotationDeg: z.number().finite().min(-360).max(360),
    offsetXM: z.number().finite().min(-1e6).max(1e6), offsetZM: z.number().finite().min(-1e6).max(1e6),
    roadSetbackM: scalar, northSetbackM: scalar }),
});
const timestamps = new Set(["createdAt", "updatedAt", "generatedAt", "calculatedAt", "observedAt", "recordedAt", "verifiedAt", "lockedAt", "timestamp"]);
class InputProblem extends Error {
  constructor(readonly status: "missing" | "conflict", message: string) { super(message); }
}

// Bound and canonicalize all source fields before hashing; the plan and review packet
// retain the full raw model. A digest avoids duplicating that model in every cost case.
// Caches, revisions, cost plans and lifecycle timestamps do not enter the basis.
function boundedInput(scenario: PlanningScenario): { raw: unknown; basis: string } {
  let nodes = 0, characters = 0;
  const active = new Set<object>();
  const visit = (value: unknown, depth: number): unknown => {
    const limit = () => { throw new InputProblem("missing", "수량 산출 입력량 한도를 초과했습니다."); };
    if (++nodes > 100000 || depth > 24) limit();
    if (value === undefined || value === null || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      characters += value.length;
      if (value.length > 100000 || characters > 2000000) limit();
      return value;
    }
    if (typeof value !== "object" || active.has(value)) throw new InputProblem("conflict", "수량 입력에 유한하지 않은 숫자, 순환 참조 또는 지원하지 않는 형식이 있습니다.");
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new InputProblem("conflict", "수량 입력은 일반 JSON 객체여야 합니다.");
    }
    active.add(value);
    let result: unknown;
    if (Array.isArray(value)) {
      if (value.length > 512) limit();
      result = value.map(child => visit(child, depth + 1));
    } else {
      const keys = Object.keys(value).sort();
      if (keys.length > 128) limit();
      for (const key of keys) {
        characters += key.length;
        if (key.length > 100000 || characters > 2000000) limit();
      }
      result = Object.fromEntries(keys.filter(key => !timestamps.has(key)).map(key => [key, visit((value as Record<string, unknown>)[key], depth + 1)]));
    }
    active.delete(value);
    return result;
  };
  if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) throw new InputProblem("missing", "저장된 계획안이 없습니다.");
  const raw = visit({ id: scenario.id, projectId: scenario.projectId, placement: scenario.placement,
    floorPrograms: scenario.floorPrograms, dwellingProgram: scenario.dwellingProgram, materials: scenario.materials }, 0);
  return { raw, basis: `${QUANTITY_TAKEOFF_VERSION}:sha256:${bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(raw))))}` };
}

function schemaStatus(error: z.ZodError): "missing" | "conflict" {
  return error.issues.every(i => ((i.code === "invalid_type" || i.code === "invalid_value") && (i.input === undefined || i.input === null)) ||
    ((i.code === "too_small" || i.code === "too_big") && i.origin === "array")) ? "missing" : "conflict";
}

type Segment = [PlanPoint, PlanPoint];
function length(segment: Segment) { return Math.hypot(segment[1].x - segment[0].x, segment[1].z - segment[0].z); }
function projection(base: Segment, other: Segment): [number, number] | null {
  const size = length(base), ux = (base[1].x - base[0].x) / size, uz = (base[1].z - base[0].z) / size;
  if (other.some(p => Math.abs((p.x - base[0].x) * uz - (p.z - base[0].z) * ux) > GEOMETRY_EPS)) return null;
  const positions = other.map(p => (p.x - base[0].x) * ux + (p.z - base[0].z) * uz);
  return [Math.min(...positions), Math.max(...positions)];
}

// Group collinear shared pieces, then union intervals: subdivisions and T junctions
// must not count a physical wall twice, even with reversed or rotated edges.
function sharedWallLength(shapes: PlanPoint[][]): number {
  const lines: Array<{ base: Segment; intervals: Array<[number, number]> }> = [];
  for (let i = 0; i < shapes.length; i++) for (let j = 0; j < i; j++) {
    const edge = sharedPlanEdge(shapes[i], shapes[j]);
    if (!edge) continue;
    let found = false;
    for (const line of lines) {
      const interval = projection(line.base, edge);
      if (!interval) continue;
      line.intervals.push(interval); found = true; break;
    }
    if (!found) lines.push({ base: edge, intervals: [[0, length(edge)]] });
  }
  return lines.reduce((total, line) => {
    const intervals = line.intervals.sort((a, b) => a[0] - b[0]);
    let [lo, hi] = intervals[0], sum = 0;
    for (const [start, end] of intervals.slice(1)) {
      if (start <= hi + GEOMETRY_EPS) hi = Math.max(hi, end);
      else { sum += hi - lo; lo = start; hi = end; }
    }
    return total + sum + hi - lo;
  }, 0);
}

function uniqueDoorCount(segments: Segment[]): number {
  const unique: Segment[] = [];
  for (const segment of segments) {
    let duplicate = false;
    for (const previous of unique) {
      const interval = projection(previous, segment);
      if (!interval) continue;
      const size = length(previous), [lo, hi] = interval;
      if (Math.abs(lo) <= GEOMETRY_EPS && Math.abs(hi - size) <= GEOMETRY_EPS) { duplicate = true; break; }
      if (Math.min(hi, size) - Math.max(lo, 0) > GEOMETRY_EPS) {
        throw new InputProblem("conflict", "서로 다른 출입문 개구부가 일부 겹칩니다. 물리적 문 수를 확정할 수 없습니다.");
      }
    }
    if (!duplicate) unique.push(segment);
  }
  return unique.length;
}

export function takeoffPlanningQuantities(scenario: PlanningScenario): QuantityTakeoff {
  const result: QuantityTakeoff = {
    version: QUANTITY_TAKEOFF_VERSION, status: "preliminary", basis: "",
    items: QUANTITY_ITEM_IDS.map(id => ({ id, ...ITEM_METADATA[id], quantity: null })), issues: [],
    limitations: [
      "저장된 모델과 가정에 따른 예비 수량이며 실측·법정 면적·허가·전문가 승인 결과가 아닙니다. 공식 경계는 미확정입니다.",
      "저장된 sourceOutline으로만 구획을 검사합니다. 현재 실제 층 외곽과의 좌표 결합·최신성 검증은 별도 통합 검증이 필요합니다.",
      "외벽·구조체·공용부 및 코어 벽·공용부 마감·창호·기계전기배관(MEP)·소방 상세 수량은 포함하지 않습니다.",
      "방화 성능·피난 적합성·문 여닫힘·시공 손실률·견적 단가·공사비는 검증하거나 계산하지 않습니다.",
      "전체 계획안이 주거·공용부·주차·필로티인 경우만 지원합니다. 최대 32개 층, 층당 20세대, 전체 120세대와 외곽 128개 꼭짓점으로 제한됩니다.",
    ],
  };
  const issue = (status: "missing" | "conflict", detail: string) => {
    if (result.status !== "conflict") result.status = status;
    if (result.issues.length < 128) result.issues.push(detail);
  };
  const assessmentIssues = (label: string, assessment: { status: string; issues: InteriorIssue[] }) => {
    if (assessment.status === "preliminary-fit") return;
    issue(assessment.status === "conflict" ? "conflict" : "missing", label + ": " +
      assessment.issues.filter(i => i.status !== "review").slice(0, 8).map(i => `${i.code}: ${i.message}`).join("; "));
  };
  try {
    const input = boundedInput(scenario);
    result.basis = input.basis;
    const parsed = scenarioSchema.safeParse(input.raw, { reportInput: true });
    if (!parsed.success) {
      issue(schemaStatus(parsed.error), "계획안의 층·용도·면적·세대수·배치 형식 또는 입력 한도를 확인해야 합니다."); return result;
    }
    const floors = parsed.data.floorPrograms;
    if (floors.some(f => f.zones.some(zone => !["residential", "common", "parking", "piloti"].includes(zone.useType)))) {
      issue("missing", "비주거 용도가 포함되어 전체 계획안의 항목별 수량 산출을 지원하지 않습니다."); return result;
    }
    const unitCounts = floors.map(f => f.zones.filter(zone => zone.useType === "residential").reduce((sum, zone) => sum + zone.unitCount, 0));
    if (unitCounts.some(n => n > 20) || unitCounts.reduce((a, b) => a + b, 0) > 120) {
      issue("missing", "층당 20세대 또는 전체 120세대 수량 산출 한도를 초과했습니다."); return result;
    }
    if (new Set(floors.map(f => f.id)).size !== floors.length || new Set(floors.map(f => f.level)).size !== floors.length) {
      issue("conflict", "층 ID 또는 층 번호가 중복되어 전체 수량을 집계할 수 없습니다."); return result;
    }
    const totals: Record<QuantityItemId, number> = { partitionLengthM: 0, interiorDoorCount: 0, entryDoorCount: 0,
      dryFloorAreaSqm: 0, wetFloorAreaSqm: 0, kitchenCount: 0, bathroomCount: 0 };
    for (const raw of floors) {
      const label = raw.label || raw.id;
      if (new Set(raw.zones.map(zone => zone.id)).size !== raw.zones.length || raw.zones.some(zone =>
        zone.useType === "residential" ? zone.unitCount < 1 || zone.areaSqm <= 0 : zone.unitCount !== 0)) {
        issue("conflict", label + ": 용도 구역 ID 또는 세대수·면적이 올바르지 않습니다."); continue;
      }
      if (!raw.interiorLayout) { issue("missing", label + ": 저장된 실내 구획이 없습니다."); continue; }
      const parent = interiorDraftSchema.safeParse(raw.interiorLayout, { reportInput: true });
      if (!parent.success) { issue(schemaStatus(parent.error), label + ": 실내·상세 실 구획 형식 또는 입력 한도가 올바르지 않습니다."); continue; }
      const draft = parent.data, outline = draft.sourceOutline;
      if (outline.length > 128) { issue("missing", label + ": 저장 외곽의 꼭짓점 한도를 초과했습니다."); continue; }
      if (!validPlanPolygon(outline)) { issue("conflict", label + ": 저장 외곽 다각형이 올바르지 않습니다."); continue; }
      const floor: FloorProgram = { ...raw, interiorLayout: draft };
      const outer = assessInteriorLayout(floor, outline);
      assessmentIssues(label, outer);
      if (outer.status !== "preliminary-fit") continue;
      const units = draft.spaces.filter(space => space.kind === "unit");
      if (draft.roomLayouts?.some(room => !units.some(unit => unit.id === room.unitId))) {
        issue("conflict", label + ": 연결된 세대가 없는 상세 실 구획이 있습니다."); continue;
      }
      const parentSegments: Segment[] = [], entrySegments: Segment[] = [];
      for (const door of draft.doors) {
        if ([door.from, door.to].every(id => units.some(unit => unit.id === id))) throw new InputProblem("conflict", label + ": 세대 사이의 직접 출입문은 산출 범위 밖입니다.");
        const segment = interiorDoorSegment(draft, door);
        if (!segment) throw new InputProblem("conflict", label + ": 층 출입문 개구부를 확인할 수 없습니다.");
        parentSegments.push(segment);
        if ([door.from, door.to].some(id => units.some(unit => unit.id === id))) entrySegments.push(segment);
      }
      uniqueDoorCount(parentSegments);
      totals.entryDoorCount += uniqueDoorCount(entrySegments);
      for (const unit of units) {
        const rooms = assessRoomLayout(floor, unit.id, outline);
        assessmentIssues(`${label}/${unit.label}`, rooms);
        if (rooms.status !== "preliminary-fit") continue;
        const room = draft.roomLayouts!.find(r => r.unitId === unit.id)!;
        const coveredArea = room.spaces.reduce((sum, space) => sum + space.widthM * space.depthM, 0);
        if (Math.abs(coveredArea - rooms.unitEnvelopeSqm) > 0.01) {
          issue("missing", `${label}/${unit.label}: 상세 실이 세대 전체를 구획하지 않아 일부 수량만 산출할 수 있습니다.`); continue;
        }
        totals.partitionLengthM += sharedWallLength(room.spaces.map(pathSpaceShape));
        const segments = room.doors.map(door => {
          const segment = pathDoorSegment(room.spaces, door, room.settings.wallThicknessM);
          if (!segment) throw new InputProblem("conflict", label + ": 실 출입문 개구부를 확인할 수 없습니다.");
          return segment;
        });
        totals.interiorDoorCount += uniqueDoorCount(segments);
        for (const space of rooms.rooms) {
          totals[space.kind === "bathroom" ? "wetFloorAreaSqm" : "dryFloorAreaSqm"] += space.clearAreaSqm;
          if (space.kind === "kitchen") totals.kitchenCount++;
          if (space.kind === "bathroom") totals.bathroomCount++;
        }
      }
    }
    if (result.status === "preliminary") {
      if (Object.values(totals).some(n => !Number.isFinite(n) || n < 0)) throw new InputProblem("conflict", "집계 수량이 유효한 유한 숫자가 아닙니다.");
      for (const item of result.items) item.quantity = totals[item.id];
    }
  } catch (error) {
    issue(error instanceof InputProblem ? error.status : "conflict", error instanceof InputProblem ? error.message : "수량 입력 또는 기하 연산을 완료하지 못했습니다.");
  }
  return result;
}
