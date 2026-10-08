import Decimal from "decimal.js";
import { FACADE_COST_VERSION, FACADE_QUANTITY_VERSION, facadeFingerprint, geometryFacadeQuantities, type FacadeQuantities } from "./facade-quantities";
import type { PlanningGeometrySnapshot } from "./planning-geometry";
import type {
  FloorProgram,
  PlanningFacadeMaterial,
  PlanningMaterialEvidenceStatus,
  PlanningMaterialSelection,
  PlanningScenario,
} from "./types";

const WON_PER_MANWON = 10_000;

export const PLANNING_FACADE_LABELS: Record<PlanningFacadeMaterial, string> = {
  unselected: "미선택 · 계획 매스",
  "standard-render": "스타코·도장",
  "brick-veneer": "치장벽돌",
  "exposed-concrete": "노출콘크리트",
  "metal-panel": "금속패널",
};

export interface PlanningMaterialAppearance {
  primaryColor: string;
  secondaryColor: string;
  primarySharePct: number;
  roughness: number;
  metalness: number;
}

const APPEARANCE: Record<
  Exclude<PlanningFacadeMaterial, "unselected">,
  Omit<PlanningMaterialAppearance, "secondaryColor" | "primarySharePct">
> = {
  "standard-render": {
    primaryColor: "#d6d3d1",
    roughness: 0.84,
    metalness: 0.02,
  },
  "brick-veneer": {
    primaryColor: "#985d47",
    roughness: 0.9,
    metalness: 0,
  },
  "exposed-concrete": {
    primaryColor: "#a8a29e",
    roughness: 0.94,
    metalness: 0,
  },
  "metal-panel": {
    primaryColor: "#64748b",
    roughness: 0.36,
    metalness: 0.62,
  },
};

export function createDefaultPlanningMaterials(): PlanningMaterialSelection {
  return {
    primaryFacadeMaterial: "unselected",
    secondaryFacadeMaterial: "exposed-concrete",
    primaryFacadeSharePct: 100,
    windowRatioPct: 25,
    rateEvidence: {
      status: "unpriced",
    },
  };
}

function finite(value: number | undefined, fallback: number): number {
  return value != null && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function resolvePlanningMaterials(
  selection?: PlanningMaterialSelection
): PlanningMaterialSelection {
  const defaults = createDefaultPlanningMaterials();
  return {
    ...defaults,
    ...selection,
    primaryFacadeSharePct: clamp(
      finite(selection?.primaryFacadeSharePct, defaults.primaryFacadeSharePct),
      0,
      100
    ),
    windowRatioPct: clamp(
      finite(selection?.windowRatioPct, defaults.windowRatioPct),
      0,
      80
    ),
    rateEvidence: {
      ...defaults.rateEvidence,
      ...selection?.rateEvidence,
      status:
        selection?.rateEvidence?.status ??
        defaults.rateEvidence?.status ??
        "unpriced",
    },
  };
}

export function planningMaterialAppearance(
  selection?: PlanningMaterialSelection
): PlanningMaterialAppearance | null {
  const resolved = resolvePlanningMaterials(selection);
  if (resolved.primaryFacadeMaterial === "unselected") return null;

  const primary = APPEARANCE[resolved.primaryFacadeMaterial];
  const secondaryMaterial =
    resolved.secondaryFacadeMaterial === "unselected"
      ? resolved.primaryFacadeMaterial
      : resolved.secondaryFacadeMaterial;
  const secondary = APPEARANCE[secondaryMaterial];
  const secondaryShare = 1 - resolved.primaryFacadeSharePct / 100;

  return {
    primaryColor: primary.primaryColor,
    secondaryColor: secondary.primaryColor,
    primarySharePct: resolved.primaryFacadeSharePct,
    roughness:
      primary.roughness * (1 - secondaryShare) +
      secondary.roughness * secondaryShare,
    metalness:
      primary.metalness * (1 - secondaryShare) +
      secondary.metalness * secondaryShare,
  };
}

function enclosedFloorAreaSqm(floor: FloorProgram): number {
  return floor.zones.reduce((sum, zone) => {
    if (zone.useType === "parking" || zone.useType === "piloti") return sum;
    return sum + Math.max(0, zone.areaSqm);
  }, 0);
}

export interface PlanningFacadeAreaEstimate {
  grossFacadeAreaSqm: number;
  netFacadeAreaSqm: number;
  basis: "user-input" | "area-based-estimate";
  note: string;
}

export function estimatePlanningFacadeArea(
  scenario: Pick<PlanningScenario, "floorPrograms" | "materials">
): PlanningFacadeAreaEstimate {
  const materials = resolvePlanningMaterials(scenario.materials);
  const override = finite(materials.facadeAreaOverrideSqm, 0);
  if (override > 0) {
    return {
      grossFacadeAreaSqm: override,
      netFacadeAreaSqm: override,
      basis: "user-input",
      note: "사용자가 입력한 외벽 순면적",
    };
  }

  const grossFacadeAreaSqm = scenario.floorPrograms
    .filter((floor) => floor.level > 0)
    .reduce((sum, floor) => {
      const enclosedArea = enclosedFloorAreaSqm(floor);
      if (enclosedArea <= 0) return sum;
      // Stage 2 개략 수량: 같은 면적의 정사각형 외곽 둘레를 사용한다.
      // 확정 견적에는 3D 외곽선에서 산출한 실제 벽체 면적으로 교체해야 한다.
      const equivalentPerimeterM = 4 * Math.sqrt(enclosedArea);
      return sum + equivalentPerimeterM * Math.max(0, floor.floorHeightM);
    }, 0);
  const netFacadeAreaSqm =
    grossFacadeAreaSqm * (1 - materials.windowRatioPct / 100);

  return {
    grossFacadeAreaSqm,
    netFacadeAreaSqm,
    basis: "area-based-estimate",
    note: "층 면적을 정사각형으로 환산한 Stage 2 개략 외벽 순면적",
  };
}

export interface PlanningMaterialCostRow {
  material: PlanningFacadeMaterial;
  areaSqm: number;
  baselineWonPerSqm: number | null;
  selectedWonPerSqm: number | null;
  adjustmentWon: number | null;
  evidence: NonNullable<PlanningMaterialSelection["rateEvidence"]>;
}
export interface PlanningMaterialCostAdjustment {
  version: typeof FACADE_COST_VERSION;
  costKey: string;
  quantities: FacadeQuantities;
  rows: PlanningMaterialCostRow[];
  pricingMode: "assembly" | "by-material";
  pricingStatus: "priced" | "partial" | "unpriced";
  unpricedAreaSqm: number;
  hasPricedArea: boolean;
  priced: boolean;
  facadeAreaSqm: number;
  areaBasis: FacadeQuantities["basis"];
  areaNote: string;
  baselineUnitCostPerSqmWon: number | null;
  selectedUnitCostPerSqmWon: number | null;
  adjustmentWon: number;
  adjustmentManwon: number;
  evidenceStatus: PlanningMaterialEvidenceStatus;
  sourceLabel: string;
}

function optionalRate(value: number | undefined, allowZero = false): number | null {
  return value == null || !Number.isFinite(value) || value < 0 || (!allowZero && value === 0) ? null : value;
}

export function materialEvidenceIsComplete(evidence: PlanningMaterialSelection["rateEvidence"]): boolean {
  return evidence?.status === "source-backed" && Boolean(evidence.sourceName?.trim() && /^\d{4}-\d{2}-\d{2}$/.test(evidence.observedAt ?? ""));
}

export function calculatePlanningMaterialAdjustment(
  scenario: Pick<PlanningScenario, "floorPrograms" | "materials">,
  geometry?: PlanningGeometrySnapshot | null
): PlanningMaterialCostAdjustment {
  const materials = resolvePlanningMaterials(scenario.materials);
  const area = estimatePlanningFacadeArea(scenario);
  const quantities: FacadeQuantities = geometry && area.basis !== "user-input"
    ? geometryFacadeQuantities(geometry, materials)
    : { version: FACADE_QUANTITY_VERSION, quantityKey: facadeFingerprint([FACADE_QUANTITY_VERSION, area]),
      basis: area.basis, status: "complete", faces: [], grossFacadeAreaSqm: area.grossFacadeAreaSqm,
      netFacadeAreaSqm: area.netFacadeAreaSqm, openingAreaSqm: area.grossFacadeAreaSqm - area.netFacadeAreaSqm,
      excludedAreaSqm: 0, unresolvedAreaSqm: 0, staleAssignmentIds: [], notes: [area.note,
        "실측·시공 수량 확정이 아닙니다. 수량·단가의 범위와 공종을 확인하세요."] };
  if (!quantities.faces.length && Object.keys(materials.faceAssignments ?? {}).length) {
    quantities.status = "unavailable";
    quantities.notes.push("면별 설정은 유효한 형상 수량에서만 적용됩니다. 수동 총면적 또는 형상 없는 추정과 병용할 수 없습니다.");
  }
  const areas = new Map<PlanningFacadeMaterial, number>();
  const add = (material: PlanningFacadeMaterial, areaSqm: number) => {
    if (areaSqm > 0) areas.set(material, (areas.get(material) ?? 0) + areaSqm);
  };
  const distribute = (areaSqm: number, material?: PlanningFacadeMaterial) => {
    if (material) { add(material, areaSqm); return; }
    add(materials.primaryFacadeMaterial, areaSqm * materials.primaryFacadeSharePct / 100);
    add(materials.secondaryFacadeMaterial, areaSqm * (1 - materials.primaryFacadeSharePct / 100));
  };
  if (quantities.faces.length) {
    for (const face of quantities.faces) if (face.exposure === "exposed" || face.exposure === "assumed-exposed") distribute(face.netAreaSqm, face.material);
  } else distribute(quantities.netFacadeAreaSqm);
  const baselineUnitCostPerSqmWon = optionalRate(materials.baselineFacadeUnitCostPerSqmWon);
  const selectedUnitCostPerSqmWon = optionalRate(materials.selectedFacadeUnitCostPerSqmWon);
  const pricingMode = materials.pricingMode ?? "assembly";
  const blocked = quantities.status === "unavailable" || quantities.staleAssignmentIds.length > 0;
  // Legacy rates describe the entire chosen assembly, not the primary material alone.
  const rows: PlanningMaterialCostRow[] = [...areas].sort(([a], [b]) => a.localeCompare(b)).map(([material, areaSqm]) => {
    const rate = materials.materialRates?.[material];
    const baselineWonPerSqm = pricingMode === "by-material" ? optionalRate(rate?.baselineWonPerSqm, true) : baselineUnitCostPerSqmWon;
    const selectedWonPerSqm = pricingMode === "by-material" ? optionalRate(rate?.selectedWonPerSqm, true) : selectedUnitCostPerSqmWon;
    const evidence = (pricingMode === "by-material" ? rate?.evidence : materials.rateEvidence) ?? { status: "unpriced" as const };
    const rated = !blocked && material !== "unselected" && baselineWonPerSqm !== null && selectedWonPerSqm !== null;
    return { material, areaSqm, baselineWonPerSqm, selectedWonPerSqm, evidence,
      adjustmentWon: rated ? new Decimal(areaSqm).mul(new Decimal(selectedWonPerSqm!).minus(baselineWonPerSqm!)).toNumber() : null };
  });
  const hasPricedArea = rows.some(row => row.adjustmentWon !== null);
  const unpricedAreaSqm = rows.filter(row => row.adjustmentWon === null).reduce((n, row) => n + row.areaSqm, 0);
  const priced = hasPricedArea && unpricedAreaSqm < 1e-8 && quantities.status === "complete";
  const adjustmentWon = rows.reduce((sum, row) => sum.plus(row.adjustmentWon ?? 0), new Decimal(0)).toNumber();
  const evidenceStatus = priced && rows.every(row => materialEvidenceIsComplete(row.evidence)) ? "source-backed" : hasPricedArea ? "user-input" : "unpriced";
  const sourceLabel = [...new Set(rows.map(row => row.evidence.sourceName?.trim()).filter(Boolean))].join(" · ") || (hasPricedArea ? "사용자 입력 단가 · 출처 미기재" : "단가 미입력");
  const costKey = facadeFingerprint({ version: FACADE_COST_VERSION, quantityKey: quantities.quantityKey, pricingMode, rows });
  return { version: FACADE_COST_VERSION, costKey, quantities, rows, pricingMode, hasPricedArea, unpricedAreaSqm, priced,
    pricingStatus: priced ? "priced" : hasPricedArea ? "partial" : "unpriced",
    facadeAreaSqm: quantities.netFacadeAreaSqm, areaBasis: quantities.basis,
    areaNote: quantities.basis === "geometry-derived" ? quantities.status === "unavailable" ? "형상 검증 미완료 · 재료비 산정 보류" : "검증된 층별 외곽선 × 높이 · 계획 수량" : area.note,
    baselineUnitCostPerSqmWon, selectedUnitCostPerSqmWon, adjustmentWon,
    adjustmentManwon: new Decimal(adjustmentWon).div(WON_PER_MANWON).toNumber(), evidenceStatus, sourceLabel };
}
