import type { LngLat } from "@/lib/finance/buildable-area";
import { analyzeFrontage } from "@/lib/geo/road-frontage";
import {
  calculateParkingLayout,
  type ParkingLayoutResult,
} from "@/lib/planning/parking-layout";
import type { PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import type {
  FloorProgram,
  ParkingStrategy,
  PlanningParking,
  PlanningScenario,
  PlanningScenarioCalculation,
} from "@/lib/planning/types";

export type ParkingSequenceRecommendationKind =
  | "keep-current"
  | "surface"
  | "piloti"
  | "reduce-program"
  | "manual-review"
  | "preserve-reference";

export interface ParkingSequenceRoadStatus {
  status: "frontage-known" | "frontage-unknown";
  roadName: string | null;
  source: "VWorld road centerline" | "none";
  /** 도로 폭은 지적 도로 경계로 별도 검증하기 전까지 절대 생성하지 않는다. */
  verifiedWidthM: null;
  message: string;
}

export interface ParkingSequenceOption {
  strategy: "surface" | "piloti";
  available: boolean;
  layout: ParkingLayoutResult | null;
  message: string;
}

export interface ParkingSequenceRecommendation {
  kind: ParkingSequenceRecommendationKind;
  actionable: boolean;
  requiredCars: number;
  residentialUnits: number;
  road: ParkingSequenceRoadStatus;
  currentLayout: ParkingLayoutResult;
  surface: ParkingSequenceOption;
  piloti: ParkingSequenceOption;
  removedGroundFloorUnitsForPiloti: number;
  removedGroundFloorAreaSqmForPiloti: number;
  title: string;
  message: string;
}

export interface ParkingSequenceAdvisorInput {
  scenario: PlanningScenario;
  calculation: PlanningScenarioCalculation;
  geometry: PlanningGeometrySnapshot;
  boundary?: LngLat[];
  roads?: Array<{ name: string | null; points: [number, number][] }>;
}

export interface ParkingAlternativePatch {
  strategy: "surface" | "piloti";
  nameSuffix: string;
  patch: Partial<Pick<PlanningScenario, "floorPrograms" | "parking">>;
  removedGroundFloorUnits: number;
  removedGroundFloorAreaSqm: number;
}

function closedBoundary(boundary: LngLat[]): LngLat[] {
  const first = boundary[0];
  const last = boundary[boundary.length - 1];
  if (!first || !last) return boundary;
  return first[0] === last[0] && first[1] === last[1]
    ? boundary
    : [...boundary, first];
}

function firstFloorProgram(scenario: PlanningScenario): FloorProgram | null {
  return scenario.floorPrograms.find((floor) => floor.level === 1) ?? null;
}

function floorArea(floor: FloorProgram | null): number {
  return (
    floor?.zones.reduce((sum, zone) => sum + Math.max(0, zone.areaSqm), 0) ??
    0
  );
}

function floorUnits(floor: FloorProgram | null): number {
  return (
    floor?.zones.reduce((sum, zone) => sum + Math.max(0, zone.unitCount), 0) ??
    0
  );
}

function hasUpperOccupiedFloor(scenario: PlanningScenario): boolean {
  return scenario.floorPrograms.some(
    (floor) =>
      floor.level > 1 &&
      floor.zones.some(
        (zone) =>
          zone.areaSqm > 0 &&
          zone.useType !== "parking" &&
          zone.useType !== "piloti"
      )
  );
}

function hasPilotiProgram(scenario: PlanningScenario): boolean {
  return Boolean(
    firstFloorProgram(scenario)?.zones.some(
      (zone) =>
        zone.areaSqm > 0 &&
        (zone.useType === "piloti" || zone.useType === "parking")
    )
  );
}

function parkingSettings(
  scenario: PlanningScenario,
  strategy: ParkingStrategy
): PlanningParking {
  return {
    ...scenario.parking,
    strategy,
    orientation: scenario.parking.orientation ?? "auto",
    stallWidthM: scenario.parking.stallWidthM ?? 2.5,
    stallDepthM: scenario.parking.stallDepthM ?? 5,
    aisleWidthM: scenario.parking.aisleWidthM ?? 6,
    entryWidthM: scenario.parking.entryWidthM ?? 3,
    coreAreaSqm:
      strategy === "piloti" ? (scenario.parking.coreAreaSqm ?? 9) : 0,
    columnLossPct:
      strategy === "piloti" ? (scenario.parking.columnLossPct ?? 8) : 0,
  };
}

function resolveFrontage(
  geometry: PlanningGeometrySnapshot,
  boundary?: LngLat[],
  roads?: Array<{ name: string | null; points: [number, number][] }>
): {
  frontEdge: [
    PlanningGeometrySnapshot["parcel"]["polygon"][number],
    PlanningGeometrySnapshot["parcel"]["polygon"][number],
  ] | null;
  road: ParkingSequenceRoadStatus;
} {
  const frontage =
    boundary && boundary.length >= 3 && roads?.length
      ? analyzeFrontage(closedBoundary(boundary), roads)
      : null;
  const polygon = geometry.parcel.polygon;
  if (
    !frontage ||
    frontage.frontIndex < 0 ||
    frontage.frontIndex >= polygon.length
  ) {
    return {
      frontEdge: null,
      road: {
        status: "frontage-unknown",
        roadName: null,
        source: "none",
        verifiedWidthM: null,
        message:
          "도로 접면 방향을 확인하지 못했습니다. 임의의 6m 도로를 가정하지 않으며 주차 진입은 수동 검토가 필요합니다.",
      },
    };
  }
  return {
    frontEdge: [
      polygon[frontage.frontIndex],
      polygon[(frontage.frontIndex + 1) % polygon.length],
    ],
    road: {
      status: "frontage-known",
      roadName: frontage.roadName,
      source: "VWorld road centerline",
      verifiedWidthM: null,
      message:
        "도로 중심선으로 접면 방향만 확인했습니다. 도로 폭·경계는 지적 도로 자료로 별도 검증해야 합니다.",
    },
  };
}

function optionMessage(
  label: string,
  layout: ParkingLayoutResult | null,
  available = true
): string {
  if (!available || !layout) return `${label} 대안을 만들 수 없습니다.`;
  if (!layout.supportedStrategy) {
    return layout.warnings[0] ?? `${label} 배치를 검토할 수 없습니다.`;
  }
  return layout.shortfallCars > 0
    ? `${label} ${layout.capacityCars}대 배치 · ${layout.shortfallCars}대 부족`
    : `${label} ${layout.capacityCars}대 배치 가능 · 요구 주차 충족`;
}

export function buildParkingSequenceRecommendation(
  input: ParkingSequenceAdvisorInput
): ParkingSequenceRecommendation {
  const { scenario, calculation, geometry } = input;
  const requiredCars = Math.max(0, Math.ceil(calculation.parking.requiredCars));
  const parcelShape = geometry.parcel.polygon;
  const firstMass = geometry.building.aboveGroundFloors.find(
    (floor) => floor.level === 1
  );
  const firstProgram = firstFloorProgram(scenario);
  const { frontEdge, road } = resolveFrontage(
    geometry,
    input.boundary,
    input.roads
  );
  const currentLayout = calculateParkingLayout({
    strategy: scenario.parking.strategy,
    parcelShape,
    buildingShape: firstMass?.shape ?? [],
    pilotiShape: firstMass?.shape ?? [],
    pilotiEnabled: hasPilotiProgram(scenario),
    requiredCars,
    frontEdge,
    parking: scenario.parking,
  });
  const surfaceLayout = calculateParkingLayout({
    strategy: "surface",
    parcelShape,
    buildingShape: firstMass?.shape ?? [],
    requiredCars,
    frontEdge,
    parking: parkingSettings(scenario, "surface"),
  });
  const pilotiAvailable = Boolean(firstMass) && hasUpperOccupiedFloor(scenario);
  const pilotiLayout = pilotiAvailable
    ? calculateParkingLayout({
        strategy: "piloti",
        parcelShape,
        pilotiShape: firstMass?.shape ?? [],
        pilotiEnabled: true,
        requiredCars,
        frontEdge,
        parking: parkingSettings(scenario, "piloti"),
      })
    : null;
  const referencePreserved = scenario.geometrySource?.mode === "reference-image";

  let kind: ParkingSequenceRecommendationKind;
  let title: string;
  let message: string;
  if (road.status === "frontage-unknown") {
    kind = "manual-review";
    title = "도로 접면을 먼저 확인하세요";
    message =
      "배치 가능 대수는 참고로만 계산했습니다. 접면이 확인되기 전에는 주차 대안을 적용하지 않습니다.";
  } else if (requiredCars === 0) {
    kind = "keep-current";
    title = "현재 프로그램은 요구 주차 0대입니다";
    message = "용도·면적 변경 시 요구 주차가 다시 계산됩니다.";
  } else if (currentLayout.supportedStrategy && currentLayout.shortfallCars === 0) {
    kind = "keep-current";
    title = "현재 주차 계획을 유지할 수 있습니다";
    message = `실제 배치 엔진에서 ${currentLayout.capacityCars}대가 배치되어 요구 ${requiredCars}대를 충족합니다.`;
  } else if (referencePreserved) {
    kind = "preserve-reference";
    title = "기준 이미지 형상을 유지합니다";
    message =
      "기준 이미지에 없는 지상주차·필로티를 새로 만들지 않습니다. 주차 부족은 별도 설계 검토 항목으로 남깁니다.";
  } else if (surfaceLayout.supportedStrategy && surfaceLayout.shortfallCars === 0) {
    kind = "surface";
    title = "지상주차 대안이 먼저 적합합니다";
    message = `건물 외곽을 제외한 대지에 ${surfaceLayout.capacityCars}대를 실제 배치할 수 있습니다.`;
  } else if (
    pilotiLayout?.supportedStrategy &&
    pilotiLayout.shortfallCars === 0
  ) {
    kind = "piloti";
    title = "필로티 대안을 검토하세요";
    message = `지상주차는 ${surfaceLayout.shortfallCars}대 부족하지만 1층 필로티에는 ${pilotiLayout.capacityCars}대를 배치할 수 있습니다.`;
  } else {
    kind = "reduce-program";
    title = "층·세대 구성을 조정해야 합니다";
    message =
      "지상주차와 필로티 모두 요구 주차를 충족하지 못합니다. 세대수·면적을 줄이거나 지하·기계식 주차를 전문가 검토해야 합니다.";
  }

  return {
    kind,
    actionable: kind === "surface" || kind === "piloti",
    requiredCars,
    residentialUnits: calculation.metrics.residentialUnitCount,
    road,
    currentLayout,
    surface: {
      strategy: "surface",
      available: true,
      layout: surfaceLayout,
      message: optionMessage("지상주차", surfaceLayout),
    },
    piloti: {
      strategy: "piloti",
      available: pilotiAvailable,
      layout: pilotiLayout,
      message: optionMessage("필로티", pilotiLayout, pilotiAvailable),
    },
    removedGroundFloorUnitsForPiloti: floorUnits(firstProgram),
    removedGroundFloorAreaSqmForPiloti: floorArea(firstProgram),
    title,
    message,
  };
}

export function buildParkingAlternativePatch(
  scenario: PlanningScenario,
  strategy: "surface" | "piloti",
  capacityCars: number
): ParkingAlternativePatch | null {
  if (scenario.geometrySource?.mode === "reference-image") return null;
  const parking: PlanningParking = {
    ...parkingSettings(scenario, strategy),
    providedCars: Math.max(0, Math.floor(capacityCars)),
    notes: [
      scenario.parking.notes,
      "주차 순서 도우미가 실제 면·통로 배치로 산정한 대안입니다. 도로 폭·경계와 차량 진출입 인허가는 별도 확인이 필요합니다.",
    ]
      .filter(Boolean)
      .join(" "),
  };
  if (strategy === "surface") {
    return {
      strategy,
      nameSuffix: "지상주차 대안",
      patch: { parking },
      removedGroundFloorUnits: 0,
      removedGroundFloorAreaSqm: 0,
    };
  }
  const groundFloor = firstFloorProgram(scenario);
  if (!groundFloor || !hasUpperOccupiedFloor(scenario)) return null;
  const removedGroundFloorAreaSqm = floorArea(groundFloor);
  const removedGroundFloorUnits = floorUnits(groundFloor);
  const floorPrograms = scenario.floorPrograms.map((floor) =>
    floor.level === 1
      ? {
          ...floor,
          zones: [
            {
              id: `${floor.id}-parking-alternative`,
              useType: "piloti" as const,
              label: "필로티 주차",
              areaSqm: removedGroundFloorAreaSqm,
              unitCount: 0,
              revenueModel: "non-revenue" as const,
            },
          ],
        }
      : floor
  );
  return {
    strategy,
    nameSuffix: "필로티 대안",
    patch: { floorPrograms, parking },
    removedGroundFloorUnits,
    removedGroundFloorAreaSqm,
  };
}
