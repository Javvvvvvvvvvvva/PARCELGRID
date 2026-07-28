"use client";

/**
 * Stage 1 — 현황 분석 (Existing Property Analysis)
 *
 * 주소 검색 직후 현재 토지·기존 건물·입지 상태를 읽기 전용으로 보여준다.
 * 신축 가능 규모와 미래 계획은 Stage 2 계획 스튜디오에서 별도로 계산한다.
 */

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useProjectStore } from "@/lib/stores/project-store";
import { KakaoMap, type CompMarker, type StationMarker } from "@/components/ui/KakaoMap";
import { Panel, SectionTitle, DataRow, Button } from "@/components/ui/primitives";
import { Dot } from "@/components/ui/Tag";
import {
  DataReadinessPanel,
  ExistingReviewPanel,
  MarketSnapshotPanel,
  RoadOrientationPanel,
} from "@/components/ui/StatusInsightPanels";
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
import {
  buildDataReadinessInsight,
  buildExistingReviewOptions,
  buildMarketInsight,
  buildRoadOrientationInsight,
} from "@/lib/analysis/status-insights";
import { num, pyeong, won } from "@/lib/utils/format";
import type { CompVM } from "@/lib/adapters/view-model";
import type { BuildingLookupResult } from "@/lib/integrations/molit-building";
import { regulatoryConstraintIsDecisionGrade } from "@/lib/regulatory/constraints";

const ExistingBuildingMass = dynamic(
  () =>
    import("@/components/ui/ExistingBuildingMass").then((m) => m.ExistingBuildingMass),
  {
    ssr: false,
    loading: () => <div style={{ height: 360, background: "var(--bg-sunken)" }} />,
  }
);

const SQM_PER_PYEONG = 3.305785;
const NEW_BUILD_CUTOFF_YEAR = new Date().getFullYear() - 5;

type MapLayer = "subject" | "comps" | "stations" | "newBuilds";
type BadgeTone = "neutral" | "positive" | "warning" | "negative";

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
  const observations = summary.filter((item) => item.kind === "observation");
  const checks = summary.filter((item) => item.kind === "check");

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
    if (!parcel?.acquiredPrice || !parcel.lotArea) return null;
    return Math.round(
      parcel.acquiredPrice / (parcel.lotArea / SQM_PER_PYEONG),
    );
  }, [parcel?.acquiredPrice, parcel?.lotArea]);

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

  const roadInsight = useMemo(
    () => (parcel ? buildRoadOrientationInsight(parcel) : null),
    [parcel]
  );
  const marketInsight = useMemo(
    () =>
      parcel
        ? buildMarketInsight(
            allComps,
            stations,
            subjectPPP,
            compMarkers.length,
            NEW_BUILD_CUTOFF_YEAR
          )
        : null,
    [parcel, allComps, stations, subjectPPP, compMarkers.length]
  );
  const dataReadiness = useMemo(
    () => (parcel ? buildDataReadinessInsight(parcel, allComps, stations) : null),
    [parcel, allComps, stations]
  );
  const reviewOptions = useMemo(
    () => (parcel ? buildExistingReviewOptions(parcel) : []),
    [parcel]
  );

  if (!parcel) {
    return (
      <div style={{ padding: 40, color: "var(--fg-muted)" }}>부지 데이터 로딩 중…</div>
    );
  }

  const farDecisionGrade = regulatoryConstraintIsDecisionGrade(
    parcel.regulatoryConstraints?.far
  );
  const bcrDecisionGrade = regulatoryConstraintIsDecisionGrade(
    parcel.regulatoryConstraints?.bcr
  );
  const heightDecisionGrade = regulatoryConstraintIsDecisionGrade(
    parcel.regulatoryConstraints?.height
  );
  const ageYears = currentBuilding?.maxAgeYears ?? main?.ageYears ?? null;
  const bcrHeadroom = ratios ? headroomPct(ratios.bcrPct, parcel.maxBCR) : null;
  const farHeadroom = ratios ? headroomPct(ratios.farPct, parcel.maxFAR) : null;
  const farUtilization =
    ratios && parcel.maxFAR > 0 ? (ratios.farPct / parcel.maxFAR) * 100 : null;
  const purpose = main
    ? main.detailPurpose && main.detailPurpose !== main.mainPurpose
      ? `${main.mainPurpose} · ${main.detailPurpose}`
      : main.mainPurpose
    : "등록 건물 없음";

  const headline = main
    ? `${ageYears ?? "—"}년 경과한 ${purpose}`
    : "건축물대장에 등록된 현재 건물이 없습니다";

  const overviewText = ratios
    ? farDecisionGrade && bcrDecisionGrade
      ? `현재 건폐율은 원문 확인 상한까지 ${bcrHeadroom?.toFixed(1)}%p 남아 있고, 용적률은 확인 상한의 ${farUtilization?.toFixed(0)}%를 사용하고 있습니다. 실제 신축 가능 규모는 Stage 2에서 일조·도로·주차를 함께 검토합니다.`
      : `현재 건물 비율은 계산됐지만 건폐율·용적률 숫자는 전국 시행령 참고 상한입니다. 관할 조례·지구단위계획 원문을 확인하기 전에는 법정 여유로 확정하지 않습니다.`
    : "현재 건물 비율을 계산할 수 없습니다. 대지·건축물대장 데이터를 확인한 뒤 Stage 2에서 가능 규모를 검토합니다.";

  const badges: { label: string; tone: BadgeTone }[] = [
    {
      label: main ? "기존 건물 있음" : "등록 건물 없음",
      tone: main ? "neutral" : "warning",
    },
    ...(ageYears != null && ageYears >= 30
      ? [{ label: `노후 ${ageYears}년`, tone: "warning" as const }]
      : []),
    ...(bcrHeadroom != null
      ? [
          {
            label: bcrDecisionGrade
              ? bcrHeadroom < 10
                ? "건폐율 여유 적음"
                : "건폐율 여유 있음"
              : "건폐율 원문 확인 필요",
            tone: bcrDecisionGrade && bcrHeadroom >= 10
              ? ("positive" as const)
              : ("warning" as const),
          },
        ]
      : []),
    ...(farHeadroom != null
      ? [
          {
            label: farDecisionGrade
              ? farHeadroom >= parcel.maxFAR * 0.3
                ? "용적률 여유 큼"
                : "용적률 여유 적음"
              : "용적률 원문 확인 필요",
            tone:
              farDecisionGrade && farHeadroom >= parcel.maxFAR * 0.3
                ? ("positive" as const)
                : ("warning" as const),
          },
        ]
      : []),
    ...(parcel.demolitionCost && parcel.demolitionCost > 0
      ? [{ label: "철거비 발생", tone: "neutral" as const }]
      : []),
    {
      label: heightDecisionGrade ? "높이 원문 확인" : "높이 원문 확인 필요",
      tone: heightDecisionGrade ? "positive" : "warning",
    },
    {
      label: parcel.roads && parcel.roads.length > 0 ? "도로 데이터 있음" : "도로 확인 필요",
      tone: parcel.roads && parcel.roads.length > 0 ? "positive" : "warning",
    },
  ];

  return (
    <div style={{ padding: "var(--s6)", maxWidth: 1200, margin: "0 auto" }}>
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
        desc="현재 토지와 기존 건물의 물리적·법적·시장 상태를 확인합니다."
        style={{ marginBottom: "var(--s5)" }}
      />

      <section
        style={{
          marginBottom: "var(--s5)",
          padding: "22px 24px",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-lg)",
          background: "var(--bg-elev)",
          boxShadow: "0 10px 30px rgba(15,23,42,0.035)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 24,
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 280, flex: 1 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.08em",
                color: "var(--fg-subtle)",
                marginBottom: 8,
              }}
            >
              CURRENT CONDITION
            </div>
            <h2 style={{ margin: 0, fontSize: 24, lineHeight: 1.3, letterSpacing: "-0.02em" }}>
              {headline}
            </h2>
            <p
              style={{
                margin: "10px 0 0",
                maxWidth: 760,
                color: "var(--fg-muted)",
                fontSize: 13.5,
                lineHeight: 1.65,
              }}
            >
              {overviewText}
            </p>
          </div>
          <div style={{ textAlign: "right", minWidth: 190 }}>
            <div style={{ fontSize: 11, color: "var(--fg-faint)", marginBottom: 5 }}>
              대상지
            </div>
            <div style={{ fontWeight: 650, fontSize: 13 }}>{parcel.address}</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 18 }}>
          {badges.map((badge) => (
            <StatusBadge key={badge.label} label={badge.label} tone={badge.tone} />
          ))}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 1,
            marginTop: 20,
            border: "1px solid var(--border)",
            borderRadius: 9,
            overflow: "hidden",
            background: "var(--border)",
          }}
        >
          <OverviewMetric label="대지" value={pyeong(parcel.lotArea)} sub={`${num(parcel.lotArea, 2)}㎡`} />
          <OverviewMetric
            label="기존 건물"
            value={main ? `지상 ${main.groundFloors}층` : "없음"}
            sub={main && main.undergroundFloors > 0 ? `지하 ${main.undergroundFloors}층` : purpose}
          />
          <OverviewMetric
            label="입력한 총 취득대금"
            value={parcel.acquiredPrice > 0 ? won(parcel.acquiredPrice, { full: true }) : "미입력"}
            sub="사용자 입력 · 주변 시세와 별도"
          />
          <OverviewMetric
            label="건폐율"
            value={ratios ? `${ratios.bcrPct.toFixed(1)}%` : "—"}
            sub={`${bcrDecisionGrade ? "원문 확인 상한" : "전국 상한 참고"} ${parcel.maxBCR}%`}
          />
          <OverviewMetric
            label="용적률"
            value={ratios ? `${ratios.farPct.toFixed(1)}%` : "—"}
            sub={`${farDecisionGrade ? "원문 확인 상한" : "전국 상한 참고"} ${parcel.maxFAR}%`}
          />
          <OverviewMetric
            label="데이터 상태"
            value={currentBuilding ? "대장 연동" : "확인 필요"}
            sub={parcel.boundary ? "필지 경계 확보" : "필지 경계 없음"}
          />
        </div>
      </section>

      <Stage1ReadingGuide
        hasBuilding={Boolean(main)}
        buildingAgeYears={ageYears}
        acquiredPriceManwon={parcel.acquiredPrice}
        maxBCR={parcel.maxBCR}
        maxFAR={parcel.maxFAR}
        missingCount={dataReadiness?.missingCount ?? 0}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
          gap: "var(--s5)",
          alignItems: "start",
        }}
      >
        <Panel title="① 토지 기본 정보" source="V월드 · 공시지가 · 건축물대장">
          <DataRow label="주소" value={parcel.address} />
          {parcel.addressRoad && <DataRow label="도로명 주소" value={parcel.addressRoad} />}
          <DataRow
            label="대지면적"
            value={`${num(parcel.lotArea, 2)} m² (${pyeong(parcel.lotArea)})`}
          />
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
                label={farDecisionGrade && bcrDecisionGrade ? "확인 상한 여유" : "참고 상한 여유"}
                value={`건폐 ${bcrHeadroom?.toFixed(1)}%p · 용적 ${farHeadroom?.toFixed(1)}%p`}
                sub={
                  farDecisionGrade && bcrDecisionGrade
                    ? "원문 확인 상한 대비 · 실제 신축 가능량은 Stage 2 검토"
                    : "전국 상한 참고 대비 · 필지별 법정 여유로 확정하지 않음"
                }
              />
            </>
          ) : (
            <>
              <DataRow
                label={bcrDecisionGrade ? "건폐율 확인 상한" : "건폐율 전국 상한 참고"}
                value={`${parcel.maxBCR}%`}
                sub="기존 건물 비율 미확인"
              />
              <DataRow
                label={farDecisionGrade ? "용적률 확인 상한" : "용적률 전국 상한 참고"}
                value={`${parcel.maxFAR}%`}
                sub="기존 건물 비율 미확인"
              />
            </>
          )}
          <DataRow
            label="공시지가"
            value={`${num(parcel.landPrice / 10_000)}만/m²`}
            sub="V월드 개별공시지가"
          />
          <DataRow
            label="도로 데이터"
            value={parcel.roads && parcel.roads.length > 0 ? `${parcel.roads.length}개 중심선` : "추가 확인 필요"}
            sub="도로 폭은 현재 데이터에 포함되지 않음"
          />
        </Panel>

        <Panel title="② 기존 건축물" source="MOLIT 건축물대장">
          {main ? (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  paddingBottom: 14,
                  marginBottom: 4,
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <strong style={{ fontSize: 28, letterSpacing: "-0.03em" }}>
                  {ageYears ?? "—"}년
                </strong>
                <span style={{ fontSize: 12, color: "var(--fg-subtle)" }}>현재 건물 연령</span>
              </div>
              {main.name && <DataRow label="건물명" value={main.name} />}
              <DataRow label="사용승인" value={formatApprovalDate(main.approvalDate, ageYears)} />
              <DataRow label="용도" value={purpose} />
              <DataRow
                label="층수"
                value={`지상 ${main.groundFloors}층${
                  main.undergroundFloors > 0 ? ` / 지하 ${main.undergroundFloors}층` : ""
                }`}
              />
              <DataRow label="건축면적" value={`${num(main.buildingArea, 2)} m²`} />
              <DataRow label="연면적" value={`${num(main.totalArea, 2)} m²`} />
              {main.height > 0 && <DataRow label="높이" value={`${num(main.height, 2)} m`} />}
              {ratios && (
                <DataRow
                  label="미건축 대지"
                  value={`${num(ratios.unbuiltLotSqm, 2)} m² (${ratios.unbuiltLotPct.toFixed(1)}%)`}
                  sub="대지면적 − 기존 건축면적"
                />
              )}
              <DataRow label="세대·가구" value={formatExistingUnits(currentBuilding)} />
              <DataRow label="구조" value={main.structure || "건축물대장 미제공"} />
              <DataRow
                label="예상 철거비"
                value={
                  parcel.demolitionCost && parcel.demolitionCost > 0
                    ? won(parcel.demolitionCost, { full: true })
                    : "개략값 없음"
                }
                sub="건축물대장 연면적 × 구조별 단가 · 견적 아님"
              />
              <DataRow label="기존 주차대수" value="추가 조회 필요" sub="표제부 외 추가 API 필요" />
              <DataRow label="승강기·지붕" value="추가 조회 필요" sub="층별개요·설비 데이터 미연동" />
              <DataRow label="위반건축물 여부" value="추가 확인 필요" sub="현재 API 응답에 포함되지 않음" />
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
              건축물대장에 등록된 건축물이 없습니다. 실제 빈 토지 여부는 현장 확인이 필요합니다.
            </p>
          )}
        </Panel>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.25fr) minmax(300px, 0.75fr)",
          gap: "var(--s5)",
          marginTop: "var(--s5)",
          alignItems: "start",
        }}
      >
        <Panel title="③ 기존 건물 개략 매스" source="건축물대장 면적·층수 기반 · 실제 배치도 아님">
          <ExistingBuildingMass
            boundary={parcel.boundary}
            currentBuilding={currentBuilding}
            lotArea={parcel.lotArea}
            height={390}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              marginTop: 10,
              fontSize: 11.5,
              color: "var(--fg-faint)",
            }}
          >
            <span>드래그로 회전 · 휠로 확대</span>
            <span>형상 정확도: 개략 · 면적·층수: 건축물대장</span>
          </div>
        </Panel>

        <Panel title="④ 현재 상태 해석" source="규칙 기반 · 사실과 검토 항목 분리">
          <DiagnosticGroup title="현황 해석" items={observations} />
          <DiagnosticGroup title="다음 단계 확인" items={checks} style={{ marginTop: 18 }} />

          {currentBuilding?.signalLabel && (
            <div
              style={{
                marginTop: 18,
                padding: "12px 13px",
                background: "var(--bg-sunken)",
                borderRadius: 8,
                fontSize: 12.5,
                border: "1px solid var(--border)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 650 }}>
                <Dot kind={signalDot(currentBuilding)} />
                {signalTitle(currentBuilding)}
              </div>
              <div style={{ marginTop: 6, color: "var(--fg-muted)", lineHeight: 1.55 }}>
                {signalDescription(currentBuilding)}
              </div>
            </div>
          )}

          <div
            style={{
              marginTop: 18,
              paddingTop: 14,
              borderTop: "1px solid var(--border)",
              fontSize: 11.5,
              lineHeight: 1.6,
              color: "var(--fg-faint)",
            }}
          >
            Stage 1은 현재 상태를 설명합니다. 신축 가능 층수·세대수·주차 배치는 Stage 2에서 계산합니다.
          </div>
        </Panel>
      </div>

      {roadInsight && (
        <div style={{ marginTop: "var(--s5)" }}>
          <RoadOrientationPanel insight={roadInsight} />
        </div>
      )}

      <Panel
        title="⑥ 지도와 주변 시장"
        source="Kakao Map · MOLIT 실거래"
        style={{ marginTop: "var(--s5)" }}
      >
        {marketInsight && <MarketSnapshotPanel insight={marketInsight} />}

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          <LayerChip
            label="대상지"
            active={layers.subject}
            onClick={() => setLayers((l) => ({ ...l, subject: !l.subject }))}
          />
          <LayerChip
            label={`수집 실거래 (${allComps.length})`}
            active={layers.comps}
            onClick={() => setLayers((l) => ({ ...l, comps: !l.comps }))}
            hint={`지도 실제 표시 ${compMarkers.length}건`}
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
              setLayers((l) => ({ ...l, newBuilds: !l.newBuilds, comps: true }))
            }
            hint={`${NEW_BUILD_CUTOFF_YEAR}년 이후 준공`}
          />
        </div>

        {parcel.lat != null && parcel.lng != null ? (
          <KakaoMap
            centerLat={parcel.lat}
            centerLng={parcel.lng}
            showRoads
            roads={parcel.roads}
            boundary={parcel.boundary}
            focusSubject
            zoomLevel={4}
            maxZoomOutLevel={4}
            nearbyRadiusM={700}
            subjectLabel={layers.subject ? parcel.address.split(" ").slice(-2).join(" ") : undefined}
            subjectPPP={subjectPPP}
            comps={layers.comps ? compMarkers : []}
            stations={layers.stations ? stations : []}
            height={500}
          />
        ) : (
          <p style={{ fontSize: 13, color: "var(--fg-muted)" }}>
            좌표 정보가 없어 지도를 표시할 수 없습니다.
          </p>
        )}
        <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "var(--fg-faint)" }}>
          초기 화면은 대상지 중심 약 700m 범위를 유지해 주변 블록과 도로를 읽을 수 있게 합니다. 우측 +/−로 확대·축소하고 ◎으로 다시 맞출 수 있습니다. 실거래 위치는 동 단위 근사이며 중앙값은 참고값입니다.
        </p>
      </Panel>

      {dataReadiness && (
        <div style={{ marginTop: "var(--s5)" }}>
          <DataReadinessPanel insight={dataReadiness} />
        </div>
      )}

      <div style={{ marginTop: "var(--s5)" }}>
        <ExistingReviewPanel options={reviewOptions} />
      </div>

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
            계획 스튜디오에서 가능 규모 검토 →
          </Button>
        </Link>
      </div>
    </div>
  );
}

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: BadgeTone;
}) {
  const styles: Record<BadgeTone, { background: string; color: string; border: string }> = {
    neutral: {
      background: "var(--bg-sunken)",
      color: "var(--fg-muted)",
      border: "var(--border)",
    },
    positive: {
      background: "var(--pos-soft)",
      color: "var(--pos-fg)",
      border: "var(--pos)",
    },
    warning: {
      background: "var(--warn-soft)",
      color: "var(--warn-fg)",
      border: "var(--warn)",
    },
    negative: {
      background: "var(--neg-soft)",
      color: "var(--neg-fg)",
      border: "var(--neg)",
    },
  };
  const s = styles[tone];
  return (
    <span
      style={{
        padding: "5px 9px",
        borderRadius: 999,
        background: s.background,
        color: s.color,
        border: `1px solid ${s.border}`,
        fontSize: 11.5,
        fontWeight: 600,
      }}
    >
      {label}
    </span>
  );
}

function Stage1ReadingGuide({
  hasBuilding,
  buildingAgeYears,
  acquiredPriceManwon,
  maxBCR,
  maxFAR,
  missingCount,
}: {
  hasBuilding: boolean;
  buildingAgeYears: number | null;
  acquiredPriceManwon: number;
  maxBCR: number;
  maxFAR: number;
  missingCount: number;
}) {
  const acquisitionLabel =
    acquiredPriceManwon > 0 ? won(acquiredPriceManwon, { full: true }) : "아직 입력하지 않음";
  const buildingLabel = hasBuilding
    ? `건축물대장상 기존 건물 있음${buildingAgeYears != null ? ` · 약 ${buildingAgeYears}년 경과` : ""}`
    : "건축물대장상 등록 건물 없음";

  return (
    <section
      style={{
        marginBottom: "var(--s5)",
        padding: "18px 20px",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-lg)",
        background: "var(--bg-elev)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <div>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 800,
              letterSpacing: "0.08em",
              color: "var(--fg-subtle)",
            }}
          >
            HOW TO READ
          </div>
          <h2 style={{ margin: "5px 0 0", fontSize: 17 }}>처음 보는 분은 이렇게 읽으세요</h2>
        </div>
        <span
          style={{
            alignSelf: "center",
            padding: "5px 9px",
            borderRadius: 999,
            background: "var(--bg-sunken)",
            color: "var(--fg-muted)",
            fontSize: 10.5,
            fontWeight: 650,
          }}
        >
          Stage 1은 현재 상태 확인 단계
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 10,
          marginTop: 15,
        }}
      >
        <ReadingCard
          step="1"
          title="지금 확인된 것"
          body={`${buildingLabel}. 총 취득대금은 사용자가 입력한 ${acquisitionLabel}을 사용합니다.`}
        />
        <ReadingCard
          step="2"
          title="아직 확정하지 않는 것"
          body={`건폐율 ${maxBCR}%·용적률 ${maxFAR}%는 전국 시행령 참고 상한입니다. 필지별 원문 확인 전에는 법정 상한으로 확정하지 않으며 실제 층수·면적·주차 가능 대수를 뜻하지 않습니다.`}
        />
        <ReadingCard
          step="3"
          title="다음에 할 일"
          body={
            missingCount > 0
              ? `추가 확인 항목 ${missingCount}개를 확인하고 Stage 2에서 실제 배치 가능 규모를 비교합니다.`
              : "확보된 현황을 기준으로 Stage 2에서 실제 배치 가능 규모를 비교합니다."
          }
        />
      </div>

      <details
        style={{
          marginTop: 12,
          borderTop: "1px solid var(--border)",
          paddingTop: 12,
          color: "var(--fg-muted)",
        }}
      >
        <summary style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 700 }}>
          자주 나오는 용어 뜻 보기
        </summary>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: 8,
            marginTop: 10,
          }}
        >
          <TermCard term="건폐율" meaning="대지 중 1층 건축면적이 차지하는 비율입니다." />
          <TermCard term="용적률" meaning="대지 대비 지상층 바닥면적 합계의 비율입니다." />
          <TermCard term="공시지가" meaning="세금·행정용 토지가격 기준이며 실제 매매가격이 아닙니다." />
          <TermCard term="예상 철거비" meaning="대장 면적과 구조별 단가로 계산한 개략값이며 업체 견적이 아닙니다." />
        </div>
      </details>
    </section>
  );
}

function ReadingCard({ step, title, body }: { step: string; title: string; body: string }) {
  return (
    <article
      style={{
        minHeight: 118,
        padding: "13px 14px",
        border: "1px solid var(--border)",
        borderRadius: 9,
        background: "var(--bg-sunken)",
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 800, color: "var(--fg-faint)" }}>STEP {step}</div>
      <h3 style={{ margin: "6px 0 0", fontSize: 13.5 }}>{title}</h3>
      <p style={{ margin: "7px 0 0", fontSize: 11.5, lineHeight: 1.6, color: "var(--fg-muted)" }}>
        {body}
      </p>
    </article>
  );
}

function TermCard({ term, meaning }: { term: string; meaning: string }) {
  return (
    <div
      style={{
        padding: "10px 11px",
        borderRadius: 8,
        background: "var(--bg-sunken)",
        fontSize: 11,
        lineHeight: 1.5,
      }}
    >
      <strong style={{ display: "block", color: "var(--fg)", marginBottom: 3 }}>{term}</strong>
      {meaning}
    </div>
  );
}

function OverviewMetric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div style={{ padding: "13px 14px", background: "var(--bg-elev)", minHeight: 76 }}>
      <div style={{ fontSize: 10.5, color: "var(--fg-subtle)", marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: "var(--fg-faint)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function DiagnosticGroup({
  title,
  items,
  style,
}: {
  title: string;
  items: ReturnType<typeof buildStatusSummary>;
  style?: React.CSSProperties;
}) {
  return (
    <div style={style}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.04em",
          color: "var(--fg-subtle)",
          marginBottom: 9,
        }}
      >
        {title}
      </div>
      <div style={{ display: "grid", gap: 9 }}>
        {items.map((item, i) => (
          <div key={`${item.text}-${i}`} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: TONE_COLOR[item.tone],
                marginTop: 7,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 13,
                lineHeight: 1.6,
                color: item.tone === "neutral" ? "var(--fg-muted)" : TONE_COLOR[item.tone],
              }}
            >
              {item.text}
            </span>
          </div>
        ))}
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

function formatApprovalDate(date: string, ageYears: number | null): string {
  if (!date) return ageYears != null ? `${ageYears}년 경과 · 승인일 미제공` : "건축물대장 미제공";
  const year = date.slice(0, 4);
  const month = date.slice(5, 7);
  return `${year}년${month ? ` ${month}월` : ""}${ageYears != null ? ` (${ageYears}년 경과)` : ""}`;
}

function signalTitle(info: BuildingLookupResult): string {
  if (info.redevelopmentSignal === "rebuild") return "노후도 기준 재건축 검토";
  if (info.redevelopmentSignal === "renovate") return "유지·리모델링·신축 비교";
  if (info.redevelopmentSignal === "vacant") return "등록 건물 없음";
  return "기존 건물 유지 검토";
}

function signalDescription(info: BuildingLookupResult): string {
  if (info.redevelopmentSignal === "rebuild") {
    return "노후도 신호는 철거 후 신축을 검토할 근거 중 하나입니다. 최종 판단은 구조 상태·철거비·신축 가능 규모·사업성을 함께 비교해야 합니다.";
  }
  if (info.redevelopmentSignal === "renovate") {
    return "노후도만으로 한 방향을 확정하지 않습니다. 유지보수 비용과 신축 시 확보 가능한 규모를 비교해야 합니다.";
  }
  if (info.redevelopmentSignal === "vacant") {
    return "건축물대장상 등록 건물이 없습니다. 실제 현황과 멸실 신고 여부를 추가로 확인해야 합니다.";
  }
  return "비교적 최근 건물로 분류됩니다. 철거보다 기존 가치와 유지 비용을 먼저 검토하는 구간입니다.";
}

function signalDot(info: BuildingLookupResult): "pos" | "warn" | "neg" {
  if (info.redevelopmentSignal === "rebuild") return "neg";
  if (info.redevelopmentSignal === "renovate") return "warn";
  return "pos";
}
