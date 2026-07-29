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

export interface PlanningMaterialCostAdjustment {
  priced: boolean;
  facadeAreaSqm: number;
  areaBasis: PlanningFacadeAreaEstimate["basis"];
  areaNote: string;
  baselineUnitCostPerSqmWon: number | null;
  selectedUnitCostPerSqmWon: number | null;
  adjustmentWon: number;
  adjustmentManwon: number;
  evidenceStatus: PlanningMaterialEvidenceStatus;
  sourceLabel: string;
}

function optionalRate(value: number | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  return value;
}

export function calculatePlanningMaterialAdjustment(
  scenario: Pick<PlanningScenario, "floorPrograms" | "materials">
): PlanningMaterialCostAdjustment {
  const materials = resolvePlanningMaterials(scenario.materials);
  const area = estimatePlanningFacadeArea(scenario);
  const baselineUnitCostPerSqmWon = optionalRate(
    materials.baselineFacadeUnitCostPerSqmWon
  );
  const selectedUnitCostPerSqmWon = optionalRate(
    materials.selectedFacadeUnitCostPerSqmWon
  );
  const priced =
    materials.primaryFacadeMaterial !== "unselected" &&
    baselineUnitCostPerSqmWon != null &&
    selectedUnitCostPerSqmWon != null;
  const adjustmentWon = priced
    ? area.netFacadeAreaSqm *
      (selectedUnitCostPerSqmWon - baselineUnitCostPerSqmWon)
    : 0;

  return {
    priced,
    facadeAreaSqm: area.netFacadeAreaSqm,
    areaBasis: area.basis,
    areaNote: area.note,
    baselineUnitCostPerSqmWon,
    selectedUnitCostPerSqmWon,
    adjustmentWon,
    adjustmentManwon: adjustmentWon / WON_PER_MANWON,
    evidenceStatus: materials.rateEvidence?.status ?? "unpriced",
    sourceLabel:
      materials.rateEvidence?.sourceName?.trim() ||
      (priced ? "사용자 입력 단가 · 출처 미기재" : "단가 미입력"),
  };
}
