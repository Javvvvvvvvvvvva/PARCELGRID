import type { SunlightGeometryProfile } from "@/lib/regulatory/sunlight-rules";
import type { Wgs84ParcelPolygon } from "@/lib/geo/parcel-topology";
import { buildParcelEnvelope, localParcelArea, unprojectParcelPolygons } from "@/lib/geo/parcel-envelope";

export type LngLat = [number, number];

export interface SunStep {
  floor: number;
  heightM: number;
  requiredSetbackM: number;
  floorPlateSqm: number;
  /** Compatibility ring exists only for a single component without holes. */
  ringLngLat: LngLat[] | null;
  polygons: Wgs84ParcelPolygon[];
}

export interface BuildableArea {
  /** Available means computed geometry, not legal approval. */
  geometryStatus: "available" | "unavailable";
  lotAreaSqm: number;
  afterSideSetbackSqm: number;
  buildable2DSqm: number;
  buildable2DRing: LngLat[] | null;
  /** [] is a valid empty result; undefined means unavailable. Never fall back to the parcel. */
  buildable2DPolygons?: Wgs84ParcelPolygon[];
  requiredSetbackMaxHeight: number;
  stepped3D: SunStep[];
  northEdgeCount: number;
  warnings: string[];
}

export interface BuildableAreaOptions {
  reportSunApplicability?: boolean;
  sunlightProfile?: SunlightGeometryProfile;
  floorHeightsM?: number[];
  floorLevels?: number[];
  roofAllowanceM?: number;
  /** Authoritative when defined, including invalid or empty input. */
  polygons?: Wgs84ParcelPolygon[];
  /** Component, ring (outer then holes), open-ring edge index. */
  edgeSetbacksByPolygon?: number[][][];
}

function profileSunSetbackM(heightM: number, profile: SunlightGeometryProfile | undefined, applies: boolean): number {
  if (!applies) return 0;
  const statutory = heightM <= (profile?.thresholdHeightM ?? 10)
    ? (profile?.lowHeightSetbackM ?? 1.5) : heightM * (profile?.highHeightRatio ?? 0.5);
  return Math.max(0, statutory - (profile?.boundaryOffsetM ?? 0));
}

function simpleRing(polygons: Wgs84ParcelPolygon[]): LngLat[] | null {
  return polygons.length === 1 && polygons[0].holes.length === 0 ? polygons[0].outer : null;
}

/** Planar preliminary envelope. Source boundaries, rules and permissions remain separately verified. */
export function calcBuildableArea(
  boundary: LngLat[] | undefined,
  sideSetbackM: number,
  floors: number,
  floorHeightM: number,
  sunApplies: boolean,
  edgeSetbacksM?: number[],
  options: BuildableAreaOptions = {}
): BuildableArea {
  const warnings: string[] = [];
  const deadline = performance.now() + 2_000;
  const check = () => {
    if (performance.now() >= deadline) throw new DOMException("건축 가능 영역 계산 시간 초과", "TimeoutError");
  };
  let requiredSetbackMaxHeight = 0;
  try {
    if (!Number.isInteger(floors) || floors < 0 || floors > 200 || !Number.isFinite(floorHeightM) || floorHeightM <= 0 || floorHeightM > 100) {
      throw new Error("층수 또는 층고가 계산 범위를 벗어났습니다.");
    }
    const floorHeightsM = options.floorHeightsM ?? [];
    if (!Array.isArray(floorHeightsM) || floorHeightsM.length > 200 || floorHeightsM.some(height => !Number.isFinite(height) || height <= 0 || height > 100)) {
      throw new Error("실제 층고 입력이 올바르지 않습니다.");
    }
    const effectiveFloors = floorHeightsM.length || floors;
    if (options.floorLevels && (options.floorLevels.length !== effectiveFloors || new Set(options.floorLevels).size !== effectiveFloors
      || options.floorLevels.some(level => !Number.isInteger(level) || level < 1 || level > 200))) throw new Error("층 레벨이 층고와 일치하지 않습니다.");
    const roofAllowanceM = options.roofAllowanceM ?? 1.4;
    if (!Number.isFinite(roofAllowanceM) || roofAllowanceM < 0 || roofAllowanceM > 100) throw new Error("옥상 높이 입력이 올바르지 않습니다.");
    const profile = options.sunlightProfile;
    if (profile && [profile.thresholdHeightM, profile.lowHeightSetbackM, profile.highHeightRatio, profile.boundaryOffsetM]
      .some(value => !Number.isFinite(value) || value < 0)) throw new Error("일조 규칙 입력이 올바르지 않습니다.");
    const sunlightApplies = profile ? profile.applies : sunApplies;
    const maxHeightM = (floorHeightsM.length ? floorHeightsM.reduce((sum, height) => sum + height, 0) : floors * floorHeightM) + roofAllowanceM;
    requiredSetbackMaxHeight = profileSunSetbackM(maxHeightM, profile, sunlightApplies);
    if (profile?.applies && profile.applicability === "review") warnings.push("정북일조 적용·예외 조건 일부가 미확인이라 기본 이격을 보수적으로 형상에 반영했습니다.");
    const polygons = options.polygons === undefined ? (boundary?.length ? [{ outer: boundary, holes: [] }] : []) : options.polygons;
    if (edgeSetbacksM?.length && (polygons.length !== 1 || polygons[0].holes.length)) throw new Error("복합 경계에는 조각·링별 이격 정보가 필요합니다.");
    const envelope = buildParcelEnvelope({ polygons, sideSetbackM,
      edgeSetbacksByPolygon: options.edgeSetbacksByPolygon ?? (edgeSetbacksM?.length ? [[edgeSetbacksM]] : undefined), check });
    const localBuildable = envelope.atNorthSetback(requiredSetbackMaxHeight);
    const buildable2DPolygons = unprojectParcelPolygons(localBuildable, envelope.origin);
    if (!envelope.afterSide.length) warnings.push("측후면 이격 후 건축 가능 영역이 없습니다.");
    else if (!localBuildable.length) warnings.push("최고높이의 정북일조 이격 후 건축 가능 영역이 없습니다. 층별 결과는 별도로 확인하세요.");
    if (!sunlightApplies && options.reportSunApplicability !== false) warnings.push("정북일조 미적용 조건으로 측후면 이격만 반영했습니다. 적용 근거는 별도 확인이 필요합니다.");
    const stepped3D: SunStep[] = [];
    let cumulativeHeightM = 0;
    const usesActualHeightContract = floorHeightsM.length > 0 || profile != null;
    for (let index = 0; index < effectiveFloors; index++) {
      check();
      cumulativeHeightM += floorHeightsM[index] ?? floorHeightM;
      const heightM = usesActualHeightContract ? cumulativeHeightM + (index === effectiveFloors - 1 ? roofAllowanceM : 0) : cumulativeHeightM + roofAllowanceM;
      const setback = profileSunSetbackM(heightM, profile, sunlightApplies);
      const local = envelope.atNorthSetback(setback);
      const stepPolygons = unprojectParcelPolygons(local, envelope.origin);
      stepped3D.push({ floor: options.floorLevels?.[index] ?? index + 1, heightM, requiredSetbackM: setback,
        floorPlateSqm: localParcelArea(local), ringLngLat: simpleRing(stepPolygons), polygons: stepPolygons });
    }
    check();
    return { geometryStatus: "available", lotAreaSqm: localParcelArea(envelope.source), afterSideSetbackSqm: localParcelArea(envelope.afterSide),
      buildable2DSqm: localParcelArea(localBuildable), buildable2DRing: simpleRing(buildable2DPolygons), buildable2DPolygons,
      requiredSetbackMaxHeight, stepped3D, northEdgeCount: envelope.northEdgeCount, warnings };
  } catch (error) {
    warnings.push(error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
      ? "계산 시간 초과 또는 취소로 건축 가능 영역을 확인하지 못했습니다."
      : "경계·층고·이격 입력을 확인하지 못해 건축 가능 영역을 계산하지 않았습니다.");
    return { geometryStatus: "unavailable", lotAreaSqm: 0, afterSideSetbackSqm: 0, buildable2DSqm: 0,
      buildable2DRing: null, requiredSetbackMaxHeight: Number.isFinite(requiredSetbackMaxHeight) ? requiredSetbackMaxHeight : 0,
      stepped3D: [], northEdgeCount: 0, warnings };
  }
}
