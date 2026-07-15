"use client";

import { useMemo } from "react";
import { Panel } from "@/components/ui/primitives";
import { getExistingBuildingGeometry } from "@/lib/geo/existing-building-geometry";
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

export function SketchupExportPackagePanel({ projectId }: { projectId: string }) {
  const data = useProjectStore((state) => state.data);
  const planningScenarios = useProjectStore((state) => state.planningScenarios);
  const selectedPlanningScenarioId = useProjectStore(
    (state) => state.selectedPlanningScenarioId
  );
  const representativeGeometrySnapshot = useProjectStore(
    (state) => state.representativeGeometrySnapshot
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
  const noContext = context.summary.totalBuildings === 0;

  return (
    <Panel
      title="SketchUp Export Package"
      source="계획 매스·필지·주변 건물·도로·정북 레이어 계약"
      bodyStyle={{ padding: "var(--s5)" }}
    >
      <div className="package-heading">
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
          <p className="package-description">
            대상 계획 매스는 설계 시작 기준으로 엄격하게 검증하고, 주변 건물은
            같은 GIS 좌표의 맥락 레이어로 포함합니다. 등록 높이가 없는 주변 건물은
            별도 추정 레이어로 분리되어 건축가가 끄고 켤 수 있습니다.
          </p>
        </div>

        <div className="hashes">
          <HashRow label="Planning" value={exportPackage.planningGeometryHash} />
          <HashRow label="Context" value={exportPackage.contextGeometryHash} />
          <HashRow label="Package" value={exportPackage.exportPackageHash} strong />
        </div>
      </div>

      <div className="context-metrics">
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
          sub="추정 레이어로 분리"
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

      {noContext && (
        <div className="package-warning">
          주변 건물 GIS 형상이 없어 현재 패키지에는 대상 계획 매스·필지·도로만
          포함됩니다. 같은 주소를 새로 조회하거나 VWorld 건물 API 상태를 확인해야
          합니다.
        </div>
      )}

      <div style={{ marginTop: 14, overflowX: "auto" }}>
        <table className="layer-table">
          <thead>
            <tr>
              <th>SketchUp 태그</th>
              <th>객체 수</th>
              <th>정확도</th>
              <th>용도</th>
            </tr>
          </thead>
          <tbody>
            {exportPackage.layers.map((layer) => (
              <tr key={layer.name}>
                <td>
                  <code>{layer.name}</code>
                </td>
                <td>{layer.objectCount}</td>
                <td>
                  {layer.accuracy === "verified"
                    ? "검증"
                    : layer.accuracy === "mixed"
                      ? "일부 추정"
                      : "참고"}
                </td>
                <td>{layer.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {exportPackage.validation.warnings.length > 0 && (
        <div className="warning-list">
          {exportPackage.validation.warnings.map((warning, index) => (
            <div key={`${warning}-${index}`}>{warning}</div>
          ))}
        </div>
      )}

      {exportPackage.validation.blockingReasons.length > 0 && (
        <div className="blocking-list">
          {exportPackage.validation.blockingReasons.map((reason, index) => (
            <div key={`${reason}-${index}`}>{reason}</div>
          ))}
        </div>
      )}

      <div className="package-footer">
        <div>
          <strong>
            {exportPackage.validation.exportable
              ? "파일 생성 조건 통과"
              : "계획 매스 오류 수정 필요"}
          </strong>
          <div className="footer-sub">
            주변 건물 추정 높이는 다운로드를 차단하지 않으며 metadata와 추정 태그에
            기록됩니다.
          </div>
        </div>
        <button
          type="button"
          disabled
          title="다음 단계에서 DAE/GLB 파일 생성기를 연결합니다."
        >
          SketchUp용 패키지 다운로드 · 다음 단계
        </button>
      </div>

      <style jsx>{`
        .package-heading {
          display: flex;
          justify-content: space-between;
          gap: 18px;
          align-items: flex-start;
          flex-wrap: wrap;
        }
        .package-description {
          max-width: 820px;
          margin: 8px 0 0;
          font-size: 11px;
          line-height: 1.55;
          color: var(--fg-muted);
        }
        .hashes {
          min-width: 205px;
          display: grid;
          gap: 4px;
        }
        .context-metrics {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(155px, 1fr));
          gap: 8px;
          margin-top: 14px;
        }
        .package-warning,
        .warning-list,
        .blocking-list {
          margin-top: 12px;
          padding: 9px 11px;
          border-radius: 8px;
          font-size: 10.5px;
          line-height: 1.5;
        }
        .package-warning,
        .warning-list {
          background: var(--warn-soft);
          color: var(--warn-fg);
        }
        .blocking-list {
          background: var(--neg-soft);
          color: var(--neg-fg);
        }
        .layer-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 10.5px;
        }
        .layer-table th,
        .layer-table td {
          padding: 8px 9px;
          border-bottom: 1px solid var(--border);
          text-align: left;
          white-space: nowrap;
        }
        .layer-table th {
          color: var(--fg-muted);
        }
        .package-footer {
          margin-top: 14px;
          padding-top: 12px;
          border-top: 1px solid var(--border);
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          font-size: 10.5px;
        }
        .footer-sub {
          margin-top: 3px;
          color: var(--fg-muted);
        }
        .package-footer button {
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 8px 11px;
          background: var(--bg-sunken);
          color: var(--fg-faint);
          font-size: 10.5px;
          cursor: not-allowed;
        }
      `}</style>
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
        fontSize: 10px,
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
