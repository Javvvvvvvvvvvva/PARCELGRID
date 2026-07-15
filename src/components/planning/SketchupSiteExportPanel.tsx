"use client";

import { useEffect, useMemo, useState } from "react";
import { Panel } from "@/components/ui/primitives";
import { getExistingBuildingGeometry } from "@/lib/geo/existing-building-geometry";
import {
  buildCadastralContext,
  type CadastralParcelFeature,
} from "@/lib/geo/cadastral-context";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import { buildSketchupExportPackage } from "@/lib/planning/sketchup-export-package";
import { downloadSketchupSiteExport } from "@/lib/planning/sketchup-site-export";
import { useProjectStore } from "@/lib/stores/project-store";
import { num } from "@/lib/utils/format";

interface ApiResponse {
  parcels: CadastralParcelFeature[];
  sourceSummary?: {
    cadastralParcelCount: number;
    cadastralRoadCount: number;
    upisRoadBoundaryCount: number;
    activeRoadBoundarySource:
      | "cadastral-road-parcel"
      | "upis-road-boundary"
      | "centerline-reference-only";
    upisDataCode: string;
  };
  error?: string;
}

type Feedback = { tone: "success" | "fail"; text: string };

type LoadState = "idle" | "loading" | "ready" | "error";

const cellStyle = {
  padding: "8px 9px",
  borderBottom: "1px solid var(--border)",
  textAlign: "left" as const,
  whiteSpace: "nowrap" as const,
};

export function SketchupSiteExportPanel({ projectId }: { projectId: string }) {
  const data = useProjectStore((state) => state.data);
  const planningScenarios = useProjectStore((state) => state.planningScenarios);
  const selectedPlanningScenarioId = useProjectStore(
    (state) => state.selectedPlanningScenarioId
  );
  const representativeGeometrySnapshot = useProjectStore(
    (state) => state.representativeGeometrySnapshot
  );
  const [sourceParcels, setSourceParcels] = useState<CadastralParcelFeature[]>([]);
  const [sourceSummary, setSourceSummary] = useState<ApiResponse["sourceSummary"]>();
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const parcel = data?.parcel;
  const scenario =
    planningScenarios.find(
      (candidate) =>
        candidate.id === selectedPlanningScenarioId && candidate.projectId === projectId
    ) ??
    planningScenarios.find((candidate) => candidate.projectId === projectId) ??
    null;
  const targetPnu = parcel
    ? ((parcel as typeof parcel & { pnu?: string }).pnu ?? parcel.id)
    : "";

  useEffect(() => {
    if (!parcel || !targetPnu || !Number.isFinite(parcel.lat) || !Number.isFinite(parcel.lng)) {
      setSourceParcels([]);
      setLoadState("idle");
      return;
    }
    const controller = new AbortController();
    setLoadState("loading");
    setLoadError(null);
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
        setSourceParcels(payload.parcels ?? []);
        setSourceSummary(payload.sourceSummary);
        setLoadState("ready");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setSourceParcels([]);
        setSourceSummary(undefined);
        setLoadState("error");
        setLoadError(error instanceof Error ? error.message : "도로 경계 조회 실패");
      });
    return () => controller.abort();
  }, [parcel, targetPnu]);

  const packageData = useMemo(() => {
    if (!scenario || !parcel?.boundary || parcel.boundary.length < 3 || !targetPnu) {
      return null;
    }
    const planning = buildPlanningGeometry({
      projectId,
      scenario,
      boundary: parcel.boundary,
      lotAreaSqm: parcel.lotArea,
      zoning: parcel.zoning ?? "",
      roads: parcel.roads,
      setback: parcel.setback,
    }).snapshot;
    const basePackage = buildSketchupExportPackage({
      planning,
      existingGeometry: getExistingBuildingGeometry(parcel.currentBuilding),
    });
    const cadastral = buildCadastralContext({
      planning,
      targetPnu,
      parcels: sourceParcels,
    });
    return { planning, basePackage, cadastral };
  }, [parcel, projectId, scenario, sourceParcels, targetPnu]);

  if (!parcel || !scenario || !packageData) return null;

  const { planning, basePackage, cadastral } = packageData;
  const planningLocked =
    representativeGeometrySnapshot?.scenarioId === planning.scenarioId &&
    representativeGeometrySnapshot?.geometryHash === planning.geometryHash;
  const hasRoadBoundary = cadastral.roadParcels.length > 0;
  const canDownload =
    basePackage.validation.exportable &&
    planningLocked &&
    loadState === "ready" &&
    sourceParcels.length > 0;
  const primary = cadastral.frontages[0] ?? null;
  const sourceLabel =
    sourceSummary?.activeRoadBoundarySource === "cadastral-road-parcel"
      ? "연속지적 도로 필지"
      : sourceSummary?.activeRoadBoundarySource === "upis-road-boundary"
        ? "VWorld 도시계획 도로 경계"
        : "도로 중심선만";

  const handleDownload = () => {
    setFeedback(null);
    if (!basePackage.validation.exportable) {
      setFeedback({
        tone: "fail",
        text:
          basePackage.validation.blockingReasons[0] ??
          "계획 매스 Geometry Contract 오류를 수정해야 합니다.",
      });
      return;
    }
    if (!planningLocked) {
      setFeedback({
        tone: "fail",
        text: "대표 계획안을 확정해 Geometry Snapshot을 잠근 뒤 다운로드하세요.",
      });
      return;
    }
    if (loadState !== "ready" || sourceParcels.length === 0) {
      setFeedback({
        tone: "fail",
        text: "지적·도로 경계 조회가 끝난 뒤 다운로드하세요.",
      });
      return;
    }
    try {
      const result = downloadSketchupSiteExport({
        basePackage,
        cadastral,
        targetBoundary: parcel.boundary,
        sourceParcels,
      });
      setFeedback({
        tone: "success",
        text: `${result.filename} 다운로드를 시작했습니다. ZIP의 model.dae와 site-context.dae를 같은 SketchUp 파일에 순서대로 가져오세요.`,
      });
    } catch (error) {
      setFeedback({
        tone: "fail",
        text:
          error instanceof Error
            ? error.message
            : "통합 SketchUp 패키지 생성 중 오류가 발생했습니다.",
      });
    }
  };

  const layers = [
    ["PG_PARCEL", 1, "대상 필지 경계"],
    ["PG_PROPOSED_MASS", planning.building.floors.length, "검증된 계획 매스"],
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
    [
      "PG_ADJACENT_PARCELS",
      cadastral.adjacentParcels.length,
      "인접 지적 필지선",
    ],
    [
      "PG_ROAD_PARCELS_CADASTRAL",
      cadastral.roadParcels.filter((road) => road.jimokCode !== "UPIS-UQ151").length,
      "연속지적 도로 필지",
    ],
    [
      "PG_ROAD_BOUNDARY_UPIS",
      cadastral.roadParcels.filter((road) => road.jimokCode === "UPIS-UQ151").length,
      "VWorld 도시계획 도로 경계",
    ],
    ["PG_ROAD_CENTERLINE_REFERENCE", planning.roads.length, "도로명·방향 참고선"],
    ["PG_FRONTAGE", cadastral.frontages.length, "대상 필지 접도선"],
    [
      "PG_ROAD_WIDTH_SAMPLES",
      cadastral.frontages.reduce((sum, frontage) => sum + frontage.widthSamples.length, 0),
      "최소·평균·최대 폭 산정 단면",
    ],
    ["PG_NORTH", 1, "정북 방향"],
  ] as const;

  return (
    <Panel
      title="SketchUp 통합 사이트 패키지"
      source="계획 매스·주변 건물·지적선·UPIS 도로 경계·DXF/GeoJSON"
      bodyStyle={{ padding: "var(--s5)" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            <span className="ui-tag">
              {canDownload ? "통합 Export 가능" : "Export 준비 중"}
            </span>
            <span className="ui-tag">활성 도로: {sourceLabel}</span>
            <span className="ui-tag">도로 경계 {cadastral.roadParcels.length}개</span>
            <span className="ui-tag">
              주변 건물 {basePackage.context.summary.totalBuildings}동
            </span>
            {planningLocked && <span className="ui-tag">대표 계획 매스 잠김</span>}
          </div>
          <p
            style={{
              maxWidth: 870,
              margin: "8px 0 0",
              fontSize: 11,
              lineHeight: 1.55,
              color: "var(--fg-muted)",
            }}
          >
            ZIP에는 계획·주변 건물 DAE, 도로·지적 컨텍스트 DAE, 2D DXF,
            WGS84 GeoJSON과 검증 metadata가 함께 들어갑니다. 두 DAE는 같은 meter 단위와
            원점을 사용하므로 SketchUp에 순서대로 가져오면 자동으로 겹칩니다.
          </p>
        </div>
        <div style={{ minWidth: 220, display: "grid", gap: 4, fontSize: 10 }}>
          <HashRow label="Planning" value={planning.geometryHash} />
          <HashRow label="Context" value={basePackage.context.contextHash} />
          <HashRow label="Cadastral" value={cadastral.cadastralHash} />
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))",
          gap: 8,
          marginTop: 14,
        }}
      >
        <Metric label="도로 경계 출처" value={sourceLabel} sub={sourceSummary?.upisDataCode ?? "VWorld"} />
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
      {loadState === "error" && <Notice tone="fail">{loadError}</Notice>}
      {!hasRoadBoundary && loadState === "ready" && (
        <Notice tone="warn">
          도로 경계 폴리곤을 찾지 못해 중심선만 포함됩니다. 이 경우 도로 폭은 검증값으로
          사용할 수 없습니다.
        </Notice>
      )}
      {feedback && <Notice tone={feedback.tone === "success" ? "success" : "fail"}>{feedback.text}</Notice>}

      <div style={{ marginTop: 14, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5 }}>
          <thead>
            <tr style={{ color: "var(--fg-muted)" }}>
              <th style={cellStyle}>SketchUp 그룹</th>
              <th style={cellStyle}>객체 수</th>
              <th style={cellStyle}>용도</th>
            </tr>
          </thead>
          <tbody>
            {layers.map(([name, count, purpose]) => (
              <tr key={name}>
                <td style={cellStyle}><code>{name}</code></td>
                <td style={cellStyle}>{count}</td>
                <td style={cellStyle}>{purpose}</td>
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
          fontSize: 10.5,
        }}
      >
        <div>
          <strong>
            {!basePackage.validation.exportable
              ? "계획 매스 오류 수정 필요"
              : !planningLocked
                ? "대표안 확정 후 다운로드 가능"
                : loadState !== "ready"
                  ? "도로 경계 조회 대기"
                  : "통합 사이트 패키지 생성 가능"}
          </strong>
          <div style={{ marginTop: 3, color: "var(--fg-muted)", maxWidth: 820 }}>
            UPIS 도로 경계는 개략설계용 도시계획 도형입니다. 현황 포장·차도·보도 경계와
            측량 성과도를 대체하지 않는다는 주의문이 metadata와 README에 포함됩니다.
          </div>
        </div>
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
          {canDownload ? "SketchUp 통합 패키지 다운로드" : "대표안·도로 경계 확인 필요"}
        </button>
      </div>
    </Panel>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div
      style={{
        padding: 11,
        border: "1px solid var(--border)",
        borderRadius: 9,
        background: "var(--bg-elev)",
      }}
    >
      <div style={{ fontSize: 9.5, color: "var(--fg-faint)" }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 15, fontWeight: 780 }}>{value}</div>
      <div style={{ marginTop: 3, fontSize: 9.5, color: "var(--fg-muted)" }}>{sub}</div>
    </div>
  );
}

function HashRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: "var(--fg-faint)" }}>{label}</span>
      <code style={{ fontWeight: 700 }}>{value}</code>
    </div>
  );
}

function Notice({
  children,
  tone = "info",
}: {
  children: React.ReactNode;
  tone?: "info" | "warn" | "fail" | "success";
}) {
  const background =
    tone === "fail"
      ? "var(--neg-soft)"
      : tone === "success"
        ? "var(--pos-soft)"
        : tone === "warn"
          ? "var(--warn-soft)"
          : "var(--accent-soft)";
  const color =
    tone === "fail"
      ? "var(--neg-fg)"
      : tone === "success"
        ? "var(--pos-fg)"
        : tone === "warn"
          ? "var(--warn-fg)"
          : "var(--accent-fg)";
  return (
    <div
      style={{
        marginTop: 12,
        padding: "9px 11px",
        borderRadius: 8,
        background,
        color,
        fontSize: 10.5,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}
