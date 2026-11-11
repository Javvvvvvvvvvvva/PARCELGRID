import { z } from "zod";
import { computeProject, PROJECT_CALCULATION_VERSION, type ProjectComputed } from "@/lib/services/compute-project";
import { CONSTRUCTION_COST_SENSITIVITY_VERSION } from "@/lib/finance/construction-cost-sensitivity";
import { SCENARIO_DECISION_MODEL_VERSION } from "@/lib/finance/scenario-decision-support";
import { calculatedValueMatches } from "@/lib/finance/calculation-match";
import type { Parcel, Scenario } from "@/lib/finance/types";
import type { FloorProgram, PlanningScenario } from "@/lib/planning/types";
import { assessInteriorLayout, interiorDraftSchema, INTERIOR_LAYOUT_VERSION, type InteriorIssue } from "@/lib/planning/interior-layout";
import { assessRoomLayout } from "@/lib/planning/room-layout";
import { ROOM_LAYOUT_VERSION } from "@/lib/planning/room-layout-schema";
import { assessEgressCore, egressPlanSchema, EGRESS_VERSION } from "@/lib/planning/egress-core";
import { validPlanPolygon, type PlanPoint } from "@/lib/planning/layout-geometry";
import { polygonAreaSqm } from "@/lib/planning/planning-massing";
import { planningParcelMatchesSnapshot, planningRoadsMatchSnapshot, resolvePlanningParcel } from "@/lib/planning/planning-parcel";
import { parkingEgressObstacles } from "@/lib/planning/parking-egress-obstacles";
import { localParcelPolygons } from "@/lib/geo/parcel-topology";
import { localParcelArea, localParcelIntersectionArea } from "@/lib/geo/parcel-topology-geometry";
import { planningGeometryContentHash, planningGeometryInputBasis, PLANNING_GEOMETRY_VERSION, GEOMETRY_AREA_PASS_TOLERANCE_PCT, type PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import { buildPlanningParkingGeometry, PLANNING_PARKING_GEOMETRY_VERSION, type PlanningParkingGeometrySnapshot } from "@/lib/planning/planning-parking-geometry";
import { vehicleProfileSchema, VEHICLE_SCREENING_VERSION } from "@/lib/planning/vehicle-circulation";
import { planningRevenueAreas, unsupportedRevenueZones } from "@/lib/planning/revenue-pools";
import { evaluateQuantityCost } from "@/lib/planning/quantity-cost";
import { quantityCostContractSchema, quantityCostInputsSchema, quantityAdjustmentForBase, QUANTITY_COST_VERSION } from "@/lib/planning/quantity-cost-contract";
import { QUANTITY_TAKEOFF_VERSION } from "@/lib/planning/quantity-takeoff";
import { additionalDwellingCostManwon } from "@/lib/planning/dwelling-program";
import { analysisReferenceIsCurrent, ANALYSIS_REFERENCE_VERSION } from "@/lib/planning/analysis-reference-contract";
import { calculatePlanningMaterialAdjustment } from "@/lib/planning/materials";
import type { HandoffDiscipline } from "./evidence-gate";
import { COMPLIANCE_MODEL_VERSION } from "@/lib/finance/compliance";
import { PROJECT_LEDGER_AUDIT_VERSION } from "@/lib/finance/project-ledger-audit";
import { HOLD_PERIOD_LEDGER_MODEL_VERSION } from "@/lib/finance/hold-period-ledger";
import { assessConstructionQuote, buildConstructionScopeLedger, CONSTRUCTION_QUOTE_VERSION, CONSTRUCTION_SCOPE_LEDGER_VERSION } from "@/lib/planning/construction-quote";

export const INTEGRATED_VERIFICATION_VERSION = "integrated-verification-2026.16" as const;

export type IntegratedVerificationInput = {
  projectId: string;
  representativeScenarioId: string;
  representativeScenarioVersion: number;
  geometryHash: string;
  data: ProjectComputed;
  planningScenario: PlanningScenario | null;
  geometry: PlanningGeometrySnapshot | null;
};

export interface IntegratedVerificationCheck {
  id: string;
  discipline: HandoffDiscipline;
  label: string;
  status: "checked" | "review" | "missing" | "fail" | "not-applicable";
  detail: string;
}

export interface IntegratedVerificationReport {
  version: typeof INTEGRATED_VERIFICATION_VERSION;
  checks: IntegratedVerificationCheck[];
  modelVersions: Record<string, string>;
  approvalStatus: "unverified";
  status: "incomplete" | "conflict" | "preliminary";
  limitations: string[];
}

type Status = IntegratedVerificationCheck["status"];
type AddCheck = (id: string, discipline: HandoffDiscipline, label: string, status: Status, detail: string) => void;
const absent = (value: unknown) => value === undefined || value === null;
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const identifier = z.string().trim().min(1).max(200);
const scalar = z.number().finite().min(0).max(1e9);
const point = z.object({ x: z.number().finite().min(-1e6).max(1e6), z: z.number().finite().min(-1e6).max(1e6) });
const polygon = z.array(point).max(128);
const count = z.number().int().min(0).max(500);
const floorSchema = z.object({
  id: identifier, label: z.string().max(160), level: z.number().int().min(-32).max(32).refine(n => n !== 0),
  floorHeightM: z.number().positive().max(12), footprintScalePct: z.number().positive().max(100), northSetbackM: scalar,
  zones: z.array(z.object({
    id: identifier, label: z.string().max(160).optional(),
    useType: z.enum(["residential", "retail", "office", "parking", "piloti", "common", "mechanical", "storage", "other"]),
    areaSqm: scalar, unitCount: count, revenueModel: z.enum(["sale", "lease", "non-revenue"]).optional(),
    saleableAreaSqm: scalar.optional(), rentableAreaSqm: scalar.optional(), parkingExclusiveAreaSqm: scalar.optional(),
  }).passthrough()).min(1).max(32),
  interiorLayout: z.unknown().optional(),
}).passthrough();
const planSchema = z.object({
  floorPrograms: z.array(floorSchema).min(1).max(32),
  placement: z.object({ rotationDeg: z.number().finite().min(-360).max(360), offsetXM: z.number().finite(),
    offsetZM: z.number().finite(), roadSetbackM: scalar, northSetbackM: scalar }),
}).passthrough();
const geometryFloorSchema = z.object({
  id: identifier, level: z.number().int().min(-32).max(32), baseHeightM: z.number().finite().min(-384).max(384),
  shape: polygon.optional(),
}).passthrough();
const geometrySchema = z.object({
  coordinateSystem: z.object({ unit: z.literal("meter"), horizontalCrs: z.literal("LOCAL_ENU_FROM_WGS84"),
    northAxis: z.literal("-Z"), eastAxis: z.literal("+X"), upAxis: z.literal("+Y"),
    originLngLat: z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-89).max(89)]) }),
  parcel: z.object({ polygon: polygon.optional(), polygons: z.array(z.object({ outer: polygon,
    holes: z.array(polygon).max(32) })).max(200).optional() }).passthrough(),
  building: z.object({ floors: z.array(geometryFloorSchema).max(32),
    aboveGroundFloors: z.array(geometryFloorSchema).max(32).optional(),
    basementFloors: z.array(geometryFloorSchema).max(32).optional(),
  }).passthrough(),
}).passthrough();
const parkingSchema = z.object({
  strategy: z.enum(["none", "surface", "piloti", "mixed", "basement", "mechanical"]), providedCars: count,
  orientation: z.enum(["auto", "parallel-front", "perpendicular-front"]).optional(),
  stallWidthM: z.number().min(1).max(10).optional(), stallDepthM: z.number().min(2).max(20).optional(),
  aisleWidthM: z.number().min(1).max(20).optional(), entryWidthM: z.number().min(1).max(20).optional(),
  coreAreaSqm: scalar.optional(), columnLossPct: z.number().min(0).max(100).optional(),
  entryOffsetRatio: z.number().min(0).max(1).optional(), vehicleProfile: vehicleProfileSchema.optional(),
});
const lngLat = z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-89).max(89)]);
const parcelSourceSchema = z.object({ boundary: z.array(lngLat).max(128).optional(),
  boundaryPolygons: z.array(z.object({ outer: z.array(lngLat).min(3).max(128),
    holes: z.array(z.array(lngLat).min(3).max(128)).max(32) })).max(200).optional() });
const roadSourceSchema = z.array(z.object({ name: z.string().max(200).nullable(), points: z.array(lngLat).min(2).max(128) })).max(32);
const roadGeometrySchema = z.array(z.object({ name: z.string().max(200).nullable(), points: polygon.min(2) })).max(32);

// Bound traversal before Zod and polygon operations. Shared references are fine; cycles are not.
function inputProblem(value: unknown, finiteNumbers = false): { status: "fail" | "missing"; detail: string } | null {
  let nodes = 0, characters = 0;
  const active = new Set<object>();
  const visit = (item: unknown, depth: number): "invalid" | "limit" | null => {
    if (++nodes > 100000 || depth > 24) return "limit";
    if (typeof item === "number") return finiteNumbers && !Number.isFinite(item) ? "invalid" : null;
    if (typeof item === "string") {
      characters += item.length;
      return item.length > 100000 || characters > 2000000 ? "limit" : null;
    }
    if (absent(item) || typeof item === "boolean") return null;
    if (typeof item !== "object" || active.has(item)) return "invalid";
    if (Array.isArray(item) ? item.length > 512 : Object.keys(item).length > 128) return "limit";
    active.add(item);
    for (const child of Object.values(item)) {
      const problem = visit(child, depth + 1);
      if (problem) return problem;
    }
    active.delete(item);
    return null;
  };
  const problem = visit(value, 0);
  return problem ? { status: problem === "limit" ? "missing" : "fail", detail: problem === "limit"
    ? "검사 입력량 한도를 초과하여 전체 모델 검사를 수행하지 못했습니다."
    : "순환 참조, 지원하지 않는 형식 또는 유한하지 않은 숫자가 포함되어 있습니다." } : null;
}

function schemaStatus(error: z.ZodError): "missing" | "fail" {
  return error.issues.every(i => ((i.code === "invalid_type" || i.code === "invalid_value") && (i.input === undefined || i.input === null)) ||
    (i.code === "too_small" && i.origin === "array")) ? "missing" : "fail";
}

function assessmentStatus(result: { status: string; issues: InteriorIssue[] }): Status {
  if (result.status === "conflict" || result.issues.some(i => i.status === "fail")) return "fail";
  if (result.status === "missing" || result.issues.some(i => i.status === "unknown")) return "missing";
  return "checked";
}

function assessmentDetail(issues: InteriorIssue[], success: string): string {
  const findings = issues.filter(i => i.status !== "review");
  return findings.length ? findings.slice(0, 8).map(i => `${i.code}: ${i.message}`).join("; ") : success;
}

function numericStatus(values: unknown[]): "checked" | "missing" | "fail" {
  if (values.some(v => !absent(v) && (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1e15))) return "fail";
  return values.some(absent) ? "missing" : "checked";
}

function closeArea(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * GEOMETRY_AREA_PASS_TOLERANCE_PCT / 100);
}

function financeChecks(vm: Record<string, unknown>, contract: Record<string, unknown>, plan: PlanningScenario | null, add: AddCheck) {
  const labels: Record<string, string> = { revenue: "매출", "revenue-pools": "용도별 매출", financing: "금융비", cost: "총사업비", profit: "이익" };
  const arithmetic = (id: string, total: unknown, terms: unknown[], negative = false) => {
    let status = numericStatus([total, ...terms]);
    // Stored VM amounts are independently rounded to whole manwon by the finance engine.
    const tolerance = (terms.length + 1) / 2;
    if (status === "checked" && ((!negative && [total, ...terms].some(v => Number(v) < 0)) ||
        Math.abs(Number(total) - terms.reduce<number>((sum, n) => sum + Number(n), 0)) > tolerance)) status = "fail";
    add(`finance.${id}`, "finance-tax", `저장된 ${labels[id]} 산술 대사`, status,
      status === "checked" ? `항목별 반올림 허용오차 ${tolerance}만원 이내로 일치합니다. 가정과 원문 근거는 독립 검증하지 않았습니다.`
        : status === "missing" ? "대사할 저장 금액이 없습니다. 누락값을 0으로 대체하지 않았습니다."
          : "저장 금액이 잘못되었거나 항목별 반올림 허용오차를 넘었습니다.");
  };
  arithmetic("revenue", vm.revenue, [vm.revenueSale, vm.revenueLease, vm.revenueRetail]);
  const pools = record(vm.revenueByPool);
  arithmetic("revenue-pools", vm.revenue, ["residentialSale", "retailSale", "officeSale", "residentialLease", "retailLease", "officeLease"].map(k => pools[k]));
  arithmetic("financing", vm.financingCost, [vm.interestCost, vm.pfFee, vm.trustFee]);
  arithmetic("cost", vm.cost, ["landCost", "acquisitionTax", "acquisitionOtherCost", "demolitionCost", "tenantRelocationCost",
    "hardCost", "softCost", "contingency", "financingCost"].map(k => vm[k]));
  arithmetic("profit", vm.profit, [vm.revenue, absent(vm.cost) ? undefined : typeof vm.cost === "number" ? -vm.cost : vm.cost], true);
  const raw = record(vm._raw);
  const rawProblem = inputProblem({ program: raw.program, assumptions: raw.assumptions, revenuePricing: raw.revenuePricing }, true);
  add("finance.raw-numbers", "finance-tax", "재무 원시 숫자 입력", rawProblem?.status ??
    (absent(raw.program) || absent(raw.assumptions) ? "missing" : "checked"), rawProblem?.detail ??
    "제공된 숫자의 유한성을 검사합니다. 월별 금융 재계산 연결은 별도 항목에서 검사하며 원문의 사실성을 입증하지 않습니다.");
  const areaLabels: Record<string, string> = { construction: "공사", saleable: "매각", rentable: "임대",
    residentialSaleSqm: "주거 매각", retailSaleSqm: "상가 매각", officeSaleSqm: "업무 매각",
    residentialLeaseSqm: "주거 임대", retailLeaseSqm: "상가 임대", officeLeaseSqm: "업무 임대" };
  const comparison = (id: string, values: unknown[], expected?: number) => {
    let status = numericStatus([...values, expected]);
    if (status === "checked" && values.some(n => Number(n) < 0 || Math.abs(Number(n) - expected!) > 0.01 + 1e-9)) status = "fail";
    add(`finance.area.${id}`, "finance-tax", `재무 ${areaLabels[id]} 면적 대사`, status,
      status === "checked" ? "저장된 재무 면적과 원시 층 프로그램이 0.01㎡ 이내로 일치합니다."
        : status === "missing" ? "원시 층 프로그램 또는 재무 면적이 없습니다." : "저장 면적이 잘못되었거나 원시 층 프로그램과 다릅니다.");
  };
  comparison("construction", [vm.gfa, contract.constructionAreaSqm], plan?.floorPrograms.reduce((s, f) => s + f.zones.reduce((n, zone) => n + zone.areaSqm, 0), 0));
  const areas = plan ? planningRevenueAreas(plan) : undefined;
  const storedAreas = record(contract.revenueAreas);
  for (const key of ["residentialSaleSqm", "retailSaleSqm", "officeSaleSqm", "residentialLeaseSqm", "retailLeaseSqm", "officeLeaseSqm"] as const) {
    comparison(key, [storedAreas[key]], areas?.[key]);
  }
  comparison("saleable", [contract.saleableAreaSqm], areas && areas.residentialSaleSqm + areas.retailSaleSqm + areas.officeSaleSqm);
  comparison("rentable", [contract.rentableAreaSqm], areas && areas.residentialLeaseSqm + areas.retailLeaseSqm + areas.officeLeaseSqm);
  if (plan && unsupportedRevenueZones(plan).length) add("finance.area.unsupported", "finance-tax", "수익 면적 검사 범위", "missing", "일부 용도에 대응하는 수익 면적 모델이 없습니다.");
}

export function buildIntegratedVerification(input: IntegratedVerificationInput): IntegratedVerificationReport {
  const report: IntegratedVerificationReport = {
    version: INTEGRATED_VERIFICATION_VERSION, checks: [], approvalStatus: "unverified", status: "incomplete",
    modelVersions: { integrated: INTEGRATED_VERIFICATION_VERSION, geometry: PLANNING_GEOMETRY_VERSION,
      interior: INTERIOR_LAYOUT_VERSION, rooms: ROOM_LAYOUT_VERSION, egress: EGRESS_VERSION,
      parking: PLANNING_PARKING_GEOMETRY_VERSION, vehicle: VEHICLE_SCREENING_VERSION, financeArithmetic: "stored-finance-arithmetic-2026.1",
      quantityTakeoff: QUANTITY_TAKEOFF_VERSION, quantityCost: QUANTITY_COST_VERSION,
      costSensitivity: CONSTRUCTION_COST_SENSITIVITY_VERSION, regulatoryRisk: COMPLIANCE_MODEL_VERSION,
      ledgerArithmetic: PROJECT_LEDGER_AUDIT_VERSION, constructionQuote: CONSTRUCTION_QUOTE_VERSION, constructionScopeLedger: CONSTRUCTION_SCOPE_LEDGER_VERSION,
      projectCalculation: PROJECT_CALCULATION_VERSION, holdPeriod: HOLD_PERIOD_LEDGER_MODEL_VERSION, scenarioDecision: SCENARIO_DECISION_MODEL_VERSION },
    limitations: [
      "공식 경계·측량 검증: 미확인. 모델 좌표는 측량으로 확정된 법적 경계가 아닙니다.",
      "인허가·법규 적합성·도로 진출입 승인: 미확인. 이 보고서는 법규 규칙이나 허가 판단을 구현하지 않습니다.",
      "전문가 신원·자격·전문가 승인: 미확인. 별도 근거와 검토가 필요합니다.",
      "실내·실 구획은 제한된 직사각형 템플릿, 가정 벽 두께 및 문 연결 검사입니다. 창호·설비·구조·시공 상세는 미검증입니다.",
      "피난은 단일 코어 계단 예약 공간과 실에서 출구까지의 개념 연결 검사입니다. 법정 보행거리·계단 수·방화 성능·장애인 통로는 미검증입니다.",
      "차량은 가정 제원에 따른 대지 내부 후보 궤적만 검사합니다. 후보 실패가 모든 주차 설계의 불가능을 뜻하지 않으며 미검사 주차면을 적합으로 처리하지 않습니다.",
      "재무는 저장 산술·면적·지원 수량 원가·월별 민감도 재계산과 별도 월별 배분·자금 보존식 검사를 수행합니다. 0원 비용의 누락 여부·시장단가·세금·금융약정·전체 공종 견적은 독립 검증하지 않습니다.",
      "형상 해시는 제공된 식별자를 비교하고 기존 계획 입력 기준은 재계산합니다. 원시 입력 전체를 봉인하는 검토 스냅샷을 대체하지 않습니다.",
      "검사 한도는 32개 층, 층당 32개 구역, 전체 주거 120세대, 외곽선 꼭짓점 128개입니다. 주차 열거는 대지·지상층 각 축 길이 120m 이내에서 수행합니다.",
    ],
  };
  const add: AddCheck = (id, discipline, label, status, detail) => report.checks.push({ id, discipline, label, status, detail });
  const parse = <T>(schema: z.ZodType<T>, value: unknown, id: string, discipline: HandoffDiscipline, label: string): T | null => {
    const problem = inputProblem(value);
    if (problem) { add(id, discipline, label, problem.status, problem.detail); return null; }
    const result = schema.safeParse(value, { reportInput: true });
    if (!result.success) {
      const status = schemaStatus(result.error);
      add(id, discipline, label, status, status === "missing" ? "필수 모델 입력이 없습니다." : "제공된 입력 형식·치수가 잘못되었거나 지원 한도를 초과했습니다.");
      return null;
    }
    add(id, discipline, label, "checked", "입력 형식과 치수 한도를 확인했습니다. 외부 승인을 뜻하지 않습니다.");
    return result.data;
  };
  const bindingLabels: Record<string, string> = { project: "프로젝트", "plan-project": "계획 프로젝트", "plan-id": "계획 ID",
    "plan-version": "계획 버전", "geometry-project": "형상 프로젝트", "geometry-id": "형상 계획 ID", "geometry-version": "형상 계획 버전",
    "geometry-hash": "형상 해시", "geometry-model": "형상 모델 버전", "geometry-input-basis": "형상 입력 기준",
    "finance-raw-id": "재무 원본 ID", "finance-plan-id": "재무 계획 ID", "finance-plan-version": "재무 계획 버전", "finance-geometry-hash": "재무 형상 해시" };
  const binding = (id: string, actual: unknown, expected: unknown, number = false) => {
    const valid = (value: unknown) => number ? Number.isSafeInteger(value) && Number(value) > 0 : identifier.safeParse(value).success;
    const status = absent(actual) || actual === "" || absent(expected) || expected === "" ? "missing"
      : !valid(actual) || !valid(expected) || actual !== expected ? "fail" : "checked";
    add(`binding.${id}`, "architect", `스냅샷 연결: ${bindingLabels[id]}`, status,
      status === "checked" ? "제공된 스냅샷 식별자가 일치합니다." : status === "missing" ? "필수 스냅샷 연결 정보가 없습니다." : "제공된 식별자·버전이 다르거나 잘못되었습니다.");
  };
  const packet = record(input), data = record(packet.data), parcel = record(data.parcel);
  const rawPlan = record(packet.planningScenario), rawGeometry = record(packet.geometry);
  if (rawGeometry.analysisReference !== undefined) {
    report.modelVersions.analysisReference = ANALYSIS_REFERENCE_VERSION;
    const current = analysisReferenceIsCurrent(rawPlan as unknown as PlanningScenario, parcel as unknown as Parcel,
      rawGeometry as unknown as PlanningGeometrySnapshot);
    add("binding.analysis-reference", "architect", "예비 분석 기준안 원본 연결", current ? "checked" : "fail",
      current ? "예비 분석 선택과 현재 대지·평면·주차 입력이 일치합니다. 이 기록은 승인이나 검산 통과 증명이 아니며 아래 원본 검사를 생략하지 않습니다."
        : "예비 분석 선택 기록이 잘못됐거나 현재 원본 입력과 다릅니다. 다시 검사하고 선택해야 합니다.");
    add("analysis.approval", "architect", "예비 분석의 승인 구분", "review", "공식 경계·허가·전문가 승인은 미확정입니다. 기준안 채택 및 서버 봉인은 법정 적합 판정이 아닙니다.");
  }
  binding("project", parcel.id, packet.projectId);
  binding("plan-project", rawPlan.projectId, packet.projectId);
  binding("plan-id", rawPlan.id, packet.representativeScenarioId);
  binding("plan-version", rawPlan.version, packet.representativeScenarioVersion, true);
  binding("geometry-project", rawGeometry.projectId, packet.projectId);
  binding("geometry-id", rawGeometry.scenarioId, packet.representativeScenarioId);
  binding("geometry-version", rawGeometry.scenarioVersion, packet.representativeScenarioVersion, true);
  binding("geometry-hash", rawGeometry.geometryHash, packet.geometryHash);
  binding("geometry-model", rawGeometry.version, PLANNING_GEOMETRY_VERSION);
  const eligibility = record(rawGeometry.validation);
  const eligibilityMissing = [eligibility.status, eligibility.representativeEligible, eligibility.exportable].some(absent);
  const eligibilityFailed = (!absent(eligibility.status) && eligibility.status !== "pass") ||
    (!absent(eligibility.representativeEligible) && eligibility.representativeEligible !== true) ||
    (!absent(eligibility.exportable) && eligibility.exportable !== true);
  add("binding.geometry-eligibility", "architect", "저장된 형상 대표안 자격", eligibilityFailed ? "fail" : eligibilityMissing ? "missing" : "checked",
    eligibilityFailed ? "저장된 형상이 통과·대표안 가능·내보내기 가능 상태를 모두 충족하지 않습니다."
      : eligibilityMissing ? "저장된 형상 자격 정보가 없습니다." : "저장된 모델 자격 플래그만 확인했습니다. 법규 적합성이나 인허가 승인이 아닙니다.");
  let plan = parse(planSchema, packet.planningScenario, "binding.plan", "architect", "원시 층 프로그램") as unknown as PlanningScenario | null;
  const parsedGeometry = parse(geometrySchema, packet.geometry, "binding.geometry", "architect", "원시 형상");
  let geometry = parsedGeometry as unknown as PlanningGeometrySnapshot | null;
  const parcelSource = parse(parcelSourceSchema, { boundary: parcel.boundary, boundaryPolygons: parcel.boundaryPolygons },
    "binding.parcel-source", "architect", "전체 대지 원자료 형식");
  const sourceRegion = resolvePlanningParcel(parcelSource ?? {});
  const parcelMatches = Boolean(geometry && planningParcelMatchesSnapshot(sourceRegion, geometry));
  const parcelStatus: Status = !geometry ? "missing" : parcelMatches ? "checked"
    : parcel.boundary !== undefined || parcel.boundaryPolygons !== undefined ? "fail" : "missing";
  add("binding.parcel-region", "architect", "전체 대지 형상·원자료 연결", parcelStatus,
    parcelMatches ? "모든 대지 조각·구멍과 공통 원점의 점 순서·좌표가 일치합니다. 공식 경계 승인은 별도입니다."
      : "전체 대지 원자료와 형상이 없거나 서로 다릅니다. 주차 미대상이어도 경계 연결을 생략하지 않습니다.");
  add("binding.parcel-support", "architect", "대지 형상 검사 범위", sourceRegion.available ? "checked" : "missing",
    sourceRegion.available ? "지원 한도 내의 모든 대지 조각과 내부 빈 공간을 검사합니다. 합필·다동 배치·공식 경계·허가는 별도 확인이 필요합니다."
      : "유효한 전체 대지 경계가 없어 검사 범위를 확인하지 못했습니다.");
  const parcelAreas = z.object({ lot: scalar.positive(), official: scalar.positive(), measured: scalar.positive() }).safeParse({
    lot: parcel.lotArea, official: record(rawGeometry.parcel).officialAreaSqm, measured: record(rawGeometry.parcel).measuredAreaSqm,
  }, { reportInput: true });
  let parcelAreaStatus: Status = "missing";
  if (parcelAreas.success && geometry && parcelMatches) {
    const area = localParcelArea(localParcelPolygons(geometry.parcel));
    parcelAreaStatus = Math.abs(parcelAreas.data.lot - parcelAreas.data.official) <= 1e-6
      && Math.abs(parcelAreas.data.measured - area) <= 1e-4
      && Math.abs(area - parcelAreas.data.lot) / parcelAreas.data.lot <= 0.02 ? "checked" : "fail";
  } else if (!parcelAreas.success && !parcelAreas.error.issues.some(issue => issue.code === "invalid_type" && issue.input === undefined)) {
    parcelAreaStatus = "fail";
  }
  add("binding.parcel-area", "architect", "전체 경계 순면적·입력 대지면적 대사", parcelAreaStatus,
    parcelAreaStatus === "checked" ? "모든 조각에서 내부 빈 공간을 뺀 면적, 저장된 형상 면적과 입력 대지면적을 대사했습니다. 공부상 면적의 진위 확인은 별도입니다."
      : "전체 경계 순면적 또는 저장된 대지면적이 원자료와 다르거나 2% 검토 범위를 벗어납니다. 없는 면적을 합산하거나 저장된 통과 플래그로 대체하지 않습니다.");
  const roadSource = parse(roadSourceSchema, parcel.roads, "binding.road-source", "architect", "도로 원자료 형식");
  const roadGeometry = parse(roadGeometrySchema, rawGeometry.roads, "binding.road-geometry", "architect", "저장 도로 형상 형식");
  const roadsMatched = Boolean(geometry && roadSource && roadGeometry && planningRoadsMatchSnapshot(roadSource,
    { roads: roadGeometry, coordinateSystem: geometry.coordinateSystem }));
  add("binding.roads", "architect", "도로 형상·원자료 연결", !geometry || !roadSource || !roadGeometry ? "missing" : roadsMatched ? "checked" : "fail",
    roadsMatched ? "도로의 이름·점 순서·공통 원점 좌표가 일치합니다. 도로의 법적 성격·폭·진입 허가는 별도입니다."
      : "도로 원자료와 저장 형상이 없거나 서로 다릅니다. 주차 미대상이어도 모든 분야에서 최신 원자료로 재검토해야 합니다.");
  if (plan) {
    const floors = plan.floorPrograms;
    const ambiguous = new Set(floors.map(f => f.id)).size !== floors.length || new Set(floors.map(f => f.level)).size !== floors.length ||
      floors.some(f => new Set(f.zones.map(zone => zone.id)).size !== f.zones.length);
    const units = floors.reduce((sum, f) => sum + f.zones.filter(zone => zone.useType === "residential").reduce((n, zone) => n + zone.unitCount, 0), 0);
    if (ambiguous || units > 120) {
      add("binding.plan-coverage", "architect", "층 프로그램 검사 범위", ambiguous ? "fail" : "missing", ambiguous
        ? "층 ID·층 번호 또는 구역 ID가 중복되어 대상을 구분할 수 없습니다." : "전체 120세대를 초과하여 통합 검사 한도를 벗어납니다.");
      plan = null;
    }
  }
  if (plan) binding("geometry-input-basis", rawGeometry.scenarioInputBasis, planningGeometryInputBasis(plan));
  else add("binding.geometry-input-basis", "architect", "형상 입력 기준", "missing", "형상 입력 기준을 재계산하려면 한도 내의 완전한 층 프로그램이 필요합니다.");
  let heightsStatus: Status = "missing";
  if (geometry && plan) {
    const expected = new Map<string, { base: number; top: number; height: number }>();
    let totalHeight = 0, basementDepth = 0;
    for (const floor of [...plan.floorPrograms].filter(f => f.level > 0).sort((a, b) => a.level - b.level)) {
      const base = totalHeight;
      totalHeight += floor.floorHeightM;
      expected.set(floor.id, { base, top: totalHeight, height: floor.floorHeightM });
    }
    for (const floor of [...plan.floorPrograms].filter(f => f.level < 0).sort((a, b) => b.level - a.level)) {
      const top = -basementDepth;
      basementDepth += floor.floorHeightM;
      expected.set(floor.id, { base: -basementDepth, top, height: floor.floorHeightM });
    }
    const building = geometry.building;
    heightsStatus = numericStatus([building.totalHeightM, building.basementDepthM,
      ...building.floors.flatMap(f => [f.baseHeightM, f.topHeightM, f.floorHeightM])]);
    if (heightsStatus === "checked") {
      const same = (a: number, b: number) => Math.abs(a - b) <= 1e-6;
      const matched = expected.size === building.floors.length
        && same(building.totalHeightM, totalHeight) && same(building.basementDepthM, basementDepth)
        && building.floors.every(floor => {
          const source = expected.get(floor.id);
          return source && same(floor.baseHeightM, source.base) && same(floor.topHeightM, source.top)
            && same(floor.floorHeightM, source.height);
        });
      heightsStatus = matched ? "checked" : "fail";
    }
  }
  add("binding.geometry-heights", "architect", "층고·층 바닥·상단 높이 대사", heightsStatus,
    heightsStatus === "checked" ? "원시 층 프로그램의 층고를 지상·지하 순서대로 누적해 모든 층의 바닥·상단 및 총 높이·깊이와 대사했습니다. 법정 높이·피난 승인은 별도입니다."
      : "저장된 층 높이 또는 건물 높이·지하 깊이가 원시 층고와 다르거나 누락됐습니다. 이 형상으로 층간 코어·피난 검사를 확정하지 않습니다.");
  let geometryContentsStatus: Status = "missing", geometryQuantitiesStatus: Status = "missing";
  if (geometry && plan && parcelAreas.success) {
    const building = geometry.building;
    const floorValuesStatus = numericStatus(building.floors.flatMap(floor =>
      [floor.baseHeightM, floor.topHeightM, floor.programAreaSqm, floor.visualAreaSqm]));
    if (floorValuesStatus === "fail" || (!absent(parcel.zoning) && typeof parcel.zoning !== "string")) geometryContentsStatus = "fail";
    else if (floorValuesStatus === "checked" && typeof parcel.zoning === "string" && sourceRegion.available && roadGeometry) {
      try {
        const hash = planningGeometryContentHash({ projectId: geometry.projectId, scenarioId: geometry.scenarioId,
          origin: geometry.coordinateSystem.originLngLat, polygons: localParcelPolygons(geometry.parcel),
          parcelAvailable: true, officialAreaSqm: parcelAreas.data.official, zoning: parcel.zoning,
          floors: building.floors, roads: roadGeometry });
        geometryContentsStatus = hash === geometry.geometryHash ? "checked" : "fail";
      } catch { geometryContentsStatus = "fail"; }
    }
    geometryQuantitiesStatus = numericStatus([building.totalProgramAreaSqm, building.totalGeometryAreaSqm,
      building.preliminaryFarAreaSqm, building.preliminaryFarPct, building.preliminaryBcrPct,
      ...building.floors.flatMap(floor => [floor.programAreaSqm, floor.visualAreaSqm])]);
    if (geometryQuantitiesStatus === "checked") {
      const same = (a: number, b: number) => Math.abs(a - b) <= 1e-4;
      const areas = building.floors.map(floor => ({ floor, measured: polygonAreaSqm(floor.shape ?? []),
        source: plan!.floorPrograms.find(source => source.id === floor.id) }));
      const totalProgramme = plan.floorPrograms.reduce((sum, floor) => sum + floor.zones.reduce((n, zone) => n + zone.areaSqm, 0), 0);
      const totalMeasured = areas.reduce((sum, area) => sum + area.measured, 0);
      const farArea = plan.floorPrograms.filter(floor => floor.level > 0).reduce((sum, floor) => sum + floor.zones
        .filter(zone => !["parking", "piloti"].includes(zone.useType)).reduce((n, zone) => n + zone.areaSqm, 0), 0);
      const footprint = Math.max(0, ...areas.filter(area => area.floor.level > 0).map(area => area.measured));
      const matched = areas.every(({ floor, measured, source }) => source
        && same(floor.programAreaSqm, source.zones.reduce((sum, zone) => sum + zone.areaSqm, 0))
        && same(floor.visualAreaSqm, measured))
        && same(building.totalProgramAreaSqm, totalProgramme) && same(building.totalGeometryAreaSqm, totalMeasured)
        && same(building.preliminaryFarAreaSqm, farArea)
        && same(building.preliminaryFarPct, farArea / parcelAreas.data.lot * 100)
        && same(building.preliminaryBcrPct, footprint / parcelAreas.data.lot * 100);
      geometryQuantitiesStatus = matched ? "checked" : "fail";
    }
  }
  add("binding.geometry-content", "architect", "형상 내용·식별값 대사", geometryContentsStatus,
    geometryContentsStatus === "checked" ? "현재 좌표·층 높이·면적·도로와 원자료 용도지역으로 재계산한 형상 식별값이 저장본과 일치합니다. 식별값은 법적 승인이나 전자서명이 아닙니다."
      : "실제 형상 내용으로 재계산한 식별값이 저장본과 다르거나 재계산 근거가 없습니다. 같은 문자열을 복사한 참조만으로 통과시키지 않습니다.");
  add("binding.geometry-quantities", "architect", "형상 면적·표시 합계 대사", geometryQuantitiesStatus,
    geometryQuantitiesStatus === "checked" ? "층별 원시 프로그램·실측 다각형 면적과 표시 합계·예비 용적률·건폐율을 독립 대사했습니다. 법정 면적 확정은 별도입니다."
      : "층별 면적 또는 표시 합계·예비 용적률·건폐율이 원시 프로그램·실제 도형과 다르거나 누락됐습니다. 사업성 면적은 자동 수정하지 않습니다.");
  if (geometry) {
    const floors = geometry.building.floors;
    const viewsMissing = !Array.isArray(geometry.building.aboveGroundFloors) || !Array.isArray(geometry.building.basementFloors);
    const viewsMatch = !viewsMissing
      && calculatedValueMatches(geometry.building.aboveGroundFloors, floors.filter(floor => floor.level > 0))
      && calculatedValueMatches(geometry.building.basementFloors, floors.filter(floor => floor.level < 0));
    add("binding.geometry-floor-views", "architect", "전체·지상·지하 층 형상 대사", viewsMissing ? "missing" : viewsMatch ? "checked" : "fail",
      viewsMatch ? "평면·주차·3D·내보내기가 사용하는 지상·지하 층별 형상이 동일한 전체 층 목록과 일치합니다."
        : "전체 층 목록과 지상·지하 형상이 누락되거나 서로 다릅니다. 표시·계산·인계 기준을 재생성해야 합니다.");
    if (new Set(floors.map(f => f.id)).size !== floors.length) {
      add("binding.geometry-floor-ids", "architect", "형상 층 식별자", "fail", "형상에 중복된 층 ID가 있습니다.");
      geometry = null;
    } else if (plan) {
      const mismatch = floors.some(f => !plan!.floorPrograms.some(p => p.id === f.id && p.level === f.level));
      const missing = plan.floorPrograms.some(f => !floors.some(g => g.id === f.id));
      add("binding.geometry-floor-coverage", "architect", "층별 형상 검사 범위", mismatch ? "fail" : missing ? "missing" : "checked",
        mismatch ? "연결되지 않은 층이 있거나 층 번호가 다릅니다." : missing ? "일부 계획 층에 형상이 없습니다." : "모든 계획 층의 형상 ID와 층 번호가 일치합니다.");
    }
  }
  const scenarios = Array.isArray(data.scenarios) && data.scenarios.length <= 128 ? data.scenarios : [];
  const candidates = scenarios.filter(s => record(s).id === packet.representativeScenarioId);
  const vm = candidates.length === 1 ? record(candidates[0]) : {};
  add("binding.finance", "architect", "대표 재무 시나리오 연결", candidates.length === 1 ? "checked" : candidates.length > 1 || scenarios.length ? "fail" : "missing",
    candidates.length === 1 ? "대표 ID에 일치하는 저장 재무 시나리오가 하나 있습니다." : "대표 ID에 일치하는 유일한 재무 시나리오가 필요합니다.");
  const rawFinance = record(vm._raw), contract = record(record(rawFinance.program).areaContract);
  binding("finance-raw-id", rawFinance.id, packet.representativeScenarioId);
  binding("finance-plan-id", contract.sourceScenarioId, packet.representativeScenarioId);
  binding("finance-plan-version", contract.sourceScenarioVersion, packet.representativeScenarioVersion, true);
  binding("finance-geometry-hash", record(contract.geometrySource).geometryHash, packet.geometryHash);
  financeChecks(vm, contract, plan, add);

  // Recalculate every displayed comparison, not just the representative's downside.
  const rawScenarios = scenarios.map(s => record(s)._raw);
  const financeProblem = inputProblem({ parcel, scenarios: rawScenarios }, true);
  const stressMissing = scenarios.some(s => record(record(s).constructionCostSensitivity).modelVersion !== CONSTRUCTION_COST_SENSITIVITY_VERSION);
  const decisionMissing = record(data.decisionSupport).modelVersion !== SCENARIO_DECISION_MODEL_VERSION;
  const calculationModelMissing = record(data.meta).version !== PROJECT_CALCULATION_VERSION;
  const startDate = record(data.meta).calculationStartDate;
  const scheduleMissing = typeof startDate !== "string" || !Number.isFinite(Date.parse(startDate));
  if (!scenarios.length || scenarios.length > 32 || financeProblem || stressMissing || decisionMissing || scheduleMissing || calculationModelMissing) {
    add("binding.ledger-arithmetic", "finance-tax", "월별 원장 별도 산술 검산", financeProblem?.status ?? "missing",
      "현재 원시 입력과 계산 결과가 충분하지 않아 월별 배분·자금 보존식 검사를 완료하지 못했습니다.");
    add("binding.monthly-finance", "finance-tax", "월별 원가·하방 비교 재계산", financeProblem?.status ?? "missing",
      financeProblem?.detail ?? (scenarios.length > 32 ? "월별 재검증은 한 번에 비교안 32개까지 지원합니다."
        : "현재 계산·규제 위험·월별 원가 민감도·비교 모델로 사업성을 다시 계산해야 합니다. 구버전 계산을 승인 근거로 사용하지 않습니다."));
  } else {
    try {
      const savedDecision = record(data.decisionSupport);
      const recalculated = computeProject(parcel as unknown as Parcel, rawScenarios as Scenario[], {
        startDate: startDate as string,
        recommendedId: savedDecision.focusMode === "explicit-selection" && typeof savedDecision.focusScenarioId === "string"
          ? savedDecision.focusScenarioId : undefined,
        calculateMaxAcquisition: false,
      });
      const matching = recalculated.scenarios.every((expected, i) => calculatedValueMatches(scenarios[i], expected)) &&
        calculatedValueMatches(data.pfSchedule, recalculated.pfSchedule) &&
        calculatedValueMatches(data.parcelRisks, recalculated.parcelRisks) &&
        calculatedValueMatches(data.decisionSupport, recalculated.decisionSupport);
      const unsupported = recalculated.scenarios.some(s => s.constructionCostSensitivity?.low.status !== "calculated" ||
        s.constructionCostSensitivity?.high.status !== "calculated");
      add("binding.ledger-arithmetic", "finance-tax", "월별 원장 별도 산술 검산", !matching ? "fail" : unsupported ? "missing" : "checked",
        !matching ? "저장 결과가 현재 원시 입력과 달라 별도 산술 검사를 현재 검토에 적용할 수 없습니다."
          : unsupported ? "일부 원가 비교안의 원장을 계산하지 못해 전체 산술 검산이 미완료입니다."
            : "계산기와 분리된 식으로 모든 표시 비교안과 저·기본·고원가의 월별 비용·수입 배분, PF 인출·상환·이자, 자금 보존과 합계를 검사했습니다. 0원 비용의 사실성·외부 전문가 검산은 미확정입니다.");
      add("binding.monthly-finance", "finance-tax", "월별 원가·하방 비교 재계산", !matching ? "fail" : unsupported ? "missing" : "checked",
        !matching ? "저장된 기본·저원가·고원가 원장 또는 비교 순위가 현재 원시 입력의 재계산과 다릅니다."
          : unsupported ? "변경 단가가 계산 한도를 벗어난 비교안이 있어 전체 하방 위험 검증은 미완료입니다."
            : "모든 표시 비교안의 재무 지표·기본/저원가/고원가 월별 금융·자금 부족·분기 현금흐름과 Pareto 비교가 원시 입력 재계산과 일치합니다. 전문가 독립 검산은 아닙니다.");
    } catch {
      add("binding.ledger-arithmetic", "finance-tax", "월별 원장 별도 산술 검산", "fail", "원장 생성 또는 별도 산술 검산에 실패했습니다. 결과를 승인 근거로 사용하지 않습니다.");
      add("binding.monthly-finance", "finance-tax", "월별 원가·하방 비교 재계산", "fail", "원시 재무 입력이 월별 계산 계약을 충족하지 않습니다.");
    }
  }

  if (plan?.quantityCost || contract.quantityCostAdjustment) {
    const costInputs = record(record(contract.stage2Economics).inputs);
    const quantityInputs = quantityCostInputsSchema.safeParse({ constructionCostPerSqmWon: costInputs.constructionCostPerSqmWon,
      basementCostMultiplier: costInputs.basementCostMultiplier });
    const quantity = plan && quantityInputs.success ? evaluateQuantityCost(plan, quantityInputs.data) : null;
    const stored = quantityCostContractSchema.safeParse(contract.quantityCostAdjustment);
    const expected = quantityCostContractSchema.safeParse(quantity?.contract);
    const matched = quantity?.status === "ready" && stored.success && expected.success &&
      JSON.stringify(stored.data) === JSON.stringify(expected.data);
    add("binding.quantity-cost", "finance-tax", "상세 수량·원가·재무 연결", matched ? "checked" : "fail",
      matched ? "원시 평면 수량과 단가·기존 포함액을 재계산한 계약이 재무 저장본과 일치합니다. 견적의 시장성·전문가 검산은 별도입니다."
        : quantity?.issues.join(" · ") || "상세 원가 계약이 원시 평면·기본 공사비와 연결되지 않거나 일부 누락됐습니다.");
    if (matched && stored.success) {
      const a = record(rawFinance.assumptions);
      try {
        const hardInputs = z.object({ above: scalar, basement: scalar, rate: scalar,
          multiplier: z.number().finite().min(1).max(10), material: z.number().finite(), dwelling: scalar, storedHard: scalar }).safeParse({
          above: contract.aboveGroundAreaSqm, basement: contract.basementAreaSqm, rate: a.constCostPerSqM,
          multiplier: a.basementCostMultiplier === undefined ? 1.25 : a.basementCostMultiplier,
          material: contract.materialAdjustmentCostManwon,
          dwelling: contract.dwellingCostAdjustment === undefined ? 0 : record(contract.dwellingCostAdjustment).costManwon,
          storedHard: vm.hardCost,
        });
        if (!hardInputs.success || !plan) throw new Error("수치 누락 또는 형식 불일치");
        const h = hardInputs.data;
        const rawDwelling = additionalDwellingCostManwon(plan.floorPrograms, plan.dwellingProgram);
        const rawMaterial = calculatePlanningMaterialAdjustment(plan).adjustmentManwon;
        const exactAreas = stored.data.constructionAreas;
        if (Math.abs(exactAreas.aboveGroundSqm - h.above) > 0.005001 || Math.abs(exactAreas.basementSqm - h.basement) > 0.005001) {
          throw new Error("상세 원가와 재무 공사면적 불일치");
        }
        const adjustmentsMatch = Number.isFinite(rawDwelling) && Number.isFinite(rawMaterial) &&
          Math.abs(h.dwelling - rawDwelling) <= 0.005001 && Math.abs(h.material - rawMaterial) <= 0.005001;
        const overlap = h.dwelling > 0 && stored.data.lines.some(line => line.treatment === "replace-allowance" &&
          ["kitchenCount", "bathroomCount"].includes(line.id));
        add("binding.quantity-existing-adjustments", "finance-tax", "기존 세대·재료비 중복 대사", adjustmentsMatch && !overlap ? "checked" : "fail",
          adjustmentsMatch && !overlap ? "저장된 세대 가산비·외장재 증감이 원시 계획과 일치하며 주방·욕실의 이중 가산이 없습니다."
            : "원시 계획과 세대·재료비 증감이 다르거나 주방·욕실 견적이 추가 세대 가산비와 중복됩니다.");
        const base = (exactAreas.aboveGroundSqm + exactAreas.basementSqm * h.multiplier) * h.rate / 10000;
        const hard = Math.max(0, base + h.material + h.dwelling + quantityAdjustmentForBase(stored.data, base));
        const matchesHard = adjustmentsMatch && !overlap && Number.isFinite(hard) && Math.abs(hard - h.storedHard) <= 0.500001;
        add("binding.quantity-hard-cost", "finance-tax", "상세 원가 공사비 반영", matchesHard ? "checked" : "fail",
          matchesHard ? "기본 공사비에서 포함액을 차감하고 상세 견적을 한 번 반영한 공사비가 저장 결과와 일치합니다."
            : "상세 견적 증감이 저장 공사비와 맞지 않습니다. 사업성을 다시 계산해야 합니다.");
      } catch { add("binding.quantity-hard-cost", "finance-tax", "상세 원가 공사비 반영", "fail", "상세 원가 계산 계약을 검증하지 못했습니다."); }
    }
  }
  const quoteInputs = quantityCostInputsSchema.safeParse({
    constructionCostPerSqmWon: record(record(contract.stage2Economics).inputs).constructionCostPerSqmWon,
    basementCostMultiplier: record(record(contract.stage2Economics).inputs).basementCostMultiplier,
  });
  let quoteAssessment: ReturnType<typeof assessConstructionQuote> | null = null;
  try {
    const quote = plan && quoteInputs.success ? assessConstructionQuote(plan, quoteInputs.data) : null;
    quoteAssessment = quote;
    add(plan?.constructionQuote === undefined ? "construction-quote.finance-tax" : "binding.construction-quote", "finance-tax", "견적 원문·공종·수량 대사",
      !quote || quote.status === "absent" || quote.status === "missing" ? "missing"
        : quote.status === "ready" ? "checked" : "fail",
      quote?.status === "ready" ? `입력된 견적의 행 합계·단위·부가세 기준·공종 연결·지원 수량이 검토 기준일 ${plan?.constructionQuote?.reviewDate} 기준으로 대사됐습니다. 원문 진위·전체 공종 실측·전문가 승인 미확정이며 사업비에 자동 반영하지 않습니다.`
        : quote?.issues.length ? quote.issues.slice(0, 20).map(issue => issue.detail).join(" · ") + (quote.issues.length > 20 ? ` · 외 ${quote.issues.length - 20}건` : "")
          : "공종별 견적 원문과 포함·제외·수량 대사가 미확정입니다.");
  } catch {
    add("binding.construction-quote", "finance-tax", "견적 원문·공종·수량 대사", "fail", "견적 기준과 입력을 검증하지 못했습니다.");
  }
  if (plan?.constructionQuote !== undefined) {
    const ledger = buildConstructionScopeLedger(plan.constructionQuote);
    const quote = quoteAssessment;
    const current = quote?.status === "ready";
    add("binding.construction-scope-ledger", "finance-tax", "17공종 원가 배분 대사",
      ledger.status === "conflict" || quote?.status === "stale" || quote?.status === "conflict" ? "fail"
        : ledger.status === "reconciled" && current ? "checked" : "missing",
      ledger.status === "reconciled" && current
        ? "공종별 입력 금액과 일괄 견적의 배분 합계가 원문 금액에 대사됐습니다. 전체 물량·원문 진위·전문가 검산은 미확정이며 사업비에 자동 반영하지 않습니다."
        : ledger.issues.slice(0, 20).map(issue => issue.detail).join(" · ") || "견적의 현재 계획·근거·유효기한을 먼저 대사해야 합니다.");
  }
  // Declared quote scope and partial residential quantities are not external full-BOQ validation.
  for (const discipline of ["developer", "finance-tax"] as const) add(`quantity-cost.${discipline}`, discipline,
    "전체 공종 물량·독립 견적 검증", "missing", "지원하는 주거 내부 구획선·문·바닥·주방·욕실 패키지 외 구조·외벽·공용부·전체 설비·방재 공종과 독립 견적 검산은 미완료입니다. 기본 연면적 단가에 남겨 두며 누락 원가를 0으로 간주하지 않습니다.");

  const usableFloors: FloorProgram[] = [];
  const usableGeometryFloors: PlanningGeometrySnapshot["building"]["floors"] = [];
  const floorRegions = new Map<string, Status>();
  // Keep this deadline local to parcel containment, not subsequent room checks.
  const regionCheckDeadline = performance.now() + 2_000;
  for (const floor of plan?.floorPrograms ?? []) {
    const shape = geometry?.building.floors.find(f => f.id === floor.id && f.level === floor.level)?.shape;
    let status: Status = "missing";
    if (shape?.length && geometry && parcelMatches && validPlanPolygon(shape)) {
      try {
        if (performance.now() < regionCheckDeadline) {
          const area = polygonAreaSqm(shape);
          const covered = localParcelIntersectionArea(localParcelPolygons(geometry.parcel), [{ outer: shape, holes: [] }]);
          status = performance.now() >= regionCheckDeadline ? "missing"
            : area - covered <= Math.max(1e-6, area * 1e-8) ? "checked" : "fail";
        }
      } catch { status = "fail"; }
    }
    floorRegions.set(floor.id, status);
  }
  for (const floor of plan?.floorPrograms ?? []) {
    const key = `floor.${encodeURIComponent(floor.id)}`;
    const g = geometry?.building.floors.find(f => f.id === floor.id && f.level === floor.level);
    const shape = g?.shape;
    const shapeStatus: Status = !shape?.length ? "missing" : validPlanPolygon(shape) ? "checked" : "fail";
    add(`${key}.outline`, "architect", `${floor.label}: 실제 외곽선`, shapeStatus,
      shapeStatus === "checked" ? "제공된 실제 층 다각형의 입력 한도와 자기 교차 여부를 확인했습니다." : "유효한 실제 층 외곽선이 필요합니다. 외곽선을 임의 생성하지 않았습니다.");
    const outline = shapeStatus === "checked" ? shape : undefined;
    const regionStatus = floorRegions.get(floor.id) ?? "missing";
    add(`binding.${key}.parcel-region`, "architect", `${floor.label}: 전체 대지 포함`, regionStatus,
      regionStatus === "checked" ? "저장된 층 외곽선의 전체 면적이 원자료와 일치하는 대지 안에 있습니다. 내부 빈 공간과 분리 조각 사이 틈은 제외했습니다. 법정 이격·허가 판정은 별도입니다."
        : regionStatus === "fail" ? "저장된 층 형상이 대지 밖·내부 빈 공간·조각 사이 틈을 침범하거나 전체 면적 교차 검사를 통과하지 못했습니다."
          : "유효한 전체 대지·층 형상 또는 계산 시간 한도 안의 포함 검사 결과가 필요합니다.");
    const area = floor.zones.reduce((sum, zone) => sum + zone.areaSqm, 0);
    const areaStatus: Status = outline ? closeArea(polygonAreaSqm(outline), area) ? "checked" : "fail" : "missing";
    if (g && heightsStatus === "checked" && geometryContentsStatus === "checked" && geometryQuantitiesStatus === "checked"
      && regionStatus === "checked" && areaStatus === "checked") usableGeometryFloors.push(g);
    add(`${key}.area`, "architect", `${floor.label}: 면적 대사`, areaStatus,
      outline ? `원시 프로그램 ${area.toFixed(3)}㎡, 실제 다각형 ${polygonAreaSqm(outline).toFixed(3)}㎡. 모델 면적이며 법정 전용면적 확정값이 아닙니다.` : "면적 대사에 실제 외곽선이 필요합니다.");
    const expected = floor.zones.filter(zone => zone.useType === "residential").flatMap(zone =>
      Array.from({ length: zone.unitCount }, (_, i) => `${zone.id}-${i}`));
    const supported = expected.length <= 20 && floor.zones.every(zone => ["residential", "common", "parking", "piloti"].includes(zone.useType)) &&
      (!expected.length || floor.zones.every(zone => ["residential", "common"].includes(zone.useType)));
    let draft = null;
    if (!absent(floor.interiorLayout)) draft = parse(interiorDraftSchema, floor.interiorLayout, `${key}.layout-input`, "architect", `${floor.label}: 원시 구획`);
    const safeFloor: FloorProgram = { ...floor, interiorLayout: draft ?? undefined };
    usableFloors.push(supported ? safeFloor : { ...safeFloor, interiorLayout: undefined });
    if (!supported) add(`${key}.interior`, "architect", `${floor.label}: 실내 템플릿`, "missing", "주거·공용부 단일 코어 템플릿 범위 밖의 층입니다. 해당 설계의 검사가 필요합니다.");
    else {
      try {
        const result = assessInteriorLayout(safeFloor, outline);
        add(`${key}.interior`, "architect", `${floor.label}: 실내 템플릿`, assessmentStatus(result),
          assessmentDetail(result.issues, `${result.units.length}세대의 제한된 템플릿 검사를 완료했습니다. 전문가 설계 승인은 미확인입니다.`));
      } catch { add(`${key}.interior`, "architect", `${floor.label}: 실내 템플릿`, "fail", "제공된 실내 구획을 안전하게 검사하지 못했습니다."); }
    }
    const actualIds = draft?.spaces.filter(s => s.kind === "unit").map(s => s.id) ?? [];
    const unitIds = [...new Set([...expected, ...actualIds])];
    if (!unitIds.length) add(`${key}.rooms`, "architect", `${floor.label}: 실 구획`, floor.zones.some(zone => zone.useType === "residential") ? "missing" : "not-applicable",
      "검사할 주거 세대가 없습니다. 주거 용도에 세대수가 없으면 입력 보완이 필요합니다.");
    for (const unitId of unitIds) {
      const id = `${key}.rooms.${encodeURIComponent(unitId)}`;
      if (!supported || !outline || !draft) { add(id, "architect", `${floor.label}: ${unitId} 실 구획`, "missing", "해당 세대의 지원되는 층 구획과 실제 외곽선이 필요합니다."); continue; }
      try {
        const result = assessRoomLayout(safeFloor, unitId, outline);
        add(id, "architect", `${floor.label}: ${unitId} 실 구획`, assessmentStatus(result), assessmentDetail(result.issues,
          `저장된 실 ${result.rooms.length}개의 형상과 개념 출입 연결을 확인했습니다. 법정 실·피난 요건은 미검증입니다.`));
      } catch { add(id, "architect", `${floor.label}: ${unitId} 실 구획`, "fail", "제공된 상세 실 구획을 안전하게 검사하지 못했습니다."); }
    }
    if (draft?.roomLayouts?.some(room => !actualIds.includes(room.unitId))) add(`${key}.orphan-rooms`, "architect", `${floor.label}: 실 소속 세대`, "fail", "저장된 실 구획이 존재하지 않는 세대를 참조합니다.");
  }
  if (!plan) add("spatial.floors", "architect", "층·세대 검사 범위", "missing", "한도 내의 완전한 층 프로그램이 없습니다.");

  let parking: PlanningParkingGeometrySnapshot | null = null;
  const parkingInputs = parse(parkingSchema, rawPlan.parking, "parking.inputs", "architect", "주차·차량 원시 입력");
  const supplied = record(rawPlan.parking).providedCars;
  const supplyStatus = absent(supplied) || absent(contract.providedParkingSpaces) ? "missing"
    : !count.safeParse(supplied).success || !count.safeParse(contract.providedParkingSpaces).success || supplied !== contract.providedParkingSpaces ? "fail" : "checked";
  add("binding.parking-supply", "architect", "주차 공급 계획·재무 연결", supplyStatus,
    supplyStatus === "checked" ? "원시 계획 주차대수와 봉인된 재무 면적 계약의 공급 대수가 일치합니다."
      : supplyStatus === "missing" ? "계획 또는 재무 계약의 주차 공급 대수가 없습니다." : "원시 계획과 재무 계약의 주차 공급 대수가 다르거나 잘못되었습니다.");
  const demandStatus = absent(contract.requiredParkingSpaces) ? "missing" : count.safeParse(contract.requiredParkingSpaces).success ? "checked" : "fail";
  add("parking.demand", "architect", "봉인된 주차 요구대수", demandStatus, demandStatus === "checked"
    ? "봉인된 재무 면적 계약의 요구대수를 사용합니다. 정책 규칙이나 기본 날짜를 평가하지 않았습니다."
    : "봉인된 재무 면적 계약에 유한하고 한도 내인 주차 요구대수가 필요합니다.");
  add("parking.supply", "architect", "계획 주차 공급 충족", !parkingInputs || demandStatus !== "checked" ? "missing"
    : parkingInputs.providedCars < Number(contract.requiredParkingSpaces) ? "fail" : "checked",
    !parkingInputs || demandStatus !== "checked" ? "유효한 계획 공급과 봉인된 요구대수가 필요합니다."
      : `계획 공급 ${parkingInputs.providedCars}대, 봉인된 요구 ${contract.requiredParkingSpaces}대입니다. 자동 배치 후보로 공급 대수를 늘리지 않습니다.`);
  if (plan && geometry && parkingInputs && demandStatus === "checked") {
    const noParking = parkingInputs.strategy === "none" && contract.requiredParkingSpaces === 0;
    const parcelPolygons = parcelMatches ? localParcelPolygons(geometry.parcel) : [];
    const ground = usableGeometryFloors.find(f => f.level === 1);
    const small = (shape: PlanPoint[]) => Math.max(...shape.map(p => p.x)) - Math.min(...shape.map(p => p.x)) <= 120 &&
      Math.max(...shape.map(p => p.z)) - Math.min(...shape.map(p => p.z)) <= 120;
    if (!parcelPolygons.length || !ground || !parcelPolygons.every(part => small(part.outer)) || !small(ground.shape)) {
      add("parking.geometry", "architect", "주차 형상 기준", "missing", "원자료와 일치하는 전체 대지·지상층 형상이 필요하며 각 대지 조각과 층의 주차 열거 한도는 축별 120m입니다.");
    } else {
      const frontageMatches = parcelMatches && roadsMatched && (noParking || Boolean(roadSource?.length));
      add("parking.frontage", "architect", "관측 도로 접면", noParking ? "not-applicable" : frontageMatches ? "checked" : "missing",
        noParking ? "요구대수가 0인 주차 미대상 계획입니다. 대지·도로 원자료 연결 검사는 유지합니다."
          : frontageMatches ? "전체 대지 조각·내부 빈 공간과 동일 원점의 도로 자료를 접면 검사에 전달합니다. 도로 폭·진입 허가는 별도입니다."
            : "전체 경계와 일치하는 도로 원자료가 필요합니다.");
      if (frontageMatches) {
        try {
          parking = buildPlanningParkingGeometry({ scenario: { ...plan, parking: parkingInputs },
            planning: { ...geometry, building: { ...geometry.building,
              aboveGroundFloors: Array.isArray(geometry.building.aboveGroundFloors)
                ? geometry.building.aboveGroundFloors.filter(f => usableGeometryFloors.some(g => g.id === f.id && g.level === f.level)) : [],
            } },
            requiredCars: Number(contract.requiredParkingSpaces), boundary: parcelSource?.boundary,
            boundaryPolygons: parcelSource?.boundaryPolygons, roads: roadSource ?? [],
            generatedAt: "sealed-input" });
          const unsupported = parking.validation.issues.some(i => i.code === "parking-layout-unsupported");
          const missingFrontage = parking.validation.issues.some(i => i.code === "parking-frontage-unknown");
          const sourceMismatch = parking.validation.issues.some(i => i.code === "parking-source-mismatch");
          const status: Status = sourceMismatch ? "fail" : noParking ? "not-applicable" : unsupported || missingFrontage ? "missing"
            : parking.validation.issues.some(i => i.severity === "fail") || parkingInputs.providedCars > parking.layout.capacityCars || parkingInputs.providedCars < Number(contract.requiredParkingSpaces) ? "fail" : "checked";
          add("parking.layout", "architect", "주차 배치 템플릿", status, noParking ? "저장된 요구대수가 명시적으로 0이고 주차 전략이 없습니다."
            : `템플릿 수용 ${parking.layout.capacityCars}대, 저장 요구 ${contract.requiredParkingSpaces}대, 계획 공급 ${parkingInputs.providedCars}대. ` +
              parking.validation.issues.filter(i => i.severity === "fail").map(i => `${i.code}: ${i.message}`).join("; "));
          const circulation = parking.circulation;
          add("parking.vehicle", "architect", "차량 동선 검사 범위", circulation.status === "not-applicable" ? "not-applicable"
            : circulation.status === "unknown" || circulation.uncheckedStalls > 0 ? "missing"
              : circulation.status === "preliminary" ? "checked" : "review",
            `간섭 없는 후보 ${circulation.clearCandidateCount}개, 검사 ${circulation.stalls.length}개, 미검사 ${circulation.uncheckedStalls}개입니다. 최종 주차 가능 판정은 아닙니다.`);
          for (const stall of circulation.stalls) add(`parking.vehicle.${encodeURIComponent(stall.stallId)}`, "architect", `차량 후보 ${stall.stallId}`,
            stall.status === "clear-candidate" ? "checked" : stall.status === "unavailable" ? "missing" : stall.status === "conflict" ? "fail" : "review", stall.reason);
        } catch { add("parking.layout", "architect", "주차 배치 템플릿", "fail", "제공된 주차 형상을 안전하게 검사하지 못했습니다."); }
      }
    }
  }
  if (!parking) {
    add("parking.coverage", "architect", "주차·차량 검사 범위", "missing", "완전하게 연결된 입력이 없어 주차 배치와 차량 후보를 검사하지 못했습니다.");
  }
  const egressPlan = parse(egressPlanSchema, rawPlan.egressPlan, "egress.inputs", "architect", "피난·출구 원시 설정");
  if (plan && egressPlan) {
    const obstacles = parkingEgressObstacles(parking);
    add("egress.obstacles", "architect", "주차·보행 간섭 검사 범위", obstacles ? "checked" : "missing",
      obstacles ? "배치된 주차면·통로·가정 기둥을 피난 모델에 전달했습니다. 실측 장애물은 미검증입니다." : "피난 모델에 전달할 주차 장애물 자료가 없습니다.");
    try {
      const result = assessEgressCore({ scenario: { ...plan, floorPrograms: usableFloors, egressPlan }, floors: usableGeometryFloors,
        parcelShape: geometry?.parcel.polygon?.length && validPlanPolygon(geometry.parcel.polygon) ? geometry.parcel.polygon : undefined,
        parcelPolygons: parcelMatches ? geometry?.parcel.polygons : [], groundObstacles: obstacles });
      add("egress.core", "architect", "코어·지상 출구 연결", assessmentStatus(result), assessmentDetail(result.issues,
        `${result.connectedFloors.length}개 층과 ${result.checkedRooms}개 실의 개념 연결을 확인했습니다. 공식 피난 승인은 미확인입니다.`));
      for (const link of result.links) add(`egress.link.${encodeURIComponent(link.lowerFloorId)}.${encodeURIComponent(link.upperFloorId)}`, "architect", link.label,
        link.status === "fit" ? "checked" : link.status === "conflict" ? "fail" : "missing", "공유 코어 영역에 기존 2개 계단 구간의 예약 공간만 검사합니다. 다른 계단 해법은 이 템플릿 범위 밖입니다.");
    } catch { add("egress.core", "architect", "코어·지상 출구 연결", "fail", "제공된 피난 모델을 안전하게 검사하지 못했습니다."); }
  } else add("egress.core", "architect", "코어·지상 출구 연결", "missing", "한도 내 원시 층 프로그램과 명시적인 피난 설정이 필요합니다.");
  report.status = report.checks.some(c => c.status === "fail") ? "conflict"
    : report.checks.some(c => c.status === "missing") ? "incomplete" : "preliminary";
  return report;
}

/** Binding gaps block every discipline; other blockers are scoped to their owning discipline. */
export function verificationApprovalBlockers(report: IntegratedVerificationReport, discipline: HandoffDiscipline): IntegratedVerificationCheck[] {
  return report.checks.filter(check => (check.status === "missing" || check.status === "fail") &&
    (check.id.startsWith("binding.") || check.discipline === discipline));
}
