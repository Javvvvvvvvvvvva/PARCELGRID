"use client";

import { FacadeQuantityEditor } from "./FacadeQuantityEditor";
import type { ReactNode } from "react";
import {
  buildPlanningDesignIntent,
  type PlanningDesignIntentParcel,
} from "@/lib/planning/design-intent";
import {
  calculatePlanningMaterialAdjustment,
  PLANNING_FACADE_LABELS,
  resolvePlanningMaterials,
} from "@/lib/planning/materials";
import type {
  PlanningFacadeMaterial,
  PlanningMaterialEvidenceStatus,
  PlanningMaterialSelection,
  PlanningScenario,
  PlanningScenarioCalculation,
} from "@/lib/planning/types";
import { num, won } from "@/lib/utils/format";

const MATERIAL_OPTIONS = Object.entries(PLANNING_FACADE_LABELS) as Array<
  [PlanningFacadeMaterial, string]
>;

function numberOrUndefined(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : undefined;
}

export function PlanningMaterialEditor({
  scenario,
  calculation,
  parcel,
  onChange,
}: {
  scenario: PlanningScenario;
  calculation: PlanningScenarioCalculation;
  parcel: PlanningDesignIntentParcel;
  onChange: (materials: PlanningMaterialSelection) => void;
}) {
  const materials = resolvePlanningMaterials(scenario.materials);
  const adjustment = calculation.economicsPreview.facadeCost ?? calculatePlanningMaterialAdjustment(scenario);

  const patch = (next: Partial<PlanningMaterialSelection>) =>
    onChange({ ...materials, ...next });

  const patchEvidence = (
    next: Partial<NonNullable<PlanningMaterialSelection["rateEvidence"]>>
  ) =>
    patch({
      rateEvidence: {
        status: materials.rateEvidence?.status ?? "unpriced",
        ...materials.rateEvidence,
        ...next,
      },
    });

  const downloadPlanDna = () => {
    const intent = buildPlanningDesignIntent(scenario, parcel, calculation);
    const blob = new Blob([JSON.stringify(intent, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${parcel.projectId}-${scenario.id}-plan-dna.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="material-grid">
        <Field label="주 외장재">
          <select
            aria-label="주 외장재"
            value={materials.primaryFacadeMaterial}
            onChange={(event) =>
              patch({
                primaryFacadeMaterial: event.target
                  .value as PlanningFacadeMaterial,
              })
            }
            style={controlStyle}
          >
            {MATERIAL_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="보조 외장재">
          <select
            aria-label="보조 외장재"
            value={materials.secondaryFacadeMaterial}
            onChange={(event) =>
              patch({
                secondaryFacadeMaterial: event.target
                  .value as PlanningFacadeMaterial,
              })
            }
            style={controlStyle}
          >
            {MATERIAL_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <NumberField
          label="주 외장재 비율"
          value={materials.primaryFacadeSharePct}
          unit="%"
          min={0}
          max={100}
          onChange={(value) => patch({ primaryFacadeSharePct: value ?? 0 })}
        />

        <NumberField
          label="창호 비율"
          value={materials.windowRatioPct}
          unit="%"
          min={0}
          max={80}
          onChange={(value) => patch({ windowRatioPct: value ?? 0 })}
        />
      </div>

      <div className="material-summary">
        <Summary
          label="외벽 순면적"
          value={`${num(adjustment.facadeAreaSqm, 1)}㎡`}
          sub={adjustment.areaNote}
        />
        <Summary
          label="재료비 증감"
          value={adjustment.hasPricedArea ? won(adjustment.adjustmentManwon, { sign: true }) : "미산정"}
          sub={
            adjustment.hasPricedArea
              ? adjustment.priced ? "기준 공사비에 증감 반영" : "일부만 산정 · 미확정 수량/단가 별도"
              : "수량·기준·선택 단가 확인 후 반영"
          }
        />
        <Summary
          label="단가 근거"
          value={adjustment.sourceLabel}
          sub={
            adjustment.evidenceStatus === "source-backed" &&
            adjustment.areaBasis === "user-input"
              ? "단가 근거 연결 · 입력 수량 별도 검토"
              : adjustment.areaBasis !== "user-input"
                ? "계획 형상·개구부 가정 검토 필요"
                : "확정 견적 전 사용자 검토 필요"
          }
        />
      </div>

      <FacadeQuantityEditor materials={materials} cost={adjustment} onChange={onChange} />

      <details>
        <summary style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 750 }}>
          전체 조합 단가·수동 수량 입력
        </summary>
        <div className="evidence-grid">
          <NumberField
            label="외벽 순면적 직접 입력"
            value={materials.facadeAreaOverrideSqm}
            unit="㎡"
            onChange={(value) => patch({ facadeAreaOverrideSqm: value })}
          />
          <NumberField
            label="전체 조합 기준 외벽 단가"
            value={
              materials.baselineFacadeUnitCostPerSqmWon == null
                ? undefined
                : materials.baselineFacadeUnitCostPerSqmWon / 10_000
            }
            unit="만원/㎡"
            onChange={(value) =>
              patch({
                baselineFacadeUnitCostPerSqmWon:
                  value == null ? undefined : value * 10_000,
              })
            }
          />
          <NumberField
            label="전체 조합 선택 외벽 단가"
            value={
              materials.selectedFacadeUnitCostPerSqmWon == null
                ? undefined
                : materials.selectedFacadeUnitCostPerSqmWon / 10_000
            }
            unit="만원/㎡"
            onChange={(value) =>
              patch({
                selectedFacadeUnitCostPerSqmWon:
                  value == null ? undefined : value * 10_000,
              })
            }
          />
          <Field label="근거 상태">
            <select
              value={materials.rateEvidence?.status ?? "unpriced"}
              onChange={(event) =>
                patchEvidence({
                  status: event.target
                    .value as PlanningMaterialEvidenceStatus,
                })
              }
              style={controlStyle}
            >
              <option value="unpriced">단가 미확인</option>
              <option value="user-input">사용자 입력</option>
              <option value="source-backed">견적·자료 근거</option>
            </select>
          </Field>
          <Field label="출처명">
            <input
              value={materials.rateEvidence?.sourceName ?? ""}
              placeholder="예: 시공사 견적서 2026-07"
              onChange={(event) =>
                patchEvidence({ sourceName: event.target.value })
              }
              style={controlStyle}
            />
          </Field>
          <Field label="기준일">
            <input
              type="date"
              value={materials.rateEvidence?.observedAt ?? ""}
              onChange={(event) =>
                patchEvidence({ observedAt: event.target.value })
              }
              style={controlStyle}
            />
          </Field>
          <Field label="포함·제외 범위"><input value={materials.rateEvidence?.note ?? ""} placeholder="자재·시공·비계·부가세 범위" onChange={e => patchEvidence({ note: e.target.value })} style={controlStyle} /></Field>
          <Field label="근거 URL">
            <input
              value={materials.rateEvidence?.sourceUrl ?? ""}
              placeholder="https://..."
              onChange={(event) =>
                patchEvidence({ sourceUrl: event.target.value })
              }
              style={controlStyle}
            />
          </Field>
        </div>
      </details>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <p style={{ margin: 0, fontSize: 10, color: "var(--fg-faint)" }}>
          외벽 수량은 계획 형상 기준입니다. GIS 형상이 없으면 구형 면적 환산값을 표시합니다.
          실측·시공 도면의 수량, 공종 범위와 견적 근거를 검토해야 합니다.
        </p>
        <button type="button" style={buttonStyle} onClick={downloadPlanDna}>
          Plan DNA JSON 다운로드
        </button>
      </div>

      <style jsx>{`
        .material-grid,
        .evidence-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(165px, 1fr));
          gap: 10px;
        }
        .material-summary {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
        }
        .evidence-grid {
          margin-top: 12px;
          padding: 12px;
          border-radius: 10px;
          background: var(--bg-sunken);
        }
        @media (max-width: 720px) {
          .material-summary {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label>
      <span style={labelStyle}>{label}</span>
      {children}
    </label>
  );
}

function NumberField({
  label,
  value,
  unit,
  min = 0,
  max,
  onChange,
}: {
  label: string;
  value?: number;
  unit: string;
  min?: number;
  max?: number;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <Field label={label}>
      <div style={{ position: "relative" }}>
        <input
          type="number"
          aria-label={label}
          min={min}
          max={max}
          step="0.1"
          value={value ?? ""}
          onChange={(event) => onChange(numberOrUndefined(event.target.value))}
          style={{ ...controlStyle, paddingRight: 66 }}
        />
        <span style={unitStyle}>{unit}</span>
      </div>
    </Field>
  );
}

function Summary({
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
        border: "1px solid var(--border)",
        borderRadius: 9,
        padding: 10,
      }}
    >
      <div style={{ fontSize: 9.5, color: "var(--fg-faint)" }}>{label}</div>
      <div style={{ marginTop: 3, fontSize: 13, fontWeight: 750 }}>{value}</div>
      <div
        style={{
          marginTop: 3,
          fontSize: 9.5,
          lineHeight: 1.4,
          color: "var(--fg-muted)",
        }}
      >
        {sub}
      </div>
    </div>
  );
}

const labelStyle = {
  display: "block",
  marginBottom: 5,
  fontSize: 10.5,
  fontWeight: 700,
} as const;

const controlStyle = {
  width: "100%",
  minHeight: 36,
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "7px 9px",
  background: "var(--bg-elev)",
  color: "var(--fg)",
  fontFamily: "inherit",
  fontSize: 11,
  boxSizing: "border-box",
} as const;

const unitStyle = {
  position: "absolute",
  right: 9,
  top: "50%",
  transform: "translateY(-50%)",
  fontSize: 9.5,
  color: "var(--fg-faint)",
  pointerEvents: "none",
} as const;

const buttonStyle = {
  border: "1px solid var(--fg)",
  borderRadius: 8,
  padding: "8px 11px",
  background: "var(--fg)",
  color: "var(--bg)",
  fontFamily: "inherit",
  fontSize: 10.5,
  fontWeight: 750,
  cursor: "pointer",
} as const;
