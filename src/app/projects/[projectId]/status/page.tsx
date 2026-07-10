"use client";

/**
 * Stage 1 — 현황 분석 (Existing Property Analysis)
 *
 * 읽기 전용. 현재 토지·건물·실거래·3D 현황을 보여준다.
 * 신축 설계(세대 배치·필로티)는 Stage 2 계획 스튜디오에서 다룬다.
 */

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useProjectStore } from "@/lib/stores/project-store";
import { KakaoMap, type CompMarker, type StationMarker } from "@/components/ui/KakaoMap";
import { Panel, SectionTitle, DataRow, Button } from "@/components/ui/primitives";
import { Dot } from "@/components/ui/Tag";
import {
  buildStatusSummary,
  formatExistingUnits,
  type SummaryTone,
} from "@/lib/analysis/status-summary";
import {
  computeExistingRatios,
  formatRatioVsLimit,
  headroomPct,
} from "@/lib/analysis/existing-building-metrics";
import { num, pyeong } from "@/lib/utils/format";
import type { CompVM } from "@/lib/adapters/view-model";
import type { BuildingLookupResult } from "@/lib/integrations/molit-building";

const ExistingBuildingMass = dynamic(
  () =>
    import("@/components/ui/ExistingBuildingMass").then((m) => m.ExistingBuildingMass),
  { ssr: false, loading: () => <div style={{ height: 360, background: "var(--bg-sunken)" }} /> }
);

const SQM_PER_PYEONG = 3.305785;
const NEW_BUILD_CUTOFF_YEAR = new Date().getFullYear() - 5;

type MapLayer = "subject" | "comps" | "stations" | "newBuilds";

const TONE_COLOR: Record<SummaryTone, string> = {
  neutral: "var(--fg)",
  positive: "var(--pos-fg)",
  warning: "var(--warn-fg)",
  negative: "var(--neg-fg)",
};

export default function StatusPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const data = useProjectStore((s) => s.data);
  const parcel = data?.parcel;
  const currentBuilding = parcel?.currentBuilding;

  const [layers, setLayers] = useState<Record<MapLayer, boolean>>({
    subject: true,
    comps: true,
    stations: true,
    newBuilds: false,
  });

  const summary = useMemo(
    () => (parcel ? buildStatusSummary(parcel) : []),
    [parcel]
  );

  const main = useMemo(() => {
    if (!currentBuilding?.hasBuilding) return null;
    return (
      currentBuilding.buildings.find((b) => b.isMainBuilding) ??
      currentBuilding.buildings[0] ??
      null
    );
  }, [currentBuilding]);

  const ratios = useMemo(() => {
    if (!main || !parcel?.lotArea) return null;
    return computeExistingRatios(main, parcel.lotArea);
  }, [main, parcel?.lotArea]);

  const allComps: CompVM[] = data?.comps ?? [];

  const subjectPPP = useMemo(() => {
    if (!parcel?.acquiredPrice || !parcel?.lotArea) return null;
    return Math.round(parcel.acquiredPrice / (parcel.lotArea / SQM_PER_PYEONG));
  }, [parcel]);

  const [stations, setStations] = useState<StationMarker[]>([]);

  useEffect(() => {
    if (parcel?.lat == null || parcel?.lng == null) return;
    let cancelled = false;
    fetch(`/api/parcels/nearby-stations?lat=${parcel.lat}&lng=${parcel.lng}&radius=1000`)
      .then((r) => r.json())
      .then((res: { stations?: StationMarker[] }) => {
        if (!cancelled && res.stations) setStations(res.stations);
      })
      .catch(() => {
        if (!cancelled) setStations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [parcel?.lat, parcel?.lng]);

  const compsForMap = useMemo(() => {
    let list = allComps.slice(0, 24);
    if (layers.newBuilds) {
      list = list.filter((c) => c.buildYear != null && c.buildYear >= NEW_BUILD_CUTOFF_YEAR);
    }
    return list;
  }, [allComps, layers.newBuilds]);

  const [compMarkers, setCompMarkers] = useState<CompMarker[]>([]);
  useEffect(() => {
    if (!layers.comps || compsForMap.length === 0) {
      setCompMarkers([]);
      return;
    }
    let cancelled = false;
    fetch("/api/parcels/comps-geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addresses: compsForMap.map((c) => c.address) }),
    })
      .then((r) => r.json())
      .then((res: { coords: ({ lat: number; lng: number } | null)[] }) => {
        if (cancelled || !res.coords) return;
        const markers: CompMarker[] = [];
        compsForMap.forEach((c, i) => {
          const coord = res.coords[i];
          if (!coord) return;
          markers.push({
            id: `${c.id}-${i}`,
            lat: coord.lat,
            lng: coord.lng,
            pricePerPyeong: c.pricePerPyeong,
            lotArea: c.lotArea,
            date: c.date,
            address: c.address,
            type: c.type,
          });
        });
        setCompMarkers(markers);
      })
      .catch(() => {
        if (!cancelled) setCompMarkers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [compsForMap, layers.comps]);

  const newBuildCount = useMemo(
    () =>
      allComps.filter((c) => c.buildYear != null && c.buildYear >= NEW_BUILD_CUTOFF_YEAR)
        .length,
    [allComps]
  );

  if (!parcel) {
    return (
      <div style={{ padding: 40, color: "var(--fg-muted)" }}>부지 데이터 로딩 중…</div>
    );
  }

  return (
    <div style={{ padding: "var(--s6)", maxWidth: 1200, margin: "0 auto" }}>
      {/* Stage indicator */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: "var(--s5)",
          fontSize: 11.5,
          color: "var(--fg-muted)",
        }}
      >
        <span style={{ fontWeight: 600, color: "var(--fg)" }}>Stage 1</span>
        <span>현황 분석</span>
        <span style={{ color: "var(--fg-faint)" }}>→</span>
        <Link
          href={`/projects/${projectId}/envelope`}
          style={{ opacity: 0.45, color: "inherit", textDecoration: "none" }}
        >
          Stage 2 계획 스튜디오
        </Link>
      </div>

      <SectionTitle
        size="lg"
        title="현황 분석"
        desc="Existing Property Analysis — 현재 토지·건물 상태를 읽기 전용으로 확인합니다."
        style={{ marginBottom: "var(--s6)" }}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "var(--s5)",
          alignItems: "start",
        }}
      >
        {/* ① 기본 정보 */}
        <Panel title="① 기본 정보" source="V월드 · 공시지가 · 건축물대장">
          <DataRow label="주소" value={parcel.address} />
          <DataRow label="대지면적" value={`${num(parcel.lotArea, 2)} m² (${pyeong(parcel.lotArea)})`} />
          <DataRow label="용도지역" value={parcel.zoning} />
          {ratios ? (
            <>
              <DataRow
                label="건폐율"
                value={formatRatioVsLimit(ratios.bcrPct, parcel.maxBCR)}
                sub={`건축면적 ${num(ratios.buildingAreaSqm, 2)}㎡ · ${ratios.bcrSource}`}
              />
              <DataRow
                label="용적률"
                value={formatRatioVsLimit(ratios.farPct, parcel.maxFAR)}
                sub={`연면적 ${num(ratios.totalAreaSqm, 2)}㎡ · ${ratios.farSource}`}
              />
              <DataRow
                label="법규 여유"
                value={`건폐 ${headroomPct(ratios.bcrPct, parcel.maxBCR).toFixed(1)}%p · 용적 ${headroomPct(ratios.farPct, parcel.maxFAR).toFixed(1)}%p`}
                sub="상한 대비 잔여"
              />
            </>
          ) : (
            <>
              <DataRow label="건폐율 상한" value={`${parcel.maxBCR}%`} sub="건물 없음 — 법규 상한만" />
              <DataRow label="용적률 상한" value={`${parcel.maxFAR}%`} sub="건물 없음 — 법규 상한만" />
            </>
          )}
          <DataRow
            label="공시지가"
            value={`${num(parcel.landPrice / 10_000)}만/m²`}
            sub="V월드 개별공시지가"
          />
        </Panel>

        {/* ② 기존 건축물 */}
        <Panel title="② 기존 건축물" source="MOLIT 건축물대장">
          {main ? (
            <>
              {main.name && <DataRow label="건물명" value={main.name} />}
              <DataRow
                label="준공연도"
                value={`${main.approvalDate.slice(0, 4)}년 ${main.approvalDate.slice(5, 7)}월 (${main.ageYears ?? "—"}년 경과)`}
              />
              <DataRow
                label="용도"
                value={
                  main.detailPurpose && main.detailPurpose !== main.mainPurpose
                    ? `${main.mainPurpose} · ${main.detailPurpose}`
                    : main.mainPurpose
                }
              />
              <DataRow
                label="층수"
                value={`지상 ${main.groundFloors}층${
                  main.undergroundFloors > 0 ? ` / 지하 ${main.undergroundFloors}층` : ""
                }`}
              />
              <DataRow label="건축면적" value={`${num(main.buildingArea, 2)} m²`} />
              <DataRow label="연면적" value={`${num(main.totalArea, 2)} m²`} />
              {main.height > 0 && (
                <DataRow label="높이" value={`${num(main.height, 2)} m`} />
              )}
              {ratios && (
                <DataRow
                  label="미건축 대지"
                  value={`${num(ratios.unbuiltLotSqm, 2)} m² (${ratios.unbuiltLotPct.toFixed(1)}%)`}
                  sub="대지 − 건축면적"
                />
              )}
              <DataRow label="세대수" value={formatExistingUnits(currentBuilding)} />
              {main.structure && <DataRow label="구조" value={main.structure} />}
              {(currentBuilding?.buildings.length ?? 0) > 1 && (
                <DataRow
                  label="부속 동"
                  value={`${(currentBuilding?.buildings.length ?? 1) - 1}동 추가`}
                  sub={`전체 연면적 합 ${num(currentBuilding?.totalBuildingArea ?? 0, 2)}㎡`}
                />
              )}
            </>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: "var(--fg-muted)" }}>
              등록된 건축물이 없습니다 (빈 토지).
            </p>
          )}
        </Panel>
      </div>

      {/* ③ 지도 */}
      <Panel
        title="③ 지도"
        source="Kakao Map · MOLIT 실거래"
        style={{ marginTop: "var(--s5)" }}
      >
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          <LayerChip
            label="대상지"
            active={layers.subject}
            onClick={() => setLayers((l) => ({ ...l, subject: !l.subject }))}
          />
          <LayerChip
            label={`실거래 (${allComps.length})`}
            active={layers.comps}
            onClick={() => setLayers((l) => ({ ...l, comps: !l.comps }))}
          />
          <LayerChip
            label={`역세권 (${stations.length})`}
            active={layers.stations}
            onClick={() => setLayers((l) => ({ ...l, stations: !l.stations }))}
          />
          <LayerChip
            label={`주변 신축 (${newBuildCount})`}
            active={layers.newBuilds}
            onClick={() =>
              setLayers((l) => ({
                ...l,
                newBuilds: !l.newBuilds,
                comps: true,
              }))
            }
            hint={`${NEW_BUILD_CUTOFF_YEAR}년 이후 준공`}
          />
        </div>

        {parcel.lat != null && parcel.lng != null ? (
          <KakaoMap
            centerLat={parcel.lat}
            centerLng={parcel.lng}
            showRoads={false}
            focusSubject
            zoomLevel={3}
            maxZoomOutLevel={4}
            nearbyRadiusM={500}
            subjectLabel={layers.subject ? parcel.address.split(" ").slice(-2).join(" ") : undefined}
            subjectPPP={subjectPPP}
            comps={layers.comps ? compMarkers : []}
            stations={layers.stations ? stations : []}
            height={400}
          />
        ) : (
          <p style={{ fontSize: 13, color: "var(--fg-muted)" }}>좌표 정보가 없어 지도를 표시할 수 없습니다.</p>
        )}
          <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "var(--fg-faint)" }}>
            우측 버튼(◎)으로 대상지 재중심 · 실거래는 동 단위 근사 좌표입니다.
          </p>
      </Panel>

      {/* ④ 기존 건물 3D + ⑤ 알고리즘 요약 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.2fr 0.8fr",
          gap: "var(--s5)",
          marginTop: "var(--s5)",
          alignItems: "start",
        }}
      >
        <Panel title="④ 기존 건물 3D" source="건축물대장 기반 단순 매스 · 신축 아님">
          <ExistingBuildingMass
            boundary={parcel.boundary}
            currentBuilding={currentBuilding}
            lotArea={parcel.lotArea}
            height={400}
          />
          <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "var(--fg-faint)" }}>
            건축물대장 기반 현재 건물 매스 · 드래그로 회전
          </p>
        </Panel>

        <Panel title="⑤ 알고리즘 요약" source="규칙 기반 · 출처 연동">
          <div style={{ fontSize: 12, color: "var(--fg-muted)", marginBottom: 10 }}>
            분석 결과
          </div>
          <ul style={{ margin: 0, padding: "0 0 0 18px", listStyle: "disc" }}>
            {summary.map((b, i) => (
              <li
                key={i}
                style={{
                  fontSize: 13.5,
                  lineHeight: 1.55,
                  marginBottom: 8,
                  color: TONE_COLOR[b.tone],
                }}
              >
                {b.text}
              </li>
            ))}
          </ul>
          {currentBuilding?.signalLabel && (
            <div
              style={{
                marginTop: 14,
                padding: "10px 12px",
                background: "var(--bg-sunken)",
                borderRadius: 6,
                fontSize: 12.5,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                <Dot kind={signalDot(currentBuilding)} />
                {currentBuilding.signalLabel}
              </div>
              <div style={{ marginTop: 4, color: "var(--fg-muted)", lineHeight: 1.5 }}>
                {currentBuilding.signalReasoning}
              </div>
            </div>
          )}
        </Panel>
      </div>

      {/* CTA → Stage 2 */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 12,
          marginTop: "var(--s6)",
          paddingTop: "var(--s5)",
          borderTop: "1px solid var(--border)",
        }}
      >
        <Link href={`/projects/${projectId}`} style={{ textDecoration: "none" }}>
          <Button variant="ghost">대시보드 건너뛰기</Button>
        </Link>
        <Link href={`/projects/${projectId}/envelope`} style={{ textDecoration: "none" }}>
          <Button variant="primary" size="lg">
            계획 스튜디오로 →
          </Button>
        </Link>
      </div>
    </div>
  );
}

function LayerChip({
  label,
  active,
  onClick,
  hint,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      style={{
        padding: "5px 10px",
        borderRadius: 999,
        border: `1px solid ${active ? "var(--fg)" : "var(--border)"}`,
        background: active ? "var(--fg)" : "transparent",
        color: active ? "var(--bg)" : "var(--fg-muted)",
        fontSize: 11.5,
        fontWeight: 500,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function signalDot(info: BuildingLookupResult): "pos" | "warn" | "neg" {
  if (info.redevelopmentSignal === "rebuild") return "neg";
  if (info.redevelopmentSignal === "renovate") return "warn";
  return "pos";
}
