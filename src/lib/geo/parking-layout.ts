/**
 * 주차 배치 엔진 v1 — 전면도로 직접 진입 직각주차 (C 확정 스펙).
 *
 * 스펙 (건축사 확정):
 *  - 직각주차 2.5×5.0m (주차장법 시행규칙 §3 — 일반형)
 *  - 전면 변 직접 진입 (소형 필지 3~5대 표준, 내부 차로 불필요 규모)
 *  - v1 제약: 전면 변에만 배치 + 구획 겹침 금지
 *  - v2 예정: 교차로 모서리 제한, 보도 통과, 내부 차로(8대+)
 *
 * 좌표는 미터 (road-frontage와 동일 투영 기준).
 * 이 결과가 ③ 필로티 자동 판단의 입력 — 1층 건축영역과 주차 구획이
 * 겹치면 필로티 ON (설계 결과, 기본값 아님 — C 원칙).
 */

export interface ParkingSpot {
  index: number;
  /** 구획 4코너 (미터) — 전면 변 시작 기준 시계/반시계 */
  cornersM: [number, number][];
  /** 구획 4코너 (위경도) — 3D 렌더용. layoutParkingFromBoundary에서만 채워짐 */
  cornersLngLat?: [number, number][];
}

export interface ParkingLayout {
  spots: ParkingSpot[];
  placed: number;
  required: number;
  shortfall: number;
  /** 전면 변에서 사용한 길이 (m) */
  frontEdgeUsedM: number;
  basis: string;
}

const STALL_W = 2.5;
const STALL_D = 5.0;
const EDGE_MARGIN = 0.3;
/** 경계선 위 점의 in/out 애매함 방지용 내부 검사 오프셋 */
const TEST_INSET = 0.05;

function pointInPoly(p: [number, number], poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (
      yi > p[1] !== yj > p[1] &&
      p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * @param boundaryM 대지 경계 (미터, 열린 링)
 * @param frontA 전면 변 시작점 (미터)
 * @param frontB 전면 변 끝점 (미터)
 * @param required 법정 필요 대수 (PRK-04 결과)
 */
export function layoutParking(
  boundaryM: [number, number][],
  frontA: [number, number],
  frontB: [number, number],
  required: number
): ParkingLayout {
  const empty: ParkingLayout = {
    spots: [],
    placed: 0,
    required,
    shortfall: required,
    frontEdgeUsedM: 0,
    basis: `직각주차 ${STALL_W}×${STALL_D}m 전면 직접 진입 — 주차장법 시행규칙 일반형`,
  };
  if (!boundaryM || boundaryM.length < 3 || required <= 0) {
    return { ...empty, shortfall: Math.max(0, required) };
  }

  const dx = frontB[0] - frontA[0];
  const dy = frontB[1] - frontA[1];
  const len = Math.hypot(dx, dy);
  if (len < STALL_W + 2 * EDGE_MARGIN) return empty;

  const u: [number, number] = [dx / len, dy / len];
  let n: [number, number] = [-u[1], u[0]];
  let cx = 0;
  let cy = 0;
  for (const [x, y] of boundaryM) {
    cx += x;
    cy += y;
  }
  cx /= boundaryM.length;
  cy /= boundaryM.length;
  if ((cx - frontA[0]) * n[0] + (cy - frontA[1]) * n[1] < 0) {
    n = [-n[0], -n[1]];
  }

  const spots: ParkingSpot[] = [];
  const maxSlots = Math.floor((len - 2 * EDGE_MARGIN) / STALL_W);
  for (let s = 0; s < maxSlots && spots.length < required; s++) {
    const t = EDGE_MARGIN + s * STALL_W;
    const base: [number, number] = [frontA[0] + u[0] * t, frontA[1] + u[1] * t];
    const testCorners: [number, number][] = [
      [base[0] + n[0] * TEST_INSET, base[1] + n[1] * TEST_INSET],
      [
        base[0] + u[0] * STALL_W + n[0] * TEST_INSET,
        base[1] + u[1] * STALL_W + n[1] * TEST_INSET,
      ],
      [
        base[0] + u[0] * STALL_W + n[0] * STALL_D,
        base[1] + u[1] * STALL_W + n[1] * STALL_D,
      ],
      [base[0] + n[0] * STALL_D, base[1] + n[1] * STALL_D],
    ];
    if (testCorners.every((c) => pointInPoly(c, boundaryM))) {
      spots.push({
        index: spots.length,
        cornersM: [
          [base[0], base[1]],
          [base[0] + u[0] * STALL_W, base[1] + u[1] * STALL_W],
          [
            base[0] + u[0] * STALL_W + n[0] * STALL_D,
            base[1] + u[1] * STALL_W + n[1] * STALL_D,
          ],
          [base[0] + n[0] * STALL_D, base[1] + n[1] * STALL_D],
        ],
      });
    }
  }

  return {
    ...empty,
    spots,
    placed: spots.length,
    shortfall: Math.max(0, required - spots.length),
    frontEdgeUsedM:
      spots.length > 0 ? EDGE_MARGIN + spots.length * STALL_W : 0,
  };
}


/** equirectangular 투영 (road-frontage와 동일 방식 — 경계 중심 기준) */
function projectToMeters(boundary: [number, number][]): [number, number][] {
  let lngSum = 0;
  let latSum = 0;
  for (const [lng, lat] of boundary) {
    lngSum += lng;
    latSum += lat;
  }
  const clng = lngSum / boundary.length;
  const clat = latSum / boundary.length;
  const LNG = 111320 * Math.cos((clat * Math.PI) / 180);
  const LAT = 110540;
  return boundary.map(([lng, lat]) => [(lng - clng) * LNG, (lat - clat) * LAT]);
}

/**
 * 위경도 경계 + frontage.frontIndex → 배치 (verdict 연결용).
 * frontIndex는 닫힌 링 기준 i번째 변 (analyzeFrontage와 동일 규약).
 */
export function layoutParkingFromBoundary(
  boundary: [number, number][],
  frontEdgeIndex: number,
  required: number
): ParkingLayout | null {
  if (!boundary || boundary.length < 4) return null;
  const isClosed =
    boundary[0][0] === boundary[boundary.length - 1][0] &&
    boundary[0][1] === boundary[boundary.length - 1][1];
  const open = isClosed ? boundary.slice(0, -1) : boundary;
  if (frontEdgeIndex < 0 || frontEdgeIndex >= open.length) return null;
  const openM = projectToMeters(open);
  const a = openM[frontEdgeIndex];
  const b = openM[(frontEdgeIndex + 1) % openM.length];
  const layout = layoutParking(openM, a, b, required);

  // 역투영 (미터 → 위경도) — 3D 렌더가 자기 좌표계로 재투영할 수 있게
  let lngSum = 0;
  let latSum = 0;
  for (const [lng, lat] of open) {
    lngSum += lng;
    latSum += lat;
  }
  const clng = lngSum / open.length;
  const clat = latSum / open.length;
  const LNG = 111320 * Math.cos((clat * Math.PI) / 180);
  const LAT = 110540;
  for (const spot of layout.spots) {
    spot.cornersLngLat = spot.cornersM.map(
      ([x, y]) => [clng + x / LNG, clat + y / LAT] as [number, number]
    );
  }
  return layout;
}


/* ─────────────── 필로티 자동 판정 (C 설계: 동선 기반) ─────────────── */

export interface PilotiVerdict {
  /** 필로티 추천 여부 — 주차 동선이 1층 건축영역 관통 시 true */
  recommended: boolean;
  /** 주차 구획 ∩ 1층 건축영역 겹침 면적 (㎡) */
  overlapSqm: number;
  /** 침범하는 구획 수 */
  spotsIntruding: number;
  reason: string;
}

function clipHalfPlaneAt(
  subject: [number, number][],
  a: [number, number],
  b: [number, number],
  interiorRef: [number, number]
): [number, number][] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return subject;
  let nx = -dy / len;
  let ny = dx / len;
  if ((interiorRef[0] - a[0]) * nx + (interiorRef[1] - a[1]) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  const inside = (p: [number, number]) =>
    (p[0] - a[0]) * nx + (p[1] - a[1]) * ny >= -1e-9;
  const out: [number, number][] = [];
  for (let i = 0; i < subject.length; i++) {
    const cur = subject[i];
    const prev = subject[(i - 1 + subject.length) % subject.length];
    const ci = inside(cur);
    const pi = inside(prev);
    if (pi !== ci) {
      const denom = (cur[0] - prev[0]) * nx + (cur[1] - prev[1]) * ny;
      const t = ((a[0] - prev[0]) * nx + (a[1] - prev[1]) * ny) / denom;
      out.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]);
    }
    if (ci) out.push(cur);
  }
  return out;
}

function polyAreaM(r: [number, number][]): number {
  if (r.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i];
    const [x2, y2] = r[(i + 1) % r.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

/**
 * 주차 구획과 1층 건축영역의 겹침 → 필로티 추천 판정.
 *
 * C(건축사) 확정 규칙: 필로티는 "남는 면적"이 아니라 "차량 동선"으로 결정.
 * 전면 직접 진입에서는 차로 = 전면 도로이므로, 구획 자체가 1층 건축영역을
 * 침범하면 차량 동선이 건물 하부를 관통 → 필로티 추천.
 * 마당 주차(겹침 0)는 1층 주거 유지 — 1㎡ 겹침에 필로티 판정하는 과보수 방지.
 * [v1 한계] 1층 영역이 심한 오목이면 겹침 과대 가능 (SH clip 볼록 가정).
 * [v2] 문 여는 여유·기둥 간섭·회전 반경 — 설계 영역이라 제외 (C).
 */
export function assessPilotiOverlap(
  boundary: [number, number][],
  layout: ParkingLayout,
  groundRingLngLat: [number, number][]
): PilotiVerdict {
  const none: PilotiVerdict = {
    recommended: false,
    overlapSqm: 0,
    spotsIntruding: 0,
    reason: "주차 배치 없음",
  };
  if (!layout || layout.spots.length === 0) return none;
  if (!groundRingLngLat || groundRingLngLat.length < 3) return none;

  // 경계 중심 기준 투영 (layoutParkingFromBoundary와 동일 규약)
  const isClosedB =
    boundary[0][0] === boundary[boundary.length - 1][0] &&
    boundary[0][1] === boundary[boundary.length - 1][1];
  const openB = isClosedB ? boundary.slice(0, -1) : boundary;
  let lngSum = 0;
  let latSum = 0;
  for (const [lng, lat] of openB) {
    lngSum += lng;
    latSum += lat;
  }
  const clng = lngSum / openB.length;
  const clat = latSum / openB.length;
  const LNG = 111320 * Math.cos((clat * Math.PI) / 180);
  const LAT = 110540;
  const pj = (p: [number, number]): [number, number] => [
    (p[0] - clng) * LNG,
    (p[1] - clat) * LAT,
  ];

  const isClosedG =
    groundRingLngLat[0][0] === groundRingLngLat[groundRingLngLat.length - 1][0] &&
    groundRingLngLat[0][1] === groundRingLngLat[groundRingLngLat.length - 1][1];
  const ground = (isClosedG ? groundRingLngLat.slice(0, -1) : groundRingLngLat).map(pj);
  if (ground.length < 3) return none;

  let gx = 0;
  let gy = 0;
  for (const [x, y] of ground) {
    gx += x;
    gy += y;
  }
  gx /= ground.length;
  gy /= ground.length;

  let overlapSqm = 0;
  let spotsIntruding = 0;
  for (const spot of layout.spots) {
    let clipped: [number, number][] = spot.cornersM;
    for (let i = 0; i < ground.length && clipped.length >= 3; i++) {
      clipped = clipHalfPlaneAt(clipped, ground[i], ground[(i + 1) % ground.length], [gx, gy]);
    }
    const a = polyAreaM(clipped);
    if (a > 0.1) {
      overlapSqm += a;
      spotsIntruding++;
    }
  }

  const recommended = overlapSqm > 1;
  return {
    recommended,
    overlapSqm: Number(overlapSqm.toFixed(1)),
    spotsIntruding,
    reason: recommended
      ? `주차 ${spotsIntruding}/${layout.placed}대의 동선이 1층 건축영역 관통 (겹침 ${overlapSqm.toFixed(1)}㎡) → 필로티 추천`
      : `주차 동선이 1층 건축영역 밖 (겹침 ${overlapSqm.toFixed(1)}㎡) → 1층 주거 유지 가능`,
  };
}
