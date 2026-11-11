import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { validateJsonStructure } from "@/lib/http/bounded-json";
import { localParcelPolygons } from "@/lib/geo/parcel-topology";
import { assessInteriorLayout, DEFAULT_INTERIOR_SETTINGS, generateInteriorDraft, interiorDraftSchema } from "./interior-layout";
import { assessRoomLayout, generateRoomLayout } from "./room-layout";
import { DEFAULT_ROOM_SETTINGS } from "./room-layout-schema";
import { assessEgressCore, DEFAULT_EGRESS_SETTINGS, EGRESS_VERSION, egressPlanSchema, groundExitBasis, groundExitCandidates, stairReservation, type EgressPlan } from "./egress-core";
import { parkingEgressObstacles } from "./parking-egress-obstacles";
import { isPlanningGeometryLocked } from "./geometry-source";
import type { PlanningScenario } from "./types";
import type { PlanningGeometrySnapshot } from "./planning-geometry";
import type { PlanningParkingGeometrySnapshot } from "./planning-parking-geometry";

export const INTERIOR_AUTOMATION_VERSION = "interior-automation-2026.1" as const;
export const INTERIOR_AUTOMATION_BUDGET_MS = 8_000;
const optionsSchema = z.object({ replaceExisting: z.boolean(), bedrooms: z.number().int().min(0).max(3) }).strict();
export interface InteriorAutomationInput {
  scenario: PlanningScenario;
  geometry: PlanningGeometrySnapshot | null;
  parking: PlanningParkingGeometrySnapshot | null;
  options: z.infer<typeof optionsSchema>;
}
const candidateSchema = z.object({
  layouts: z.array(z.object({ floorId: z.string(), layout: interiorDraftSchema }).strict()).max(32),
  egressPlan: egressPlanSchema,
}).strict();
type Candidate = z.infer<typeof candidateSchema>;
export interface InteriorAutomationProgress { attempt: number; floor: number; totalFloors: number }
export interface InteriorAutomationResult {
  version: typeof INTERIOR_AUTOMATION_VERSION;
  sourceKey: string;
  status: "ready" | "no-candidate" | "incomplete" | "blocked";
  approvalStatus: "unverified";
  changed: boolean;
  attempts: number;
  rows: Array<{ floorId: string; label: string; interior: string; units: number; roomsReady: number; preserved: boolean }>;
  connectedFloors: number;
  issues: string[];
  candidate: Candidate | null;
}

/** Ephemeral preview binding, not a permit or a persisted approval. */
export function interiorAutomationInputKey(input: InteriorAutomationInput): string {
  if (!validateJsonStructure(input, { maxDepth: 32, maxNodes: 250000 }).ok) throw new Error("일괄 구획 입력 한도를 초과했습니다.");
  const text = JSON.stringify({ version: INTERIOR_AUTOMATION_VERSION, ...input });
  if (text.length > 4_000_000) throw new Error("일괄 구획 입력 한도를 초과했습니다.");
  return `PG-INTERIOR-${bytesToHex(sha256(new TextEncoder().encode(text)))}`;
}

function prerequisites(input: InteriorAutomationInput): string[] {
  const { scenario, geometry, parking } = input;
  if (!optionsSchema.safeParse(input.options).success) return ["생성 옵션이 올바르지 않습니다."];
  if (isPlanningGeometryLocked(scenario)) return ["잠긴 형상은 수정할 수 없습니다."];
  const floors = scenario.floorPrograms;
  if (!floors.length || floors.length > 32 || new Set(floors.map(f => f.id)).size !== floors.length ||
      new Set(floors.map(f => f.level)).size !== floors.length || !floors.some(f => f.level === 1) ||
      floors.some(f => !Number.isInteger(f.level) || f.level === 0)) return ["중복 없는 1~32개 층과 지상 1층이 필요합니다."];
  const units = floors.flatMap(f => f.zones.filter(z => z.useType === "residential"));
  if (!units.length || units.some(z => !Number.isInteger(z.unitCount) || z.unitCount < 1 || z.unitCount > 20) ||
      units.reduce((sum, z) => sum + z.unitCount, 0) > 120) return ["일괄 생성 범위는 전체 120세대 이하의 주거·공용부 계획입니다."];
  if (!geometry || geometry.projectId !== scenario.projectId || geometry.scenarioId !== scenario.id || geometry.scenarioVersion !== scenario.version ||
      geometry.validation.status !== "pass" || !geometry.validation.representativeEligible ||
      geometry.building.floors.length !== floors.length || floors.some(f => !geometry.building.floors.some(g =>
        g.id === f.id && g.level === f.level && Number.isFinite(g.baseHeightM) && g.shape.length >= 3 && g.shape.length <= 500))) {
    return ["현재 계획의 전체 층 외곽·높이 기하 검사가 필요합니다."];
  }
  if (!parking || parking.planningGeometryHash !== geometry.geometryHash || !parking.frontage.sourceMatched ||
      parking.layout.generationStatus !== "complete" || parking.validation.status === "fail") {
    return ["같은 형상의 도로 접면·주차 장애물 검사를 먼저 완료해야 합니다."];
  }
  return [];
}

function withCandidate(input: InteriorAutomationInput, candidate: Candidate): PlanningScenario {
  return { ...input.scenario, floorPrograms: input.scenario.floorPrograms.map(floor => ({ ...floor,
    interiorLayout: candidate.layouts.find(item => item.floorId === floor.id)?.layout })), egressPlan: candidate.egressPlan };
}

function inspect(input: InteriorAutomationInput, scenario: PlanningScenario, check: () => void) {
  const issues: string[] = [];
  const rows = scenario.floorPrograms.map(floor => {
    check();
    const outline = input.geometry!.building.floors.find(mass => mass.id === floor.id)!.shape;
    const interior = assessInteriorLayout(floor, outline);
    if (interior.status !== "preliminary-fit") issues.push(...interior.issues.filter(i => i.status !== "review").map(i => `${floor.label}: ${i.message}`));
    if (!floor.interiorLayout) issues.push(`${floor.label}: 구획 후보를 찾지 못했습니다.`);
    const units = floor.interiorLayout?.spaces.filter(space => space.kind === "unit") ?? [];
    let roomsReady = 0;
    for (const unit of units) {
      check();
      const result = assessRoomLayout(floor, unit.id, outline);
      if (result.status === "preliminary-fit") roomsReady++;
      else issues.push(`${floor.label} ${unit.label}: ${result.issues.find(i => i.status !== "review")?.message ?? "상세 실 후보 미확보"}`);
    }
    const rooms = floor.interiorLayout?.roomLayouts ?? [];
    if (new Set(rooms.map(room => room.unitId)).size !== rooms.length || rooms.some(room => !units.some(unit => unit.id === room.unitId))) {
      issues.push(`${floor.label}: 중복되거나 세대와 연결되지 않은 상세 실 구획이 있습니다.`);
    }
    return { floorId: floor.id, label: floor.label, interior: interior.status, units: units.length, roomsReady,
      preserved: !input.options.replaceExisting && !!input.scenario.floorPrograms.find(f => f.id === floor.id)?.interiorLayout };
  });
  check();
  const egress = assessEgressCore({ scenario, floors: input.geometry!.building.floors,
    parcelPolygons: localParcelPolygons(input.geometry!.parcel), groundObstacles: parkingEgressObstacles(input.parking) });
  if (egress.issues.some(issue => issue.code === "egress-geometry-budget")) throw new DOMException("피난 연결 계산 한도로 검사가 미완료입니다.", "TimeoutError");
  check();
  if (egress.status !== "preliminary-chain") issues.push(...egress.issues.filter(i => i.status !== "review").map(i => i.message));
  return { issues: [...new Set(issues)].slice(0, 120), rows, egress };
}

export function generateInteriorAutomation(input: InteriorAutomationInput, progress?: (value: InteriorAutomationProgress) => void): InteriorAutomationResult {
  const started = performance.now();
  const check = () => { if (performance.now() - started > INTERIOR_AUTOMATION_BUDGET_MS) throw new DOMException("일괄 구획 계산 한도를 초과했습니다.", "TimeoutError"); };
  const result: InteriorAutomationResult = { version: INTERIOR_AUTOMATION_VERSION, sourceKey: "", status: "blocked", approvalStatus: "unverified",
    changed: false, attempts: 0, rows: [], connectedFloors: 0, issues: [], candidate: null };
  try {
    result.sourceKey = interiorAutomationInputKey(input);
    result.issues = prerequisites(input);
    if (result.issues.length) return result;
    const basePlan: EgressPlan = input.scenario.egressPlan ?? { version: EGRESS_VERSION, settings: DEFAULT_EGRESS_SETTINGS };
    if (!egressPlanSchema.safeParse(basePlan).success) throw new Error("기존 피난 가정값을 확인해야 합니다.");
    const masses = [...input.geometry!.building.floors].sort((a, b) => a.level - b.level);
    const reservations = masses.slice(1).map((mass, i) => stairReservation(mass.baseHeightM - masses[i].baseHeightM, basePlan.settings));
    if (reservations.some(r => !r)) throw new Error("층간 높이에 맞는 계단 예약 공간을 계산하지 못했습니다.");
    const width = Math.max(DEFAULT_INTERIOR_SETTINGS.coreWidthM, ...reservations.map(r => r!.widthM + DEFAULT_INTERIOR_SETTINGS.wallThicknessM));
    const depth = Math.max(DEFAULT_INTERIOR_SETTINGS.coreDepthM, ...reservations.map(r => r!.depthM + DEFAULT_INTERIOR_SETTINGS.wallThicknessM));
    let bestScore = Infinity;
    // Bounded templates stop at the first complete fit; this is not an optimizer.
    for (const extraWidth of [0, 0.5]) for (const extraDepth of [0, 0.5, 1]) {
      check(); result.attempts++;
      const scenario = structuredClone(input.scenario);
      for (const [index, floor] of scenario.floorPrograms.entries()) {
        check(); progress?.({ attempt: result.attempts, floor: index, totalFloors: scenario.floorPrograms.length });
        const outline = input.geometry!.building.floors.find(mass => mass.id === floor.id)!.shape;
        if (!floor.interiorLayout || input.options.replaceExisting) {
          const settings = { ...(floor.interiorLayout?.settings ?? DEFAULT_INTERIOR_SETTINGS) };
          settings.coreWidthM = Math.max(settings.coreWidthM, width + extraWidth);
          settings.coreDepthM = Math.max(settings.coreDepthM, depth + extraDepth);
          floor.interiorLayout = generateInteriorDraft(floor, outline, settings).draft ?? undefined;
        }
        const layout = floor.interiorLayout;
        if (!layout) continue;
        for (const unit of layout.spaces.filter(space => space.kind === "unit")) {
          check();
          if (layout.roomLayouts?.some(room => room.unitId === unit.id)) continue;
          const generated = generateRoomLayout(floor, unit.id, outline, { ...DEFAULT_ROOM_SETTINGS, bedrooms: input.options.bedrooms });
          if (generated.draft) layout.roomLayouts = [...layout.roomLayouts ?? [], generated.draft];
        }
      }
      scenario.egressPlan = structuredClone(basePlan);
      const ground = scenario.floorPrograms.find(floor => floor.level === 1)!;
      let inspected: ReturnType<typeof inspect> | null = null;
      if ((!basePlan.exit || input.options.replaceExisting) && ground.interiorLayout) {
        const shape = input.geometry!.building.floors.find(mass => mass.id === ground.id)!.shape;
        for (const exit of groundExitCandidates(ground, shape)) {
          check();
          scenario.egressPlan.exit = { floorId: ground.id, spaceId: exit.spaceId, edgeIndex: exit.edgeIndex,
            offsetRatio: 0.5, widthM: Math.max(0.9, basePlan.settings.minimumDoorWidthM), layoutBasis: groundExitBasis(ground.interiorLayout) };
          const candidate = inspect(input, scenario, check);
          if (!inspected || candidate.issues.length < inspected.issues.length) inspected = candidate;
          if (!candidate.issues.length) break;
        }
      }
      inspected ??= inspect(input, scenario, check);
      const score = inspected.issues.length;
      if (score < bestScore) {
        bestScore = score; result.rows = inspected.rows; result.connectedFloors = inspected.egress.connectedFloors.length;
        result.issues = inspected.issues;
      }
      if (!score) {
        const candidate = candidateSchema.parse({ layouts: scenario.floorPrograms.map(floor => ({ floorId: floor.id, layout: floor.interiorLayout })),
          egressPlan: scenario.egressPlan });
        check();
        result.candidate = candidate; result.status = "ready";
        result.changed = JSON.stringify(scenario.floorPrograms) !== JSON.stringify(input.scenario.floorPrograms) ||
          JSON.stringify(scenario.egressPlan) !== JSON.stringify(input.scenario.egressPlan);
        return result;
      }
    }
    result.status = "no-candidate";
    result.issues.push("유한한 직사각형 템플릿에서 전체 연결 후보를 찾지 못했습니다. 설계 불가능 판정이 아닙니다.");
  } catch (error) {
    result.status = error instanceof Error && error.name === "TimeoutError" ? "incomplete" : "blocked";
    result.candidate = null; result.changed = false;
    result.issues = [error instanceof Error ? error.message : "일괄 구획 계산을 완료하지 못했습니다."];
  }
  return result;
}

export function applyInteriorAutomation(input: InteriorAutomationInput, result: InteriorAutomationResult): Partial<PlanningScenario> {
  if (result.version !== INTERIOR_AUTOMATION_VERSION || result.status !== "ready" || !result.changed ||
      result.sourceKey !== interiorAutomationInputKey(input) || prerequisites(input).length) throw new Error("생성 후 입력이 변경됐거나 적용할 후보가 없습니다. 다시 생성해 주세요.");
  const candidate = candidateSchema.parse(result.candidate);
  if (candidate.layouts.length !== input.scenario.floorPrograms.length || new Set(candidate.layouts.map(item => item.floorId)).size !== candidate.layouts.length ||
      candidate.layouts.some(item => !input.scenario.floorPrograms.some(floor => floor.id === item.floorId))) throw new Error("층 구획 연결이 올바르지 않습니다.");
  if (!input.options.replaceExisting) for (const floor of input.scenario.floorPrograms) {
    const next = candidate.layouts.find(item => item.floorId === floor.id)!.layout;
    if (floor.interiorLayout) {
      const { roomLayouts, ...parent } = interiorDraftSchema.parse(floor.interiorLayout);
      const { roomLayouts: nextRooms, ...nextParent } = next;
      if (JSON.stringify(parent) !== JSON.stringify(nextParent) || roomLayouts?.some(room =>
        JSON.stringify(room) !== JSON.stringify(nextRooms?.find(item => item.unitId === room.unitId)))) throw new Error("기존 구획을 바꾸는 후보는 덮어쓰기 동의가 필요합니다.");
    }
  }
  if (!input.options.replaceExisting && input.scenario.egressPlan?.exit && JSON.stringify(input.scenario.egressPlan) !== JSON.stringify(candidate.egressPlan)) {
    throw new Error("기존 출구 연결은 보존해야 합니다.");
  }
  const scenario = withCandidate(input, candidate);
  const started = performance.now();
  const checked = inspect(input, scenario, () => { if (performance.now() - started > INTERIOR_AUTOMATION_BUDGET_MS) throw new Error("후보 재검사 시간 한도를 초과했습니다."); });
  if (checked.issues.length) throw new Error(`후보 원본 재검사 실패: ${checked.issues[0]}`);
  // Only these two fields can change; areas, costs, parking and approval stay untouched.
  return { floorPrograms: scenario.floorPrograms, egressPlan: scenario.egressPlan };
}
