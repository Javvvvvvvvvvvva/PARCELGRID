"use client";

import { useMemo, useState } from "react";
import { useProjectStore } from "@/lib/stores/project-store";
import {
  constraintStatusLabel,
  coreRegulatoryConstraintsVerified,
  createRegulatoryReferenceSet,
  replaceConstraintEvidence,
  restoreReferenceConstraint,
  type RegulatoryConstraintKey,
  type RegulatoryConstraintSet,
} from "@/lib/regulatory/constraints";

const FIELD_META: Array<{
  key: RegulatoryConstraintKey;
  label: string;
  unit: "%" | "m" | "층";
  requiredForCore: boolean;
}> = [
  { key: "bcr", label: "건폐율 적용 상한", unit: "%", requiredForCore: true },
  { key: "far", label: "용적률 적용 상한", unit: "%", requiredForCore: true },
  { key: "height", label: "필지별 최고높이", unit: "m", requiredForCore: true },
  { key: "floors", label: "별도 층수 한도", unit: "층", requiredForCore: false },
];

function numberText(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) && value > 0 ? String(value) : "";
}

function badgeColor(status: string): { bg: string; fg: string } {
  if (status === "source-backed" || status === "expert-approved") {
    return { bg: "var(--pos-soft)", fg: "var(--pos-fg)" };
  }
  if (status === "unknown") return { bg: "var(--neg-soft)", fg: "var(--neg-fg)" };
  return { bg: "var(--warn-soft)", fg: "var(--warn-fg)" };
}

export function RegulatoryEvidencePanel({ projectId }: { projectId: string }) {
  const data = useProjectStore((state) => state.data);
  const setData = useProjectStore((state) => state.setData);
  const parcel = data?.parcel;

  const baseSet = useMemo<RegulatoryConstraintSet | null>(() => {
    if (!parcel) return null;
    return (
      parcel.regulatoryConstraints ??
      createRegulatoryReferenceSet({
        farPct: parcel.maxFAR,
        bcrPct: parcel.maxBCR,
        heightM: parcel.heightLimit,
        zoningSourceName: "구버전 VWorld 용도지역 조회",
      })
    );
  }, [parcel]);

  const [values, setValues] = useState<Record<RegulatoryConstraintKey, string>>(() => ({
    far: numberText(baseSet?.far.value),
    bcr: numberText(baseSet?.bcr.value),
    height: numberText(baseSet?.height.value),
    floors: numberText(baseSet?.floors.value),
  }));
  const [sourceName, setSourceName] = useState("");
  const [sourceRef, setSourceRef] = useState("");
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [checkedBy, setCheckedBy] = useState("");
  const [checkedRole, setCheckedRole] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  if (!data || !parcel || !baseSet || parcel.id !== projectId) return null;

  const parseValue = (key: RegulatoryConstraintKey): number | null => {
    const parsed = Number(values[key]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  const persist = (sourceBacked: boolean) => {
    if (
      sourceBacked &&
      (!sourceName.trim() || !sourceRef.trim() || !asOf || !checkedBy.trim() || !checkedRole.trim())
    ) {
      setMessage("원문 확인값은 출처명·URL/문서번호·기준일·확인자·역할을 모두 입력해야 합니다.");
      return;
    }

    const status = sourceBacked ? "source-backed" : "user-entered";
    const next: RegulatoryConstraintSet = {
      ...baseSet,
      retrievedAt: new Date().toISOString(),
      far: replaceConstraintEvidence(baseSet.far, {
        value: parseValue("far"),
        status,
        sourceName: sourceName || "사용자 입력",
        sourceRef,
        asOf,
        checkedBy,
        checkedRole,
        note,
      }),
      bcr: replaceConstraintEvidence(baseSet.bcr, {
        value: parseValue("bcr"),
        status,
        sourceName: sourceName || "사용자 입력",
        sourceRef,
        asOf,
        checkedBy,
        checkedRole,
        note,
      }),
      height: replaceConstraintEvidence(baseSet.height, {
        value: parseValue("height"),
        status,
        sourceName: sourceName || "사용자 입력",
        sourceRef,
        asOf,
        checkedBy,
        checkedRole,
        note,
      }),
      floors: replaceConstraintEvidence(baseSet.floors, {
        value: parseValue("floors"),
        status,
        sourceName: sourceName || "사용자 입력",
        sourceRef,
        asOf,
        checkedBy,
        checkedRole,
        note,
      }),
    };

    setData({
      ...data,
      parcel: {
        ...parcel,
        maxFAR: next.far.value ?? parcel.maxFAR,
        maxBCR: next.bcr.value ?? parcel.maxBCR,
        heightLimit: sourceBacked ? next.height.value ?? 0 : 0,
        regulatoryConstraints: next,
      },
      meta: { ...data.meta, lastSyncedAt: new Date().toISOString() },
    });
    setMessage(
      sourceBacked
        ? "원문 확인값을 저장했습니다. Stage 2 계산은 즉시 갱신되며 Stage 4 전문가 검토는 별도로 남습니다."
        : "사용자 입력값을 저장했습니다. 계산에는 반영되지만 법규 통과 판정에는 사용하지 않습니다."
    );
  };

  const resetToReference = () => {
    const next: RegulatoryConstraintSet = {
      ...baseSet,
      retrievedAt: new Date().toISOString(),
      far: restoreReferenceConstraint(baseSet.far),
      bcr: restoreReferenceConstraint(baseSet.bcr),
      height: restoreReferenceConstraint(baseSet.height),
      floors: restoreReferenceConstraint(baseSet.floors),
    };
    setValues({
      far: numberText(next.far.value),
      bcr: numberText(next.bcr.value),
      height: numberText(next.height.value),
      floors: numberText(next.floors.value),
    });
    setData({
      ...data,
      parcel: {
        ...parcel,
        maxFAR: next.far.value ?? parcel.maxFAR,
        maxBCR: next.bcr.value ?? parcel.maxBCR,
        heightLimit: 0,
        regulatoryConstraints: next,
      },
      meta: { ...data.meta, lastSyncedAt: new Date().toISOString() },
    });
    setMessage("필지별 확인값을 제거하고 전국 참고값·미확인 상태로 되돌렸습니다.");
  };

  const coreVerified = coreRegulatoryConstraintsVerified(
    parcel.regulatoryConstraints ?? baseSet
  );

  return (
    <section
      style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        background: "var(--bg-elev)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 18,
          padding: "18px 20px",
          borderBottom: "1px solid var(--border)",
          alignItems: "flex-start",
        }}
      >
        <div>
          <div className="mono" style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".12em" }}>
            REGULATORY SOURCE LEDGER
          </div>
          <h3 style={{ margin: "6px 0 0", fontSize: 17 }}>건폐율·용적률·높이 원문 검증</h3>
          <p style={{ margin: "6px 0 0", fontSize: 11.5, lineHeight: 1.55, color: "var(--fg-muted)" }}>
            VWorld는 용도지역·지구 명칭을 조회합니다. 아래 숫자는 관할 조례·지구단위계획·가로구역 높이 등 필지별 원문을 확인한 뒤 저장해야 법규 통과 판정에 사용됩니다.
          </p>
        </div>
        <span
          style={{
            flexShrink: 0,
            borderRadius: 999,
            padding: "6px 9px",
            background: coreVerified ? "var(--pos-soft)" : "var(--warn-soft)",
            color: coreVerified ? "var(--pos-fg)" : "var(--warn-fg)",
            fontSize: 10.5,
            fontWeight: 800,
          }}
        >
          {coreVerified ? "핵심 3항목 원문 확인" : "핵심 원문 미확인"}
        </span>
      </div>

      <div style={{ padding: 20, display: "grid", gap: 18 }}>
        <div
          style={{
            padding: 12,
            borderRadius: 9,
            background: "var(--bg-sunken)",
            fontSize: 11,
            lineHeight: 1.55,
            color: "var(--fg-muted)",
          }}
        >
          <strong style={{ color: "var(--fg)" }}>공식 조회 사실</strong> · {parcel.zoning} ({parcel.zoneCode}) · {baseSet.zoningSource.sourceName}
          {parcel.overlays && parcel.overlays.length > 0 && (
            <div style={{ marginTop: 4 }}>
              중첩 {parcel.overlays.length}건: {parcel.overlays.map((item) => item.name).join(" · ")}
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
          {FIELD_META.map((field) => {
            const evidence = baseSet[field.key];
            const colors = badgeColor(evidence.status);
            return (
              <label key={field.key} style={{ display: "grid", gap: 6, padding: 12, border: "1px solid var(--border)", borderRadius: 9 }}>
                <span style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11.5, fontWeight: 700 }}>
                  {field.label}
                  <span style={{ borderRadius: 999, padding: "2px 6px", background: colors.bg, color: colors.fg, fontSize: 9.5 }}>
                    {constraintStatusLabel(evidence.status)}
                  </span>
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <input
                    type="number"
                    min="0"
                    step={field.unit === "층" ? "1" : "0.1"}
                    value={values[field.key]}
                    onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                    placeholder={field.requiredForCore ? "필수 확인" : "지정된 경우만"}
                    style={{ width: "100%", height: 36, border: "1px solid var(--border-strong)", borderRadius: 7, padding: "0 9px", background: "var(--bg)", color: "var(--fg)", font: "inherit" }}
                  />
                  <span style={{ flexShrink: 0, fontSize: 11, color: "var(--fg-muted)" }}>{field.unit}</span>
                </div>
                <small style={{ minHeight: 28, fontSize: 9.5, lineHeight: 1.45, color: "var(--fg-faint)" }}>
                  {evidence.sourceName}
                </small>
              </label>
            );
          })}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
          <Field label="원문·고시·조례명" value={sourceName} onChange={setSourceName} placeholder="예: 서울특별시 도시계획 조례" />
          <Field label="원문 URL 또는 문서번호" value={sourceRef} onChange={setSourceRef} placeholder="공식 URL·고시번호·파일 참조" />
          <Field label="기준일" value={asOf} onChange={setAsOf} type="date" />
          <Field label="확인자" value={checkedBy} onChange={setCheckedBy} placeholder="성명" />
          <Field label="확인 역할" value={checkedRole} onChange={setCheckedRole} placeholder="건축사·도시계획 담당 등" />
          <Field label="적용 메모" value={note} onChange={setNote} placeholder="완화·중첩·적용 조건" />
        </div>

        {message && (
          <div role="status" style={{ padding: "9px 11px", borderRadius: 8, background: "var(--accent-soft)", color: "var(--accent-fg)", fontSize: 11.5 }}>
            {message}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <button type="button" onClick={resetToReference} style={secondaryButtonStyle}>
            참고값으로 되돌리기
          </button>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => persist(false)} style={secondaryButtonStyle}>
              사용자 입력 임시 저장
            </button>
            <button type="button" onClick={() => persist(true)} style={primaryButtonStyle}>
              원문 확인값 저장
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "date";
}) {
  return (
    <label style={{ display: "grid", gap: 5, fontSize: 10.5, color: "var(--fg-muted)" }}>
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        style={{ height: 36, border: "1px solid var(--border)", borderRadius: 7, padding: "0 9px", background: "var(--bg)", color: "var(--fg)", font: "inherit", fontSize: 11.5 }}
      />
    </label>
  );
}

const primaryButtonStyle = {
  border: "1px solid var(--fg)",
  borderRadius: 8,
  padding: "9px 12px",
  background: "var(--fg)",
  color: "var(--bg-elev)",
  font: "inherit",
  fontSize: 11,
  fontWeight: 750,
  cursor: "pointer",
} as const;

const secondaryButtonStyle = {
  ...primaryButtonStyle,
  border: "1px solid var(--border)",
  background: "var(--bg-elev)",
  color: "var(--fg-muted)",
} as const;
