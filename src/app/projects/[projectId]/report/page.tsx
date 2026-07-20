"use client";

/**
 * 예비 사업성 검토서 — 전문가 검토 전 한 장 요약.
 *
 * 저장된 분석 결과를 비교용으로 묶는다. 금융기관 약정, 시공사 견적,
 * 세무조정과 외부 가격검증 전에는 투자 타당성 확정 보고서로 사용하지 않는다.
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
            예비 사업성 검토서<br />분석 기준일 {analysisDate}
          </div>
        </div>

        <div className="rpt-title">{parcel.address}</div>
        <div className="rpt-sub">
          {parcel.zoning} · 대지 {num(Math.round(parcel.lotArea * 100) / 100)}㎡ ({pyeong.toFixed(1)}평) · 검토 인수가 {won(parcel.acquiredPrice)}
        </div>

        <div
          role="status"
          style={{
            margin: "12px 0",
            padding: "10px 12px",
            border: "1px solid #d8a92e",
            borderRadius: 8,
            background: "#fff8dc",
            color: "#5f4600",
            fontSize: 11,
            lineHeight: 1.55,
          }}
        >
          <strong>예비 모델 · 전문가 검토 전</strong><br />
          아래 값은 저장 시점의 세전 비교값입니다. 금융기관 약정·시공사 견적·감정평가·세무 검토 전에는 매입 결정, 대출 심사 또는 세무신고에 사용할 수 없습니다.
        </div>

        {/* 대표 비교 시나리오 */}
        <div className="rpt-reco">
          <div className="rpt-reco-top">
            <span className="rpt-reco-name">대표 비교안 — {recommended.shortName} {recommended.name}</span>
            <span className="rpt-reco-badge">예비 비교안</span>
          </div>
          <div className="rpt-reco-kpis">
            <div className="rpt-reco-kpi"><div className="l">저장된 세전 손익</div><div className="v">{won(recommended.profit)}</div></div>
            <div className="rpt-reco-kpi"><div className="l">저장된 세전 IRR</div><div className="v">{recommended.irr.toFixed(1)}%</div></div>
            <div className="rpt-reco-kpi"><div className="l">DSCR</div><div className="v">{recommended.dscr > 0 ? recommended.dscr.toFixed(2) : "N/A"}</div></div>
            <div className="rpt-reco-kpi"><div className="l">예비 필요 자본</div><div className="v">{won(recommended.equity)}</div></div>
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
            <OvItem l="검토 인수가" v={won(parcel.acquiredPrice)} />
            <OvItem l="평당 검토 인수가" v={`${num(Math.round(parcel.acquiredPrice / pyeong))}만`} />
          </div>
        </div>

        {/* 시나리오 비교 */}
        <div className="rpt-sec">
          <div className="rpt-sec-h">시나리오 비교</div>
          <table className="rpt-table">
            <thead>
              <tr>
                <th>시나리오</th>
                <th className="num">세전 손익</th>
                <th className="num">이익률</th>
                <th className="num">세전 IRR</th>
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
                        <td className="num">{s.dscr > 0 ? s.dscr.toFixed(2) : "N/A"}</td>
                      </>
                    )}
                    <td>{unfit ? "—" : s.recommended ? "비교 우선" : "비교"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 실거래 근거 + 데이터 출처 */}
        <div className="rpt-sec">
          <div className="rpt-sec-h">관측자료 · 참고 출처</div>
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
          <span>예비 비교용 — 매입·대출·세무 의사결정 전 전문가 검토 필수</span>
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
