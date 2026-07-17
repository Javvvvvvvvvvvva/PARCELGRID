"use client";

import { useMemo, useState } from "react";
import { Panel } from "@/components/ui/primitives";
import { getExistingBuildingGeometry } from "@/lib/geo/existing-building-geometry";
import { downloadSketchupDaeExport } from "@/lib/planning/sketchup-dae-export";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import { buildSketchupExportPackage } from "@/lib/planning/sketchup-export-package";
import { useProjectStore } from "@/lib/stores/project-store";
import { num } from "@/lib/utils/format";

const PACKAGE_STATUS = {
  ready: {
    label: "Export 패키지 준비 완료",
    color: "var(--pos-fg)",
    background: "var(--pos-soft)",
  },
  "ready-with-warnings": {
    label: "Export 가능 · 추정값 포함",
    color: "var(--warn-fg)",
    background: "var(--warn-soft)",
  },
  blocked: {
    label: "Export 차단",
    color: "var(--neg-fg)",
    background: "var(--neg-soft)",
  },
} as const;

const tableCell = {
  padding: "8px 9px",
  borderBottom: "1px solid var(--border)",
  textAlign: "left" as const,
  whiteSpace: "nowrap" as const,
};

type DownloadFeedback = {
  tone: "success" | "fail";
  text: string;
};

export function SketchupExportPackagePanel({ projectId }: { projectId: string }) {
  const data = useProjectStore((state) => state.data);
  const planningScenarios = useProjectStore((state) => state.planningScenarios);
  const selectedPlanningScenarioId = useProjectStore(
    (state) => state.selectedPlanningScenarioId
  );
  const representativeGeometrySnapshot = useProjectStore(
    (state) => state.representativeGeometrySnapshot
  );
  const [downloadFeedback, setDownloadFeedback] =
    useState<DownloadFeedback | null>(null);

  const scenario =
    planningScenarios.find(
      (candidate) =>
        candidate.id === selectedPlanningScenarioId &&
        candidate.projectId === projectId
    ) ??
    planningScenarios.find((candidate) => candidate.projectId === projectId) ??
    null;
  const parcel = data?.parcel;

  const exportPackage = useMemo(() => {
    if (!scenario || !parcel?.boundary || parcel.boundary.length < 3) return null;
    const planning = buildPlanningGeometry({
      projectId,
      scenario,
      boundary: parcel.boundary,
      lotAreaSqm: parcel.lotArea,
      zoning: parcel.zoning ?? "",
      roads: parcel.roads,
      setback: parcel.setback,
    }).snapshot;
    return buildSketchupExportPackage({
      planning,
      existingGeometry: getExistingBuildingGeometry(parcel.currentBuilding),
    });
  }, [projectId, scenario, parcel]);

  if (!scenario || !parcel || !exportPackage) return null;

  const packageStatus = PACKAGE_STATUS[exportPackage.validation.status];
  const context = exportPackage.context;
  const planningLocked =
    representativeGeometrySnapshot?.scenarioId === exportPackage.scenarioId &&
    representativeGeometrySnapshot?.geometryHash ===
      exportPackage.planningGeometryHash;
  const canDownload = exportPackage.validation.exportable && planningLocked;

  const handleDownload = () => {
    setDownloadFeedback(null);
    if (!exportPackage.validation.exportable) {
      setDownloadFeedback({
        tone: "fail",
        text:
          exportPackage.validation.blockingReasons[0] ??
          "계획 매스 기하 오류를 먼저 수정해야 합니다.",
      });
      return;
    }
    if (!planningLocked) {
      setDownloadFeedback({
        tone: "fail",
        text: "현재 계획안을 대표안으로 확정해 Geometry Snapshot을 잠근 뒤 다운로드하세요.",
      });
      return;
    }
    try {
      const result = downloadSketchupDaeExport(exportPackage);
      setDownloadFeedback({
        tone: "success",
        text: `${result.filename} 다운로드를 시작했습니다. ZIP 안의 DAE를 SketchUp에서 COLLADA 형식으로 가져오세요.`,
      });
    } catch (error) {
      setDownloadFeedback({
        tone: "fail",
        text:
          error instanceof Error
            ? error.message
            : "SketchUp 패키지 생성 중 알 수 없는 오류가 발생했습니다.",
      });
    }
  };

  return (
    <Panel
      title="SketchUp Export Package"
      source="계획 매스·필지·주변 건물·도로·정북 레이어 계약"
      bodyStyle={{ padding: "var(--s5)" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 18,
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            <span
              style={{
                padding: "4px 8px",
                borderRadius: 999,
                background: packageStatus.background,
                color: packageStatus.color,
                fontSize: 10.5,
                fontWeight: 750,
              }}
            >
              {packageStatus.label}
            </span>
            <span className="ui-tag">주변 {context.summary.totalBuildings}동</span>
            <span className="ui-tag">
              높이 확인 {context.summary.verifiedHeightBuildings}동
            </span>
            <span className="ui-tag">
              높이 추정 {context.summary.estimatedHeightBuildings}동
            </span>
            {planningLocked && <span className="ui-tag">대표 계획 매스 잠김</span>}
          </div>
          <p
            style={{
              maxWidth: 820,
              margin: "8px 0 0",
              fontSize: 11,
              lineHeight: 1.55,
              color: "var(--fg-muted)",
            }}
          >
            대상 계획 매스는 설계 시작 기준으로 엄격하게 검증하고, 주변 건물은
            같은 GIS 좌표의 맥락 레이어로 포함합니다. 등록 높이가 없는 주변 건물은
            별도 추정 그룹으로 분리되어 건축가가 끄고 켤 수 있습니다.
          </p>
        </div>
        <div style={{ minWidth: 205, display: "grid", gap: 4 }}>
          <HashRow label="Planning" value={exportPackage.planningGeometryHash} />
          <HashRow label="Context" value={exportPackage.contextGeometryHash} />
          <HashRow label="Package" value={exportPackage.exportPackageHash} strong />
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
        <PackageMetric
          label="주변 건물"
          value={`${context.summary.totalBuildings}동`}
          sub={`필지 경계 기준 약 ${num(context.radiusM, 0)}m`}
        />
        <PackageMetric
          label="등록 높이 확인"
          value={`${context.summary.verifiedHeightBuildings}동`}
          sub="VWorld GIS 속성 높이"
        />
        <PackageMetric
          label="층수 기반 높이 추정"
          value={`${context.summary.estimatedHeightBuildings}동`}
          sub="추정 그룹으로 분리"
        />
        <PackageMetric
          label="기본 1층 높이 추정"
          value={`${context.summary.defaultHeightBuildings}동`}
          sub="층수와 높이 모두 없는 경우"
        />
        <PackageMetric
          label="제외된 주변 형상"
          value={`${context.summary.excludedBuildings}동`}
          sub="빈 형상·자기 교차"
        />
      </div>

      {context.summary.totalBuildings === 0 && (
        <Notice tone="warn">
          주변 건물 GIS 형상이 없어 현재 패키지에는 대상 계획 매스·필지·도로만
          포함됩니다. 같은 주소를 새로 조회하거나 VWorld 건물 API 상태를 확인해야
          합니다.
        </Notice>
      )}

      <div style={{ marginTop: 14, overflowX: "auto" }}>
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5 }}
        >
          <thead>
            <tr style={{ color: "var(--fg-muted)" }}>
              <th style={tableCell}>SketchUp 그룹명</th>
              <th style={tableCell}>객체 수</th>
              <th style={tableCell}>정확도</th>
              <th style={tableCell}>용도</th>
            </tr>
          </thead>
          <tbody>
            {exportPackage.layers.map((layer) => (
              <tr key={layer.name}>
                <td style={tableCell}>
                  <code>{layer.name}</code>
                </td>
                <td style={tableCell}>{layer.objectCount}</td>
                <td style={tableCell}>
                  {layer.accuracy === "verified"
                    ? "검증"
                    : layer.accuracy === "mixed"
                      ? "일부 추정"
                      : "참고"}
                </td>
                <td style={tableCell}>{layer.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {exportPackage.validation.warnings.length > 0 && (
        <Notice tone="warn">
          {exportPackage.validation.warnings.map((warning, index) => (
            <div key={`${warning}-${index}`}>{warning}</div>
          ))}
        </Notice>
      )}
      {exportPackage.validation.blockingReasons.length > 0 && (
        <Notice tone="fail">
          {exportPackage.validation.blockingReasons.map((reason, index) => (
            <div key={`${reason}-${index}`}>{reason}</div>
          ))}
        </Notice>
      )}
      {downloadFeedback && (
        <Notice tone={downloadFeedback.tone === "success" ? "success" : "fail"}>
          {downloadFeedback.text}
        </Notice>
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
            {!exportPackage.validation.exportable
              ? "계획 매스 오류 수정 필요"
              : planningLocked
                ? "대표안 잠금 및 파일 생성 조건 통과"
                : "대표안 확정 후 다운로드 가능"}
          </strong>
          <div style={{ marginTop: 3, color: "var(--fg-muted)", maxWidth: 780 }}>
            ZIP에는 COLLADA DAE, 검증 metadata JSON, SketchUp 가져오기 안내문이
            포함됩니다. DAE는 PG_* 그룹 계층을 보존하지만 SketchUp Tags 자동 생성은
            버전에 따라 다를 수 있습니다.
          </div>
        </div>
        <button
          type="button"
          disabled={!canDownload}
          onClick={handleDownload}
          title={
            !exportPackage.validation.exportable
              ? "계획 매스 기하 오류를 먼저 수정하세요."
              : !planningLocked
                ? "대표 계획안을 확정해 Geometry Snapshot을 잠그세요."
                : "검증된 DAE와 metadata가 포함된 ZIP을 다운로드합니다."
          }
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
          {canDownload
            ? "SketchUp용 DAE 패키지 다운로드"
            : planningLocked
              ? "SketchUp 다운로드 차단"
              : "대표안 확정 후 다운로드"}
        </button>
      </div>
    </Panel>
  );
}

function HashRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        fontSize: 10,
      }}
    >
      <span style={{ color: "var(--fg-faint)" }}>{label}</span>
      <code style={{ fontWeight: strong ? 800 : 650 }}>{value}</code>
    </div>
  );
}

function PackageMetric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
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
      <div style={{ marginTop: 4, fontSize: 15, fontWeight: 750 }}>{value}</div>
      <div style={{ marginTop: 3, fontSize: 9.5, color: "var(--fg-muted)" }}>
        {sub}
      </div>
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "warn" | "fail" | "success";
  children: React.ReactNode;
}) {
  const fail = tone === "fail";
  const success = tone === "success";
  return (
    <div
      style={{
        marginTop: 12,
        padding: "9px 11px",
        borderRadius: 8,
        background: fail
          ? "var(--neg-soft)"
          : success
            ? "var(--pos-soft)"
            : "var(--warn-soft)",
        color: fail
          ? "var(--neg-fg)"
          : success
            ? "var(--pos-fg)"
            : "var(--warn-fg)",
        fontSize: 10.5,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}
