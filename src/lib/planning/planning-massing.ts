import type {
  FloorProgram,
  FloorUseType,
  PlanningPlacement,
} from "@/lib/planning/types";

export interface LocalPlanPoint {
  x: number;
  z: number;
}

export interface PlanningEnvelopeStep {
  level: number;
  shape: LocalPlanPoint[];
  envelopeAreaSqm: number;
  requiredSetbackM: number;
  envelopeAvailable: boolean;
}

export interface PlanningMassZoneSummary {
  useType: FloorUseType;
  areaSqm: number;
  unitCount: number;
}

export interface PlanningFloorMass {
  id: string;
  level: number;
  label: string;
  baseHeightM: number;
  topHeightM: number;
  floorHeightM: number;
  shape: LocalPlanPoint[];
  programAreaSqm: number;
  visualAreaSqm: number;
  areaDifferencePct: number;
  footprintScalePct: number;
  northSetbackM: number;
  requiredSetbackM: number;
  envelopeAvailable: boolean;
  residentialUnits: number;
  commercialUnits: number;
  dominantUse: FloorUseType | "mixed";
  zones: PlanningMassZoneSummary[];
}

export interface PlanningMassModel {
  floors: PlanningFloorMass[];
  aboveGroundFloors: PlanningFloorMass[];
  basementFloors: PlanningFloorMass[];
  totalHeightM: number;
  basementDepthM: number;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function polygonAreaSqm(points: LocalPlanPoint[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.x * next.z - next.x * current.z;
  }
  return Math.abs(sum) / 2;
}

export function polygonCentroid(points: LocalPlanPoint[]): LocalPlanPoint {
  if (points.length === 0) return { x: 0, z: 0 };
  const signedArea = points.reduce((sum, current, index) => {
    const next = points[(index + 1) % points.length];
    return sum + current.x * next.z - next.x * current.z;
  }, 0) / 2;

  if (Math.abs(signedArea) < 1e-9) {
    return points.reduce(
      (sum, point) => ({ x: sum.x + point.x / points.length, z: sum.z + point.z / points.length }),
      { x: 0, z: 0 }
    );
  }

  let x = 0;
  let z = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const factor = current.x * next.z - next.x * current.z;
    x += (current.x + next.x) * factor;
    z += (current.z + next.z) * factor;
  }
  const divisor = 6 * signedArea;
  return { x: x / divisor, z: z / divisor };
}

export function transformPlanningFootprint(
  points: LocalPlanPoint[],
  footprintScalePct: number,
  northSetbackM: number,
  placement: PlanningPlacement
): LocalPlanPoint[] {
  const center = polygonCentroid(points);
  const scale = Math.min(1, Math.max(0.1, footprintScalePct / 100));
  const angle = (placement.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return points.map((point) => {
    const scaledX = (point.x - center.x) * scale;
    const scaledZ = (point.z - center.z) * scale;
    const rotatedX = scaledX * cos - scaledZ * sin;
    const rotatedZ = scaledX * sin + scaledZ * cos;
    return {
      x: center.x + rotatedX + placement.offsetXM,
      // Local z grows toward the south. A north setback therefore moves the mass south.
      z: center.z + rotatedZ + placement.offsetZM + nonNegative(northSetbackM),
    };
  });
}

function floorProgramArea(floor: FloorProgram): number {
  return floor.zones.reduce((sum, zone) => sum + nonNegative(zone.areaSqm), 0);
}

function countUnits(floor: FloorProgram, uses: FloorUseType[]): number {
  return floor.zones.reduce(
    (sum, zone) => uses.includes(zone.useType) ? sum + Math.max(0, Math.floor(zone.unitCount)) : sum,
    0
  );
}

function dominantUse(floor: FloorProgram): FloorUseType | "mixed" {
  const positive = floor.zones.filter((zone) => zone.areaSqm > 0);
  if (positive.length === 0) return "other";
  const byUse = new Map<FloorUseType, number>();
  positive.forEach((zone) => byUse.set(zone.useType, (byUse.get(zone.useType) ?? 0) + zone.areaSqm));
  const ranked = [...byUse.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length > 1 && ranked[1][1] >= ranked[0][1] * 0.6) return "mixed";
  return ranked[0][0];
}

function buildMass(
  floor: FloorProgram,
  envelope: PlanningEnvelopeStep,
  placement: PlanningPlacement,
  baseHeightM: number,
  topHeightM: number
): PlanningFloorMass {
  const shape = transformPlanningFootprint(
    envelope.shape,
    floor.footprintScalePct,
    floor.northSetbackM,
    placement
  );
  const programAreaSqm = floorProgramArea(floor);
  const visualAreaSqm = polygonAreaSqm(shape);
  const areaDifferencePct = programAreaSqm > 0
    ? ((visualAreaSqm - programAreaSqm) / programAreaSqm) * 100
    : 0;

  return {
    id: floor.id,
    level: floor.level,
    label: floor.label,
    baseHeightM,
    topHeightM,
    floorHeightM: nonNegative(floor.floorHeightM),
    shape,
    programAreaSqm,
    visualAreaSqm,
    areaDifferencePct,
    footprintScalePct: floor.footprintScalePct,
    northSetbackM: nonNegative(floor.northSetbackM),
    requiredSetbackM: nonNegative(envelope.requiredSetbackM),
    envelopeAvailable: envelope.envelopeAvailable,
    residentialUnits: countUnits(floor, ["residential"]),
    commercialUnits: countUnits(floor, ["retail", "office"]),
    dominantUse: dominantUse(floor),
    zones: floor.zones.map((zone) => ({
      useType: zone.useType,
      areaSqm: nonNegative(zone.areaSqm),
      unitCount: Math.max(0, Math.floor(zone.unitCount)),
    })),
  };
}

export function buildPlanningMassModel(
  floorPrograms: FloorProgram[],
  envelopeSteps: PlanningEnvelopeStep[],
  placement: PlanningPlacement
): PlanningMassModel {
  const envelopeByLevel = new Map(envelopeSteps.map((step) => [step.level, step]));
  const fallbackEnvelope = envelopeSteps.find((step) => step.level === 1) ?? envelopeSteps[0] ?? {
    level: 1,
    shape: [],
    envelopeAreaSqm: 0,
    requiredSetbackM: 0,
    envelopeAvailable: false,
  };

  const groundPrograms = floorPrograms
    .filter((floor) => floor.level > 0)
    .sort((a, b) => a.level - b.level);
  const basementPrograms = floorPrograms
    .filter((floor) => floor.level < 0)
    .sort((a, b) => b.level - a.level); // B1, B2, B3

  let currentHeightM = 0;
  const aboveGroundFloors = groundPrograms.map((floor) => {
    const height = nonNegative(floor.floorHeightM);
    const base = currentHeightM;
    currentHeightM += height;
    return buildMass(
      floor,
      envelopeByLevel.get(floor.level) ?? fallbackEnvelope,
      placement,
      base,
      currentHeightM
    );
  });

  let currentDepthM = 0;
  const basementFloors = basementPrograms.map((floor) => {
    const height = nonNegative(floor.floorHeightM);
    const top = -currentDepthM;
    currentDepthM += height;
    const base = -currentDepthM;
    return buildMass(
      floor,
      envelopeByLevel.get(floor.level) ?? fallbackEnvelope,
      placement,
      base,
      top
    );
  });

  return {
    floors: [...aboveGroundFloors, ...basementFloors],
    aboveGroundFloors,
    basementFloors,
    totalHeightM: currentHeightM,
    basementDepthM: currentDepthM,
  };
}
