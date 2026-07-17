export type LngLat = [number, number];
export type BuildingRing = LngLat[];
export type BuildingPolygon = BuildingRing[];

export type BuildingGeometryStatus = "matched" | "not_found" | "error";
export type BuildingGeometryMatchMethod = "pnu" | "geometry";
export type BuildingParcelOverlapStatus = "verified" | "review";
export type ViolationStatus = "yes" | "no" | "unknown";

export interface ExistingBuildingFootprint {
  id: string;
  pnu: string;
  buildingName: string;
  polygons: BuildingPolygon[];
  footprintAreaSqm: number;
  totalAreaSqm: number;
  heightM: number;
  groundFloors: number;
  undergroundFloors: number;
  useApprovalDate: string;
  purposeCode: string;
  structureCode: string;
  violationStatus: ViolationStatus;
  violationRaw: string;
  matchMethod: BuildingGeometryMatchMethod;
  source: "vworld-dt_d010";
  /** 건물 외곽 면적 중 대상 필지 내부와 겹치는 비율 (0~1). */
  parcelOverlapRatio?: number;
  /** 85% 이상 verified, 60~85% review. 60% 미만 형상은 결과에서 제외한다. */
  parcelOverlapStatus?: BuildingParcelOverlapStatus;
}

export interface ExistingBuildingGeometry {
  source: "vworld-dt_d010";
  status: BuildingGeometryStatus;
  /** 대상 필지의 현재 건물 형상. */
  footprints: ExistingBuildingFootprint[];
  /** 대상 필지를 둘러싼 인접 건물 형상. 현황 3D에서만 반투명 컨텍스트로 사용한다. */
  contextFootprints?: ExistingBuildingFootprint[];
  /** 주변 건물을 수집한 필지 경계 기준 거리. */
  contextRadiusM?: number;
  queryFeatureCount: number;
  /** 필지 겹침 60% 미만으로 자동 제외한 대상 후보 수. */
  rejectedFootprintCount?: number;
  /** 필지 겹침 60~85%로 추가 확인이 필요한 채택 형상 수. */
  reviewFootprintCount?: number;
}

export interface BuildingLookupWithGeometry {
  geometry?: ExistingBuildingGeometry;
}

export function getExistingBuildingGeometry(
  value: unknown
): ExistingBuildingGeometry | null {
  if (!value || typeof value !== "object") return null;
  const geometry = (value as BuildingLookupWithGeometry).geometry;
  if (!geometry || geometry.source !== "vworld-dt_d010") return null;
  return geometry;
}

export function hasMatchedBuildingGeometry(value: unknown): boolean {
  const geometry = getExistingBuildingGeometry(value);
  return Boolean(geometry?.status === "matched" && geometry.footprints.length > 0);
}
