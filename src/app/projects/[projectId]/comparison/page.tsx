"use client";

/**
 * 시나리오 비교 — PARCELGRID (PDF p2 재현, 그리드/가독성 강화판).
 *
 * - 라벨 | 시나리오 열들을 세로 구분선으로 명확히 분리
 * - 값(굵게, 왼쪽) / 기준안 대비 증감(작게, 오른쪽) 한 셀 안에서 분리
 * - 기준안 열은 증감 없이 값만 + 회색 톤 + "기준" 뱃지
 * - 퍼센트형 지표(이익률·IRR·LTC·용적률·PF금리)는 증감을 %p로 표기, 값엔 + 안 붙임
 * - 데이터는 스토어에서, layout이 hydration 담당
 */

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useProjectStore } from "@/lib/stores/project-store";
import { num, won, scenarioViable } from "@/lib/utils/format";
import { calculateScenario } from "@/lib/finance/scenario";
import type { ScenarioVM } from "@/lib/adapters/view-model";

/** 값 포맷 종류. pp = 퍼센트 지표(값 자체가 %), 증감은 %p */
type Fmt = "won" | "pp" | "x" | "month" | "raw";

interface MetricRow {
  label: string;
  get: (s: ScenarioVM) => number;
  fmt: Fmt;
  /** true=높을수록 유리(녹색), false=낮을수록 유리 */
  higherBetter: boolean;
}
interface Section { title: string; hint: string; rows: MetricRow[]; }

const SECTIONS: Section[] = [
  {
    title: "수익성",
    hint: "사업의 외형과 남는 돈",
    rows: [
      { label: "총 매출", get: (s) => s.revenue, fmt: "won", higherBetter: true },
      { label: "총 사업비", get: (s) => s.cost, fmt: "won", higherBetter: false },
      { label: "순이익", get: (s) => s.profit, fmt: "won", higherBetter: true },
      { label: "이익률", get: (s) => s.profitMargin, fmt: "pp", higherBetter: true },
      { label: "IRR", get: (s) => s.irr, fmt: "pp", higherBetter: true },
      { label: "Equity Multiple", get: (s) => s.equityMultiple, fmt: "x", higherBetter: true },
    ],
  },
  {
    title: "자본 구조 & PF",
    hint: "내 돈은 얼마, 빌리는 돈은 얼마, 갚을 수 있나",
    rows: [
      { label: "투입 자본", get: (s) => s.equity, fmt: "won", higherBetter: false },
      { label: "PF 한도", get: (s) => s.pf, fmt: "won", higherBetter: true },
      { label: "LTC", get: (s) => s.ltc, fmt: "pp", higherBetter: false },
      { label: "DSCR", get: (s) => s.dscr, fmt: "x", higherBetter: true },
      { label: "PF 금리 가정", get: (s) => s.assumptions.intRate, fmt: "pp", higherBetter: false },
      { label: "사업 기간", get: (s) => s.timeline, fmt: "month", higherBetter: false },
    ],
  },
  {
    title: "건축 / 규제",
    hint: "얼마나 크게 지을 수 있나",
    rows: [
      { label: "용적률", get: (s) => s.far, fmt: "pp", higherBetter: true },
      { label: "연면적", get: (s) => s.gfa, fmt: "raw", higherBetter: true },
      { label: "규제 점수", get: (s) => s.regulatory, fmt: "raw", higherBetter: true },
    ],
  },
];

/** 값 표시 (증감 아님 — + 안 붙임) */
function fmtVal(v: number, fmt: Fmt): string {
  switch (fmt) {
    case "won": return Math.abs(v) >= 10000 ? `${(v / 10000).toFixed(1)}억` : `${Math.round(v).toLocaleString()}만`;
    case "pp": return `${v.toFixed(1)}%`;
    case "x": return `${v.toFixed(2)}x`;
    case "month": return `${Math.round(v)}개월`;
    case "raw": return num(v);
  }
}

/** 기준안 대비 증감 표시. pp는 %p 차이, 그 외는 % 변화율 */
function fmtDelta(v: number, base: number, fmt: Fmt): { text: string; raw: number } | null {
  if (v === base) return { text: "—", raw: 0 };
  if (fmt === "pp") {
    const d = v - base;
    return { text: `${d > 0 ? "+" : ""}${d.toFixed(1)}%p`, raw: d };
  }
  if (base === 0) return null;
  const d = ((v - base) / Math.abs(base)) * 100;
  return { text: `${d > 0 ? "+" : ""}${d.toFixed(1)}%`, raw: d };
}

export default function ComparisonPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const router = useRouter();
  const data = useProjectStore((s) => s.data);
  const scenarios = data?.scenarios ?? [];

  const recommended = scenarios.find((s) => s.recommended) ?? scenarios[0];
  const [baseId, setBaseId] = useState<string>(
    () => scenarios.find((s) => !s.recommended)?.id ?? recommended?.id ?? ""
  );
  const tab = "compare" as const;

  if (!data || scenarios.length === 0) return null;

  const base = scenarios.find((s) => s.id === baseId) ?? scenarios[0];
  const ordered = [
    ...scenarios.filter((s) => s.recommended),
    ...scenarios.filter((s) => !s.recommended),
  ];

  // 그리드 컬럼: 라벨 + 시나리오들
  const cols = `220px repeat(${ordered.length}, minmax(0, 1fr))`;

  return (
    <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      {/* 탭 + 기준안 */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <Tab active={tab === "compare"} >
          시나리오 비교 <Badge>{scenarios.length}</Badge>
        </Tab>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: "var(--fg-muted)" }}>기준안</span>
          <select
            value={baseId}
            onChange={(e) => setBaseId(e.target.value)}
            style={{ height: 30, padding: "0 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--fg)", fontSize: 13 }}
          >
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>{s.shortName} · {s.typeKr}</option>
            ))}
          </select>
        </div>
      </div>

      {(
        <>
          {/* 범례 */}
          <div style={{ display: "flex", gap: 16, alignItems: "center", fontSize: 12, color: "var(--fg-muted)" }}>
            <span>각 값 우측 = <b style={{ color: "var(--fg)" }}>기준안({base.shortName}) 대비</b></span>
            <LegendDot color="var(--pos, #16a34a)" /> 유리
            <LegendDot color="var(--neg, #dc2626)" /> 불리
            <span>· %p = 퍼센트 포인트 차이</span>
          </div>

          {/* 카드 헤더 */}
          <div style={{ display: "grid", gridTemplateColumns: cols, border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ background: "var(--bg-elev)" }} />
            {ordered.map((s, i) => {
              const isRec = s.recommended;
              const isBase = s.id === base.id;
              return (
                <div
                  key={s.id}
                  onClick={() => router.push(`/projects/${projectId}/scenarios/${s.id}`)}
                  style={{
                    padding: 16, cursor: "pointer",
                    borderLeft: "1px solid var(--border)",
                    background: isRec ? "var(--fg)" : isBase ? "var(--bg-sunken, #f8f8f8)" : "var(--bg-elev)",
                    color: isRec ? "var(--bg)" : "var(--fg)",
                    display: "flex", flexDirection: "column", gap: 6,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11.5 }}>
                    <span style={{ opacity: 0.7 }}>{s.shortName}</span>
                    {isRec ? <Pill dark>권장</Pill> : isBase ? <Pill>기준</Pill> : null}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{s.typeKr}</div>
                  <div style={{ fontSize: 11.5, opacity: 0.65 }}>
                    {s.tag ? `${s.tag} · ` : ""}{s.floors.above}F/B{s.floors.below}
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: s.profit < 0 ? "var(--neg-fg)" : undefined }}>
                    {Math.abs(s.profit) >= 10000 ? `${(s.profit / 10000).toFixed(1)}억` : `${Math.round(s.profit).toLocaleString()}만`}
                  </div>
                  {scenarioViable(s).ok ? (
                    <div style={{ fontSize: 11.5, opacity: 0.65 }}>예상 이익 · 마진 {s.profitMargin.toFixed(1)}%</div>
                  ) : (
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--neg-fg)", background: "rgba(155,45,34,0.08)", padding: "2px 8px", borderRadius: 4, display: "inline-block", marginTop: 4 }}>
                      {scenarioViable(s).label}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 섹션 매트릭스 */}
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "6px 4px" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>{section.title}</span>
                <span style={{ fontSize: 11.5, color: "var(--fg-muted)" }}>{section.hint}</span>
              </div>
              <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
                {section.rows.map((row, ri) => {
                  const bVal = row.get(base);
                  return (
                    <div
                      key={row.label}
                      className="cmp-row"
                      style={{
                        display: "grid", gridTemplateColumns: cols,
                        borderTop: ri === 0 ? "none" : "1px solid var(--border)",
                      }}
                    >
                      <div style={{ padding: "11px 16px", fontSize: 13, color: "var(--fg-muted)", display: "flex", alignItems: "center" }}>
                        {row.label}
                      </div>
                      {ordered.map((s) => {
                        const v = row.get(s);
                        const isBase = s.id === base.id;
                        const d = isBase ? null : fmtDelta(v, bVal, row.fmt);
                        const good = d && d.raw !== 0 ? (row.higherBetter ? d.raw > 0 : d.raw < 0) : null;
                        return (
                          <div
                            key={s.id}
                            style={{
                              padding: "11px 16px", borderLeft: "1px solid var(--border)",
                              display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10,
                              background: isBase ? "var(--bg-sunken, #fafafa)" : "transparent",
                            }}
                          >
                            <span style={{ fontSize: 14, fontWeight: 600, fontFamily: "var(--font-mono, monospace)", color: v < 0 ? "var(--neg, #dc2626)" : "var(--fg)" }}>
                              {fmtVal(v, row.fmt)}
                            </span>
                            {d && (
                              <span style={{ fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap", color: good == null ? "var(--fg-subtle, #aaa)" : good ? "var(--pos, #16a34a)" : "var(--neg, #dc2626)" }}>
                                {d.raw > 0 ? "▲" : d.raw < 0 ? "▼" : ""}{d.text.replace(/^[+-]/, "")}
                              </span>
                            )}
                            {isBase && (
                              <span style={{ fontSize: 11, color: "var(--fg-subtle, #aaa)", whiteSpace: "nowrap" }}>기준</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      )}

      <style>{`.cmp-row:hover { background: var(--bg-hover, rgba(0,0,0,0.015)); }`}</style>
    </div>
  );
}

function Tab({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{ padding: "8px 14px", fontSize: 13, fontWeight: active ? 600 : 400, color: active ? "var(--fg)" : "var(--fg-muted)", borderBottom: active ? "2px solid var(--fg)" : "2px solid transparent", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
      {children}
    </div>
  );
}
function Badge({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 999, background: "var(--bg-active, #e5e7eb)", color: "var(--fg-muted)" }}>{children}</span>;
}
function Pill({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return <span style={{ fontSize: 10.5, fontWeight: 600, padding: "2px 6px", borderRadius: 4, background: dark ? "var(--bg)" : "var(--bg-active, #e5e7eb)", color: dark ? "var(--fg)" : "var(--fg-muted)" }}>{children}</span>;
}
function LegendDot({ color }: { color: string }) {
  return <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: color, marginRight: -8 }} />;
}
/* ─── 민감도 비교 (핵심가격 ±10% → 순이익) ───────────────── */
function SensitivityCompare({
  scenarios,
  parcel,
}: {
  scenarios: ScenarioVM[];
  parcel: import("@/lib/finance/types").Parcel;
}) {
  if (!parcel) {
    return <Placeholder title="민감도 분석" />;
  }

  const STEPS = [-10, 0, 10]; // 핵심가격 %

  // 각 시나리오: 핵심가격(분양형=분양가/임대형=임대료) ±10% 재계산
  const rows = scenarios.map((s) => {
    const raw = s._raw;
    const isSale = raw ? raw.assumptions.salePricePerSqM > 0 : true;
    const priceLabel = isSale ? "분양가" : "임대료";

    const vals = STEPS.map((ds) => {
      if (!raw) return s.profit;
      const a = isSale
        ? {
            ...raw.assumptions,
            salePricePerSqM: Math.round(raw.assumptions.salePricePerSqM * (1 + ds / 100)),
          }
        : {
            ...raw.assumptions,
            rentPerSqMMonth: Math.round(raw.assumptions.rentPerSqMMonth * (1 + ds / 100)),
          };
      try {
        return calculateScenario({ parcel, scenario: { ...raw, assumptions: a } }).profit;
      } catch {
        return s.profit;
      }
    });
    return { s, vals, priceLabel };
  });

  // 전체 min/max로 막대 스케일 (손익분기 0 중심)
  const allVals = rows.flatMap((r) => r.vals);
  const absMax = Math.max(1, ...allVals.map((v) => Math.abs(v)));
  const scale = absMax * 1.1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 12, color: "var(--fg-muted)", marginBottom: 8 }}>
        각 시나리오의 핵심 가격(분양가 또는 임대료)을 −10% / 0 / +10% 변동시켰을 때 순이익 범위.
        막대가 손익분기선(0) 오른쪽이면 흑자, 왼쪽이면 손실.
      </div>
      {rows.map(({ s, vals, priceLabel }) => {
        const lo = Math.min(...vals);
        const hi = Math.max(...vals);
        const mid = vals[1];
        const allPos = lo >= 0;
        const allNeg = hi < 0;
        const color = allPos ? "var(--pos-fg, #1f6b40)" : allNeg ? "var(--neg-fg)" : "var(--edge-gold, #c9a227)";

        // 막대 위치 (%) — 중앙 50%가 0
        const toPct = (v: number) => 50 + (v / scale) * 50;
        const leftPct = Math.min(toPct(lo), toPct(hi));
        const widthPct = Math.abs(toPct(hi) - toPct(lo));

        return (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
            <div style={{ width: 130, flexShrink: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{s.shortName} {s.name}</div>
              <div style={{ fontSize: 11, color: "var(--fg-muted)" }}>{priceLabel} 기준</div>
            </div>
            <div style={{ flex: 1, position: "relative", height: 40, background: "var(--bg-sunken)", borderRadius: 6, overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: 1, background: "var(--border)" }} />
              <div
                style={{
                  position: "absolute",
                  top: 9,
                  height: 22,
                  left: `${leftPct}%`,
                  width: `${Math.max(2, widthPct)}%`,
                  background: color,
                  opacity: 0.85,
                  borderRadius: 3,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span style={{ fontSize: 10.5, color: "#fff", whiteSpace: "nowrap", fontFamily: "var(--font-mono)" }}>
                  {won(lo)} ~ {won(hi)}
                </span>
              </div>
            </div>
            <div style={{ width: 110, textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 13, fontFamily: "var(--font-mono)", fontWeight: 600, color: mid >= 0 ? "var(--fg)" : "var(--neg-fg)" }}>
                {won(mid)}
              </div>
              <div style={{ fontSize: 11, color: "var(--fg-muted)" }}>
                {allPos ? "전구간 흑자" : allNeg ? "전구간 손실" : "손익 혼재"}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <div style={{ border: "1px dashed var(--border)", borderRadius: 10, padding: "48px 20px", textAlign: "center", color: "var(--fg-muted)" }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: "var(--fg)" }}>{title}</div>
      <div style={{ fontSize: 13 }}>준비 중입니다 — 다음 업데이트에서 제공됩니다.</div>
    </div>
  );
}
