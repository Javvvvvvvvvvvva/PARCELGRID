import {
  polygonAreaSqm,
  polygonCentroid,
  type LocalPlanPoint,
} from "@/lib/planning/planning-massing";
import type {
  ParkingOrientation,
  ParkingStrategy,
  PlanningParking,
} from "@/lib/planning/types";

const EPSILON = 1e-7;

export interface ParkingStallLayout {
  id: string;
  corners: LocalPlanPoint[];
  center: LocalPlanPoint;
  widthM: number;
  depthM: number;
  angleDeg: number;
  source: "surface" | "piloti";
}

export interface ParkingLayoutInput {
  strategy: ParkingStrategy;
  parcelShape: LocalPlanPoint[];
  buildingShape?: LocalPlanPoint[];
  pilotiShape?: LocalPlanPoint[];
  pilotiEnabled?: boolean;
  requiredCars: number;
  frontEdge?: [LocalPlanPoint, LocalPlanPoint] | null;
  parking: PlanningParking;
}

export interface ParkingLayoutResult {
  supportedStrategy: boolean;
  source: "none" | "surface" | "piloti" | "mixed";
  requiredCars: number;
  capacityCars: number;
  shortfallCars: number;
  rawCandidateCars: number;
  usableAreaSqm: number;
  targetShape: LocalPlanPoint[];
  exclusionShape: LocalPlanPoint[];
  stalls: ParkingStallLayout[];
  aisleShape: LocalPlanPoint[];
  coreShape: LocalPlanPoint[];
  columns: LocalPlanPoint[];
  orientationDeg: number;
  warnings: string[];
}

interface ParkingConfig {
  orientation: ParkingOrientation;
  stallWidthM: number;
  stallDepthM: number;
  aisleWidthM: number;
  entryWidthM: number;
  coreAreaSqm: number;
  columnLossPct: number;
}

interface OrientedPoint {
  u: number;
  v: number;
}

interface CandidateLayout {
  stalls: ParkingStallLayout[];
  aisleShape: LocalPlanPoint[];
  rawCandidateCars: number;
  capacityCars: number;
  angleDeg: number;
}

function finitePositive(value: number | undefined, fallback: number): number {
  return value != null && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function configFromParking(parking: PlanningParking): ParkingConfig {
  return {
    orientation: parking.orientation ?? "auto",
    stallWidthM: finitePositive(parking.stallWidthM, 2.5),
    stallDepthM: finitePositive(parking.stallDepthM, 5),
    aisleWidthM: finitePositive(parking.aisleWidthM, 6),
    entryWidthM: finitePositive(parking.entryWidthM, 3),
    coreAreaSqm: Math.max(0, parking.coreAreaSqm ?? 10),
    columnLossPct: clamp(parking.columnLossPct ?? 8, 0, 45),
  };
}

function pointOnSegment(
  point: LocalPlanPoint,
  start: LocalPlanPoint,
  end: LocalPlanPoint
): boolean {
  const cross =
    (point.z - start.z) * (end.x - start.x) -
    (point.x - start.x) * (end.z - start.z);
  if (Math.abs(cross) > EPSILON) return false;
  const dot =
    (point.x - start.x) * (end.x - start.x) +
    (point.z - start.z) * (end.z - start.z);
  if (dot < -EPSILON) return false;
  const lengthSquared =
    (end.x - start.x) ** 2 + (end.z - start.z) ** 2;
  return dot <= lengthSquared + EPSILON;
}

function pointInPolygon(point: LocalPlanPoint, polygon: LocalPlanPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index++
  ) {
    const current = polygon[index];
    const before = polygon[previous];
    if (pointOnSegment(point, before, current)) return true;
    const intersects =
      current.z > point.z !== before.z > point.z &&
      point.x <
        ((before.x - current.x) * (point.z - current.z)) /
          (before.z - current.z) +
          current.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonInside(inner: LocalPlanPoint[], outer: LocalPlanPoint[]): boolean {
  if (inner.length < 3 || outer.length < 3) return false;
  return inner.every((point) => pointInPolygon(point, outer));
}

function shapesOverlap(a: LocalPlanPoint[], b: LocalPlanPoint[]): boolean {
  if (a.length < 3 || b.length < 3) return false;
  if (a.some((point) => pointInPolygon(point, b))) return true;
  if (b.some((point) => pointInPolygon(point, a))) return true;
  const centerA = polygonCentroid(a);
  const centerB = polygonCentroid(b);
  return pointInPolygon(centerA, b) || pointInPolygon(centerB, a);
}

function toOriented(point: LocalPlanPoint, angleDeg: number): OrientedPoint {
  const angle = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    u: point.x * cos + point.z * sin,
    v: -point.x * sin + point.z * cos,
  };
}

function fromOriented(point: OrientedPoint, angleDeg: number): LocalPlanPoint {
  const angle = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: point.u * cos - point.v * sin,
    z: point.u * sin + point.v * cos,
  };
}

function orientedBounds(shape: LocalPlanPoint[], angleDeg: number) {
  const points = shape.map((point) => toOriented(point, angleDeg));
  return {
    minU: Math.min(...points.map((point) => point.u)),
    maxU: Math.max(...points.map((point) => point.u)),
    minV: Math.min(...points.map((point) => point.v)),
    maxV: Math.max(...points.map((point) => point.v)),
  };
}

function rectangleInOrientedSpace(
  centerU: number,
  centerV: number,
  width: number,
  depth: number,
  angleDeg: number
): LocalPlanPoint[] {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  return [
    { u: centerU - halfWidth, v: centerV - halfDepth },
    { u: centerU + halfWidth, v: centerV - halfDepth },
    { u: centerU + halfWidth, v: centerV + halfDepth },
    { u: centerU - halfWidth, v: centerV + halfDepth },
  ].map((point) => fromOriented(point, angleDeg));
}

function longestEdgeAngle(shape: LocalPlanPoint[]): number {
  let longest = -1;
  let angle = 0;
  shape.forEach((point, index) => {
    const next = shape[(index + 1) % shape.length];
    const dx = next.x - point.x;
    const dz = next.z - point.z;
    const lengthSquared = dx * dx + dz * dz;
    if (lengthSquared > longest) {
      longest = lengthSquared;
      angle = (Math.atan2(dz, dx) * 180) / Math.PI;
    }
  });
  return angle;
}

function edgeAngle(edge?: [LocalPlanPoint, LocalPlanPoint] | null): number | null {
  if (!edge) return null;
  return (
    (Math.atan2(edge[1].z - edge[0].z, edge[1].x - edge[0].x) * 180) /
    Math.PI
  );
}

function coreRectangle(
  targetShape: LocalPlanPoint[],
  angleDeg: number,
  coreAreaSqm: number
): LocalPlanPoint[] {
  if (coreAreaSqm <= 0 || targetShape.length < 3) return [];
  const bounds = orientedBounds(targetShape, angleDeg);
  const targetWidth = Math.max(1, bounds.maxU - bounds.minU);
  const targetDepth = Math.max(1, bounds.maxV - bounds.minV);
  const width = Math.min(targetWidth * 0.38, Math.max(2, Math.sqrt(coreAreaSqm * 1.35)));
  const depth = Math.min(targetDepth * 0.45, coreAreaSqm / Math.max(width, 0.1));
  return rectangleInOrientedSpace(
    bounds.maxU - width / 2 - 0.25,
    bounds.maxV - depth / 2 - 0.25,
    width,
    depth,
    angleDeg
  );
}

function generateColumns(
  targetShape: LocalPlanPoint[],
  coreShape: LocalPlanPoint[],
  angleDeg: number
): LocalPlanPoint[] {
  if (targetShape.length < 3) return [];
  const bounds = orientedBounds(targetShape, angleDeg);
  const columns: LocalPlanPoint[] = [];
  for (let u = bounds.minU + 2.5; u < bounds.maxU; u += 5) {
    for (let v = bounds.minV + 2.5; v < bounds.maxV; v += 5) {
      const point = fromOriented({ u, v }, angleDeg);
      if (
        pointInPolygon(point, targetShape) &&
        (coreShape.length < 3 || !pointInPolygon(point, coreShape))
      ) {
        columns.push(point);
      }
    }
  }
  return columns;
}

function candidateAngles(
  targetShape: LocalPlanPoint[],
  orientation: ParkingOrientation,
  frontEdge?: [LocalPlanPoint, LocalPlanPoint] | null
): number[] {
  const front = edgeAngle(frontEdge);
  const base = front ?? longestEdgeAngle(targetShape);
  if (orientation === "parallel-front") return [base];
  if (orientation === "perpendicular-front") return [base + 90];
  return [base, base + 90];
}

function generateCandidate(
  source: "surface" | "piloti",
  targetShape: LocalPlanPoint[],
  exclusionShape: LocalPlanPoint[],
  coreShape: LocalPlanPoint[],
  angleDeg: number,
  rows: 1 | 2,
  bandOffsetRatio: number,
  config: ParkingConfig
): CandidateLayout | null {
  const bounds = orientedBounds(targetShape, angleDeg);
  const totalDepth =
    rows * config.stallDepthM + config.aisleWidthM;
  const availableDepth = bounds.maxV - bounds.minV;
  if (availableDepth + EPSILON < totalDepth) return null;
  const remaining = Math.max(0, availableDepth - totalDepth);
  const bandStart = bounds.minV + remaining * bandOffsetRatio;
  const rowCenters =
    rows === 1
      ? [bandStart + config.stallDepthM / 2]
      : [
          bandStart + config.stallDepthM / 2,
          bandStart +
            config.stallDepthM +
            config.aisleWidthM +
            config.stallDepthM / 2,
        ];
  const aisleCenterV =
    rows === 1
      ? bandStart + config.stallDepthM + config.aisleWidthM / 2
      : bandStart + config.stallDepthM + config.aisleWidthM / 2;
  const aisleShape = rectangleInOrientedSpace(
    (bounds.minU + bounds.maxU) / 2,
    aisleCenterV,
    Math.max(0.1, bounds.maxU - bounds.minU),
    config.aisleWidthM,
    angleDeg
  );

  const stalls: ParkingStallLayout[] = [];
  let index = 0;
  for (
    let centerU = bounds.minU + config.stallWidthM / 2;
    centerU <= bounds.maxU - config.stallWidthM / 2 + EPSILON;
    centerU += config.stallWidthM
  ) {
    rowCenters.forEach((centerV) => {
      const corners = rectangleInOrientedSpace(
        centerU,
        centerV,
        config.stallWidthM,
        config.stallDepthM,
        angleDeg
      );
      if (!polygonInside(corners, targetShape)) return;
      if (exclusionShape.length >= 3 && shapesOverlap(corners, exclusionShape)) {
        return;
      }
      if (coreShape.length >= 3 && shapesOverlap(corners, coreShape)) return;
      stalls.push({
        id: `${source}-${angleDeg.toFixed(1)}-${rows}-${index++}`,
        corners,
        center: polygonCentroid(corners),
        widthM: config.stallWidthM,
        depthM: config.stallDepthM,
        angleDeg,
        source,
      });
    });
  }

  const lossPct = source === "piloti" ? config.columnLossPct : 0;
  const capacityCars = Math.max(
    0,
    Math.round(stalls.length * (1 - lossPct / 100))
  );
  return {
    stalls: stalls.slice(0, capacityCars),
    aisleShape,
    rawCandidateCars: stalls.length,
    capacityCars,
    angleDeg,
  };
}

function emptyResult(
  input: ParkingLayoutInput,
  source: ParkingLayoutResult["source"],
  warnings: string[]
): ParkingLayoutResult {
  return {
    supportedStrategy: false,
    source,
    requiredCars: Math.max(0, Math.ceil(input.requiredCars)),
    capacityCars: 0,
    shortfallCars: Math.max(0, Math.ceil(input.requiredCars)),
    rawCandidateCars: 0,
    usableAreaSqm: 0,
    targetShape: [],
    exclusionShape: [],
    stalls: [],
    aisleShape: [],
    coreShape: [],
    columns: [],
    orientationDeg: 0,
    warnings,
  };
}

function calculateSingleLayout(
  input: ParkingLayoutInput,
  source: "surface" | "piloti"
): ParkingLayoutResult {
  const config = configFromParking(input.parking);
  const targetShape =
    source === "piloti" ? input.pilotiShape ?? [] : input.parcelShape;
  const exclusionShape =
    source === "surface" ? input.buildingShape ?? [] : [];
  const warnings: string[] = [];

  if (source === "piloti" && !input.pilotiEnabled) {
    return emptyResult(input, source, [
      "1층 프로그램에 필로티 또는 주차 구역이 없어 필로티 주차를 배치할 수 없습니다.",
    ]);
  }
  if (targetShape.length < 3 || polygonAreaSqm(targetShape) <= 0) {
    return emptyResult(input, source, [
      source === "piloti"
        ? "필로티 외곽선이 없어 주차면을 배치할 수 없습니다."
        : "대지 경계가 없어 지상 주차면을 배치할 수 없습니다.",
    ]);
  }

  const angles = candidateAngles(
    targetShape,
    config.orientation,
    input.frontEdge
  );
  let best: CandidateLayout | null = null;
  let bestCore: LocalPlanPoint[] = [];

  for (const angle of angles) {
    const coreShape =
      source === "piloti"
        ? coreRectangle(targetShape, angle, config.coreAreaSqm)
        : [];
    for (const rows of [1, 2] as const) {
      for (let offsetIndex = 0; offsetIndex <= 6; offsetIndex += 1) {
        const candidate = generateCandidate(
          source,
          targetShape,
          exclusionShape,
          coreShape,
          angle,
          rows,
          offsetIndex / 6,
          config
        );
        if (
          candidate &&
          (!best ||
            candidate.capacityCars > best.capacityCars ||
            (candidate.capacityCars === best.capacityCars &&
              candidate.rawCandidateCars > best.rawCandidateCars))
        ) {
          best = candidate;
          bestCore = coreShape;
        }
      }
    }
  }

  if (!best) {
    return emptyResult(input, source, [
      `현재 ${source === "piloti" ? "필로티" : "지상"} 영역의 폭·깊이로는 주차면과 차량 통로를 함께 배치하지 못했습니다.`,
    ]);
  }

  const frontLength = input.frontEdge
    ? Math.hypot(
        input.frontEdge[1].x - input.frontEdge[0].x,
        input.frontEdge[1].z - input.frontEdge[0].z
      )
    : null;
  if (frontLength != null && frontLength < config.entryWidthM) {
    warnings.push(
      `전면 경계 길이 ${frontLength.toFixed(1)}m가 입력한 진입 폭 ${config.entryWidthM.toFixed(1)}m보다 짧습니다.`
    );
  }
  if (source === "surface" && exclusionShape.length >= 3) {
    warnings.push("지상 주차는 건물 외곽선을 제외한 개략 배치이며 조경·보행로·소방 동선을 추가 확인해야 합니다.");
  }
  if (source === "piloti") {
    warnings.push("필로티 기둥은 개략 그리드이며 실제 구조 스팬·코어·보행 동선에 따라 재배치해야 합니다.");
  }

  const columns =
    source === "piloti"
      ? generateColumns(targetShape, bestCore, best.angleDeg)
      : [];
  const requiredCars = Math.max(0, Math.ceil(input.requiredCars));
  const usableAreaSqm = Math.max(
    0,
    polygonAreaSqm(targetShape) -
      polygonAreaSqm(exclusionShape) -
      polygonAreaSqm(bestCore)
  );

  return {
    supportedStrategy: true,
    source,
    requiredCars,
    capacityCars: best.capacityCars,
    shortfallCars: Math.max(0, requiredCars - best.capacityCars),
    rawCandidateCars: best.rawCandidateCars,
    usableAreaSqm,
    targetShape,
    exclusionShape,
    stalls: best.stalls,
    aisleShape: best.aisleShape,
    coreShape: bestCore,
    columns,
    orientationDeg: best.angleDeg,
    warnings,
  };
}

export function calculateParkingLayout(
  input: ParkingLayoutInput
): ParkingLayoutResult {
  if (input.strategy === "surface") {
    return calculateSingleLayout(input, "surface");
  }
  if (input.strategy === "piloti") {
    return calculateSingleLayout(input, "piloti");
  }
  if (input.strategy === "mixed") {
    const piloti = calculateSingleLayout(
      { ...input, strategy: "piloti" },
      "piloti"
    );
    const surface = calculateSingleLayout(
      { ...input, strategy: "surface" },
      "surface"
    );
    const requiredCars = Math.max(0, Math.ceil(input.requiredCars));
    const capacityCars = piloti.capacityCars + surface.capacityCars;
    return {
      supportedStrategy:
        piloti.supportedStrategy || surface.supportedStrategy,
      source: "mixed",
      requiredCars,
      capacityCars,
      shortfallCars: Math.max(0, requiredCars - capacityCars),
      rawCandidateCars:
        piloti.rawCandidateCars + surface.rawCandidateCars,
      usableAreaSqm: piloti.usableAreaSqm + surface.usableAreaSqm,
      targetShape: surface.targetShape,
      exclusionShape: surface.exclusionShape,
      stalls: [...piloti.stalls, ...surface.stalls],
      aisleShape: surface.aisleShape.length > 0
        ? surface.aisleShape
        : piloti.aisleShape,
      coreShape: piloti.coreShape,
      columns: piloti.columns,
      orientationDeg: surface.orientationDeg || piloti.orientationDeg,
      warnings: [...piloti.warnings, ...surface.warnings],
    };
  }
  if (input.strategy === "none") {
    return emptyResult(input, "none", ["주차 계획 없음이 선택되어 있습니다."]);
  }
  return emptyResult(input, "none", [
    input.strategy === "basement"
      ? "지하주차 램프와 회차 배치는 후속 고급 검토 대상입니다."
      : "기계식 주차 제원과 장비 형식은 후속 고급 검토 대상입니다.",
  ]);
}
