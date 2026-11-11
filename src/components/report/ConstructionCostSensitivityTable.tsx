"use client";

import type {
  ConstructionCostCase,
  ConstructionCostSensitivity,
} from "@/lib/finance/construction-cost-sensitivity";
import { num } from "@/lib/utils/format";

const CASES = [
  { key: "low", label: "Low · -15%" },
  { key: "base", label: "Base · 기준 단가" },
  { key: "high", label: "High · +20%" },
] as const;

function amount(value: number): string {
  return `${num(value)}만원`;
}

function caseRows(stressCase: ConstructionCostCase) {
  const rate = {
    label: "기본 공사단가",
    value: `${num(stressCase.unitCostPerSqmWon)}원/㎡`,
  };
  if (stressCase.status !== "calculated") return [rate];

  const { result } = stressCase;
  const { funding } = result;
  const irr =
    result.irrStatus === "calculated" && Number.isFinite(result.irr)
      ? `${result.irr.toFixed(1)}%`
      : result.irrStatus === "ambiguous"
        ? "단일 수익률 미확정"
        : "산출 불가";

  return [
    rate,
    { label: "직접 공사비", value: amount(result.hardCost) },
    { label: "설계·감리·인허가", value: amount(result.softCost) },
    { label: "예비비", value: amount(result.contingency) },
    { label: "PF 이자", value: amount(result.interestCost) },
    { label: "PF 수수료", value: amount(result.pfFee) },
    { label: "신탁비", value: amount(result.trustFee) },
    { label: "금융비 합계", value: amount(result.financingCost), strong: true },
    { label: "총사업비", value: amount(result.totalCost), strong: true },
    { label: "총매출", value: amount(result.totalRevenue) },
    { label: "세전 손익", value: amount(result.profit), strong: true },
    { label: "필요 자기자본", value: amount(funding.requiredEquityManwon), strong: true },
    {
      label: "자금조달",
      value:
        funding.status === "funded"
          ? "입력 한도 내"
          : funding.status === "shortfall"
            ? "자금 부족"
            : "한도 미확인",
    },
    {
      label: "자금 부족액",
      value:
        funding.status === "unverified"
          ? "미확인"
          : amount(funding.shortfallManwon),
    },
    {
      label: "최초 부족월",
      value:
        funding.status === "unverified"
          ? "미확인"
          : funding.status === "funded"
            ? "해당 없음"
            : funding.firstShortfallMonth == null
              ? "미확인"
              : `${num(funding.firstShortfallMonth)}개월차`,
    },
    { label: "세전 IRR", value: irr },
    { label: "세전 NPV", value: amount(result.npv) },
    { label: "최대 자금노출", value: amount(Math.abs(result.maxExposure)) },
    { label: "사업기간", value: `${num(result.totalMonths)}개월` },
  ];
}

export default function ConstructionCostSensitivityTable({
  sensitivity,
}: {
  sensitivity: ConstructionCostSensitivity | null;
}) {
  return (
    <section className="rpt-sec" aria-labelledby="construction-cost-sensitivity-heading">
      <h2 className="rpt-sec-h" id="construction-cost-sensitivity-heading">
        기본 공사단가 민감도 · 월별 재계산
      </h2>
      <p className="sensitivity-note">
        -15% / +20%는 예시 스트레스 가정이며 통계적 신뢰구간이나 실제 견적이 아닙니다.
        상세 수량내역·대체 견적·자재·세대 구성은 고정하고 잔여 기본 공사단가만 변경합니다.
        월별 PF 이자·수수료, 자금조달과 세전 자기자본 현금흐름을 재계산하며,
        금융기관·전문가 승인과 세후 결과는 미확정입니다.
      </p>

      {!sensitivity ? (
        <p className="sensitivity-pending" role="status">
          <strong>재계산 필요</strong>
          <span>현재 입력과 일치하는 월별 민감도 결과가 없습니다. 사업성 분석을 재계산하고 저장해야 합니다.</span>
        </p>
      ) : (
        <>
          <p className="sensitivity-note">
            금액: 만원 단위 반올림 · 단가: 원/㎡ · 금융비 합계 = PF 이자 + PF 수수료 + 신탁비
          </p>
          <div className="sensitivity-grid">
            {CASES.map(({ key, label }) => {
              const stressCase = sensitivity[key];
              return (
                <section className="sensitivity-case" key={key} aria-labelledby={`sensitivity-${key}`}>
                  <h3 className={key === "base" ? "is-base" : ""} id={`sensitivity-${key}`}>
                    {label}
                  </h3>
                  <dl>
                    {caseRows(stressCase).map((row) => (
                      <div className={"strong" in row && row.strong ? "sensitivity-row is-total" : "sensitivity-row"} key={row.label}>
                        <dt>{row.label}</dt>
                        <dd>{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                  {stressCase.status === "unavailable" && (
                    <p className="sensitivity-pending" role="status">
                      <strong>산출 불가</strong>
                      <span>{stressCase.reason}</span>
                    </p>
                  )}
                </section>
              );
            })}
          </div>
          <p className="sensitivity-note sensitivity-version">
            민감도 모델 {sensitivity.modelVersion} · 월별 원장 {sensitivity.ledgerModelVersion}
          </p>
        </>
      )}

      <style jsx>{`
        h2, h3, p, dt, dd { letter-spacing: 0; }
        .sensitivity-note { margin: 0 0 10px; color: var(--fg-muted); font-size: 10px; line-height: 1.6; overflow-wrap: anywhere; }
        .sensitivity-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
        .sensitivity-case { min-width: 0; }
        h3 { margin: 0; padding: 8px 6px; border-bottom: 1px solid var(--border); background: var(--bg-sunken); font-size: 11px; line-height: 1.5; }
        h3.is-base { color: var(--accent); }
        dl { margin: 0; }
        .sensitivity-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); align-items: start; gap: 6px; min-height: 34px; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 10px; line-height: 1.6; }
        dt, dd { min-width: 0; overflow-wrap: anywhere; }
        dt { color: var(--fg-muted); }
        dd { margin: 0; text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
        .is-total { font-weight: 700; }
        .is-total dt { color: inherit; }
        .sensitivity-pending { display: grid; gap: 4px; margin: 12px 0; padding: 10px 0; border-block: 1px solid var(--border); color: var(--warn-fg); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
        .sensitivity-version { margin-top: 10px; margin-bottom: 0; }
        @media screen and (max-width: 760px) {
          .sensitivity-grid { grid-template-columns: minmax(0, 1fr); gap: 20px; }
          .sensitivity-row { font-size: 11px; }
        }
        @media print {
          .sensitivity-grid { gap: 12px; break-inside: avoid; }
          h3, .sensitivity-note { break-after: avoid; }
          .sensitivity-row, .sensitivity-pending { break-inside: avoid; }
        }
      `}</style>
    </section>
  );
}
