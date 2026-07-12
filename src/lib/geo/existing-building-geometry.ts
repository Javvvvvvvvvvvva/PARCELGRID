export type LngLat = [number, number];
export type BuildingRing = LngLat[];
export type BuildingPolygon = BuildingRing[];

export type BuildingGeometryStatus = "matched" | "not_found" | "error";
export type BuildingGeometryMatchMethod = "pnu" | "geometry";
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
}

export interface ExistingBuildingGeometry {
  source: "vworld-dt_d010";
  status: BuildingGeometryStatus;
  footprints: ExistingBuildingFootprint[];
  queryFeatureCount: number;
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
