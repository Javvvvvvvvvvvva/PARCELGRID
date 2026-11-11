import type { FloorProgram, FloorZone, PlanningScenario, PlanningScenarioCalculation } from "./types";
import { planningGeometryInputBasis, type PlanningGeometrySnapshot } from "./planning-geometry";
import { polygonAreaSqm } from "./planning-massing";
import { assessInteriorLayout, interiorDraftSchema, interiorProgramBasis, type InteriorDraft } from "./interior-layout";
import { assessRoomLayout, roomParentBasis } from "./room-layout";
import { calculatePlanningScenario, type PlanningCalculationContext } from "./scenario-calculator";
import { resolveZoneRevenueModel } from "./scenario-utils";
import { groundExitBasis } from "./egress-core";
import { isPlanningGeometryLocked } from "./geometry-source";
import { dwellingSaleBreakdown } from "./dwelling-pricing";
import { layoutFinanceBinding, layoutFinanceHistorySchema, layoutFinanceKey, layoutFinanceOptionsSchema,
  LAYOUT_FINANCE_VERSION, type LayoutFinanceApplication, type LayoutFinanceOptions } from "./layout-finance-state";

export interface LayoutFinancePreview {
  status: "ready" | "blocked";
  sourceKey: string; options: LayoutFinanceOptions;
  issues: string[]; notes: string[];
  rows: Array<{ floorId: string; floorLabel: string; unitId: string; label: string; model: string;
    beforeRevenueSqm: number; beforeExclusiveSqm: number | null; envelopeClearSqm: number; proposedSqm: number }>;
  floors: Array<{ id: string; label: string; grossSqm: number; commonBeforeSqm: number; commonAfterSqm: number; geometricCommonSqm: number }>;
  candidate: PlanningScenario | null;
  before: PlanningScenarioCalculation | null; after: PlanningScenarioCalculation | null;
  changed: boolean;
  beforeFloors: LayoutFinanceApplication["beforeFloors"];
}
export interface LayoutFinanceInput {
  scenario: PlanningScenario; geometry: PlanningGeometrySnapshot | null; context: PlanningCalculationContext;
  options: LayoutFinanceOptions;
}
const net = (z: FloorZone) => resolveZoneRevenueModel(z) === "sale" ? z.saleableAreaSqm ?? z.areaSqm :
  resolveZoneRevenueModel(z) === "lease" ? z.rentableAreaSqm ?? z.areaSqm : 0;
const total = (zones: FloorZone[]) => zones.reduce((sum, z) => sum + z.areaSqm, 0);
const common = (zones: FloorZone[]) => total(zones.filter(z => z.useType === "common"));
const areaBudgetIssues = new Set(["exclusive-area-shortfall", "common-area-shortfall"]);

function sourceKey(input: LayoutFinanceInput): string {
  const { scenario: s, geometry: g } = input;
  return layoutFinanceKey({ scenario: { ...s, checks: undefined, economicsPreview: undefined }, context: input.context, options: input.options,
    geometry: g && { scenarioId: g.scenarioId, projectId: g.projectId, coordinateSystem: g.coordinateSystem, parcel: g.parcel, floors: g.building.floors } });
}
function remapDraft(parent: InteriorDraft, zones: FloorZone[], links: LayoutFinanceApplication["beforeFloors"][number]["unitLinks"], reverse = false): InteriorDraft {
  const mapped = new Map(links.map(l => [reverse ? l.afterId : l.beforeId, { id: reverse ? l.beforeId : l.afterId, zoneId: reverse ? l.beforeZoneId : l.afterZoneId }]));
  const remap = (id: string) => mapped.get(id)?.id ?? id;
  const next: InteriorDraft = { ...parent, spaces: parent.spaces.map(s => mapped.has(s.id) ? { ...s, ...mapped.get(s.id)! } : s),
    doors: parent.doors.map(d => ({ ...d, from: remap(d.from), to: remap(d.to) })) };
  next.programBasis = interiorProgramBasis({ zones } as FloorProgram);
  next.roomLayouts = parent.roomLayouts?.map(room => {
    const oldUnit = parent.spaces.find(s => s.id === room.unitId), unit = next.spaces.find(s => s.id === remap(room.unitId));
    return { ...room, unitId: remap(room.unitId), entryDoor: { ...room.entryDoor, from: remap(room.entryDoor.from), to: remap(room.entryDoor.to) },
      parentBasis: oldUnit && unit && room.parentBasis === roomParentBasis(parent, oldUnit) ? roomParentBasis(next, unit) : room.parentBasis };
  });
  return next;
}

export function buildLayoutFinancePreview(input: LayoutFinanceInput): LayoutFinancePreview {
  const { scenario, geometry, context } = input;
  const result: LayoutFinancePreview = { status: "blocked", sourceKey: sourceKey(input), options: input.options,
    issues: [], notes: [], rows: [], floors: [], candidate: null, before: null, after: null, changed: false, beforeFloors: [] };
  const parsed = layoutFinanceOptionsSchema.safeParse(input.options);
  if (!parsed.success || new Set(input.options.floorIds).size !== input.options.floorIds.length) {
    result.issues.push("면적 기준과 검토 층 선택이 올바르지 않습니다."); return result;
  }
  if (!geometry || geometry.scenarioId !== scenario.id || (scenario.projectId && geometry.projectId !== scenario.projectId)) {
    result.issues.push("현재 계획안의 층 외곽 좌표가 필요합니다. 임의 경계로 계산하지 않습니다."); return result;
  }
  if (geometry.scenarioInputBasis !== planningGeometryInputBasis(scenario)) {
    result.issues.push("층 외곽이 현재 배치·층 설정과 일치하지 않습니다. 형상을 다시 계산해야 합니다."); return result;
  }
  if (new Set(scenario.floorPrograms.map(f => f.id)).size !== scenario.floorPrograms.length) {
    result.issues.push("층 ID가 중복됐습니다."); return result;
  }
  const selected = input.options.floorIds.map(id => scenario.floorPrograms.find(f => f.id === id));
  if (selected.some(f => !f)) { result.issues.push("선택한 층이 삭제되거나 변경됐습니다."); return result; }
  const candidate = structuredClone(scenario), usedZoneIds = new Set(scenario.floorPrograms.flatMap(f => f.zones.map(z => z.id)));
  if (usedZoneIds.size !== scenario.floorPrograms.flatMap(f => f.zones).length) { result.issues.push("구역 ID가 중복됐습니다."); return result; }
  for (const floor of selected as FloorProgram[]) {
    const shape = geometry.building.floors.find(f => f.id === floor.id)?.shape, parent = floor.interiorLayout;
    const residential = floor.zones.filter(z => z.useType === "residential");
    if (!shape || !parent || !interiorDraftSchema.safeParse(parent).success || !residential.length ||
        floor.zones.some(z => !["residential", "common"].includes(z.useType) || !Number.isFinite(z.areaSqm) || z.areaSqm < 0 ||
          (z.useType === "common" && (z.unitCount !== 0 || resolveZoneRevenueModel(z) !== "non-revenue")))) {
      result.issues.push(floor.label + ": 저장된 주거·공용부 구획과 유효한 면적 프로그램이 필요합니다."); continue;
    }
    const gross = total(floor.zones);
    if (Math.abs(polygonAreaSqm(shape) - gross) > 0.01) {
      result.issues.push(floor.label + ": 현재 외곽 면적과 프로그램 총면적이 다릅니다. 층 외곽을 먼저 검토해야 합니다."); continue;
    }
    const assessment = assessInteriorLayout(floor, shape);
    const blocking = assessment.issues.filter(i => i.status !== "review" && !areaBudgetIssues.has(i.code));
    if (blocking.length) { result.issues.push(...blocking.map(i => floor.label + ": " + i.message)); continue; }
    const links: LayoutFinanceApplication["beforeFloors"][number]["unitLinks"] = [];
    const issueCount = result.issues.length;
    const unitZones: FloorZone[] = [];
    const envelopeAreas = new Map(assessment.units.map(u => [u.id, u.clearAreaSqm]));
    // Reconcile only area-budget warnings temporarily; all shape/door/staleness checks above must pass.
    const temporaryZones = floor.zones.filter(z => z.useType === "residential").map(z => {
      const area = parent.spaces.filter(s => s.kind === "unit" && s.zoneId === z.id).reduce((sum, s) => sum + (envelopeAreas.get(s.id) ?? 0), 0);
      return { ...z, areaSqm: area, saleableAreaSqm: area, rentableAreaSqm: area, parkingExclusiveAreaSqm: area };
    });
    const roomFloor = { ...floor, zones: [...temporaryZones, { id: "__layout-area-check", useType: "common" as const,
      areaSqm: gross - total(temporaryZones), unitCount: 0, revenueModel: "non-revenue" as const }] };
    roomFloor.interiorLayout = { ...parent, programBasis: interiorProgramBasis(roomFloor) };
    for (const zone of residential) {
      for (let index = 0; index < zone.unitCount; index++) {
        const unitId = zone.id + "-" + index, unit = parent.spaces.find(s => s.id === unitId && s.zoneId === zone.id);
        const envelopeClearSqm = envelopeAreas.get(unitId);
        if (!unit || envelopeClearSqm == null) { result.issues.push(floor.label + ": 세대와 구역 연결이 없습니다."); continue; }
        let proposedSqm = envelopeClearSqm;
        if (input.options.areaBasis === "room-clear") {
          const rooms = assessRoomLayout(roomFloor, unitId, shape);
          if (rooms.status !== "preliminary-fit") {
            result.issues.push(floor.label + " " + unit.label + ": " + (rooms.issues.find(i => i.status !== "review")?.message ?? "상세 실 검증이 필요합니다.")); continue;
          }
          proposedSqm = rooms.clearAreaSqm;
        }
        if (!(proposedSqm > 0) || proposedSqm > envelopeClearSqm + 0.01) { result.issues.push(floor.label + ": 유효면적 합계를 확인해야 합니다."); continue; }
        let zoneId = zone.id;
        if (zone.unitCount > 1) {
          const prefix = "layout-" + layoutFinanceKey([floor.id, unitId]).slice(10);
          zoneId = prefix;
          let suffix = 1;
          while (usedZoneIds.has(zoneId)) zoneId = prefix + "-" + suffix++;
          usedZoneIds.add(zoneId);
        }
        const model = resolveZoneRevenueModel(zone);
        unitZones.push({ ...zone, id: zoneId, label: unit.label, unitCount: 1, areaSqm: proposedSqm,
          saleableAreaSqm: model === "sale" ? proposedSqm : 0, rentableAreaSqm: model === "lease" ? proposedSqm : 0,
          parkingExclusiveAreaSqm: proposedSqm, parkingExclusiveAreaStatus: "user-entered" });
        links.push({ beforeId: unitId, afterId: zoneId + "-0", beforeZoneId: zone.id, afterZoneId: zoneId });
        result.rows.push({ floorId: floor.id, floorLabel: floor.label, unitId, label: unit.label, model,
          beforeRevenueSqm: Math.min(zone.areaSqm, net(zone)) / zone.unitCount,
          beforeExclusiveSqm: zone.parkingExclusiveAreaSqm == null ? null : zone.parkingExclusiveAreaSqm / zone.unitCount, envelopeClearSqm, proposedSqm });
      }
    }
    if (result.issues.length > issueCount) continue;
    const remaining = gross - total(unitZones);
    if (remaining < assessment.commonAreaSqm - 0.01) { result.issues.push(floor.label + ": 공용부를 보존할 잔여 면적이 부족합니다."); continue; }
    const oldCommon = floor.zones.filter(z => z.useType === "common");
    const commons = oldCommon.length ? oldCommon.map(z => ({ ...z })) : [{
      id: "layout-common-" + layoutFinanceKey(floor.id).slice(10), useType: "common" as const, unitCount: 0, areaSqm: 0, revenueModel: "non-revenue" as const,
    }];
    if (!oldCommon.length) {
      const prefix = commons[0].id;
      let suffix = 1;
      while (usedZoneIds.has(commons[0].id)) commons[0].id = prefix + "-" + suffix++;
      usedZoneIds.add(commons[0].id);
    }
    const commonTotal = common(floor.zones);
    let allocated = 0;
    commons.forEach((z, i) => {
      z.areaSqm = i === commons.length - 1 ? remaining - allocated : commonTotal > 0 ? remaining * z.areaSqm / commonTotal : 0;
      z.saleableAreaSqm = 0; z.rentableAreaSqm = 0; allocated += z.areaSqm;
    });
    const nextFloor = { ...floor, zones: [...unitZones, ...commons], interiorLayout: remapDraft(parent, [...unitZones, ...commons], links) };
    if (assessInteriorLayout(nextFloor, shape).status !== "preliminary-fit") { result.issues.push(floor.label + ": 면적 변경 후 구획 검증이 유지되지 않습니다."); continue; }
    candidate.floorPrograms = candidate.floorPrograms.map(f => f.id === floor.id ? nextFloor : f);
    if (candidate.egressPlan?.exit?.floorId === floor.id && candidate.egressPlan.exit.layoutBasis === groundExitBasis(parent)) {
      candidate.egressPlan.exit.layoutBasis = groundExitBasis(nextFloor.interiorLayout);
    }
    result.beforeFloors.push({ floorId: floor.id, zones: structuredClone(floor.zones), programBasis: parent.programBasis, unitLinks: links,
      roomBases: (parent.roomLayouts ?? []).map(r => ({ unitId: r.unitId, parentBasis: r.parentBasis })) });
    result.floors.push({ id: floor.id, label: floor.label, grossSqm: gross, commonBeforeSqm: commonTotal,
      commonAfterSqm: remaining, geometricCommonSqm: assessment.commonAreaSqm });
  }
  if (result.issues.length) return result;
  try {
    result.before = calculatePlanningScenario(scenario, context);
    result.after = calculatePlanningScenario(candidate, context);
    if (scenario.quantityCost && (result.before.economicsPreview.quantityCostStatus !== "ready" ||
        result.after.economicsPreview.quantityCostStatus !== "ready")) {
      result.before = null; result.after = null;
      result.issues.push("면적 변경으로 상세 수량 원가의 기준이 달라집니다. 수량·원가 반영을 명시적으로 해제한 뒤 면적을 변경하고 포함액·견적을 다시 검토해야 합니다.");
      return result;
    }
    const oldPrices = dwellingSaleBreakdown(scenario, result.before.economicsPreview.residentialFallbackUnitPriceWon ?? 0);
    const newPrices = dwellingSaleBreakdown(candidate, result.after.economicsPreview.residentialFallbackUnitPriceWon ?? 0);
    if (oldPrices.filter(r => r.bandApplied).reduce((n, r) => n + r.unitCount, 0) > newPrices.filter(r => r.bandApplied).reduce((n, r) => n + r.unitCount, 0))
      result.notes.push("면적 조건 변경으로 일부 평형별·실거래 관측 단가가 해제되어 기존 공통 가정 단가로 재계산됐습니다.");
  } catch { result.issues.push("사업성 계산 입력·평형별 단가를 확인해야 합니다. 변경을 반영하지 않습니다."); return result; }
  result.candidate = candidate;
  result.changed = layoutFinanceBinding(candidate) !== layoutFinanceBinding(scenario);
  result.notes.push("유효면적은 내부 벽 두께 가정값이며 법정 전용면적이 아닙니다. 주차 산정 입력도 사용자 가정으로 유지됩니다.",
    "층 총면적·세대수·제공 주차대수는 유지됩니다. 공용부 잔여에는 벽체와 미배정 공간이 포함됩니다.",
    "미반영 공종은 기존 연면적 단가를 유지합니다. 상세 수량·견적은 수량·원가에서 별도로 대사하며 면적 편집으로 원가 기준을 자동 갱신하지 않습니다.",
    "공식 경계·법정 피난 적합성·허가·전문가 승인은 별도이며 이번 반영으로 승인되지 않습니다.");
  if (selected.length < scenario.floorPrograms.filter(f => f.zones.some(z => z.useType === "residential")).length)
    result.notes.push("선택하지 않은 주거층은 기존 면적 가정을 유지합니다.");
  result.status = "ready";
  return result;
}

export function applyLayoutFinance(input: LayoutFinanceInput, expectedKey: string, appliedAt: string): { patch?: Partial<PlanningScenario>; error?: string } {
  if (isPlanningGeometryLocked(input.scenario)) return { error: "잠긴 계획안은 반영할 수 없습니다." };
  if (sourceKey(input) !== expectedKey) return { error: "비교 후 계획안·계산 가정·형상이 변경됐습니다. 최신 비교안을 확인해야 합니다." };
  if (!Number.isFinite(Date.parse(appliedAt))) return { error: "반영 시각이 올바르지 않습니다." };
  const p = buildLayoutFinancePreview(input);
  if (p.status !== "ready" || !p.candidate || !p.before || !p.after || !p.changed) return { error: p.issues[0] ?? "반영할 면적 변경이 없습니다." };
  const entry: LayoutFinanceApplication = { id: "layout-" + crypto.randomUUID(), version: LAYOUT_FINANCE_VERSION, appliedAt,
    options: structuredClone(input.options), sourceKey: expectedKey, beforeBinding: layoutFinanceBinding(input.scenario),
    resultKey: layoutFinanceBinding(p.candidate), beforeFloors: p.beforeFloors,
    beforeExitBasis: input.scenario.egressPlan?.exit?.layoutBasis,
    beforeRevenueAreaSqm: p.before.metrics.saleableAreaSqm + p.before.metrics.rentableAreaSqm,
    afterRevenueAreaSqm: p.after.metrics.saleableAreaSqm + p.after.metrics.rentableAreaSqm,
    profitDeltaManwon: p.after.economicsPreview.profitManwon - p.before.economicsPreview.profitManwon };
  const history = [...input.scenario.layoutFinanceHistory ?? [], entry].slice(-10);
  if (!layoutFinanceHistorySchema.safeParse(history).success) return { error: "면적 반영 이력을 저장할 수 없습니다." };
  return { patch: { floorPrograms: p.candidate.floorPrograms, egressPlan: p.candidate.egressPlan, layoutFinanceHistory: history,
    checks: [], economicsPreview: { ...p.after.economicsPreview, status: "stale" } } };
}

export function undoLayoutFinance(scenario: PlanningScenario, revertedAt: string): { patch?: Partial<PlanningScenario>; error?: string } {
  if (isPlanningGeometryLocked(scenario)) return { error: "잠긴 계획안은 복원할 수 없습니다." };
  const history = scenario.layoutFinanceHistory ?? [], last = history.filter(h => !h.revertedAt).at(-1);
  if (!last || !layoutFinanceHistorySchema.safeParse(history).success || !Number.isFinite(Date.parse(revertedAt))) return { error: "복원할 유효한 반영 이력이 없습니다." };
  if (last.resultKey !== layoutFinanceBinding(scenario)) return { error: "반영 후 평면·구역·주차가 변경됐습니다. 현재 편집을 덮어쓰지 않도록 복원을 중단합니다." };
  const next = structuredClone(scenario);
  for (const before of last.beforeFloors) {
    const floor = next.floorPrograms.find(f => f.id === before.floorId);
    if (!floor?.interiorLayout) return { error: "복원 대상 구획이 없습니다." };
    floor.interiorLayout = remapDraft(floor.interiorLayout, before.zones, before.unitLinks, true);
    floor.interiorLayout.programBasis = before.programBasis;
    floor.interiorLayout.roomLayouts = floor.interiorLayout.roomLayouts?.map(r => ({
      ...r, parentBasis: before.roomBases.find(b => b.unitId === r.unitId)?.parentBasis ?? r.parentBasis,
    }));
    floor.zones = before.zones;
  }
  if (next.egressPlan?.exit && last.beforeExitBasis) next.egressPlan.exit.layoutBasis = last.beforeExitBasis;
  if (layoutFinanceBinding(next) !== last.beforeBinding) return { error: "복원 이력과 원본 계획안 기준이 다릅니다. 변경을 반영하지 않습니다." };
  return { patch: { floorPrograms: next.floorPrograms, egressPlan: next.egressPlan,
    layoutFinanceHistory: history.map(h => h.id === last.id ? { ...h, revertedAt } : h), checks: [],
    economicsPreview: { ...scenario.economicsPreview, status: "stale" } } };
}
