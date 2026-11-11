"use client";

import { sessionFetch as fetch } from "@/lib/auth/client-session";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import { useProjectStore } from "@/lib/stores/project-store";
import { analyzeDwellingMarket, dwellingMarketBands, dwellingMarketLocation, dwellingMarketTargets, DWELLING_MARKET_SOURCE, koreaDate, MARKET_EXCLUSION_LABELS } from "@/lib/finance/dwelling-market";
import { transactionEvidenceMessage } from "@/lib/integrations/molit-evidence";
import type { MolitRangeEvidence } from "@/lib/integrations/molit-evidence";
import type { CompVM } from "@/lib/adapters/view-model";
import type { PlanningDwellingProgram, PlanningScenario } from "@/lib/planning/types";
import { num } from "@/lib/utils/format";

export function DwellingMarketEvidencePanel({ scenario, onChange }: {
  scenario: PlanningScenario; onChange: (program: PlanningDwellingProgram) => void;
}) {
  const data = useProjectStore(state => state.data);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => {
    setBusy(false); setError(null);
    return () => { requestRef.current?.abort(); requestRef.current = null; };
  }, [data?.parcel.id, data?.parcel.address]);
  const location = data ? dwellingMarketLocation(data.parcel) : { lawdCd: "", dongName: "" };
  const asOf = koreaDate();
  const report = useMemo(() => analyzeDwellingMarket({
    comps: data?.dwellingMarket?.comps ?? [], evidence: data?.dwellingMarket?.evidence,
    targets: dwellingMarketTargets(scenario), lawdCd: location.lawdCd, dongName: location.dongName,
    asOf, projectId: data?.parcel.id ?? "",
  }), [data, scenario, location.lawdCd, location.dongName, asOf]);
  const bands = dwellingMarketBands(report);

  async function refresh() {
    if (!data || busy || !location.lawdCd || !location.dongName) return;
    const controller = new AbortController();
    requestRef.current?.abort(); requestRef.current = controller;
    const projectId = data.parcel.id;
    const address = data.parcel.address;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/parcels/dwelling-market", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(location), signal: controller.signal,
      });
      if (!response.ok) throw new Error("조회 실패");
      const result = await response.json() as { comps: CompVM[]; evidence: MolitRangeEvidence };
      if (!Array.isArray(result.comps) || result.evidence?.type !== "villa" || result.evidence?.lawdCd !== location.lawdCd) throw new Error("조회 형식 오류");
      const current = useProjectStore.getState();
      if (controller.signal.aborted || current.data?.parcel.id !== projectId || current.data.parcel.address !== address) return;
      current.setData({ ...current.data,
        dwellingMarket: { comps: result.comps, evidence: [result.evidence] },
        meta: { ...current.data.meta, lastSyncedAt: result.evidence.retrievedAt },
      });
    } catch {
      if (!controller.signal.aborted) setError("자료를 갱신하지 못했습니다. 기존 자료의 수집시각을 확인하세요.");
    } finally {
      if (requestRef.current === controller) { requestRef.current = null; setBusy(false); }
    }
  }

  if (!scenario.dwellingProgram) return null;
  return <section aria-label="평형별 실거래 근거" style={{ borderTop: "1px solid var(--border)", marginTop: 16, paddingTop: 14, minWidth: 0, scrollMarginTop: 120 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <h3 style={{ fontSize: 14, margin: 0 }}>평형별 실거래 근거</h3>
      <button type="button" title="공식 실거래 새로 조회" aria-label="공식 실거래 새로 조회" disabled={busy || !location.lawdCd || !location.dongName} onClick={refresh} style={button}>
        <RefreshCw size={15} />{busy ? "조회 중" : "공식 자료 조회"}
      </button>
    </div>
    <p style={note}>{location.dongName || "법정동 미확인"} · 최근 12개월 · 기준일 {asOf} · <a href={DWELLING_MARKET_SOURCE} target="_blank" rel="noreferrer">국토부 연립·다세대</a></p>
    <p style={note}>준공 5년 이내(거래연도 기준), 2~5층, 개인 매수·중개거래·등기일 확인 표본. 취소·특수 거래는 제외합니다. 같은 동은 반경 1km가 아니며, 신축 분양가·감정가와 다릅니다.</p>
    {(error || report.problem) && <p role="status" style={{ ...note, color: "var(--warn-fg)" }}>{error || report.problem}</p>}
    {report.collection && <details style={note}><summary>수집 범위와 시각</summary>
      <p>{transactionEvidenceMessage([report.collection])}</p>
      <div>{report.collection.startYearMonth}~{report.collection.endYearMonth} · 집계 {report.collection.retrievedAt}</div>
      {report.collection.sourceRetrievals?.map(item => <div key={item.month}>{item.month}: {item.oldestFetchedAt}~{item.newestFetchedAt}</div>)}
    </details>}
    {report.rows.map(row => <div key={row.targetExclusiveSqm} style={{ borderBottom: "1px solid var(--border)", padding: "12px 0", minWidth: 0 }}>
      <strong style={{ fontSize: 12 }}>전용 {num(row.targetExclusiveSqm, 2)}㎡ · {row.included.length}건 / {row.addressCount}개 주소</strong>
      <div style={note}>비교 범위 {num(Math.max(0, row.targetExclusiveSqm - row.tolerance), 2)}~{num(row.targetExclusiveSqm + row.tolerance, 2)}㎡</div>
      <div style={{ fontSize: 12, marginTop: 4 }}>{row.medianWon === null ? "관측 단가 없음" : `주소별 중앙값의 중앙값 ${num(row.medianWon / 10_000, 1)}만원/전용㎡`}</div>
      {row.minWon !== null && <div style={note}>거래 표본 범위 {num(row.minWon / 10_000, 1)}~{num(row.maxWon! / 10_000, 1)}만원/㎡ · 신뢰구간 아님</div>}
      <div style={{ ...note, color: row.applicable ? "var(--fg-muted)" : "var(--warn-fg)" }}>{row.applicable ? "관측 근거 확보 · 적용해도 사용자 가정이며 전문가 확인 전" : row.blockers.join(" · ")}</div>
      <details style={note}><summary>비교 거래 {row.included.length}건</summary>
        <div style={{ overflowX: "auto", maxHeight: 230 }}><table style={{ borderCollapse: "collapse", width: "100%", minWidth: 450 }}>
          <thead><tr>{["주소 / 계약일", "전용㎡ / 층", "거래가(만원)", "준공 / 등기일", "매도자"].map(text => <th key={text} style={cell}>{text}</th>)}</tr></thead>
          <tbody>{row.included.map(comp => <tr key={comp.id}><td style={cell}>{comp.address}<br />{comp.date}</td><td style={cell}>{num(comp.lotArea, 2)} / {comp.floor}층</td><td style={cell}>{num(comp.priceWon / 10_000, 0)}</td><td style={cell}>{comp.buildYear}<br />{comp.registrationDate}</td><td style={cell}>{comp.sellerType || "미확인"}</td></tr>)}</tbody>
        </table></div>
      </details>
      <details style={note}><summary>제외 {row.excluded.length}건 · 첫 제외 사유 기준</summary>
        {Object.entries(MARKET_EXCLUSION_LABELS).map(([key, label]) => {
          const matches = row.excluded.filter(item => item.reason === key);
          return matches.length ? <details key={key}><summary>{label}: {matches.length}건</summary><div style={{ maxHeight: 180, overflow: "auto" }}>{matches.map((item, index) => <div key={`${item.comp.id}-${index}`}>{item.comp.address} · {item.comp.date} · {num(item.comp.lotArea, 2)}㎡</div>)}</div></details> : null;
        })}
      </details>
    </div>)}
    <button type="button" disabled={!bands.length || busy} onClick={() => onChange({ ...scenario.dwellingProgram!, salePriceBands: bands })} style={{ ...button, marginTop: 12 }}>
      <Check size={15} />기존 평형 단가를 관측값으로 교체 ({bands.length}평형)
    </button>
    <p style={note}>근거 부족 평형: 공통 주거 매각 가정 유지. 채택 단가: 해당 계획 전용면적·2~5층에만 한정. 시장 변동·품질·위치 차이와 분양 가능성은 미확정입니다.</p>
  </section>;
}

const note: React.CSSProperties = { fontSize: 11, lineHeight: 1.65, color: "var(--fg-muted)", overflowWrap: "anywhere" };
const button: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 32, maxWidth: "100%", fontSize: 11, whiteSpace: "normal" };
const cell: React.CSSProperties = { textAlign: "left", padding: "5px 6px", borderBottom: "1px solid var(--border)", fontSize: 10 };
