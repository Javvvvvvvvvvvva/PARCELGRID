"use client";

import { useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { dwellingComparisonCandidates, dwellingSensitivity } from "@/lib/planning/dwelling-comparison";
import { dwellingProgramSummary } from "@/lib/planning/dwelling-program";
import type { PlanningRecommendationEngineInput, RecommendationCandidateEvaluation } from "@/lib/planning/recommendation-engine";
import type { PlanningScenario } from "@/lib/planning/types";
import { num, won } from "@/lib/utils/format";

export function DwellingComparisonTable({ evaluations, input, onCopy }: {
  evaluations: RecommendationCandidateEvaluation[];
  input: PlanningRecommendationEngineInput;
  onCopy: (scenario: PlanningScenario) => void;
}) {
  const [unitFilter, setUnitFilter] = useState("all");
  const candidates = useMemo(() => dwellingComparisonCandidates(evaluations), [evaluations]);
  const rows = useMemo(() => candidates.map((candidate) => ({
    candidate, summary: dwellingProgramSummary(candidate.scenario.floorPrograms),
    stress: dwellingSensitivity(candidate.scenario, input, -10, 15),
  })), [candidates, input]);
  if (!rows.length) return null;
  const counts = [...new Set(rows.map((row) => row.summary.unitCount))].sort((a, b) => a - b);
  return (
    <section aria-label="세대 구성 자동 비교" style={{ marginTop: 18, borderTop: "1px solid var(--border)", paddingTop: 14, minWidth: 0 }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h3 style={{ fontSize: 14, margin: 0 }}>세대 구성 자동 비교</h3>
        <label style={{ fontSize: 11 }}>세대수 <select aria-label="비교 세대수" value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)}>
          <option value="all">전체</option>{counts.map((count) => <option key={count} value={count}>{count}세대</option>)}
        </select></label>
      </header>
      <p style={{ color: "var(--warn-fg)", fontSize: 11, lineHeight: 1.6 }}>
        예비 면적 프로그램 · 실내 평면, 차량 회전궤적, 진출입 허가 미검증. 주차 배치가 없는 후보의 손익은 공간 실현을 전제한 조건부 값입니다.
      </p>
      <div role="region" aria-label="세대별 주차·손익 비교표" tabIndex={0} style={{ overflowX: "auto", maxWidth: "100%" }}>
        <table style={{ width: "100%", minWidth: 900, borderCollapse: "collapse", fontSize: 11, textAlign: "left" }}>
          <thead><tr>{["구성 / 주차 방식", "전용 / 용적률", "주차 필요 / 2D 배치", "매출 / 총비용", "개략 손익", "매각 -10%·공사 +15%", "검증 상태", "편집"].map((label) => <th key={label} style={cell}>{label}</th>)}</tr></thead>
          <tbody>{rows.filter(({ summary }) => unitFilter === "all" || summary.unitCount === Number(unitFilter)).map(({ candidate: c, summary: s, stress }) => {
            const p = c.calculation.economicsPreview;
            const missingBoundary = c.calculation.checks.some((check) => check.code === "spatial-envelope-data" && check.status === "unknown");
            const issues = c.calculation.checks.filter((check) => check.status !== "pass");
            const floors = c.scenario.floorPrograms.filter((floor) => floor.zones.some((z) => z.useType === "residential")).length;
            return <tr key={c.scenario.id}>
              <td style={cell}><strong>{s.unitCount}세대 · 주거 {floors}층</strong><br />{s.maxExclusiveSqm - s.minExclusiveSqm > 1 ? "혼합 평형" : "단일 평형"} · {c.scenario.parking.strategy === "piloti" ? "필로티" : "지상"}</td>
              <td style={cell}>{num(s.minExclusiveSqm, 1)}{s.maxExclusiveSqm - s.minExclusiveSqm > 0.1 ? `~${num(s.maxExclusiveSqm, 1)}` : ""}㎡<br />{num(c.calculation.metrics.preliminaryFarPct, 1)}%</td>
              <td style={cell}>{c.calculation.parking.requiredCars}대 / {missingBoundary ? "미확인" : `${c.parkingLayout.capacityCars}대`}<br /><span style={{ color: "var(--fg-muted)" }}>회전궤적 미검증</span></td>
              <td style={cell}>{won(p.expectedRevenueManwon)}<br />{won(p.totalCostManwon)}</td>
              <td style={cell}>{won(p.profitManwon, { sign: true })}</td>
              <td style={{ ...cell, color: stress.profitManwon < 0 ? "var(--neg-fg)" : "var(--fg)" }}>{won(stress.profitManwon, { sign: true })}</td>
              <td style={{ ...cell, maxWidth: 240 }}><details><summary style={{ cursor: "pointer" }}>{missingBoundary ? "경계 미확인" : c.eligible ? "2D 예비 후보" : "미충족"} · {issues.length}항목</summary>
                <ul style={{ paddingLeft: 16, lineHeight: 1.5 }}>{issues.map((check) => <li key={check.code}>{check.label}: {check.message}</li>)}</ul>
              </details></td>
              <td style={cell}><button type="button" onClick={() => onCopy(c.scenario)} aria-label={`${s.unitCount}세대 주거 ${floors}층 계획 복사`} title="내 계획안으로 복사" style={iconButton}><Copy size={16} /></button></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <p style={{ fontSize: 10, color: "var(--fg-muted)", lineHeight: 1.6 }}>각 세대수·주거층수·평형·주차 방식에서 예비 적격 여부, 형상 실패 수, 개략 손익 순으로 고른 후보입니다. 탐색 범위 내 비교이며 전체 설계의 최적해가 아닙니다. 평형별 단가는 별도 근거가 없으면 공통 단가 가정입니다. 민감도는 금융 기간·분양 지연이 고정된 Stage 2 개략값입니다.</p>
    </section>
  );
}

const cell: React.CSSProperties = { padding: "10px 8px", borderBottom: "1px solid var(--border)", verticalAlign: "top", lineHeight: 1.55 };
const iconButton: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--fg)", cursor: "pointer" };
