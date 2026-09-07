"use client";

import { useEffect, useMemo, useState } from "react";
import { Panel } from "@/components/ui/primitives";
import {
  buildCadastralContext,
  type CadastralParcelFeature,
} from "@/lib/geo/cadastral-context";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import { downloadCadastralLineworkPackage } from "@/lib/planning/cadastral-linework-export";
import { useProjectStore } from "@/lib/stores/project-store";
import { num } from "@/lib/utils/format";

interface ApiResponse {
  source: string;
  targetPnu: string;
  parcels: CadastralParcelFeature[];
  error?: string;
}

type LoadState = "idle" | "loading" | "ready" | "error";

const cellStyle = {
  padding: "8px 9px",
  borderBottom: "1px solid var(--border)",
  textAlign: "left" as const,
  whiteSpace: "nowrap" as const,
};

export function CadastralRoadContextPanel({ projectId }: { projectId: string }) {
  const data = useProjectStore((state) => state.data);
  const planningScenarios = useProjectStore((state) => state.planningScenarios);
  const selectedPlanningScenarioId = useProjectStore(
    (state) => state.selectedPlanningScenarioId
  );
  const [sourceParcels, setSourceParcels] = useState<CadastralParcelFeature[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);

  const parcel = data?.parcel;
  const scenario =
    planningScenarios.find(
      (candidate) =>
        candidate.id === selectedPlanningScenarioId &&
        candidate.projectId === projectId
    ) ??
    planningScenarios.find((candidate) => candidate.projectId === projectId) ??
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
      setSourceParcels([]);
      setLoadState("idle");
      setLoadError(null);
      return;
    }

    const controller = new AbortController();
    setLoadState("loading");
    setLoadError(null);
    setDownloadMessage(null);

    fetch("/api/parcels/cadastral-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetPnu,
        lat: parcel.lat,
        lng: parcel.lng,
        radiusM: 80,
      }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as ApiResponse;
        if (!response.ok) {
          throw new Error(payload.error ?? `지적도 조회 실패 (${response.status})`);
        }
        return payload;
      })
      .then((payload) => {
        setSourceParcels(payload.parcels ?? []);
        setLoadState("ready");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setSourceParcels([]);
        setLoadState("error");
        setLoadError(
          error instanceof Error ? error.message : "주변 지적도 조회에 실패했습니다."
        );
      });

    return () => controller.abort();
  }, [manualParcel, parcel, targetPnu]);

  const planning = useMemo(() => {
    if (!scenario || !parcel?.boundary || parcel.boundary.length < 3) return null;
    return buildPlanningGeometry({
      projectId,
      scenario,
      boundary: parcel.boundary,
      lotAreaSqm: parcel.lotArea,
      zoning: parcel.zoning ?? "",
      roads: parcel.roads,
      setback: parcel.setback,
    }).snapshot;
  }, [parcel, projectId, scenario]);

  const snapshot = useMemo(() => {
    if (!planning || !targetPnu) return null;
    return buildCadastralContext({
      planning,
      targetPnu,
      parcels: sourceParcels,
    });
  }, [planning, sourceParcels, targetPnu]);

  if (manualParcel || !parcel || !scenario || !planning || !snapshot) return null;

  const primary = snapshot.frontages[0] ?? null;
  const widthAvailable = primary?.widthAvgM != null;
  const canDownload = loadState === "ready" && sourceParcels.length > 0;

  const handleDownload = () => {
    if (!canDownload || !parcel.boundary) return;
    const result = downloadCadastralLineworkPackage({
      snapshot,
      targetBoundary: parcel.boundary,
      sourceParcels,
    });
    setDownloadMessage(`${result.filename} 다운로드를 시작했습니다.`);
  };

  return (
    <Panel
      title="지적도·도로 경계 계약"
      source="VWorld 연속지적도 · 지적상 도로 폭 · DXF/GeoJSON"
      bodyStyle={{ padding: "var(--s5)" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 18,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            <span className="ui-tag">대상 필지 경계</span>
            <span className="ui-tag">
              인접 필지 {snapshot.summary.adjacentParcelCount}필지
            </span>
            <span className="ui-tag">
              도로 필지 {snapshot.summary.roadParcelCount}필지
            </span>
            <span className="ui-tag">
              폭 검증 {snapshot.summary.verifiedWidthFrontageCount}면
            </span>
          </div>
          <p
            style={{
              maxWidth: 890,
              margin: "8px 0 0",
              fontSize: 11,
              lineHeight: 1.58,
              color: "var(--fg-muted)",
            }}
          >
            지목이 도로인 연속지적 필지의 실제 폴리곤을 가져와 대상 필지 접도면에서
            반대편 지적 경계까지 수직 폭을 측정합니다. 아래 폭은 지적상 도로 폭이며,
            현황 포장·차도·보도 폭이나 측량 성과도를 의미하지 않습니다.
          </p>
        </div>
        <div style={{ minWidth: 210, display: "grid", gap: 4, fontSize: 10 }}>
          <HashRow label="Cadastral" value={snapshot.cadastralHash} />
          <HashRow label="원점" value={planning.coordinateSystem.originLngLat.map((v) => v.toFixed(6)).join(", ")} />
          <HashRow label="단위" value="meter" />
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(165px, 1fr))",
          gap: 8,
          marginTop: 14,
        }}
      >
        <Metric
          label="지적상 도로 폭 · 최소"
          value={widthAvailable ? `${num(snapshot.summary.primaryWidthMinM ?? 0, 2)}m` : "미확인"}
          sub="접도부 수직 샘플"
        />
        <Metric
          label="지적상 도로 폭 · 평균"
          value={widthAvailable ? `${num(snapshot.summary.primaryWidthAvgM ?? 0, 2)}m` : "미확인"}
          sub={primary ? `${primary.widthSamples.length}개 샘플` : "도로 필지 매칭 필요"}
          strong
        />
        <Metric
          label="지적상 도로 폭 · 최대"
          value={widthAvailable ? `${num(snapshot.summary.primaryWidthMaxM ?? 0, 2)}m` : "미확인"}
          sub="비정형 도로 폭 범위"
        />
        <Metric
          label="접도 경계 길이"
          value={primary ? `${num(primary.frontageLengthM, 2)}m` : "미확인"}
          sub={primary ? `평행도 ${num(primary.alignmentPct, 1)}%` : "접도면 매칭 필요"}
        />
        <Metric
          label="필지-도로 경계 간격"
          value={primary ? `${num(primary.boundaryGapM, 3)}m` : "미확인"}
          sub="0.75m 이하 접도 판정"
        />
      </div>

      {loadState === "loading" && (
        <Notice tone="info">주변 연속지적도와 도로 필지를 조회하고 있습니다.</Notice>
      )}
      {loadState === "error" && (
        <Notice tone="fail">{loadError ?? "주변 연속지적도 조회 실패"}</Notice>
      )}
      {snapshot.validation.issues.length > 0 && loadState !== "loading" && (
        <Notice tone="warn">
          {snapshot.validation.issues.map((issue) => (
            <div key={`${issue.code}-${issue.parcelPnu ?? "all"}`}>{issue.message}</div>
          ))}
        </Notice>
      )}
      {downloadMessage && <Notice tone="success">{downloadMessage}</Notice>}

      {snapshot.frontages.length > 0 && (
        <div style={{ marginTop: 14, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5 }}>
            <thead>
              <tr style={{ color: "var(--fg-muted)" }}>
                <th style={cellStyle}>도로 필지 PNU</th>
                <th style={cellStyle}>지번</th>
                <th style={cellStyle}>접도 길이</th>
                <th style={cellStyle}>경계 간격</th>
                <th style={cellStyle}>폭 최소/평균/최대</th>
                <th style={cellStyle}>판정</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.frontages.map((frontage) => (
                <tr key={`${frontage.roadParcelPnu}-${frontage.targetEdgeIndex}`}>
                  <td style={cellStyle}><code>{frontage.roadParcelPnu}</code></td>
                  <td style={cellStyle}>{frontage.roadParcelJibun || "-"}</td>
                  <td style={cellStyle}>{num(frontage.frontageLengthM, 2)}m</td>
                  <td style={cellStyle}>{num(frontage.boundaryGapM, 3)}m</td>
                  <td style={cellStyle}>
                    {frontage.widthAvgM == null
                      ? "폭 미확인"
                      : `${num(frontage.widthMinM ?? 0, 2)} / ${num(frontage.widthAvgM, 2)} / ${num(frontage.widthMaxM ?? 0, 2)}m`}
                  </td>
                  <td style={cellStyle}>
                    {frontage.status === "verified-cadastral-width"
                      ? "지적 폭 검증"
                      : frontage.status === "frontage-only"
                        ? "접도만 확인"
                        : "인접 도로 후보"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
            {canDownload
              ? "지적·도로 선형 패키지 생성 가능"
              : "주변 연속지적도 조회 후 다운로드 가능"}
          </strong>
          <div style={{ marginTop: 3, color: "var(--fg-muted)", maxWidth: 800 }}>
            ZIP에는 로컬 미터 DXF, WGS84 GeoJSON, 폭 샘플과 출처가 포함된 metadata가
            들어갑니다. DXF의 X는 동쪽, Y는 북쪽이며 기존 DAE의 -Z와 같은 방향입니다.
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
          지적도·도로 DXF 패키지 다운로드
        </button>
      </div>
    </Panel>
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

function Metric({
  label,
  value,
  sub,
  strong = false,
}: {
  label: string;
  value: string;
  sub: string;
  strong?: boolean;
}) {
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
      <div style={{ marginTop: 4, fontSize: 15, fontWeight: strong ? 850 : 750 }}>
        {value}
      </div>
      <div style={{ marginTop: 3, fontSize: 9.5, color: "var(--fg-muted)" }}>{sub}</div>
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "info" | "warn" | "fail" | "success";
  children: React.ReactNode;
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
