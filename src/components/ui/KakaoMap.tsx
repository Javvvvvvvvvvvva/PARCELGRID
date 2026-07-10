"use client";

/**
 * Kakao Map — 실거래·대지 시각화 (사용자용 지도).
 * 법규/필지는 VWorld 엔진, 사용자 지도는 Kakao Map으로 분리 (C 확정).
 *
 * 대상 대지 마커 + 주변 실거래 점 (평당가 색상 + 클릭 팝업).
 * "왜 이 가격인지"를 지도로 납득 (건축가 조언).
 */

import { useEffect, useRef, useState } from "react";

const SDK_ID = "kakao-map-sdk";
const JS_KEY = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;

declare global {
  interface Window {
    kakao: any;
  }
}

function loadKakaoSdk(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("no window"));
    if (window.kakao && window.kakao.maps) {
      resolve();
      return;
    }
    const existing = document.getElementById(SDK_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => window.kakao.maps.load(() => resolve()));
      return;
    }
    if (!JS_KEY) {
      reject(new Error("NEXT_PUBLIC_KAKAO_JS_KEY 없음"));
      return;
    }
    const script = document.createElement("script");
    script.id = SDK_ID;
    script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${JS_KEY}&autoload=false`;
    script.async = true;
    script.onload = () => {
      window.kakao.maps.load(() => resolve());
    };
    script.onerror = () => reject(new Error("Kakao SDK 로드 실패"));
    document.head.appendChild(script);
  });
}

export interface StationMarker {
  name: string;
  lat: number;
  lng: number;
  /** 대지에서 직선거리 (m) */
  distanceM: number;
}

export interface CompMarker {
  /** 표 연동용 식별자 (CompVM _key) */
  id?: string;
  lat: number;
  lng: number;
  pricePerPyeong: number;
  lotArea: number;
  date: string;
  address: string;
  type: string;
  /** 매각가 알고리즘이 참고한 사례 (saleEstimate.cases 매칭) — 지도 강조 */
  referenced?: boolean;
}

/** 평당가 → 색상 (낮음 파랑 ↔ 높음 빨강). min~max 정규화. */
function priceColor(ppp: number, min: number, max: number): string {
  if (max <= min) return "#3b82f6";
  const t = Math.max(0, Math.min(1, (ppp - min) / (max - min)));
  // 파랑(210) → 빨강(0) HSL 보간
  const hue = 210 - t * 210;
  return `hsl(${hue}, 75%, 52%)`;
}

/** 위경도 간 거리 (m) — 근사 */
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function KakaoMap({
  centerLat,
  centerLng,
  subjectLabel,
  subjectPPP,
  comps = [],
  stations = [],
  selectedId,
  onSelectComp,
  height = 420,
  /** 필지 경계 폴리곤 [lng, lat][] */
  boundary,
  /** true면 대상지 중심 확대 유지 (실거래 전체 fit 안 함) */
  focusSubject = false,
  /** 초기 줌 (1=가장 가까움, 14=멀음). focusSubject 시 2~3 권장 */
  zoomLevel = 5,
  /** 인접 도로 중심선 (V월드) */
  roads = [],
  /** false면 도로선·도로명 미표시 */
  showRoads = true,
  /** focusSubject 시 주변 마커 포함 최대 줌 아웃 레벨 */
  maxZoomOutLevel = 4,
  /** 주변 실거래·역 포함 반경 (m) */
  nearbyRadiusM = 550,
}: {
  centerLat: number;
  centerLng: number;
  subjectLabel?: string;
  /** 대상 대지 평당가 (만원/평) — 실거래와 비교 표시용 */
  subjectPPP?: number | null;
  comps?: CompMarker[];
  /** 주변 지하철역 (역세권 표시) */
  stations?: StationMarker[];
  /** 선택된 실거래 id (표 연동 — 해당 점 강조) */
  selectedId?: string | null;
  /** 점 클릭 콜백 (표 연동) */
  onSelectComp?: (id: string) => void;
  height?: number;
  boundary?: [number, number][];
  focusSubject?: boolean;
  zoomLevel?: number;
  roads?: { name: string | null; points: [number, number][] }[];
  showRoads?: boolean;
  maxZoomOutLevel?: number;
  nearbyRadiusM?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let cancelled = false;

    loadKakaoSdk()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        const kakao = window.kakao;
        const center = new kakao.maps.LatLng(centerLat, centerLng);
        const map = new kakao.maps.Map(containerRef.current, {
          center,
          level: zoomLevel,
          draggable: true,
          scrollwheel: true,
          disableDoubleClickZoom: false,
        });
        mapRef.current = map;

        const fitBounds = new kakao.maps.LatLngBounds();
        fitBounds.extend(center);

        // 필지 경계 폴리곤
        if (boundary && boundary.length >= 3) {
          const path = boundary.map(([lng, lat]) => new kakao.maps.LatLng(lat, lng));
          new kakao.maps.Polygon({
            map,
            path,
            strokeWeight: 2.5,
            strokeColor: "#2563eb",
            strokeOpacity: 0.95,
            fillColor: "#3b82f6",
            fillOpacity: 0.15,
          });
          path.forEach((p: { getLat: () => number; getLng: () => number }) => fitBounds.extend(p));
        }

        // 인접 도로 + 도로명 (선택)
        if (showRoads) {
        roads.forEach((road) => {
          if (!road.points || road.points.length < 2) return;
          const path = road.points.map(([lng, lat]) => new kakao.maps.LatLng(lat, lng));
          new kakao.maps.Polyline({
            map,
            path,
            strokeWeight: 5,
            strokeColor: "#6b7280",
            strokeOpacity: 0.85,
          });
          path.forEach((p: { getLat: () => number; getLng: () => number }) => {
            if (haversineM(centerLat, centerLng, p.getLat(), p.getLng()) <= nearbyRadiusM + 200) {
              fitBounds.extend(p);
            }
          });
          const label = road.name?.trim();
          if (label) {
            const mid = path[Math.floor(path.length / 2)];
            const el = document.createElement("div");
            el.style.cssText =
              "padding:2px 7px;border-radius:4px;background:rgba(255,255,255,0.92);border:1px solid #9ca3af;font-size:11px;font-weight:600;color:#475569;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.12);";
            el.textContent = label;
            new kakao.maps.CustomOverlay({
              map,
              position: mid,
              content: el,
              yAnchor: 0.5,
              xAnchor: 0.5,
            }).setMap(map);
          }
        });
        }

        // 대상 대지 마커 (기본 핀 + 라벨)
        const subjectMarker = new kakao.maps.Marker({ position: center, zIndex: 10 });
        subjectMarker.setMap(map);
        if (subjectLabel) {
          const iw = new kakao.maps.InfoWindow({
            content: `<div style="padding:6px 10px;font-size:12px;font-weight:700;color:#111;white-space:nowrap;">📍 ${subjectLabel}</div>`,
          });
          iw.open(map, subjectMarker);
        }

        // 실거래 점 (평당가 색상 원형 마커)
        if (comps.length > 0) {
          const prices = comps.map((c) => c.pricePerPyeong);
          const min = Math.min(...prices);
          const max = Math.max(...prices);

          let openInfo: any = null;

          comps.forEach((c) => {
            const dist = haversineM(centerLat, centerLng, c.lat, c.lng);
            if (focusSubject && dist > nearbyRadiusM) return;

            const pos = new kakao.maps.LatLng(c.lat, c.lng);
            fitBounds.extend(pos);
            const color = priceColor(c.pricePerPyeong, min, max);

            // 색상 점 — DOM 엘리먼트로 직접 생성 (클릭 리스너 부착 위해)
            const isSel = selectedId != null && c.id === selectedId;
            const dotEl = document.createElement("div");
            const dotSize = isSel ? 22 : 14;
            const dotRing = isSel ? "3px solid #f59e0b" : "2px solid #fff";
            dotEl.style.cssText = `width:${dotSize}px;height:${dotSize}px;border-radius:50%;background:${color};border:${dotRing};box-shadow:0 1px 4px rgba(0,0,0,0.45);cursor:pointer;transition:transform 0.1s;`;
            dotEl.addEventListener("mouseenter", () => {
              dotEl.style.transform = "scale(1.4)";
            });
            dotEl.addEventListener("mouseleave", () => {
              dotEl.style.transform = "scale(1)";
            });

            const dot = new kakao.maps.CustomOverlay({
              position: pos,
              content: dotEl,
              yAnchor: 0.5,
              xAnchor: 0.5,
              clickable: true,
            });
            dot.setMap(map);

            // 클릭 → 팝업
            const pyeong = Math.round(c.lotArea / 3.305785);
            const vsSubject =
              subjectPPP != null
                ? c.pricePerPyeong > subjectPPP
                  ? `<span style="color:#dc2626;">우리보다 +${Math.round(((c.pricePerPyeong - subjectPPP) / subjectPPP) * 100)}%</span>`
                  : c.pricePerPyeong < subjectPPP
                  ? `<span style="color:#2563eb;">우리보다 ${Math.round(((c.pricePerPyeong - subjectPPP) / subjectPPP) * 100)}%</span>`
                  : `<span style="color:#666;">우리와 동일</span>`
                : "";
            dotEl.addEventListener("click", () => {
              if (c.id && onSelectComp) onSelectComp(c.id);
              if (openInfo) openInfo.close();
              const info = new kakao.maps.InfoWindow({
                position: pos,
                content: `<div style="padding:8px 12px;font-size:12px;color:#111;line-height:1.6;min-width:150px;">
                  <div style="font-weight:700;margin-bottom:2px;">${c.address}</div>
                  <div>평당 <b>${c.pricePerPyeong.toLocaleString()}만</b> ${vsSubject}</div>
                  <div style="color:#666;">${c.type} · ${pyeong}평 · ${c.date}</div>
                </div>`,
              });
              info.open(map);
              openInfo = info;
            });
          });

        }

        // 지하철역 — 근거리만 bounds 포함
        stations.forEach((st) => {
          const pos = new kakao.maps.LatLng(st.lat, st.lng);
          if (!focusSubject || st.distanceM <= nearbyRadiusM + 300) {
            fitBounds.extend(pos);
          }
          const near = st.distanceM <= 500; // 역세권 기준
          const distLabel =
            st.distanceM >= 1000
              ? `${(st.distanceM / 1000).toFixed(1)}km`
              : `${st.distanceM}m`;

          const el = document.createElement("div");
          el.style.cssText = `display:flex;align-items:center;gap:4px;padding:3px 8px;border-radius:12px;background:${near ? "#059669" : "#64748b"};color:#fff;font-size:11px;font-weight:600;box-shadow:0 1px 4px rgba(0,0,0,0.35);white-space:nowrap;`;
          el.textContent = `🚇 ${st.name} ${distLabel}`;

          const overlay = new kakao.maps.CustomOverlay({
            position: pos,
            content: el,
            yAnchor: 0.5,
            xAnchor: 0.5,
          });
          overlay.setMap(map);
        });

        // 통합 줌 — 대상지 + 주변 실거래·도로
        map.setBounds(fitBounds, 44, 44, 44, 44);
        const lv = map.getLevel();
        if (focusSubject) {
          if (lv > maxZoomOutLevel) map.setLevel(maxZoomOutLevel);
          if (lv < 2) map.setLevel(2);
        } else if (boundary && boundary.length >= 3) {
          if (lv > 5) map.setLevel(5);
        }

        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMsg(err.message || "지도 로드 실패");
        setStatus("error");
      });

    return () => {
      cancelled = true;
      mapRef.current = null;
    };
  }, [
    centerLat,
    centerLng,
    subjectLabel,
    subjectPPP,
    comps,
    stations,
    selectedId,
    onSelectComp,
    boundary,
    focusSubject,
    zoomLevel,
    roads,
    showRoads,
    maxZoomOutLevel,
    nearbyRadiusM,
  ]);

  const zoomIn = () => {
    const map = mapRef.current;
    if (!map) return;
    map.setLevel(Math.max(1, map.getLevel() - 1));
  };
  const zoomOut = () => {
    const map = mapRef.current;
    if (!map) return;
    map.setLevel(Math.min(14, map.getLevel() + 1));
  };
  const recenter = () => {
    const map = mapRef.current;
    if (!map) return;
    const kakao = window.kakao;
    map.setCenter(new kakao.maps.LatLng(centerLat, centerLng));
    const bounds = new kakao.maps.LatLngBounds();
    bounds.extend(new kakao.maps.LatLng(centerLat, centerLng));
    if (boundary && boundary.length >= 3) {
      boundary.forEach(([lng, lat]) => bounds.extend(new kakao.maps.LatLng(lat, lng)));
    }
    comps.forEach((c) => {
      if (haversineM(centerLat, centerLng, c.lat, c.lng) <= nearbyRadiusM) {
        bounds.extend(new kakao.maps.LatLng(c.lat, c.lng));
      }
    });
    map.setBounds(bounds, 44, 44, 44, 44);
    if (map.getLevel() > maxZoomOutLevel) map.setLevel(maxZoomOutLevel);
    if (map.getLevel() < 2) map.setLevel(2);
  };

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height,
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid var(--border)",
        background: "var(--bg-sunken)",
      }}
    >
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      {status === "ready" && (
        <div
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            zIndex: 2,
          }}
        >
          <MapZoomBtn label="+" onClick={zoomIn} title="확대" />
          <MapZoomBtn label="−" onClick={zoomOut} title="축소" />
          <MapZoomBtn label="◎" onClick={recenter} title="대상지로" small />
        </div>
      )}
      {comps.length > 0 && status === "ready" && (
        <div
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            right: 10,
            background: "var(--bg-elev)",
            border: "1px solid var(--border-faint)",
            borderRadius: 8,
            padding: "7px 12px",
            fontSize: 11.5,
            color: "var(--fg-muted)",
            lineHeight: 1.4,
            pointerEvents: "none",
            boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
          }}
        >
          실거래는 지번이 비공개(개인정보)라 <b style={{ color: "var(--fg)" }}>동 단위 근사 위치</b>로 표시됩니다.
          점 색상은 평당가, 위치는 참고용입니다.
        </div>
      )}
      {comps.length > 0 && status === "ready" && (
        <div
          style={{
            position: "absolute",
            bottom: 10,
            left: 10,
            background: "var(--bg-elev)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 11,
            color: "var(--fg-muted)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "hsl(210,75%,52%)", display: "inline-block" }} />
            낮음
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "hsl(0,75%,52%)", display: "inline-block" }} />
            높음
          </span>
          <span style={{ color: "var(--fg-faint)" }}>· 평당가</span>
          <span style={{ color: "var(--fg-faint)", marginLeft: 4 }}>· 동 단위 근사 위치</span>
        </div>
      )}
      {status === "loading" && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "var(--fg-subtle)" }}>
          지도 불러오는 중…
        </div>
      )}
      {status === "error" && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 13, color: "var(--neg-fg)", padding: 16, textAlign: "center" }}>
          <span>지도를 불러오지 못했습니다</span>
          <span style={{ fontSize: 11, color: "var(--fg-faint)" }}>{errorMsg}</span>
          <span style={{ fontSize: 11, color: "var(--fg-faint)" }}>Kakao Developers에서 localhost:3000 도메인 등록을 확인하세요</span>
        </div>
      )}
    </div>
  );
}

function MapZoomBtn({
  label,
  onClick,
  title,
  small,
}: {
  label: string;
  onClick: () => void;
  title: string;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        width: small ? 30 : 30,
        height: small ? 26 : 30,
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "var(--bg-elev)",
        color: "var(--fg)",
        fontSize: small ? 13 : 16,
        fontWeight: 600,
        cursor: "pointer",
        boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
        lineHeight: 1,
      }}
    >
      {label}
    </button>
  );
}
