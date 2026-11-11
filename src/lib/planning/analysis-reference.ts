import type { Parcel } from "@/lib/finance/types";
import { localParcelPolygons } from "@/lib/geo/parcel-topology";
import { assessInteriorLayout } from "./interior-layout";
import { assessRoomLayout } from "./room-layout";
import { assessEgressCore } from "./egress-core";
import { parkingEgressObstacles } from "./parking-egress-obstacles";
import { analysisReferenceInputKey, analysisReferenceSchema, ANALYSIS_REFERENCE_VERSION, type AnalysisReferenceSelection } from "./analysis-reference-contract";
import type { PlanningScenario, PlanningScenarioCalculation } from "./types";
import type { PlanningGeometrySnapshot } from "./planning-geometry";
import type { PlanningParkingGeometrySnapshot } from "./planning-parking-geometry";
import { planningParcelMatchesSnapshot, planningRoadsMatchSnapshot, resolvePlanningParcel } from "./planning-parcel";

export interface AnalysisReferenceAssessment {
  ready: boolean;
  blockers: Array<{ code: string; message: string }>;
  unresolved: AnalysisReferenceSelection["unresolved"];
}
export interface AnalysisReferenceInput {
  scenario: PlanningScenario;
  parcel: Parcel;
  calculation: PlanningScenarioCalculation;
  geometry: PlanningGeometrySnapshot | null;
  parking: PlanningParkingGeometrySnapshot | null;
}

export function assessPlanningAnalysisReference(input: AnalysisReferenceInput): AnalysisReferenceAssessment {
  const { scenario, parcel, calculation, geometry, parking } = input;
  const blockers: AnalysisReferenceAssessment["blockers"] = [];
  const add = (code: string, message: string) => blockers.push({ code, message });
  const unresolved = calculation.checks.filter(check => check.status === "review" || check.status === "unknown")
    .map(check => ({ code: check.code, status: check.status as "review" | "unknown", message: check.message }));
  for (const check of calculation.checks) if (check.status === "fail") add(check.code, check.message);
  for (const code of ["bcr", "far", "height", "parking"]) {
    if (!calculation.checks.some(check => check.code === code)) add(code, "현재 입력의 건폐율·용적률·높이·주차 계산 결과가 모두 필요합니다.");
  }
  const bounds = [
    ["bcr", "건폐율", calculation.metrics.preliminaryBcrPct, parcel.regulatoryConstraints?.bcr.value ?? parcel.maxBCR],
    ["far", "용적률", calculation.metrics.preliminaryFarPct, parcel.regulatoryConstraints?.far.value ?? parcel.maxFAR],
    ["height", "높이", calculation.metrics.totalHeightM, parcel.regulatoryConstraints?.height.value ?? parcel.heightLimit],
  ] as const;
  for (const [code, label, actual, limit] of bounds) {
    if (!Number.isFinite(limit) || !(limit > 0) || !Number.isFinite(actual) || actual < 0) add(code, `${label}의 유한한 양수 검토 상한이 필요합니다.`);
    else if (actual > limit + 0.01) add(code, `${label}가 입력 검토 상한을 초과했습니다. 가정값을 적합 판정으로 바꾸지 않습니다.`);
  }
  const floorLimit = parcel.regulatoryConstraints?.floors.value;
  if (floorLimit != null && (!Number.isFinite(floorLimit) || floorLimit <= 0 || calculation.metrics.aboveGroundFloors > floorLimit)) {
    add("floors", "입력한 층수 검토 상한을 충족하지 못했습니다.");
  }
  if (!geometry?.validation.representativeEligible || geometry.validation.status !== "pass" ||
      geometry.projectId !== parcel.id || geometry.scenarioId !== scenario.id || geometry.scenarioVersion !== scenario.version ||
      !planningParcelMatchesSnapshot(resolvePlanningParcel(parcel), geometry) || !planningRoadsMatchSnapshot(parcel.roads ?? [], geometry)) {
    add("geometry", "현재 대지·계획과 같은 입력으로 기하 검사를 완료해야 합니다.");
  }
  for (const check of calculation.checks) {
    if (["revenue-area", "unsupported-revenue-use"].includes(check.code) && check.status !== "pass") add(check.code, check.message);
    if (check.code === "layout-finance-adoption" && check.status === "unknown") add(check.code, check.message);
  }
  const required = calculation.parking.requiredCars, provided = scenario.parking.providedCars;
  if (![required, provided].every(value => Number.isSafeInteger(value) && value >= 0) || provided < required ||
      calculation.parking.components.some(component => component.distributionStatus === "invalid")) add("parking-count", "예비 요구 주차와 입력 주차대수를 충족해야 합니다.");
  const needsParking = required > 0 || provided > 0 || scenario.parking.strategy !== "none";
  if (needsParking && (!parking || parking.planningGeometryHash !== geometry?.geometryHash ||
      parking.frontage.status !== "known" || parking.frontage.sourceMatched !== true ||
      parking.layout.generationStatus !== "complete" || parking.validation.status === "fail" ||
      parking.layout.capacityCars < Math.max(required, provided))) add("parking-layout", "도로 접면과 실제 주차 배치가 현재 계획을 충족해야 합니다.");
  if (needsParking && (!parking || parking.circulation.status !== "preliminary" || parking.circulation.uncheckedStalls !== 0)) {
    add("vehicle-circulation", "생성된 주차면 전체의 내부 차량 후보 궤적 검사를 완료해야 합니다. 미검사·충돌·탐색 실패는 채택할 수 없습니다.");
  }
  const residential = scenario.floorPrograms.filter(floor => floor.zones.some(zone => zone.useType === "residential" && zone.unitCount > 0));
  for (const floor of scenario.floorPrograms.filter(floor => floor.interiorLayout || residential.includes(floor))) {
    const outline = geometry?.building.floors.find(mass => mass.id === floor.id)?.shape;
    const interior = assessInteriorLayout(floor, outline);
    if (interior.status !== "preliminary-fit") add(`interior:${floor.id}`, `${floor.label}: 실내 구획 예비 검사가 미완료입니다.`);
    if (residential.includes(floor)) {
      const units = floor.interiorLayout?.spaces.filter(space => space.kind === "unit") ?? [];
      if (!units.length || units.some(unit => assessRoomLayout(floor, unit.id, outline).status !== "preliminary-fit") ||
          floor.interiorLayout?.roomLayouts?.some(room => !units.some(unit => unit.id === room.unitId))) {
        add(`rooms:${floor.id}`, `${floor.label}: 방·주방·욕실 및 현관 연결 검사가 미완료입니다.`);
      }
    }
  }
  if (residential.length && (!geometry || assessEgressCore({ scenario, floors: geometry.building.floors,
    parcelPolygons: localParcelPolygons(geometry.parcel), groundObstacles: parkingEgressObstacles(parking) }).status !== "preliminary-chain")) {
    add("egress", "실에서 지상 출구까지의 피난·층간 코어 예비 연결 검사가 미완료입니다.");
  }
  return { ready: blockers.length === 0, blockers, unresolved };
}

export function createAnalysisReferenceSelection(input: AnalysisReferenceInput, selectedAt: string): AnalysisReferenceSelection | null {
  const result = assessPlanningAnalysisReference(input);
  if (!result.ready || !input.geometry) return null;
  return analysisReferenceSchema.parse({ version: ANALYSIS_REFERENCE_VERSION, purpose: "preliminary-analysis", approvalStatus: "unverified", selectedAt,
    inputKey: analysisReferenceInputKey(input.scenario, input.parcel, input.geometry), unresolved: result.unresolved });
}
