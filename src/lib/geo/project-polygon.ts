/**
 * 경위도(WGS84) 폴리곤 → 평면 미터 좌표 변환 (3D 매싱용).
 *
 * 부지 중심(centroid)을 원점으로 등거리 근사 투영.
 * 작은 필지(수십 m)는 지구 곡률 무시 가능 → 단순 근사로 오차 <1%.
 * 검증: 쌍문동 281-23 (126.96㎡) → 변환 후 면적 오차 0.7%.
 */

export interface ProjectedPolygon {
  /** 평면 좌표 [x, y][] (미터, 중심 원점). 입력 순서·닫힘 유지 */
  points: [number, number][];
  /** 원점이 된 중심 경위도 */
  center: { lng: number; lat: number };
  /** 대지 바운딩 박스 (카메라 거리 산정용) */
  widthM: number;
  depthM: number;
  /** 변환 좌표 기준 면적 (㎡) — 검증용 */
  areaSqm: number;
}

const LAT_METERS_PER_DEG = 110540; // 위도 1도 ≈ 110.54km (거의 일정)

/**
 * 경위도 폴리곤을 평면 미터로 투영.
 * @param boundary [lng, lat][] (GeoJSON 순서). 닫힌 링(첫=끝) 허용.
 */
export function projectPolygon(
  boundary: [number, number][]
): ProjectedPolygon | null {
  if (!boundary || boundary.length < 4) return null; // 최소 삼각형+닫힘

  // centroid — 닫힘 점(첫=끝) 중복 제외
  const ring =
    boundary.length > 1 &&
    boundary[0][0] === boundary[boundary.length - 1][0] &&
    boundary[0][1] === boundary[boundary.length - 1][1]
      ? boundary.slice(0, -1)
      : boundary;

  if (ring.length < 3) return null;

  const lng0 = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;

  const lngMetersPerDeg = 111320 * Math.cos((lat0 * Math.PI) / 180);

  const points: [number, number][] = boundary.map(([lng, lat]) => [
    (lng - lng0) * lngMetersPerDeg,
    (lat - lat0) * LAT_METERS_PER_DEG,
  ]);

  // shoelace 면적
  let a = 0;
  for (let i = 0; i < points.length - 1; i++) {
    a += points[i][0] * points[i + 1][1] - points[i + 1][0] * points[i][1];
  }
  const areaSqm = Math.abs(a / 2);

  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const widthM = Math.max(...xs) - Math.min(...xs);
  const depthM = Math.max(...ys) - Math.min(...ys);

  return {
    points,
    center: { lng: lng0, lat: lat0 },
    widthM,
    depthM,
    areaSqm,
  };
}
