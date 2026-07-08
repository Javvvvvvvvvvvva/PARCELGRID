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
}

/** 평당가 → 색상 (낮음 파랑 ↔ 높음 빨강). min~max 정규화. */
function priceColor(ppp: number, min: number, max: number): string {
  if (max <= min) return "#3b82f6";
  const t = Math.max(0, Math.min(1, (ppp - min) / (max - min)));
  // 파랑(210) → 빨강(0) HSL 보간
  const hue = 210 - t * 210;
  return `hsl(${hue}, 75%, 52%)`;
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
}) {
  const containerRef = useRef<HTMLDivElement>(null);
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
          level: 5,
        });

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
          const bounds = new kakao.maps.LatLngBounds();
          bounds.extend(center);

          let openInfo: any = null;

          comps.forEach((c) => {
            const pos = new kakao.maps.LatLng(c.lat, c.lng);
            bounds.extend(pos);
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

          // 모든 점 보이게 범위 조정
          map.setBounds(bounds);
        }

        // 지하철역 마커 (역세권 — "왜 비싼지"의 핵심)
        stations.forEach((st) => {
          const pos = new kakao.maps.LatLng(st.lat, st.lng);
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

        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMsg(err.message || "지도 로드 실패");
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [centerLat, centerLng, subjectLabel, subjectPPP, comps, stations, selectedId, onSelectComp]);

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
