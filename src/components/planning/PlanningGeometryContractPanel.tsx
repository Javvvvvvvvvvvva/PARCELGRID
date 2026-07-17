"use client";

import { useMemo } from "react";
import { Panel } from "@/components/ui/primitives";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import { useProjectStore } from "@/lib/stores/project-store";
import { num } from "@/lib/utils/format";

const STATUS_STYLE = {
  pass: {
    label: "기하 검증 통과",
    color: "var(--pos-fg)",
    background: "var(--pos-soft)",
  },
  review: {
    label: "원자료 확인 필요",
    color: "var(--warn-fg)",
    background: "var(--warn-soft)",
  },
  fail: {
    label: "대표안·Export 차단",
    color: "var(--neg-fg)",
    background: "var(--neg-soft)",
  },
} as const;

export function PlanningGeometryContractPanel({
  projectId,
}: {
  projectId: string;
}) {
  const data = useProjectStore((state) => state.data);
  const planningScenarios = useProjectStore((state) => state.planningScenarios);
  const selectedPlanningScenarioId = useProjectStore(
    (state) => state.selectedPlanningScenarioId
  );
  const representativeGeometrySnapshot = useProjectStore(
    (state) => state.representativeGeometrySnapshot
  );
  const geometryValidationError = useProjectStore(
    (state) => state.geometryValidationError
  );

  const scenario =
    planningScenarios.find(
      (candidate) =>
        candidate.id === selectedPlanningScenarioId &&
        candidate.projectId === projectId
    ) ??
    planningScenarios.find((candidate) => candidate.projectId === projectId) ??
    null;
  const parcel = data?.parcel;

  const result = useMemo(() => {
    if (!scenario || !parcel?.boundary || parcel.boundary.length < 3) return null;
    return buildPlanningGeometry({
      projectId,
      scenario,
      boundary: parcel.boundary,
      lotAreaSqm: parcel.lotArea,
      zoning: parcel.zoning ?? "",
      roads: parcel.roads,
      setback: parcel.setback,
    });
  }, [projectId, scenario, parcel]);

  if (!scenario || !parcel) return null;

  if (!result) {
    return (
      <Panel
        title="Geometry Contract"
        source="대표 계획안·SketchUp 전달 기준"
        bodyStyle={{ padding: "var(--s5)" }}
      >
        <div
          style={{
            padding: 12,
            borderRadius: 9,
            background: "var(--neg-soft)",
            color: "var(--neg-fg)",
            fontSize: 11.5,
          }}
        >
          대지 경계 GIS 데이터가 없어 검증 가능한 계획 매스를 만들 수 없습니다.
        </div>
      </Panel>
    );
  }

  const snapshot = result.snapshot;
  const status = STATUS_STYLE[snapshot.validation.status];
  const locked =
    representativeGeometrySnapshot?.scenarioId === snapshot.scenarioId &&
    representativeGeometrySnapshot?.geometryHash === snapshot.geometryHash;

  return (
    <Panel
      title="Geometry Contract"
      source="3D·면적 계산·대표안·SketchUp Export 단일 기준"
      bodyStyle={{ padding: "var(--s5)" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
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
                background: status.background,
                color: status.color,
                fontSize: 10.5,
                fontWeight: 750,
              }}
            >
              {status.label}
            </span>
            <span className="ui-tag">단위 m</span>
            <span className="ui-tag">북쪽 -Z</span>
            <span className="ui-tag">동쪽 +X</span>
            {locked && <span className="ui-tag">대표안 스냅샷 잠김</span>}
          </div>
          <p
            style={{
              margin: "8px 0 0",
              maxWidth: 760,
              fontSize: 11,
              lineHeight: 1.55,
              color: "var(--fg-muted)",
            }}
          >
            프로그램 면적과 실제 3D 외곽 면적이 같은 좌표·단위에서 검증됩니다.
            실패 항목이 있으면 대표안 확정과 향후 SketchUp 파일 생성이 차단됩니다.
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 9.5, color: "var(--fg-faint)" }}>
            Geometry hash
          </div>
          <code style={{ fontSize: 12, fontWeight: 750 }}>
            {snapshot.geometryHash}
          </code>
          <div style={{ marginTop: 3, fontSize: 9.5, color: "var(--fg-faint)" }}>
            {snapshot.version} · 계획 v{snapshot.scenarioVersion}
          </div>
        </div>
      </div>

      {geometryValidationError && (
        <div
          style={{
            marginTop: 12,
            padding: "9px 11px",
            borderRadius: 8,
            border: "1px solid var(--neg-fg)",
            background: "var(--neg-soft)",
            color: "var(--neg-fg)",
            fontSize: 10.5,
            lineHeight: 1.5,
          }}
        >
          <strong>최근 대표안 확정 거부:</strong> {geometryValidationError}
        </div>
      )}

      <div className="geometry-metrics">
        <GeometryMetric
          label="프로그램 총면적"
          value={`${num(snapshot.building.totalProgramAreaSqm, 2)}㎡`}
        />
        <GeometryMetric
          label="실제 3D 총면적"
          value={`${num(snapshot.building.totalGeometryAreaSqm, 2)}㎡`}
          sub={`차이 ${num(
            snapshot.building.totalGeometryAreaSqm -
              snapshot.building.totalProgramAreaSqm,
            2
          )}㎡`}
        />
        <GeometryMetric
          label="매스 기준 건폐율"
          value={`${snapshot.building.preliminaryBcrPct.toFixed(2)}%`}
        />
        <GeometryMetric
          label="프로그램 기준 용적률"
          value={`${snapshot.building.preliminaryFarPct.toFixed(2)}%`}
        />
        <GeometryMetric
          label="최대 층별 면적 오차"
          value={`${snapshot.validation.maxFloorAreaDifferencePct.toFixed(3)}%`}
          sub="0.1% 이하 통과 · 0.5% 초과 차단"
        />
      </div>

      <div style={{ marginTop: 14, overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 10.5,
          }}
        >
          <thead>
            <tr style={{ color: "var(--fg-muted)", textAlign: "left" }}>
              <th style={cellStyle}>층</th>
              <th style={cellStyle}>프로그램</th>
              <th style={cellStyle}>실제 매스</th>
              <th style={cellStyle}>차이</th>
              <th style={cellStyle}>층고</th>
              <th style={cellStyle}>판정</th>
            </tr>
          </thead>
          <tbody>
            {[...snapshot.building.floors]
              .sort((a, b) => b.level - a.level)
              .map((floor) => {
                const floorStyle = STATUS_STYLE[floor.areaStatus];
                return (
                  <tr key={floor.id}>
                    <td style={cellStyle}>
                      <strong>{floor.label}</strong>
                    </td>
                    <td style={cellStyle}>{num(floor.programAreaSqm, 2)}㎡</td>
                    <td style={cellStyle}>{num(floor.visualAreaSqm, 2)}㎡</td>
                    <td style={cellStyle}>
                      {floor.areaDifferenceSqm >= 0 ? "+" : ""}
                      {num(floor.areaDifferenceSqm, 2)}㎡ ·{" "}
                      {floor.areaDifferencePct.toFixed(3)}%
                    </td>
                    <td style={cellStyle}>{floor.floorHeightM.toFixed(2)}m</td>
                    <td style={cellStyle}>
                      <span style={{ color: floorStyle.color, fontWeight: 750 }}>
                        {floor.areaStatus === "pass"
                          ? "일치"
                          : floor.areaStatus === "review"
                            ? "확인"
                            : "차단"}
                      </span>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {snapshot.validation.issues.length > 0 && (
        <div style={{ marginTop: 14, display: "grid", gap: 6 }}>
          {snapshot.validation.issues.map((issue, index) => (
            <div
              key={`${issue.code}-${issue.floorId ?? "project"}-${index}`}
              style={{
                padding: "8px 10px",
                borderRadius: 7,
                background:
                  issue.severity === "fail"
                    ? "var(--neg-soft)"
                    : "var(--warn-soft)",
                color:
                  issue.severity === "fail"
                    ? "var(--neg-fg)"
                    : "var(--warn-fg)",
                fontSize: 10.5,
                lineHeight: 1.45,
              }}
            >
              <strong>{issue.severity === "fail" ? "차단" : "확인"}</strong>
              <span style={{ marginLeft: 7 }}>{issue.message}</span>
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          marginTop: 14,
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
          paddingTop: 12,
          borderTop: "1px solid var(--border)",
        }}
      >
        <div style={{ fontSize: 10.5, color: "var(--fg-muted)" }}>
          {snapshot.validation.exportable
            ? "이 계획 매스는 SketchUp export geometry 생성 조건을 통과했습니다."
            : "기하 오류를 수정해야 SketchUp export geometry를 생성할 수 있습니다."}
        </div>
        <button
          type="button"
          disabled
          title="Geometry Contract 완료 후 다음 단계에서 DAE/GLB export를 연결합니다."
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "8px 11px",
            background: "var(--bg-sunken)",
            color: "var(--fg-faint)",
            fontSize: 10.5,
            cursor: "not-allowed",
          }}
        >
          SketchUp용 매스 다운로드 · 다음 단계
        </button>
      </div>

      <style jsx>{`
        .geometry-metrics {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(155px, 1fr));
          gap: 8px;
          margin-top: 14px;
        }
      `}</style>
    </Panel>
  );
}

function GeometryMetric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
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
      {sub && (
        <div style={{ marginTop: 3, fontSize: 9.5, color: "var(--fg-muted)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

const cellStyle = {
  padding: "8px 9px",
  borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap",
} as const;
