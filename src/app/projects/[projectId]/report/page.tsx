"use client";

/**
 * 예비 사업성 검토서 — 전문가 검토 전 한 장 요약.
 *
 * 저장된 분석 결과를 비교용으로 묶는다. 금융기관 약정, 시공사 견적,
 * 세무조정과 외부 가격검증 전에는 투자 타당성 확정 보고서로 사용하지 않는다.
 */

import { use, useMemo } from "react";
import Link from "next/link";
import { useProjectStore } from "@/lib/stores/project-store";
import { won, num, scenarioViable } from "@/lib/utils/format";
import { PROJECT_LEDGER_MODEL_VERSION } from "@/lib/finance/project-ledger";
import { buildEvidenceGate } from "@/lib/handoff/evidence-gate";
import {
  constraintStatusLabel,
  coreRegulatoryConstraintsVerified,
  type RegulatoryConstraintEvidence,
} from "@/lib/regulatory/constraints";

const SQM_PER_PYEONG = 3.305785;

export default function ReportPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const data = useProjectStore((s) => s.data);
  const representativeGeometry = useProjectStore(
    (state) => state.representativeGeometrySnapshot
  );

  const scenarios = data?.scenarios ?? [];
  const parcel = data?.parcel;
  const comps = data?.comps ?? [];
  const geometry =
    representativeGeometry?.projectId === projectId
      ? representativeGeometry
      : null;

  const evidenceGate = useMemo(() => {
    if (!data) return null;
    return buildEvidenceGate({
      projectId,
      address: data.parcel.address,
      geometryHash: geometry?.geometryHash ?? null,
      roadReferenceCount: data.parcel.roads?.length ?? 0,
      regulatorySourceBacked: coreRegulatoryConstraintsVerified(
        data.parcel.regulatoryConstraints
      ),
      saleCompCount: comps.length,
      saleEstimateVersion: data.saleEstimate?.modelVersion ?? null,
      acquisitionEstimateVersion:
        data.parcel.acquisitionEstimate?.modelVersion ?? null,
      financeModelVersion: PROJECT_LEDGER_MODEL_VERSION,
      taxComplete: false,
    });
  }, [comps.length, data, geometry, projectId]);

  const recommended = useMemo(
    () => scenarios.find((s) => s.recommended) ?? scenarios[0],
    [scenarios]
  );

  const compsMedian = useMemo(() => {
    if (comps.length === 0) return null;
    const sorted = [...comps.map((c) => c.pricePerPyeong)].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }, [comps]);

  if (!data || !parcel || !recommended || !evidenceGate) {
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
          <strong>Stage 5 예비 모델 · 전문가 검토 전</strong><br />
          아래 값은 저장 시점의 세전 비교값입니다. Stage 4 Evidence Gate 필수 미확인 {evidenceGate.criticalBlockerCount}건이 남아 있습니다. 금융기관 약정·시공사 견적·감정평가·세무 검토 전에는 매입 결정, 대출 심사 또는 세무신고에 사용할 수 없습니다.{" "}
          <Link href={`/projects/${projectId}/handoff`} style={{ color: "inherit", fontWeight: 700 }}>
            검증·인계 보드 확인
          </Link>
        </div>

        {/* 대표 비교 시나리오 */}
        <div className="rpt-reco">
          <div className="rpt-reco-top">
            <span className="rpt-reco-name">대표 비교안 — {recommended.shortName} {recommended.name}</span>
            <span className="rpt-reco-badge">예비 비교안</span>
          </div>
          <div className="rpt-reco-kpis">
            <div className="rpt-reco-kpi"><div className="l">Low 공사비(-15%) 손익</div><div className="v">{won(recommended.profitAtLowCost ?? recommended.profit)}</div></div>
            <div className="rpt-reco-kpi"><div className="l">Base 저장 손익</div><div className="v">{won(recommended.profit)}</div></div>
            <div className="rpt-reco-kpi"><div className="l">High 공사비(+20%) 손익</div><div className="v">{won(recommended.profitAtHighCost ?? recommended.profit)}</div></div>
            <div className="rpt-reco-kpi"><div className="l">저장된 세전 IRR</div><div className="v">{recommended.irrStatus === "calculated" ? `${recommended.irr.toFixed(1)}%` : "N/A"}</div></div>
          </div>
        </div>

        {/* 부지 개요 */}
        <div className="rpt-sec">
          <div className="rpt-sec-h">부지 개요</div>
          <div className="rpt-ov">
            <OvItem l="대지면적" v={`${num(Math.round(parcel.lotArea * 100) / 100)}㎡ / ${pyeong.toFixed(1)}평`} />
            <OvItem l="용도지역" v={parcel.zoning} />
            <OvItem
              l="용적률"
              v={`${parcel.maxFAR}% · ${constraintStatusLabel(parcel.regulatoryConstraints?.far.status ?? "unknown")}`}
            />
            <OvItem
              l="건폐율"
              v={`${parcel.maxBCR}% · ${constraintStatusLabel(parcel.regulatoryConstraints?.bcr.status ?? "unknown")}`}
            />
            <OvItem l="검토 인수가" v={won(parcel.acquiredPrice)} />
            <OvItem l="평당 검토 인수가" v={`${num(Math.round(parcel.acquiredPrice / pyeong))}만`} />
          </div>
        </div>

        {geometry && (
          <div className="rpt-sec">
            <div className="rpt-sec-h">대표 계획 매스 · Geometry Snapshot</div>
            <div className="rpt-ov">
              <OvItem l="층수" v={`지상 ${geometry.building.aboveFloors.length}층 · 지하 ${geometry.building.basementFloors.length}층`} />
              <OvItem l="프로그램 면적" v={`${num(Math.round(geometry.building.totalProgramAreaSqm * 10) / 10)}㎡`} />
              <OvItem l="실현 용적률" v={`${geometry.building.preliminaryFarPct.toFixed(1)}%`} />
              <OvItem l="기하 검증" v={geometry.validation.status === "pass" ? "대표안 적격 · 고정" : "추가 검토"} />
              <OvItem l="Geometry hash" v={geometry.geometryHash} />
            </div>
          </div>
        )}

        <div className="rpt-sec">
          <div className="rpt-sec-h">법규 수치 근거</div>
          <div style={{ marginBottom: 10, fontSize: 10.5, lineHeight: 1.55, color: "var(--fg-muted)" }}>
            VWorld는 용도지역·중첩 규제 명칭의 관측 출처입니다. 건폐율·용적률·높이 숫자는 아래 원문 상태가
            <strong> 원문 확인</strong> 또는 <strong>전문가 승인</strong>일 때만 법규 판정에 사용합니다.
          </div>
          <table className="rpt-table">
            <thead>
              <tr>
                <th>항목</th><th>값</th><th>근거 상태</th><th>원문·확인 정보</th>
              </tr>
            </thead>
            <tbody>
              <RegulatoryEvidenceRow label="건폐율" evidence={parcel.regulatoryConstraints?.bcr} />
              <RegulatoryEvidenceRow label="용적률" evidence={parcel.regulatoryConstraints?.far} />
              <RegulatoryEvidenceRow label="최고높이" evidence={parcel.regulatoryConstraints?.height} />
              <RegulatoryEvidenceRow label="층수 제한" evidence={parcel.regulatoryConstraints?.floors} />
            </tbody>
          </table>
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
                        <td className="num">{s.irrStatus === "calculated" ? `${s.irr.toFixed(1)}%` : "N/A"}</td>
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

function RegulatoryEvidenceRow({
  label,
  evidence,
}: {
  label: string;
  evidence?: RegulatoryConstraintEvidence;
}) {
  const value =
    evidence?.value != null ? `${num(evidence.value)}${evidence.unit}` : "미확인";
  const source = evidence
    ? [
        evidence.sourceName,
        evidence.sourceRef,
        evidence.asOf ? `기준일 ${evidence.asOf}` : null,
        evidence.checkedBy
          ? `확인 ${evidence.checkedBy}${evidence.checkedRole ? `(${evidence.checkedRole})` : ""}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "원문 미등록";
  return (
    <tr>
      <td>{label}</td>
      <td>{value}</td>
      <td>{constraintStatusLabel(evidence?.status ?? "unknown")}</td>
      <td style={{ maxWidth: 380, whiteSpace: "normal", lineHeight: 1.45 }}>{source}</td>
    </tr>
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
