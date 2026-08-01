"use client";

import type { PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import {
  createPlanningGeometrySource,
  planningGeometrySourceLabel,
  resolvePlanningGeometrySource,
} from "@/lib/planning/geometry-source";
import type {
  PlanningGeometrySource,
  PlanningGeometrySourceMode,
  PlanningScenario,
} from "@/lib/planning/types";

const SOURCE_MODES: PlanningGeometrySourceMode[] = [
  "engine-generated",
  "external-model",
  "reference-image",
];

const SOURCE_DESCRIPTION: Record<PlanningGeometrySourceMode, string> = {
  "engine-generated": "계획 스튜디오의 층·배치 값으로 정확한 매스를 생성합니다.",
  "external-model": "DAE·GLB·DXF 원본 좌표를 검증한 뒤 같은 매스로 연결합니다.",
  "reference-image": "이미지 구성은 보존하지만 정확한 좌표가 없으면 시각 참고자료로만 사용합니다.",
};

export function PlanningGeometrySourcePanel({
  scenario,
  geometry,
  onChange,
}: {
  scenario: PlanningScenario;
  geometry: PlanningGeometrySnapshot | null;
  onChange: (source: PlanningGeometrySource) => void;
}) {
  const source = resolvePlanningGeometrySource(scenario);
  const firstFailure = geometry?.validation.issues.find(
    (issue) => issue.severity === "fail"
  );

  const selectMode = (mode: PlanningGeometrySourceMode) => {
    if (mode === source.mode) return;
    if (
      source.locked &&
      !window.confirm(
        "현재 형상 잠금을 해제하고 형상 출처를 변경할까요? 대표안은 다시 확정해야 합니다."
      )
    ) {
      return;
    }
    onChange(createPlanningGeometrySource(mode));
  };

  const toggleLock = () => {
    if (source.locked) {
      onChange({
        ...source,
        locked: false,
        lockedGeometryHash: undefined,
        lockedAt: undefined,
      });
      return;
    }
    if (!geometry?.validation.exportable) return;
    onChange({
      ...source,
      locked: true,
      lockedGeometryHash: geometry.geometryHash,
      lockedAt: new Date().toISOString(),
    });
  };

  const statusLabel = source.locked
    ? "형상 잠금"
    : source.exactGeometryAvailable
      ? "정확 좌표"
      : "참고자료";

  return (
    <section
      aria-label="형상 출처와 잠금"
      style={{
        display: "grid",
        gap: 12,
        padding: "14px 15px",
        border: "1px solid var(--line)",
        borderRadius: 12,
        background: "var(--bg-sunken)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 800 }}>형상 출처</div>
          <div style={{ marginTop: 3, fontSize: 10.5, color: "var(--fg-muted)" }}>
            화면·3D·법규·대표안·SketchUp·CAD가 같은 Geometry Hash를 사용합니다.
          </div>
        </div>
        <span
          style={{
            padding: "4px 8px",
            borderRadius: 999,
            background: source.locked
              ? "var(--pos-soft)"
              : source.exactGeometryAvailable
                ? "var(--accent-soft)"
                : "var(--warn-soft)",
            color: source.locked
              ? "var(--pos-fg)"
              : source.exactGeometryAvailable
                ? "var(--accent)"
                : "var(--warn-fg)",
            fontSize: 10.5,
            fontWeight: 800,
          }}
        >
          {statusLabel}
        </span>
      </div>

      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        {SOURCE_MODES.map((mode) => {
          const active = mode === source.mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => selectMode(mode)}
              style={{
                padding: "8px 10px",
                borderRadius: 9,
                border: active
                  ? "1px solid var(--accent)"
                  : "1px solid var(--line)",
                background: active ? "var(--accent-soft)" : "var(--bg)",
                color: active ? "var(--accent)" : "var(--fg-muted)",
                fontSize: 11,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              {planningGeometrySourceLabel(mode)}
            </button>
          );
        })}
      </div>

      <div style={{ fontSize: 11, lineHeight: 1.65, color: "var(--fg-muted)" }}>
        {SOURCE_DESCRIPTION[source.mode]}
        {source.mode === "reference-image" && (
          <strong style={{ display: "block", color: "var(--warn-fg)" }}>
            이미지와 JSON만으로 원래 매스를 임의 재구성하지 않습니다.
          </strong>
        )}
        {source.mode !== "engine-generated" && !source.exactGeometryAvailable && (
          <span style={{ display: "block", color: "var(--warn-fg)" }}>
            정확한 원본 좌표 파일 연결 기능이 완료될 때까지 대표안·내보내기가 차단됩니다.
          </span>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, color: "var(--fg-muted)" }}>
            현재 Geometry Hash
          </div>
          <code
            title={geometry?.geometryHash}
            style={{
              display: "block",
              marginTop: 2,
              fontSize: 10.5,
              overflowWrap: "anywhere",
              color: "var(--fg)",
            }}
          >
            {geometry?.geometryHash ?? "대지 경계 확인 필요"}
          </code>
        </div>
        {source.mode === "engine-generated" && (
          <button
            type="button"
            disabled={!source.locked && !geometry?.validation.exportable}
            onClick={toggleLock}
            style={{
              padding: "8px 11px",
              borderRadius: 9,
              border: "1px solid var(--line-strong)",
              background: source.locked ? "var(--bg)" : "var(--fg)",
              color: source.locked ? "var(--fg)" : "var(--bg)",
              fontSize: 11,
              fontWeight: 800,
              cursor:
                !source.locked && !geometry?.validation.exportable
                  ? "not-allowed"
                  : "pointer",
              opacity:
                !source.locked && !geometry?.validation.exportable ? 0.55 : 1,
            }}
          >
            {source.locked ? "잠금 해제" : "현재 형상 잠금"}
          </button>
        )}
      </div>

      {firstFailure && (
        <div
          role="alert"
          style={{
            padding: "9px 10px",
            borderRadius: 9,
            background: "var(--neg-soft)",
            color: "var(--neg-fg)",
            fontSize: 10.5,
            lineHeight: 1.55,
          }}
        >
          {firstFailure.message}
        </div>
      )}
    </section>
  );
}
