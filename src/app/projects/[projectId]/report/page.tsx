"use client";

/**
 * 투자 타당성 보고서 (PDF p7) — 시행사 제출용 한 장 요약.
 *
 * 지금까지의 모든 분석(부지·시나리오·실거래·가정)을 한 페이지로 묶음.
 * 인쇄/PDF 친화 레이아웃. viable=false 시나리오는 "시행 불가"로 정직하게 표시.
 */

import { use, useMemo } from "react";
import { useProjectStore } from "@/lib/stores/project-store";
import { won, num, scenarioViable } from "@/lib/utils/format";

const SQM_PER_PYEONG = 3.305785;

export default function ReportPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  use(params);
  const data = useProjectStore((s) => s.data);

  const scenarios = data?.scenarios ?? [];
  const parcel = data?.parcel;
  const comps = data?.comps ?? [];

  const recommended = useMemo(
    () => scenarios.find((s) => s.recommended) ?? scenarios[0],
    [scenarios]
  );

  const compsMedian = useMemo(() => {
    if (comps.length === 0) return null;
    const sorted = [...comps.map((c) => c.pricePerPyeong)].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }, [comps]);

  if (!data || !parcel || !recommended) {
    return <div style={{ padding: 40, color: "var(--fg-muted)" }}>보고서를 생성할 데이터가 없습니다.</div>;
  }

  const pyeong = parcel.lotArea / SQM_PER_PYEONG;
  const analysisDate = data.meta?.lastSyncedAt
    ? new Date(data.meta.lastSyncedAt).toLocaleDateString("ko-KR")
    : new Date().toLocaleDateString("ko-KR");

  return (
    <div className="rpt-wrap">
      <div className="rpt-page">
        {/* 표지 헤더 */}
        <div className="rpt-head">
          <div className="rpt-brand">
            <svg width="24" height="24" viewBox="0 0 28 28" aria-hidden>
              <path d="M3.5 23 L14 4 L14 23 Z" fill="var(--accent)" />
              <path d="M24.5 23 L14 4 L14 23 Z" fill="var(--edge-gold)" />
            </svg>
            <div>
              <span className="rpt-co"><b>Double</b> Edge</span>
              <span className="rpt-pr">ParcelGrid</span>
            </div>
          </div>
          <div className="rpt-meta">
            투자 타당성 보고서<br />분석일 {analysisDate}
          </div>
        </div>

        <div className="rpt-title">{parcel.address}</div>
        <div className="rpt-sub">
          {parcel.zoning} · 대지 {num(Math.round(parcel.lotArea * 100) / 100)}㎡ ({pyeong.toFixed(1)}평) · 인수가 {won(parcel.acquiredPrice)}
        </div>

        {/* 권장 시나리오 */}
        <div className="rpt-reco">
          <div className="rpt-reco-top">
            <span className="rpt-reco-name">권장 — {recommended.shortName} {recommended.name}</span>
            <span className="rpt-reco-badge">★ 권장</span>
          </div>
          <div className="rpt-reco-kpis">
            <div className="rpt-reco-kpi"><div className="l">예상 순이익</div><div className="v">{won(recommended.profit)}</div></div>
            <div className="rpt-reco-kpi"><div className="l">IRR</div><div className="v">{recommended.irr.toFixed(1)}%</div></div>
            <div className="rpt-reco-kpi"><div className="l">DSCR</div><div className="v">{recommended.dscr.toFixed(2)}</div></div>
            <div className="rpt-reco-kpi"><div className="l">필요 자본</div><div className="v">{won(recommended.equity)}</div></div>
          </div>
        </div>

        {/* 부지 개요 */}
        <div className="rpt-sec">
          <div className="rpt-sec-h">부지 개요</div>
          <div className="rpt-ov">
            <OvItem l="대지면적" v={`${num(Math.round(parcel.lotArea * 100) / 100)}㎡ / ${pyeong.toFixed(1)}평`} />
            <OvItem l="용도지역" v={parcel.zoning} />
            <OvItem l="용적률 상한" v={`${parcel.maxFAR}%`} />
            <OvItem l="건폐율 상한" v={`${parcel.maxBCR}%`} />
            <OvItem l="인수가" v={won(parcel.acquiredPrice)} />
            <OvItem l="평당 인수가" v={`${num(Math.round(parcel.acquiredPrice / pyeong))}만`} />
          </div>
        </div>

        {/* 시나리오 비교 */}
        <div className="rpt-sec">
          <div className="rpt-sec-h">시나리오 비교</div>
          <table className="rpt-table">
            <thead>
              <tr>
                <th>시나리오</th>
                <th className="num">순이익</th>
                <th className="num">이익률</th>
                <th className="num">IRR</th>
                <th className="num">DSCR</th>
                <th>판정</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s) => {
                const unfit = !scenarioViable(s).ok;
                return (
                  <tr key={s.id} className={s.recommended ? "rpt-reco-row" : ""}>
                    <td>{s.shortName} {s.name}{s.recommended ? " ★" : ""}</td>
                    {unfit ? (
                      <td className="rpt-unfit" colSpan={4}>{scenarioViable(s).label} — {s.viabilityNote ?? "이 규모로는 수익이 비용을 밑돕니다"}</td>
                    ) : (
                      <>
                        <td className="num">{won(s.profit)}</td>
                        <td className="num">{s.profitMargin.toFixed(1)}%</td>
                        <td className="num">{s.irr.toFixed(1)}%</td>
                        <td className="num">{s.dscr.toFixed(2)}</td>
                      </>
                    )}
                    <td>{unfit ? "—" : s.recommended ? "권장" : "검토"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 실거래 근거 + 데이터 출처 */}
        <div className="rpt-sec">
          <div className="rpt-sec-h">실거래 근거 · 데이터 출처</div>
          <div className="rpt-src">
            {compsMedian != null && (
              <span className="rpt-src-item">국토교통부 실거래가 ({comps.length}건, 중앙값 평당 {num(compsMedian)}만)</span>
            )}
            <span className="rpt-src-item">V월드 지적·용도지역</span>
            <span className="rpt-src-item">MOLIT 건축물대장</span>
            <span className="rpt-src-item">Kakao 지오코딩</span>
          </div>
        </div>

        <div className="rpt-foot">
          <span>Double Edge · ParcelGrid v2.4</span>
          <span>정직한 답 — 추정값은 가정에 근거하며 실제와 다를 수 있습니다</span>
        </div>
      </div>

      {/* 인쇄 버튼 (화면에만, 인쇄 시 숨김) */}
      <div className="rpt-actions">
        <button className="ui-btn ui-btn--primary" onClick={() => window.print()}>
          PDF로 저장 / 인쇄
        </button>
      </div>
    </div>
  );
}

function OvItem({ l, v }: { l: string; v: string }) {
  return (
    <div className="rpt-ov-item">
      <span className="rpt-ov-l">{l}</span>
      <span className="rpt-ov-v">{v}</span>
    </div>
  );
}
