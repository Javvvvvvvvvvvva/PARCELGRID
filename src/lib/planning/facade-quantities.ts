import type { PlanningFloorMass, LocalPlanPoint } from "./planning-massing";
import type { PlanningGeometrySnapshot } from "./planning-geometry";
import type { PlanningMaterialSelection, PlanningFacadeMaterial } from "./types";

export const FACADE_QUANTITY_VERSION = "facade-quantity-2026.1" as const;
export const FACADE_COST_VERSION = "facade-cost-2026.1" as const;

/** Content fingerprint, not a security signature. Canonical keys exclude UI order. */
export function facadeFingerprint(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item && typeof item === "object" ? Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : item;
  const text = JSON.stringify(canonical(value));
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export interface FacadeFace {
  id: string;
  floorId: string;
  label: string;
  start: LocalPlanPoint;
  end: LocalPlanPoint;
  baseHeightM: number;
  heightM: number;
  lengthM: number;
  grossAreaSqm: number;
  openingAreaSqm: number;
  netAreaSqm: number;
  exposure: "assumed-exposed" | "exposed" | "shared" | "unknown";
  material?: PlanningFacadeMaterial;
}
export interface FacadeQuantities {
  version: typeof FACADE_QUANTITY_VERSION;
  quantityKey: string;
  geometryHash?: string;
  basis: "geometry-derived" | "user-input" | "area-based-estimate";
  status: "complete" | "partial" | "unavailable";
  faces: FacadeFace[];
  grossFacadeAreaSqm: number;
  openingAreaSqm: number;
  netFacadeAreaSqm: number;
  excludedAreaSqm: number;
  unresolvedAreaSqm: number;
  staleAssignmentIds: string[];
  notes: string[];
}

/** IDs bind assignments to the actual segment and vertical span, not an edge index. */
export function floorFacadeFaces(floor: PlanningFloorMass): FacadeFace[] {
  const shape = floor.shape.filter((p, i, ring) => i === 0 || p.x !== ring[i - 1].x || p.z !== ring[i - 1].z);
  if (shape.length > 1 && shape[0].x === shape.at(-1)!.x && shape[0].z === shape.at(-1)!.z) shape.pop();
  if (shape.length < 3 || floor.level <= 0) return [];
  const pointKey = (p: LocalPlanPoint) => [Number(p.x.toFixed(6)), Number(p.z.toFixed(6))];
  return shape.flatMap((start, index) => {
    const end = shape[(index + 1) % shape.length];
    const lengthM = Math.hypot(end.x - start.x, end.z - start.z);
    const heightM = floor.topHeightM - floor.baseHeightM;
    if (!Number.isFinite(lengthM * heightM) || lengthM <= 1e-6 || heightM <= 0) return [];
    const endpoints = [pointKey(start), pointKey(end)].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return [{ id: `face-${facadeFingerprint([floor.level, endpoints, floor.baseHeightM, floor.topHeightM])}`,
      floorId: floor.id, label: `${floor.label} · 벽 ${index + 1}`, start, end, baseHeightM: floor.baseHeightM,
      heightM, lengthM, grossAreaSqm: lengthM * heightM, openingAreaSqm: 0, netAreaSqm: lengthM * heightM,
      exposure: "assumed-exposed" as const }];
  });
}

export function geometryFacadeQuantities(geometry: PlanningGeometrySnapshot, materials: PlanningMaterialSelection): FacadeQuantities {
  const faces: FacadeFace[] = [];
  const notes = ["계획 형상의 수직 외벽만 산출. 지붕·바닥·테라스·지하·난간·필로티 기둥은 제외.",
    "인접 건물과의 접합은 자동 판정하지 않음. 기본값은 노출 가정이며 공유벽·미확인은 면별 지정.",
    "창호는 수량 공제 가정이며 실제 창 위치나 시공 도면을 생성하지 않음. 중정(내부 링)은 현재 형상 계약 미지원."];
  let unresolvedAreaSqm = 0, excludedAreaSqm = 0;
  let invalid = geometry.validation.status === "fail";
  if (invalid) notes.push("형상 검증 실패: 자동 재료비를 반영하지 않습니다.");
  const currentIds = new Set<string>();
  for (const floor of geometry.building.aboveGroundFloors) {
    const edges = floorFacadeFaces(floor);
    edges.forEach(face => currentIds.add(face.id));
    const openArea = floor.zones.filter(z => z.useType === "parking" || z.useType === "piloti").reduce((n, z) => n + z.areaSqm, 0);
    const enclosedArea = floor.zones.filter(z => z.useType !== "parking" && z.useType !== "piloti").reduce((n, z) => n + z.areaSqm, 0);
    if (enclosedArea <= 0) { excludedAreaSqm += edges.reduce((n, f) => n + f.grossAreaSqm, 0); continue; }
    const unresolved = openArea > 0 || floor.selfIntersects || floor.areaStatus !== "pass";
    if (unresolved) notes.push(`${floor.label}: 개방 구역 혼합 또는 형상 불일치로 외벽 경계 미확정.`);
    if (!edges.length) { invalid = true; notes.push(`${floor.label}: 외벽 외곽선 없음.`); }
    for (const raw of edges) {
      const selected = materials.faceAssignments?.[raw.id];
      const exposure = unresolved ? "unknown" : selected?.exposure ?? "assumed-exposed";
      const suppliedOpening = selected?.openingAreaSqm;
      const invalidOpening = suppliedOpening != null && (!Number.isFinite(suppliedOpening) || suppliedOpening < 0 || suppliedOpening > raw.grossAreaSqm);
      if (invalidOpening) notes.push(`${raw.label}: 개구부 면적이 벽 면적 범위를 벗어남.`);
      const openingAreaSqm = suppliedOpening != null && !invalidOpening ? suppliedOpening : raw.grossAreaSqm * materials.windowRatioPct / 100;
      const face: FacadeFace = { ...raw, exposure: invalidOpening ? "unknown" as const : exposure,
        material: selected?.material, openingAreaSqm, netAreaSqm: Math.max(0, raw.grossAreaSqm - openingAreaSqm) };
      if (face.exposure === "unknown") unresolvedAreaSqm += raw.grossAreaSqm;
      if (face.exposure === "shared") excludedAreaSqm += raw.grossAreaSqm;
      faces.push(face);
    }
  }
  const staleAssignmentIds = Object.keys(materials.faceAssignments ?? {}).filter(id => !currentIds.has(id));
  if (staleAssignmentIds.length) notes.push("형상 변경 전 면별 설정이 남아 있습니다. 이전 설정을 해제하고 다시 지정하세요. 자동 재료비 반영 보류.");
  const counted = faces.filter(f => f.exposure === "exposed" || f.exposure === "assumed-exposed");
  const grossFacadeAreaSqm = counted.reduce((n, f) => n + f.grossAreaSqm, 0);
  const openingAreaSqm = counted.reduce((n, f) => n + f.openingAreaSqm, 0);
  return { version: FACADE_QUANTITY_VERSION, quantityKey: facadeFingerprint({ version: FACADE_QUANTITY_VERSION, geometryHash: geometry.geometryHash,
    faces: faces.map(({ material: _material, ...face }) => { void _material; return face; }).sort((a, b) => a.id.localeCompare(b.id)), unresolvedAreaSqm, excludedAreaSqm, invalid, staleAssignmentIds }),
    geometryHash: geometry.geometryHash, basis: "geometry-derived", status: invalid ? "unavailable" : unresolvedAreaSqm > 0 || staleAssignmentIds.length > 0 ? "partial" : "complete",
    faces, grossFacadeAreaSqm, openingAreaSqm, netFacadeAreaSqm: grossFacadeAreaSqm - openingAreaSqm, unresolvedAreaSqm, excludedAreaSqm, staleAssignmentIds, notes };
}
