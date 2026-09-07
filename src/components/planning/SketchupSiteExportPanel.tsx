"use client";

import { useEffect, useMemo, useState } from "react";
import { Panel } from "@/components/ui/primitives";
import { defaultAssumptions } from "@/lib/finance/scenario";
import { getExistingBuildingGeometry } from "@/lib/geo/existing-building-geometry";
import {
  buildCadastralContext,
  type CadastralParcelFeature,
} from "@/lib/geo/cadastral-context";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import { buildPlanningParkingGeometry } from "@/lib/planning/planning-parking-geometry";
import {
  calculatePlanningScenario,
  planningEconomicsAssumptionsFromLegacy,
} from "@/lib/planning/scenario-calculator";
import { buildSketchupExportPackage } from "@/lib/planning/sketchup-export-package";
import { buildSiteDeliveryAudit } from "@/lib/planning/site-delivery-audit";
import { downloadPlanningCadPackage } from "@/lib/planning/planning-cad-export";
import { downloadSketchupSiteDeliveryExport } from "@/lib/planning/sketchup-site-delivery-export";
import { useProjectStore } from "@/lib/stores/project-store";
import { num } from "@/lib/utils/format";

interface ApiResponse {
  parcels?: CadastralParcelFeature[];
  sourceSummary?: {
    activeRoadBoundarySource:
      | "cadastral-road-parcel"
      | "upis-road-boundary"
      | "centerline-reference-only";
    upisDataCode: string;
  };
  error?: string;
}

type LoadState = "idle" | "loading" | "ready" | "error";
type Feedback = { tone: "success" | "fail"; text: string };

const cell = {
  padding: "8px 9px",
  borderBottom: "1px solid var(--border)",
  textAlign: "left" as const,
};

const CHECK_TONE = {
  pass: {
    label: "통과",
    background: "var(--pos-soft)",
    color: "var(--pos-fg)",
  },
  review: {
    label: "확인",
    background: "var(--warn-soft)",
    color: "var(--warn-fg)",
  },
  fail: {
    label: "차단",
    background: "var(--neg-soft)",
    color: "var(--neg-fg)",
  },
} as const;

export function SketchupSiteExportPanel({ projectId }: { projectId: string }) {
  const data = useProjectStore((state) => state.data);
  const scenarios = useProjectStore((state) => state.planningScenarios);
  const selectedId = useProjectStore((state) => state.selectedPlanningScenarioId);
  const representativeGeometry = useProjectStore(
    (state) => state.representativeGeometrySnapshot
  );

  const [parcels, setParcels] = useState<CadastralParcelFeature[]>([]);
  const [sourceSummary, setSourceSummary] = useState<ApiResponse["sourceSummary"]>();
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [message, setMessage] = useState<Feedback | null>(null);

  const parcel = data?.parcel;
  const targetBoundary = parcel?.boundary;
  const scenario =
    scenarios.find(
      (candidate) => candidate.id === selectedId && candidate.projectId === projectId
    ) ??
    scenarios.find((candidate) => candidate.projectId === projectId) ??
    null;
  const targetPnu = parcel
    ? ((parcel as typeof parcel & { pnu?: string }).pnu ?? parcel.id)
    : "";
  const manualParcel = parcel?.inputProvenance?.mode === "manual";

  useEffect(() => {
    if (
      !parcel ||
      manualParcel ||
      !targetPnu ||
      !Number.isFinite(parcel.lat) ||
      !Number.isFinite(parcel.lng)
    ) {
      setParcels([]);
      setSourceSummary(undefined);
      setLoadState("idle");
      setMessage(null);
      return;
    }

    const controller = new AbortController();
    setLoadState("loading");
    setMessage(null);

    fetch("/api/parcels/cadastral-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetPnu,
        lat: parcel.lat,
        lng: parcel.lng,
        radiusM: 100,
      }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as ApiResponse;
        if (!response.ok) {
          throw new Error(payload.error ?? `도로 경계 조회 실패 (${response.status})`);
        }
        return payload;
      })
      .then((payload) => {
        setParcels(payload.parcels ?? []);
        setSourceSummary(payload.sourceSummary);
        setLoadState("ready");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setParcels([]);
        setSourceSummary(undefined);
        setLoadState("error");
        setMessage({
          tone: "fail",
          text: error instanceof Error ? error.message : "도로 경계 조회 실패",
        });
      });

    return () => controller.abort();
  }, [manualParcel, parcel, targetPnu]);

  const packageData = useMemo(() => {
    if (!scenario || !parcel || !targetBoundary || targetBoundary.length < 3 || !targetPnu) {
      return null;
    }

    const planning = buildPlanningGeometry({
      projectId,
      scenario,
      boundary: targetBoundary,
      lotAreaSqm: parcel.lotArea,
      zoning: parcel.zoning ?? "",
      roads: parcel.roads,
      setback: parcel.setback,
    }).snapshot;
    const legacyAssumptions =
      data?.scenarios.find((candidate) => candidate.recommended)?._raw
        .assumptions ??
      data?.scenarios[0]?._raw.assumptions ??
      defaultAssumptions();
    const calculation = calculatePlanningScenario(scenario, {
      parcel: {
        lotAreaSqm: parcel.lotArea,
        maxFARPct: parcel.maxFAR,
        maxBCRPct: parcel.maxBCR,
        heightLimitM: parcel.heightLimit ?? 0,
        regulatoryConstraints: parcel.regulatoryConstraints,
        roofAllowanceM: 1.4,
        acquisitionCostManwon: parcel.acquiredPrice,
        demolitionCostManwon: parcel.demolitionCost ?? 0,
      },
      assumptions: planningEconomicsAssumptionsFromLegacy(
        legacyAssumptions,
        `stage2-${data?.meta.version ?? "local"}`
      ),
      calculatedAt: data?.meta.lastSyncedAt,
    });
    const parking = buildPlanningParkingGeometry({
      scenario,
      planning,
      requiredCars: calculation.parking.requiredCars,
      boundary: targetBoundary,
      roads: parcel.roads,
    });
    const basePackage = buildSketchupExportPackage({
      planning,
      parking,
      existingGeometry: getExistingBuildingGeometry(parcel.currentBuilding),
    });
    const cadastral = buildCadastralContext({
      planning,
      targetPnu,
      parcels,
    });
    const audit = buildSiteDeliveryAudit({
      planning,
      context: basePackage.context,
      cadastral,
    });

    return { planning, parking, basePackage, cadastral, audit };
  }, [data, parcel, parcels, projectId, scenario, targetBoundary, targetPnu]);

  if (!parcel || !targetBoundary || !scenario || !packageData) return null;

  const { planning, parking, basePackage, cadastral, audit } = packageData;
  const locked =
    representativeGeometry?.scenarioId === planning.scenarioId &&
    representativeGeometry?.geometryHash === planning.geometryHash;
  const canDownload =
    audit.exportable &&
    basePackage.validation.exportable &&
    locked &&
    loadState === "ready" &&
    parcels.length > 0;
  const primary = cadastral.frontages[0] ?? null;
  const sourceLabel =
    sourceSummary?.activeRoadBoundarySource === "cadastral-road-parcel"
      ? "연속지적 도로 필지"
      : sourceSummary?.activeRoadBoundarySource === "upis-road-boundary"
        ? "VWorld 도시계획 도로 경계"
        : "도로 중심선 참고";
  const upisCount = cadastral.roadParcels.filter(
    (road) => road.jimokCode === "UPIS-UQ151"
  ).length;
  const cadastralRoadCount = cadastral.roadParcels.length - upisCount;
  const widthSampleCount = cadastral.frontages.reduce(
    (sum, frontage) => sum + frontage.widthSamples.length,
    0
  );

  const handleDownload = () => {
    setMessage(null);
    if (!audit.exportable || !basePackage.validation.exportable) {
      setMessage({
        tone: "fail",
        text:
          audit.checks.find((check) => check.status === "fail")?.message ??
          basePackage.validation.blockingReasons[0] ??
          "계획 매스 Geometry Contract를 먼저 수정하세요.",
      });
      return;
    }
    if (!locked) {
      setMessage({
        tone: "fail",
        text: "대표 계획안을 확정해 Geometry Snapshot을 잠근 뒤 다운로드하세요.",
      });
      return;
    }
    if (loadState !== "ready" || parcels.length === 0) {
      setMessage({ tone: "fail", text: "지적·도로 경계 조회가 끝난 뒤 다운로드하세요." });
      return;
    }

    try {
      const result = downloadSketchupSiteDeliveryExport({
        basePackage,
        cadastral,
        targetBoundary,
        sourceParcels: parcels,
      });
      setMessage({
        tone: "success",
        text: `${result.filename} 다운로드를 시작했습니다. SketchUp에서는 ${result.preferredImportFilename} 파일 하나를 먼저 가져오세요.`,
      });
    } catch (error) {
      setMessage({
        tone: "fail",
        text:
          error instanceof Error
            ? error.message
            : "통합 SketchUp 패키지 생성 중 오류가 발생했습니다.",
      });
    }
  };

  const handleCadDownload = () => {
    setMessage(null);
    if (!audit.exportable || !basePackage.validation.exportable) {
      setMessage({
        tone: "fail",
        text:
          audit.checks.find((check) => check.status === "fail")?.message ??
          basePackage.validation.blockingReasons[0] ??
          "계획 매스 Geometry Contract를 먼저 수정하세요.",
      });
      return;
    }
    if (!locked) {
      setMessage({
        tone: "fail",
        text: "대표 계획안을 확정해 Geometry Snapshot을 잠근 뒤 다운로드하세요.",
      });
      return;
    }
    if (loadState !== "ready" || parcels.length === 0) {
      setMessage({ tone: "fail", text: "지적·도로 경계 조회가 끝난 뒤 다운로드하세요." });
      return;
    }

    try {
      const result = downloadPlanningCadPackage({
        basePackage,
        cadastral,
        targetBoundary,
        sourceParcels: parcels,
      });
      setMessage({
        tone: "success",
        text: `${result.filename} 다운로드를 시작했습니다. CAD에서는 ${result.dxfFilename} 파일을 열고 단위를 meter로 확인하세요.`,
      });
    } catch (error) {
      setMessage({
        tone: "fail",
        text:
          error instanceof Error
            ? error.message
            : "CAD 설계 기준 패키지 생성 중 오류가 발생했습니다.",
      });
    }
  };

  const rows: Array<[string, number, string]> = [
    ["PG_PARCEL", 1, "대상 필지 경계"],
    ["PG_PROPOSED_MASS", planning.building.floors.length, "검증된 계획 매스"],
    ["PG_PARKING_STALLS", parking.layout.stalls.length, "실제 주차면"],
    [
      "PG_PARKING_AISLE",
      parking.layout.aisleShape.length >= 3 ? 1 : 0,
      "차량 통로 외곽",
    ],
    [
      "PG_PARKING_CORE",
      parking.layout.coreShape.length >= 3 ? 1 : 0,
      "필로티 주차 불가 코어",
    ],
    [
      "PG_PARKING_COLUMNS_REFERENCE",
      parking.layout.columns.length,
      "구조설계 전 기둥 참고점",
    ],
    [
      "PG_PARKING_ACCESS_REFERENCE",
      parking.layout.entryPath.length >= 2 ? 1 : 0,
      "차량 진입 참고선",
    ],
    [
      "PG_CONTEXT_BUILDINGS_VERIFIED",
      basePackage.context.summary.verifiedHeightBuildings,
      "등록 높이 주변 건물",
    ],
    [
      "PG_CONTEXT_BUILDINGS_ESTIMATED",
      basePackage.context.summary.estimatedHeightBuildings,
      "추정 높이 주변 건물",
    ],
    ["PG_ADJACENT_PARCELS", cadastral.adjacentParcels.length, "인접 지적 필지선"],
    ["PG_ROAD_PARCELS_CADASTRAL", cadastralRoadCount, "연속지적 도로 필지"],
    ["PG_ROAD_BOUNDARY_UPIS", upisCount, "VWorld 도시계획 도로 경계"],
    ["PG_ROAD_CENTERLINE_REFERENCE", planning.roads.length, "도로명·방향 참고선"],
    ["PG_FRONTAGE", cadastral.frontages.length, "대상 필지 접도선"],
    ["PG_ROAD_WIDTH_SAMPLES", widthSampleCount, "도로 폭 수직 샘플"],
    ["PG_NORTH", 1, "정북 방향"],
  ];

  const auditTone = CHECK_TONE[audit.status];

  return (
    <Panel
      title="설계 파일 내보내기"
      source="SketchUp DAE · CAD DXF · WGS84 GeoJSON"
      bodyStyle={{ padding: "var(--s5)" }}
    >
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        <span
          style={{
            padding: "4px 8px",
            borderRadius: 999,
            background: auditTone.background,
            color: auditTone.color,
            fontSize: 10.5,
            fontWeight: 750,
          }}
        >
          설계 전달 {auditTone.label}
        </span>
        <span className="ui-tag">{canDownload ? "통합 Export 가능" : "Export 준비 중"}</span>
        <span className="ui-tag">활성 도로: {sourceLabel}</span>
        <span className="ui-tag">도로 경계 {cadastral.roadParcels.length}개</span>
        <span className="ui-tag">주변 건물 {basePackage.context.summary.totalBuildings}동</span>
        {locked && <span className="ui-tag">대표 계획 매스 잠김</span>}
        <span className="ui-tag">
          주차 {parking.layout.capacityCars}대 · {parking.parkingGeometryHash}
        </span>
      </div>

      <p
        style={{
          margin: "8px 0 0",
          fontSize: 11,
          lineHeight: 1.55,
          color: "var(--fg-muted)",
        }}
      >
        SketchUp 패키지는 계획 매스·실제 주차면·차량 통로·주변 건물·필지·도로를
        동일 원점의 DAE로 제공합니다. CAD 패키지는 잠긴 대표안의
        <strong> 층별 실제 외곽선과 같은 주차 배치</strong>를 AutoCAD R2000 DXF
        레이어로 분리합니다. 화면·SketchUp·CAD는 같은 Parking Geometry Hash와
        로컬 meter 좌표를 사용합니다.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 8,
          marginTop: 14,
        }}
      >
        <Metric
          label="실제 주차 배치"
          value={`${parking.layout.capacityCars}대 / 요구 ${parking.layout.requiredCars}대`}
          sub={parking.parkingGeometryHash}
        />
        <Metric
          label="도로 경계 출처"
          value={sourceLabel}
          sub={sourceSummary?.upisDataCode ?? "VWorld"}
        />
        <Metric
          label="도로 폭 · 최소"
          value={primary?.widthMinM == null ? "미확인" : `${num(primary.widthMinM, 2)}m`}
          sub="접도부 수직 샘플"
        />
        <Metric
          label="도로 폭 · 평균"
          value={primary?.widthAvgM == null ? "미확인" : `${num(primary.widthAvgM, 2)}m`}
          sub={primary ? `${primary.widthSamples.length}개 단면` : "경계 매칭 필요"}
        />
        <Metric
          label="도로 폭 · 최대"
          value={primary?.widthMaxM == null ? "미확인" : `${num(primary.widthMaxM, 2)}m`}
          sub="비정형 폭 범위"
        />
        <Metric
          label="접도 길이"
          value={primary ? `${num(primary.frontageLengthM, 2)}m` : "미확인"}
          sub={primary ? `경계 간격 ${num(primary.boundaryGapM, 3)}m` : "접도면 미확인"}
        />
      </div>

      {loadState === "loading" && <Notice>지적·UPIS 도로 경계를 조회하고 있습니다.</Notice>}
      {manualParcel && (
        <Notice tone="fail">
          사용자 GeoJSON은 계획 검토에 사용할 수 있지만 측량·지적 원문은 아닙니다.
          VWorld 지적·도로 경계를 확인하기 전에는 설계 전달 패키지를 내보낼 수 없습니다.
        </Notice>
      )}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <div
        style={{
          marginTop: 14,
          border: "1px solid var(--border)",
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid var(--border)",
            fontSize: 11.5,
            fontWeight: 760,
          }}
        >
          설계 전달 준비 체크
        </div>
        <div style={{ display: "grid" }}>
          {audit.checks.map((check) => {
            const tone = CHECK_TONE[check.status];
            return (
              <div
                key={check.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "70px minmax(125px, 180px) 1fr",
                  gap: 10,
                  alignItems: "center",
                  padding: "9px 12px",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 10.5,
                }}
              >
                <span
                  style={{
                    justifySelf: "start",
                    padding: "3px 7px",
                    borderRadius: 999,
                    background: tone.background,
                    color: tone.color,
                    fontWeight: 750,
                  }}
                >
                  {tone.label}
                </span>
                <strong>{check.label}</strong>
                <span style={{ color: "var(--fg-muted)", lineHeight: 1.45 }}>
                  {check.message}
                </span>
              </div>
            );
          })}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "70px minmax(125px, 180px) 1fr",
              gap: 10,
              alignItems: "center",
              padding: "9px 12px",
              fontSize: 10.5,
            }}
          >
            <span
              style={{
                justifySelf: "start",
                padding: "3px 7px",
                borderRadius: 999,
                background: locked ? "var(--pos-soft)" : "var(--warn-soft)",
                color: locked ? "var(--pos-fg)" : "var(--warn-fg)",
                fontWeight: 750,
              }}
            >
              {locked ? "통과" : "확인"}
            </span>
            <strong>대표안 잠금</strong>
            <span style={{ color: "var(--fg-muted)" }}>
              {locked
                ? `대표 Geometry Snapshot ${planning.geometryHash}과 일치합니다.`
                : "현재 계획안을 대표안으로 확정해야 다운로드할 수 있습니다."}
            </span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5 }}>
          <thead>
            <tr style={{ color: "var(--fg-muted)" }}>
              <th style={cell}>공통 설계 레이어</th>
              <th style={cell}>객체 수</th>
              <th style={cell}>용도</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, count, purpose]) => (
              <tr key={name}>
                <td style={cell}>
                  <code>{name}</code>
                </td>
                <td style={cell}>{count}</td>
                <td style={cell}>{purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div
        style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: "1px solid var(--border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 10.5, color: "var(--fg-muted)", maxWidth: 850 }}>
          UPIS 도로 경계는 개략설계용 도시계획 도형이며 현황측량을 대체하지 않습니다.
          확인 항목은 metadata와 README에도 기록됩니다.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={!canDownload}
            onClick={handleCadDownload}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "9px 12px",
              background: canDownload ? "var(--bg-elev)" : "var(--bg-sunken)",
              color: canDownload ? "var(--fg)" : "var(--fg-faint)",
              fontSize: 10.5,
              fontWeight: 750,
              cursor: canDownload ? "pointer" : "not-allowed",
            }}
          >
            {canDownload ? "CAD 설계 기준 패키지 다운로드 (DXF)" : "대표안·도로 경계 확인 필요"}
          </button>
          <button
            type="button"
            disabled={!canDownload}
            onClick={handleDownload}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "9px 12px",
              background: canDownload ? "var(--fg)" : "var(--bg-sunken)",
              color: canDownload ? "var(--bg)" : "var(--fg-faint)",
              fontSize: 10.5,
              fontWeight: 750,
              cursor: canDownload ? "pointer" : "not-allowed",
            }}
          >
            {canDownload ? "SketchUp 설계 전달 패키지 다운로드" : "대표안·도로 경계 확인 필요"}
          </button>
        </div>
      </div>
    </Panel>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div style={{ padding: 11, border: "1px solid var(--border)", borderRadius: 9 }}>
      <div style={{ fontSize: 9.5, color: "var(--fg-faint)" }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 15, fontWeight: 780 }}>{value}</div>
      <div style={{ marginTop: 3, fontSize: 9.5, color: "var(--fg-muted)" }}>{sub}</div>
    </div>
  );
}

function Notice({
  children,
  tone = "success",
}: {
  children: React.ReactNode;
  tone?: "success" | "fail";
}) {
  return (
    <div
      style={{
        marginTop: 12,
        padding: "9px 11px",
        borderRadius: 8,
        background: tone === "fail" ? "var(--neg-soft)" : "var(--pos-soft)",
        color: tone === "fail" ? "var(--neg-fg)" : "var(--pos-fg)",
        fontSize: 10.5,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}
