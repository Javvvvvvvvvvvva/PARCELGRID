import { getPosition } from "suncalc";
import { booleanPointInPolygon, point, polygon } from "@turf/turf";
import { DoubleSide, ExtrudeGeometry, Ray, Shape, Vector2, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { PlanningGeometrySnapshot } from "./planning-geometry";

export interface SolarAccessInput {
  planning: PlanningGeometrySnapshot;
  date: string;
  startHour: number;
  endHour: number;
  stepMinutes: number;
}
export interface SolarAccessResult {
  geometryHash: string;
  date: string;
  coverage: "proposed-mass-only";
  timezone: "Asia/Seoul";
  points: Array<{ x: number; z: number; sunnyMinutes: number }>;
  sampledMinutes: number;
}

/** SunCalc v2 uses DEGREES clockwise from north. Planning axes: east +X, north -Z. */
export function solarDirection(azimuthDeg: number, altitudeDeg: number): Vector3 {
  const a = azimuthDeg * Math.PI / 180, h = altitudeDeg * Math.PI / 180;
  return new Vector3(Math.sin(a) * Math.cos(h), Math.sin(h), -Math.cos(a) * Math.cos(h)).normalize();
}

export function calculateSolarAccess(input: SolarAccessInput): SolarAccessResult {
  const { planning, date, startHour, endHour, stepMinutes } = input;
  const midnight = new Date(`${date}T00:00:00+09:00`);
  const [lng, lat] = planning.coordinateSystem.originLngLat;
  const ring = planning.parcel.polygon;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(midnight.getTime()) || new Date(midnight.getTime() + 9 * 3600000).toISOString().slice(0, 10) !== date || ![startHour, endHour, stepMinutes, lat, lng].every(Number.isFinite) || startHour < 0 || endHour > 24 || startHour >= endHour || stepMinutes < 15 || stepMinutes > 60 || Math.abs(lat) > 90 || Math.abs(lng) > 180 || ring.length < 3 || ring.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.z)) || planning.building.floors.length > 100) throw new Error("일영 분석의 날짜·시간·부지 정보를 확인하세요.");
  const shape = polygon([[...ring.map(p => [p.x, p.z]), [ring[0].x, ring[0].z]]]);
  const minX = Math.min(...ring.map(p => p.x)), maxX = Math.max(...ring.map(p => p.x));
  const minZ = Math.min(...ring.map(p => p.z)), maxZ = Math.max(...ring.map(p => p.z));
  const samples: SolarAccessResult["points"] = [];
  for (let row = 0; row < 12; row++) for (let col = 0; col < 12; col++) {
    const x = minX + (col + 0.5) * (maxX - minX) / 12, z = minZ + (row + 0.5) * (maxZ - minZ) / 12;
    if (!booleanPointInPolygon(point([x, z]), shape)) continue;
    // Evaluate exposed ground; points underneath a proposed floor are not outdoor daylight samples.
    if (planning.building.aboveGroundFloors.some(f => f.shape.length >= 3 && booleanPointInPolygon(point([x, z]), polygon([[...f.shape.map(p => [p.x, p.z]), [f.shape[0].x, f.shape[0].z]]])))) continue;
    samples.push({ x, z, sunnyMinutes: 0 });
  }
  const meshes: Array<{ geometry: ExtrudeGeometry; bvh: MeshBVH }> = [];
  try {
    for (const floor of planning.building.aboveGroundFloors) {
      if (floor.shape.length < 3 || floor.topHeightM <= floor.baseHeightM) continue;
      const s = new Shape(floor.shape.map(p => new Vector2(p.x, -p.z)));
      const geometry = new ExtrudeGeometry(s, { depth: floor.topHeightM - floor.baseHeightM, bevelEnabled: false });
      geometry.rotateX(-Math.PI / 2); geometry.translate(0, floor.baseHeightM, 0);
      meshes.push({ geometry, bvh: new MeshBVH(geometry) });
    }
    for (let minute = startHour * 60; minute < endHour * 60; minute += stepMinutes) {
      const duration = Math.min(stepMinutes, endHour * 60 - minute);
      const instant = new Date(midnight.getTime() + (minute + duration / 2) * 60000);
      const position = getPosition(instant, lat, lng);
      if (position.altitude <= 0) continue;
      const direction = solarDirection(position.azimuth, position.altitude);
      for (const sample of samples) {
        const ray = new Ray(new Vector3(sample.x, 0.02, sample.z), direction);
        if (!meshes.some(mesh => mesh.bvh.raycastFirst(ray, DoubleSide))) sample.sunnyMinutes += duration;
      }
    }
  } finally { for (const mesh of meshes) mesh.geometry.dispose(); }
  return { geometryHash: planning.geometryHash, date, coverage: "proposed-mass-only", timezone: "Asia/Seoul", points: samples, sampledMinutes: (endHour - startHour) * 60 };
}
