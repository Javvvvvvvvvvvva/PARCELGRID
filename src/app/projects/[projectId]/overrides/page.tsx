"use client";

/**
 * 가정 편집 (PDF p6) — 실시간 재계산 시뮬레이터.
 *
 * 시나리오의 가정(분양가·임대료·공사비·금리 등)을 슬라이더로 조정하면
 * calculateScenario를 클라에서 재호출 → 순이익·IRR·DSCR가 즉시 갱신.
 * finance 엔진이 순수함수라 서버 왕복 없이 즉답.
 */

import { use, useMemo, useState } from "react";
import { useProjectStore } from "@/lib/stores/project-store";
import { calculateScenario } from "@/lib/finance/scenario";
import { won, pct, num } from "@/lib/utils/format";
import type { AssumptionSet } from "@/lib/finance/types";

// 슬라이더 정의: 필드 / 라벨 / 단위 / min / max / step / 표시변환
type Knob = {
  field: keyof AssumptionSet;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  fmt?: (v: number) => string;
};

const GROUPS: { title: string; knobs: Knob[] }[] = [
  {
    title: "매출",
    knobs: [
      { field: "salePricePerSqM", label: "매각 단가(통매각)", unit: "만원/㎡", min: 2_500_000, max: 12_000_000, step: 100_000, fmt: (v) => num(Math.round(v / 10000)) },
      { field: "rentPerSqMMonth", label: "임대료", unit: "원/㎡·월", min: 8_000, max: 60_000, step: 1_000, fmt: (v) => num(v) },
      { field: "vacancyRate", label: "공실률", unit: "%", min: 0, max: 20, step: 0.5 },
      { field: "capRate", label: "Cap rate", unit: "%", min: 3, max: 8, step: 0.1 },
    ],
  },
  {
    title: "비용",
    knobs: [
      { field: "constCostPerSqM", label: "공사비", unit: "만원/㎡", min: 1_500_000, max: 5_000_000, step: 50_000, fmt: (v) => num(Math.round(v / 10000)) },
      { field: "softCostRate", label: "설계·인허가", unit: "%", min: 5, max: 20, step: 1 },
      { field: "contingencyRate", label: "예비비", unit: "%", min: 0, max: 15, step: 1 },
    ],
  },
  {
    title: "금융",
    knobs: [
      { field: "ltcTarget", label: "PF 비율(LTC)", unit: "%", min: 50, max: 90, step: 1 },
      { field: "interestRate", label: "PF 금리", unit: "%", min: 3, max: 12, step: 0.1 },
    ],
  },
  {
    title: "기간",
    knobs: [
      { field: "designMonths", label: "설계·인허가", unit: "개월", min: 3, max: 18, step: 1 },
      { field: "constructionMonths", label: "공사", unit: "개월", min: 6, max: 36, step: 1 },
      { field: "saleOutMonths", label: "분양·매각", unit: "개월", min: 1, max: 24, step: 1 },
    ],
  },
];

export default function OverridesPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  use(params);
  const data = useProjectStore((s) => s.data);

  const scenarios = data?.scenarios ?? [];
  const [activeId, setActiveId] = useState<string | null>(scenarios[0]?.id ?? null);
  const active = scenarios.find((s) => s.id === activeId) ?? scenarios[0];

  // 편집 중인 가정 (override). null이면 기본값.
  const [overrides, setOverrides] = useState<Partial<AssumptionSet>>({});

  const baseAssumptions = active?._raw?.assumptions;

  // 현재 가정 = 기본 + override
  const current = useMemo<AssumptionSet | null>(() => {
    if (!baseAssumptions) return null;
    return { ...baseAssumptions, ...overrides };
  }, [baseAssumptions, overrides]);

  // 기본 결과 (override 없이)
  const baseResult = useMemo(() => {
    if (!active?._raw || !data?.parcel) return null;
    try {
      return calculateScenario({ parcel: data.parcel, scenario: active._raw });
    } catch {
      return null;
    }
  }, [active, data?.parcel]);

  // 편집된 결과 (실시간 재계산)
  const editedResult = useMemo(() => {
    if (!active?._raw || !data?.parcel || !current) return null;
    try {
      return calculateScenario({
        parcel: data.parcel,
        scenario: { ...active._raw, assumptions: current },
      });
    } catch {
      return null;
    }
  }, [active, data?.parcel, current]);

  if (!data) return null;
  if (active && !active._raw) {
    return (
      <div style={{ padding: 40, color: "var(--fg-muted)", lineHeight: 1.6 }}>
        가정 편집에 필요한 시나리오 원본 데이터가 없습니다.<br />
        <span style={{ fontSize: 13 }}>이 부지를 다시 분석하면 활성화됩니다. (좌측 상단에서 주소 재분석)</span>
      </div>
    );
  }
  if (!active || !current || !baseResult || !editedResult) {
    return <div style={{ padding: 40, color: "var(--fg-muted)" }}>시나리오 데이터가 없습니다.</div>;
  }

  const dirty = Object.keys(overrides).length > 0;
  const setKnob = (field: keyof AssumptionSet, value: number) =>
    setOverrides((o) => ({ ...o, [field]: value }));

  // IRR 근사 (ScenarioResult에 irr 없으면 profit/equity 기반) — 실제 필드명에 맞춤
  const irrOf = (r: typeof baseResult) => (r as { irr?: number }).irr ?? 0;
  const profitOf = (r: typeof baseResult) => (r as { profit?: number }).profit ?? 0;

  return (
    <div style={{ padding: 20 }}>
      {/* 시나리오 탭 */}
      <div className="ui-tabs" style={{ marginBottom: 16, paddingLeft: 0 }}>
        {scenarios.map((s) => (
          <div key={s.id} className={`ui-tab ${s.id === active.id ? "ui-tab--active" : ""}`}
            onClick={() => { setActiveId(s.id); setOverrides({}); }}>
            {s.shortName} · {s.name}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", gap: 20, alignItems: "start" }}>
        {/* 좌측: 가정 슬라이더 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {GROUPS.map((g) => (
            <div key={g.title} className="ui-panel" style={{ padding: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{g.title}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {g.knobs.map((k) => {
                  const v = current[k.field] as number;
                  const base = baseAssumptions![k.field] as number;
                  const changed = v !== base;
                  const show = k.fmt ? k.fmt(v) : String(v);
                  return (
                    <div key={k.field}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                        <span style={{ fontSize: 12.5, color: "var(--fg-muted)" }}>{k.label}</span>
                        <span style={{ fontSize: 13, fontFamily: "var(--font-mono, monospace)", fontWeight: changed ? 700 : 500, color: changed ? "var(--accent)" : "var(--fg)" }}>
                          {show} <span style={{ fontSize: 11, color: "var(--fg-subtle)" }}>{k.unit}</span>
                        </span>
                      </div>
                      <input type="range" min={k.min} max={k.max} step={k.step} value={v}
                        onChange={(e) => setKnob(k.field, Number(e.target.value))}
                        style={{ width: "100%", accentColor: "var(--accent)" }} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* 우측: 실시간 결과 (sticky) */}
        <div style={{ position: "sticky", top: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="ui-panel" style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>실시간 결과</span>
              {dirty && (
                <button className="ui-btn ui-btn--sm" onClick={() => setOverrides({})}>기본값 복원</button>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <ResultRow label="순이익" base={profitOf(baseResult)} edited={profitOf(editedResult)} fmt={(v) => won(v)} dirty={dirty} />
              <ResultRow label="총수입" base={baseResult.totalRevenue} edited={editedResult.totalRevenue} fmt={(v) => won(v)} dirty={dirty} />
              <ResultRow label="총비용" base={baseResult.totalCost} edited={editedResult.totalCost} fmt={(v) => won(v)} dirty={dirty} invert />
            </div>
          </div>
          {dirty && (
            <div style={{ fontSize: 11.5, color: "var(--fg-subtle)", padding: "0 4px", lineHeight: 1.5 }}>
              ↳ 슬라이더를 움직이면 즉시 재계산됩니다. 기본 가정은 서울 표준값 기준이며, 본 부지 실거래·견적에 맞게 조정하세요.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultRow({ label, base, edited, fmt, dirty, invert }: {
  label: string; base: number; edited: number; fmt: (v: number) => string; dirty: boolean; invert?: boolean;
}) {
  const delta = edited - base;
  const better = invert ? delta < 0 : delta > 0;
  const deltaPct = base !== 0 ? (delta / Math.abs(base)) * 100 : 0;
  return (
    <div>
      <div style={{ fontSize: 11.5, color: "var(--fg-muted)", marginBottom: 2 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--font-mono, monospace)" }}>{fmt(edited)}</span>
        {dirty && Math.abs(delta) > 0.5 && (
          <span style={{ fontSize: 12, fontWeight: 600, color: better ? "var(--pos-fg, var(--pos))" : "var(--neg-fg, var(--neg))" }}>
            {delta > 0 ? "+" : ""}{deltaPct.toFixed(1)}%
          </span>
        )}
      </div>
      {dirty && Math.abs(delta) > 0.5 && (
        <div style={{ fontSize: 11, color: "var(--fg-subtle)" }}>기본 {fmt(base)}</div>
      )}
    </div>
  );
}
