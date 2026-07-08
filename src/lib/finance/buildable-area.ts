/**
 * Buildable Area Engine (#2) — 대지에서 실제 건축 가능 영역 도출 (Geometry).
 *
 * 8단계 아키텍처의 핵심 토대. 주차 배치·3D 매싱·정북일조 정밀화가 이걸 사용.
 *
 * 계산:
 *  대지 Polygon − 측후면 이격 − 정북일조 이격 = 건축가능영역
 *  · 측후면: turf.buffer(음수)로 균일 축소
 *  · 정북일조: 진북 방향 반평면 clip (C 법규 확정 — 방향성)
 *
 * 데이터 분리 (C 확정):
 *  · buildable2D — 최고높이 1개 이격 (보수적, 면적 판정용)
 *  · stepped3D — 층별 계단식 이격 (3D 매싱용)
 */

import * as turf from "@turf/turf";
import type { Feature, Polygon } from "geojson";

export type LngLat = [number, number];

export interface SunStep {
  floor: number;
  heightM: number;
  requiredSetbackM: number;
  /** 층별 건축가능 면적 (㎡) — 계단식 후퇴 반영 */
  floorPlateSqm: number;
  /** 층별 건축가능 형상 [lng,lat][] — 정북 후퇴 반영, 3D 매싱용 (없으면 null) */
  ringLngLat: LngLat[] | null;
}

export interface BuildableArea {
  lotAreaSqm: number;
  afterSideSetbackSqm: number;
  /** 최종 건축가능 면적 (㎡) — 정북일조 최고높이 기준 (2D 보수적) */
  buildable2DSqm: number;
  /** 건축가능 영역 폴리곤 (2D) — [lng,lat] ring */
  buildable2DRing: LngLat[] | null;
  requiredSetbackMaxHeight: number;
  stepped3D: SunStep[];
  northEdgeCount: number;
  warnings: string[];
}

function sunSetbackM(heightM: number): number {
  return heightM <= 10 ? 1.5 : heightM / 2;
}

/** 위경도 → 로컬 미터 (원점 기준) */
function toMeters(ring: LngLat[], origin: LngLat): LngLat[] {
  const [olng, olat] = origin;
  const k = Math.cos((olat * Math.PI) / 180);
  return ring.map(([lng, lat]) => [
    (lng - olng) * 111_000 * k,
    (lat - olat) * 111_000,
  ]);
}

/** 로컬 미터 → 위경도 */
function toLngLat(ringM: LngLat[], origin: LngLat): LngLat[] {
  const [olng, olat] = origin;
  const k = Math.cos((olat * Math.PI) / 180);
  return ringM.map(([x, y]) => [olng + x / (111_000 * k), olat + y / 111_000]);
}

/** Shoelace 면적 (미터 좌표) */
function areaM(ring: LngLat[]): number {
  let a = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
  }
  return Math.abs(a) / 2;
}

/**
 * 북측 경계 후보 개수 — 진북(+y) 성분 가진 segment (C 법규 확정).
 * "위도 최대 변 1개"가 아니라 북측 성분 가진 모든 경계.
 */
function countNorthEdges(ringM: LngLat[]): number {
  const n = ringM.length;
  if (n < 3) return 0;
  const cx = ringM.reduce((s, p) => s + p[0], 0) / n;
  const cy = ringM.reduce((s, p) => s + p[1], 0) / n;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const a = ringM[i];
    const b = ringM[(i + 1) % n];
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    let nx = -dy;
    let ny = dx;
    if (nx * (cx - mx) + ny * (cy - my) > 0) {
      nx = -nx;
      ny = -ny;
    }
    const len = Math.hypot(nx, ny) || 1;
    if (ny / len > 0.001) count++;
  }
  return count;
}

/**
 * 정북일조 반평면 clip — 북단에서 이격거리만큼 남쪽 한계선 아래만 남김.
 * 진북 = +y. 한계선 y = maxY − setback. Sutherland-Hodgman.
 * 어떤 형상(직사각·L자·마름모)이든 정확.
 */
/**
 * 임의 변의 내부 half-plane 클립 — 변 (a→b)에서 내부로 setbackM만큼 후퇴.
 * 변별 차등 이격용 (전면/측면/후면). 내부 방향은 링 중심으로 자동 판별 (CW/CCW 무관).
 * Sutherland–Hodgman — 볼록·오목 모두 동작하나 오목 극단에서 다중 폴리곤은 미지원(소형 필지 충분).
 */
function clipEdgeSetback(
  ringM: LngLat[],
  a: LngLat,
  b: LngLat,
  setbackM: number
): LngLat[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0 || setbackM <= 0) return ringM;
  let nx = -dy / len;
  let ny = dx / len;
  let cx = 0;
  let cy = 0;
  for (const [x, y] of ringM) {
    cx += x;
    cy += y;
  }
  cx /= ringM.length;
  cy /= ringM.length;
  if ((cx - a[0]) * nx + (cy - a[1]) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  const ox = a[0] + nx * setbackM;
  const oy = a[1] + ny * setbackM;
  const inside = (p: LngLat) => (p[0] - ox) * nx + (p[1] - oy) * ny >= -1e-9;
  const out: LngLat[] = [];
  for (let i = 0; i < ringM.length; i++) {
    const cur = ringM[i];
    const prev = ringM[(i - 1 + ringM.length) % ringM.length];
    const cin = inside(cur);
    const pin = inside(prev);
    if (pin !== cin) {
      const denom = (cur[0] - prev[0]) * nx + (cur[1] - prev[1]) * ny;
      const t = ((ox - prev[0]) * nx + (oy - prev[1]) * ny) / denom;
      out.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]);
    }
    if (cin) out.push(cur);
  }
  return out;
}

function clipNorthSunlight(ringM: LngLat[], setbackM: number): LngLat[] {
  if (setbackM <= 0) return ringM;
  const maxY = Math.max(...ringM.map((p) => p[1]));
  const limitY = maxY - setbackM;
  const out: LngLat[] = [];
  const n = ringM.length;
  for (let i = 0; i < n; i++) {
    const cur = ringM[i];
    const next = ringM[(i + 1) % n];
    const curIn = cur[1] <= limitY;
    const nextIn = next[1] <= limitY;
    if (curIn) out.push(cur);
    if (curIn !== nextIn) {
      const t = (limitY - cur[1]) / (next[1] - cur[1]);
      out.push([cur[0] + t * (next[0] - cur[0]), limitY]);
    }
  }
  return out;
}

/**
 * 건축가능영역 계산 (완성형).
 *
 * @param boundary 대지 경계 [[lng,lat],...]
 * @param sideSetbackM 측후면 이격 (m)
 * @param floors 지상 층수
 * @param floorHeightM 층고 (기본 3.0)
 * @param sunApplies 정북일조 적용 여부 (용도지역 판정)
 */
export function calcBuildableArea(
  boundary: LngLat[] | undefined,
  sideSetbackM: number,
  floors: number,
  floorHeightM: number,
  sunApplies: boolean,
  /** 변별 이격 (m) — 원본 boundary 변 순서 (road-frontage edges.index 대응).
   *  주어지면 균일 buffer 대신 변별 half-plane 클립. 값 없는 변은 sideSetbackM. */
  edgeSetbacksM?: number[]
): BuildableArea {
  const warnings: string[] = [];
  const maxHeightM = floors * floorHeightM + 1.4;
  const requiredSetbackMaxHeight = sunApplies ? sunSetbackM(maxHeightM) : 0;

  if (!boundary || boundary.length < 3) {
    warnings.push("대지 경계(polygon) 데이터 없음 — 건축가능영역 계산 불가");
    return {
      lotAreaSqm: 0,
      afterSideSetbackSqm: 0,
      buildable2DSqm: 0,
      buildable2DRing: null,
      requiredSetbackMaxHeight,
      stepped3D: [],
      northEdgeCount: 0,
      warnings,
    };
  }

  // 닫힌 ring
  const ring: LngLat[] =
    boundary[0][0] === boundary[boundary.length - 1][0] &&
    boundary[0][1] === boundary[boundary.length - 1][1]
      ? boundary
      : [...boundary, boundary[0]];

  const parcelPoly = turf.polygon([ring]);
  const lotAreaSqm = turf.area(parcelPoly);
  const origin = ring[0];

  // 1) 이격 — 변별 차등(edgeSetbacksM) 우선, 없으면 균일 buffer (하위 호환)
  let sideRing: LngLat[];
  let afterSideSetbackSqm: number;
  if (edgeSetbacksM && edgeSetbacksM.length > 0) {
    const isClosed =
      ring.length > 1 &&
      ring[0][0] === ring[ring.length - 1][0] &&
      ring[0][1] === ring[ring.length - 1][1];
    const openRing = isClosed ? ring.slice(0, -1) : ring;
    const openM = toMeters(openRing, origin);
    let clipped = openM;
    for (let i = 0; i < openM.length && clipped.length >= 3; i++) {
      const sb = edgeSetbacksM[i] ?? sideSetbackM;
      if (sb > 0) {
        clipped = clipEdgeSetback(
          clipped,
          openM[i],
          openM[(i + 1) % openM.length],
          sb
        );
      }
    }
    if (clipped.length >= 3) {
      afterSideSetbackSqm = areaM(clipped);
      sideRing = toLngLat(clipped, origin);
    } else {
      warnings.push("변별 이격(전면·측면·후면) 적용 시 건축가능영역 소멸 (대지 협소)");
      return {
        lotAreaSqm: Number(lotAreaSqm.toFixed(1)),
        afterSideSetbackSqm: 0,
        buildable2DSqm: 0,
        buildable2DRing: null,
        requiredSetbackMaxHeight,
        stepped3D: [],
        northEdgeCount: 0,
        warnings,
      };
    }
  } else if (sideSetbackM > 0) {
    const buffered = turf.buffer(parcelPoly, -sideSetbackM, { units: "meters" });
    if (buffered && buffered.geometry.type === "Polygon") {
      sideRing = buffered.geometry.coordinates[0] as LngLat[];
      afterSideSetbackSqm = turf.area(buffered as Feature<Polygon>);
    } else {
      warnings.push(`측후면 ${sideSetbackM}m 이격 시 건축가능영역 소멸 (대지 협소)`);
      return {
        lotAreaSqm: Number(lotAreaSqm.toFixed(1)),
        afterSideSetbackSqm: 0,
        buildable2DSqm: 0,
        buildable2DRing: null,
        requiredSetbackMaxHeight,
        stepped3D: [],
        northEdgeCount: 0,
        warnings,
      };
    }
  } else {
    sideRing = ring;
    afterSideSetbackSqm = lotAreaSqm;
  }

  const sideRingM = toMeters(sideRing, origin);
  const northEdgeCount = countNorthEdges(sideRingM);

  // 2) 정북일조 방향성 clip (2D 보수적 — 최고높이 기준)
  let buildableRingM = sideRingM;
  if (sunApplies && requiredSetbackMaxHeight > 0) {
    buildableRingM = clipNorthSunlight(sideRingM, requiredSetbackMaxHeight);
    if (buildableRingM.length < 3) {
      warnings.push(
        `정북일조 ${requiredSetbackMaxHeight.toFixed(1)}m 이격 시 건축가능영역 소멸`
      );
    }
    if (northEdgeCount === 0) {
      warnings.push("북측 경계 후보 없음 — 정북일조 방향 확인 필요");
    }
  } else if (!sunApplies) {
    warnings.push("정북일조 미적용 용도지역 — 측후면 이격만 반영");
  }

  const buildable2DSqm = buildableRingM.length >= 3 ? areaM(buildableRingM) : 0;
  const buildable2DRing =
    buildableRingM.length >= 3 ? toLngLat(buildableRingM, origin) : null;

  // 3) 층별 계단식 (3D 매싱용) — 각 층 이격으로 clip한 면적
  const stepped3D: SunStep[] = [];
  for (let f = 1; f <= floors; f++) {
    const h = f * floorHeightM + 1.4;
    const setback = sunApplies ? sunSetbackM(h) : 0;
    const plateRingM =
      setback > 0 ? clipNorthSunlight(sideRingM, setback) : sideRingM;
    stepped3D.push({
      floor: f,
      heightM: Number(h.toFixed(1)),
      requiredSetbackM: Number(setback.toFixed(1)),
      floorPlateSqm: plateRingM.length >= 3 ? Number(areaM(plateRingM).toFixed(1)) : 0,
      ringLngLat: plateRingM.length >= 3 ? toLngLat(plateRingM, origin) : null,
    });
  }

  return {
    lotAreaSqm: Number(lotAreaSqm.toFixed(1)),
    afterSideSetbackSqm: Number(afterSideSetbackSqm.toFixed(1)),
    buildable2DSqm: Number(buildable2DSqm.toFixed(1)),
    buildable2DRing,
    requiredSetbackMaxHeight: Number(requiredSetbackMaxHeight.toFixed(1)),
    stepped3D,
    northEdgeCount,
    warnings,
  };
}
