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
import { useReviewStore } from "@/lib/stores/review-store";
import { won, num, scenarioViable } from "@/lib/utils/format";
import { PROJECT_LEDGER_MODEL_VERSION } from "@/lib/finance/project-ledger";
import { buildEvidenceGate } from "@/lib/handoff/evidence-gate";
import {
  buildExpertReviewSummary,
  validateExpertReview,
} from "@/lib/handoff/review-workflow";
import {
  buildSourceDataGate,
  FINANCIAL_SOURCE_FIELD_META,
  validateFinancialSourceEvidence,
} from "@/lib/finance/source-data-gate";
import { buildPlanningDesignIntent } from "@/lib/planning/design-intent";
import {
  PLANNING_FACADE_LABELS,
  resolvePlanningMaterials,
} from "@/lib/planning/materials";
import ConceptRenderStudio from "@/components/report/ConceptRenderStudio";
import {
  constraintStatusLabel,
  coreRegulatoryConstraintsVerified,
  type RegulatoryConstraintEvidence,
} from "@/lib/regulatory/constraints";

const SQM_PER_PYEONG = 3.305785;

const DISCIPLINE_LABEL = {
  architect: "건축가",
  developer: "시행·원가",
  "finance-tax": "금융·회계·세무",
  "sales-marketing": "분양·홍보",
} as const;

const REVIEW_STATUS_LABEL = {
  "not-requested": "미요청",
  requested: "검토 요청",
  approved: "승인",
  "changes-requested": "수정 요청",
} as const;

const EVIDENCE_STATUS_LABEL = {
  "system-confirmed": "시스템 재현",
  "expert-review": "전문가 검토",
  missing: "미확인",
} as const;

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
  const planningScenarios = useProjectStore(
    (state) => state.planningScenarios
  );
  const representativePlanningScenarioId = useProjectStore(
    (state) => state.representativePlanningScenarioId
  );
  const financialSources = useProjectStore(
    (state) => state.financialSources[projectId] ?? {}
  );
  const priceVerifications = useReviewStore(
    (state) => state.priceVerifications[projectId] ?? {}
  );
  const expertReviews = useReviewStore(
    (state) => state.expertReviews[projectId] ?? {}
  );

  const scenarios = useMemo(() => data?.scenarios ?? [], [data?.scenarios]);
  const parcel = data?.parcel;
  const comps = useMemo(() => data?.comps ?? [], [data?.comps]);
  const geometry =
    representativeGeometry?.projectId === projectId
      ? representativeGeometry
      : null;
  const planningScenario =
    planningScenarios.find(
      (scenario) =>
        scenario.id === representativePlanningScenarioId &&
        (!scenario.projectId || scenario.projectId === projectId)
    ) ?? null;
  const constructionSource = financialSources.constCostPerSqM;
  const ltcSource = financialSources.ltcTarget;
  const interestSource = financialSources.interestRate;
  const validConstructionQuote = Boolean(
    constructionSource &&
      constructionSource.sourceKind === "professional-quote" &&
      validateFinancialSourceEvidence(constructionSource).valid
  );
  const validTermSheet = Boolean(
    ltcSource &&
      interestSource &&
      ltcSource.sourceKind === "lender-term-sheet" &&
      interestSource.sourceKind === "lender-term-sheet" &&
      validateFinancialSourceEvidence(ltcSource).valid &&
      validateFinancialSourceEvidence(interestSource).valid
  );
  const financeTaxReview = expertReviews["finance-tax"];
  const taxComplete = Boolean(
    financeTaxReview?.status === "approved" &&
      validateExpertReview(financeTaxReview).valid
  );
  const reviewSummary = useMemo(
    () => buildExpertReviewSummary(expertReviews),
    [expertReviews]
  );

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
      taxComplete,
      hasConstructionQuote: validConstructionQuote,
      hasTermSheet: validTermSheet,
      hasExternalPriceOpinion:
        priceVerifications.acquisition?.status === "verified",
    });
  }, [
    comps.length,
    data,
    geometry,
    priceVerifications.acquisition?.status,
    projectId,
    taxComplete,
    validConstructionQuote,
    validTermSheet,
  ]);

  const recommended = useMemo(
    () => scenarios.find((s) => s.recommended) ?? scenarios[0],
    [scenarios]
  );

  const compsMedian = useMemo(() => {
    if (comps.length === 0) return null;
    const sorted = [...comps.map((c) => c.pricePerPyeong)].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }, [comps]);

  const sourceGate = useMemo(
    () =>
      recommended
        ? buildSourceDataGate(recommended._raw, financialSources)
        : null,
    [financialSources, recommended]
  );

  const designPrompt = useMemo(() => {
    if (!planningScenario || !parcel) {
      return "첨부한 PARCELGRID 3D 기준 이미지의 층수, 전체 실루엣, 층별 외곽선과 후퇴, 대지 내 위치, 회전 방향, 도로 관계, 카메라와 원근을 변경하지 않는다. 외장 마감과 합리적인 저층 주거 창호만 표현한다.";
    }
    return buildPlanningDesignIntent(planningScenario, {
      projectId,
      address: parcel.address,
      parcelAreaSqm: parcel.lotArea,
      maxBuildingCoveragePct: parcel.maxBCR,
      maxFloorAreaRatioPct: parcel.maxFAR,
    }).generationInstruction.promptKo;
  }, [parcel, planningScenario, projectId]);

  const planningMaterials = useMemo(
    () => (planningScenario ? resolvePlanningMaterials(planningScenario.materials) : null),
    [planningScenario]
  );

  if (!data || !parcel || !recommended || !evidenceGate || !sourceGate) {
    return <div style={{ padding: 40, color: "var(--fg-muted)" }}>보고서를 생성할 데이터가 없습니다.</div>;
  }

  const pyeong = parcel.lotArea / SQM_PER_PYEONG;
  const analysisDate = data.meta?.lastSyncedAt
    ? new Date(data.meta.lastSyncedAt).toLocaleDateString("ko-KR")
    : new Date().toLocaleDateString("ko-KR");
  const finalReady =
    evidenceGate.criticalBlockerCount === 0 &&
    reviewSummary.ready &&
    sourceGate.status === "source-backed";
  const areaContract = recommended._raw.program.areaContract;
  const currentBuilding = parcel.currentBuilding;
  const accountingGap = Math.abs(
    recommended.revenue - recommended.cost - recommended.profit
  );
  const capitalGap = Math.abs(
    recommended.cost - recommended.equity - recommended.pf
  );

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
          <strong>{finalReady ? "Stage 5 · 필수 근거와 전문가 승인 기록 완료" : "Stage 5 예비 모델 · 전문가 검토 진행 중"}</strong><br />
          아래 값은 저장 시점의 세전 비교값입니다. 계산 입력 근거 {sourceGate.validRecords.length}/{sourceGate.requiredFields.length}건 · Stage 4 필수 미확인 {evidenceGate.criticalBlockerCount}건 · 전문가 승인 {reviewSummary.approvedCount}/{reviewSummary.requiredDisciplines.length}개 분야입니다. 금융기관 약정·시공사 견적·감정평가·세무 원문을 별도로 대조하기 전에는 매입 결정, 대출 심사 또는 세무신고에 사용할 수 없습니다.{" "}
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
              <OvItem l="층수" v={`지상 ${geometry.building.aboveGroundFloors.length}층 · 지하 ${geometry.building.basementFloors.length}층`} />
              <OvItem l="프로그램 면적" v={`${num(Math.round(geometry.building.totalProgramAreaSqm * 10) / 10)}㎡`} />
              <OvItem l="실현 용적률" v={`${geometry.building.preliminaryFarPct.toFixed(1)}%`} />
              <OvItem l="기하 검증" v={geometry.validation.status === "pass" ? "대표안 적격 · 고정" : "추가 검토"} />
              <OvItem l="Geometry hash" v={geometry.geometryHash} />
            </div>
          </div>
        )}


        <div className="rpt-sec">
          <div className="rpt-sec-h">기존 건축물 · 건축HUB 건축물대장</div>
          {currentBuilding ? (
            <>
              <div className="rpt-ov">
                <OvItem l="존재 여부" v={currentBuilding.hasBuilding ? "기존 건축물 있음" : "건축물대장상 빈 토지"} />
                <OvItem l="총 연면적" v={`${num(Math.round(currentBuilding.totalBuildingArea * 10) / 10)}㎡`} />
                <OvItem l="가장 오래된 사용승인" v={currentBuilding.oldestApprovalDate || "미확인"} />
                <OvItem l="최대 노후도" v={currentBuilding.maxAgeYears > 0 ? `${currentBuilding.maxAgeYears}년` : "미확인"} />
                <OvItem l="검토 시그널" v={currentBuilding.signalLabel} />
                <OvItem l="건물 동수" v={`${currentBuilding.buildings.length}동`} />
              </div>
              <p style={{ margin: "10px 0 0", color: "var(--fg-muted)", fontSize: 10.5, lineHeight: 1.55 }}>
                {currentBuilding.signalReasoning} 건축물대장 관측값이며 철거 가능성·위반건축물·임차권·현황 일치는 별도 원문과 현장조사가 필요합니다.
              </p>
              {currentBuilding.buildings.length > 0 && (
                <table className="rpt-table" style={{ marginTop: 10 }}>
                  <thead><tr><th>동·용도</th><th>구조</th><th className="num">층수</th><th className="num">연면적</th><th className="num">건폐/용적</th><th>사용승인</th></tr></thead>
                  <tbody>
                    {currentBuilding.buildings.map((building, index) => (
                      <tr key={`${building.name}-${index}`}>
                        <td>{building.name || `${index + 1}동`} · {building.detailPurpose || building.mainPurpose || "용도 미확인"}</td>
                        <td>{building.structure || "미확인"}</td>
                        <td className="num">지상 {building.groundFloors} / 지하 {building.undergroundFloors}</td>
                        <td className="num">{num(Math.round(building.totalArea * 10) / 10)}㎡</td>
                        <td className="num">{building.buildingCoverage.toFixed(1)}% / {building.floorAreaRatio.toFixed(1)}%</td>
                        <td>{building.approvalDate || "미확인"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <p style={{ color: "var(--neg-fg)", fontSize: 11 }}>
              건축HUB 건축물대장 조회 결과가 저장되지 않았습니다. 주소 분석을 다시 실행하거나 MOLIT_SERVICE_KEY와 해당 API 활용 승인을 확인하세요.
            </p>
          )}
        </div>

        <div className="rpt-sec">
          <div className="rpt-sec-h">대표 계획 프로그램 · Stage 2→3 면적 계약</div>
          <div className="rpt-ov">
            <OvItem l="계획 용도" v={recommended.typeKr} />
            <OvItem l="층수" v={`지상 ${recommended.floors.above}층 · 지하 ${recommended.floors.below}층`} />
            <OvItem l="공사 기준 연면적" v={`${num(Math.round((areaContract?.constructionAreaSqm ?? recommended.gfa) * 10) / 10)}㎡`} />
            <OvItem l="용적률 산입면적" v={areaContract ? `${num(Math.round(areaContract.farAreaSqm * 10) / 10)}㎡` : "Legacy FAR/BCR 계산"} />
            <OvItem l="매각 가능면적" v={areaContract ? `${num(Math.round(areaContract.saleableAreaSqm * 10) / 10)}㎡` : "미분리"} />
            <OvItem l="임대 가능면적" v={areaContract ? `${num(Math.round(areaContract.rentableAreaSqm * 10) / 10)}㎡` : "미분리"} />
            <OvItem l="주차" v={areaContract ? `계획 ${areaContract.providedParkingSpaces}대 / 필요 ${areaContract.requiredParkingSpaces}대` : `${recommended._raw.program.units.residential}세대 기준 재검토`} />
            <OvItem l="면적 계약" v={areaContract ? areaContract.schemaVersion : "구버전 호환 계산"} />
            <OvItem l="형상 출처" v={areaContract?.geometrySource?.mode ?? planningScenario?.geometrySource?.mode ?? "미확인"} />
          </div>
          {planningMaterials && (
            <p style={{ margin: "10px 0 0", color: "var(--fg-muted)", fontSize: 10.5 }}>
              외장: {PLANNING_FACADE_LABELS[planningMaterials.primaryFacadeMaterial]} {planningMaterials.primaryFacadeSharePct}% · {PLANNING_FACADE_LABELS[planningMaterials.secondaryFacadeMaterial]} {100 - planningMaterials.primaryFacadeSharePct}% · 창호비 {planningMaterials.windowRatioPct}%
            </p>
          )}
        </div>

        <ConceptRenderStudio
          projectId={projectId}
          geometryHash={geometry?.geometryHash}
          defaultPrompt={designPrompt}
        />

        <div className="rpt-sec">
          <div className="rpt-sec-h">사업수지 원장 · 매출과 비용</div>
          <div className="rpt-two-col">
            <table className="rpt-table">
              <thead><tr><th>매출</th><th className="num">금액</th></tr></thead>
              <tbody>
                <MoneyRow label="주거 매각·분양" value={recommended.revenueSale} />
                <MoneyRow label="주거 임대 출구가치" value={recommended.revenueLease} />
                <MoneyRow label="근생 임대 출구가치" value={recommended.revenueRetail} />
                <MoneyRow label="총매출" value={recommended.revenue} strong />
              </tbody>
            </table>
            <table className="rpt-table">
              <thead><tr><th>비용</th><th className="num">금액</th></tr></thead>
              <tbody>
                <MoneyRow label="부동산 취득대금" value={recommended.landCost} />
                <MoneyRow label="철거비" value={recommended.demolitionCost} />
                <MoneyRow label="직접 공사비" value={recommended.hardCost} />
                <MoneyRow label="설계·감리·인허가" value={recommended.softCost} />
                <MoneyRow label="예비비" value={recommended.contingency} />
                <MoneyRow label="금융비" value={recommended.financingCost} />
                <MoneyRow label="총사업비" value={recommended.cost} strong />
              </tbody>
            </table>
          </div>
          <div className="rpt-reconciliation">
            <span>매출 = 비용 + 세전손익</span>
            <strong>{accountingGap <= 1 ? "정합" : `차이 ${won(accountingGap)}`}</strong>
            <span>총사업비 = 자기자본 + PF</span>
            <strong>{capitalGap <= 1 ? "정합" : `차이 ${won(capitalGap)}`}</strong>
          </div>
        </div>

        <div className="rpt-sec">
          <div className="rpt-sec-h">자본구조 · 수익지표 · 세금 경계</div>
          <div className="rpt-ov">
            <OvItem l="자기자본" v={won(recommended.equity)} />
            <OvItem l="PF" v={won(recommended.pf)} />
            <OvItem l="LTC" v={`${recommended.ltc.toFixed(1)}%`} />
            <OvItem l="세전 손익" v={won(recommended.profit)} />
            <OvItem l="이익률" v={`${recommended.profitMargin.toFixed(1)}%`} />
            <OvItem l="세전 IRR" v={recommended.irrStatus === "calculated" ? `${recommended.irr.toFixed(1)}%` : "N/A"} />
            <OvItem l="NPV" v={won(recommended.npv)} />
            <OvItem l="Equity Multiple" v={recommended.equityMultiple > 0 ? `${recommended.equityMultiple.toFixed(2)}×` : "N/A"} />
            <OvItem l="DSCR" v={recommended.dscr > 0 ? recommended.dscr.toFixed(2) : "N/A"} />
            <OvItem l="최대 자금노출" v={won(Math.abs(recommended.maxExposure))} />
            <OvItem l="회수기간" v={recommended.paybackMonths != null ? `${recommended.paybackMonths}개월` : "사업기간 내 미회수"} />
            <OvItem l="부분 세금 추정" v={won(recommended.taxBurden)} />
          </div>
          <p style={{ margin: "10px 0 0", color: "var(--neg-fg)", fontSize: 10, lineHeight: 1.5 }}>
            세금 값은 계산 가능한 일부 항목의 예비 합계입니다. 재산세·부가세·토지/건물 안분·법인 세무조정과 추가과세가 완결되지 않았으므로 세후 수익으로 해석하지 않습니다.
          </p>
        </div>

        <div className="rpt-sec">
          <div className="rpt-sec-h">공사비 민감도</div>
          <table className="rpt-table">
            <thead><tr><th>조건</th><th className="num">공사비</th><th className="num">세전 손익</th><th>해석</th></tr></thead>
            <tbody>
              <tr><td>Low · -15%</td><td className="num">{won(recommended.constructionCostLow ?? recommended.hardCost * 0.85)}</td><td className="num">{won(recommended.profitAtLowCost ?? recommended.profit)}</td><td>낙관 원가 범위</td></tr>
              <tr className="rpt-reco-row"><td>Base</td><td className="num">{won(recommended.hardCost)}</td><td className="num">{won(recommended.profit)}</td><td>현재 저장 입력</td></tr>
              <tr><td>High · +20%</td><td className="num">{won(recommended.constructionCostHigh ?? recommended.hardCost * 1.2)}</td><td className="num">{won(recommended.profitAtHighCost ?? recommended.profit)}</td><td>원가 상승 스트레스</td></tr>
            </tbody>
          </table>
        </div>

        <div className="rpt-sec">
          <div className="rpt-sec-h">분기별 현금흐름 · {PROJECT_LEDGER_MODEL_VERSION}</div>
          <table className="rpt-table">
            <thead><tr><th>분기</th><th>단계</th><th className="num">유출</th><th className="num">유입</th><th className="num">순현금</th><th className="num">누적</th></tr></thead>
            <tbody>
              {data.pfSchedule.map((row) => (
                <tr key={row.quarter}>
                  <td>{row.quarter}</td><td>{row.phase}</td>
                  <td className="num">{won(row.outflow)}</td><td className="num">{won(row.inflow)}</td>
                  <td className="num">{won(row.net)}</td><td className="num">{won(row.cumulative)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ margin: "8px 0 0", color: "var(--fg-muted)", fontSize: 9.5 }}>
            단독·다가구 통매각은 사업 종료 시 매출 100% 회수, 임대·근생 가치는 종료 시 회수하는 예비 원장입니다. 실제 계약금·중도금·잔금과 PF 상환순서로 교체해야 합니다.
          </p>
        </div>

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

        <div className="rpt-sec">
          <div className="rpt-sec-h">실거래 비교 근거</div>
          {comps.length > 0 ? (
            <>
              <p style={{ color: "var(--fg-muted)", fontSize: 10.5 }}>
                국토교통부 실거래 {comps.length}건 · 중앙값 평당 {compsMedian != null ? num(compsMedian) : "—"}만원. 아래는 최근 비교자료 최대 12건이며 감정평가나 매각 확정가가 아닙니다.
              </p>
              <table className="rpt-table">
                <thead><tr><th>계약일</th><th>소재지·유형</th><th className="num">면적</th><th className="num">거래금액</th><th className="num">평당</th><th className="num">거리</th></tr></thead>
                <tbody>
                  {comps.slice(0, 12).map((comp) => (
                    <tr key={comp.id}>
                      <td>{comp.date}</td>
                      <td>{comp.address} · {comp.type}</td>
                      <td className="num">{num(Math.round((comp.gfa || comp.area) * 10) / 10)}㎡</td>
                      <td className="num">{won(comp.price)}</td>
                      <td className="num">{num(comp.pricePerPyeong)}만/평</td>
                      <td className="num">{comp.dist > 0 ? `${comp.dist.toFixed(1)}km` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p style={{ color: "var(--neg-fg)", fontSize: 11 }}>채택 가능한 실거래 비교자료가 없습니다. MOLIT 키·법정동·조회기간을 확인하세요.</p>
          )}
        </div>

        <div className="rpt-sec">
          <div className="rpt-sec-h">계산 입력 근거자료 · {sourceGate.validRecords.length}/{sourceGate.requiredFields.length}건 확정</div>
          <table className="rpt-table">
            <thead><tr><th>입력 항목</th><th className="num">적용값</th><th>상태</th><th>발급기관·원문·기준일·확인자</th></tr></thead>
            <tbody>
              {sourceGate.requiredFields.map((field) => {
                const record = financialSources[field];
                const invalid = sourceGate.invalidFields.find((item) => item.field === field);
                const status = sourceGate.validRecords.some((item) => item.field === field)
                  ? "확정"
                  : record
                    ? "원문 확인"
                    : "미등록";
                return (
                  <tr key={field}>
                    <td>{FINANCIAL_SOURCE_FIELD_META[field].label}</td>
                    <td className="num">
                      {record ? `${num(record.value)} ${FINANCIAL_SOURCE_FIELD_META[field].unit}` : "—"}
                    </td>
                    <td>{status}</td>
                    <td style={{ whiteSpace: "normal", lineHeight: 1.45 }}>
                      {record
                        ? [record.sourceName, record.documentRef, record.asOf, record.verifiedBy, invalid?.errors.join(" / ")].filter(Boolean).join(" · ")
                        : "실제 계약서·견적서·Term Sheet·감정평가 또는 승인 원문 필요"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="rpt-sec">
          <div className="rpt-sec-h">리스크·미확인 사항</div>
          <table className="rpt-table">
            <thead><tr><th>항목</th><th>수준</th><th>판정·다음 확인</th><th>참고</th></tr></thead>
            <tbody>
              {data.parcelRisks.map((risk) => (
                <tr key={risk.code}>
                  <td>{risk.label}</td><td>{risk.levelLabel}</td>
                  <td style={{ whiteSpace: "normal", lineHeight: 1.45 }}>{risk.note}</td>
                  <td>{risk.reference ?? "—"}</td>
                </tr>
              ))}
              {evidenceGate.lanes.flatMap((lane) =>
                lane.items.filter((item) => item.status === "missing").map((item) => (
                  <tr key={item.id}>
                    <td>{item.label}</td><td>미확인{item.critical ? " · 필수" : ""}</td>
                    <td style={{ whiteSpace: "normal", lineHeight: 1.45 }}>{item.nextAction}</td>
                    <td>{lane.title}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="rpt-sec">
          <div className="rpt-sec-h">전문가 인계·승인 기록</div>
          <table className="rpt-table">
            <thead><tr><th>분야</th><th>상태</th><th>담당자·소속</th><th>근거·검토일</th><th>메모</th></tr></thead>
            <tbody>
              {reviewSummary.requiredDisciplines.map((discipline) => {
                const review = expertReviews[discipline];
                return (
                  <tr key={discipline}>
                    <td>{DISCIPLINE_LABEL[discipline]}</td>
                    <td>{REVIEW_STATUS_LABEL[review?.status ?? "not-requested"]}</td>
                    <td>{review ? `${review.reviewer} · ${review.organization}` : "미배정"}</td>
                    <td>{review ? [review.evidenceRef, review.reviewedAt].filter(Boolean).join(" · ") : "—"}</td>
                    <td style={{ whiteSpace: "normal" }}>{review?.notes || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="rpt-stage-grid">
            {evidenceGate.lanes.map((lane) => (
              <div key={lane.discipline}>
                <strong>{lane.title}</strong>
                {lane.items.map((item) => (
                  <span key={item.id}>{EVIDENCE_STATUS_LABEL[item.status]} · {item.label}</span>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="rpt-sec">
          <div className="rpt-sec-h">공공데이터·모델 출처와 연결 상태</div>
          <table className="rpt-table">
            <thead><tr><th>출처</th><th>이 보고서에서 사용</th><th>상태</th><th>한계</th></tr></thead>
            <tbody>
              <tr><td>V월드</td><td>필지 경계·공시지가·용도지역·도로 참고선</td><td>{parcel.boundary?.length ? "조회됨" : "미조회"}</td><td>도로 중심선은 도로 폭·현황측량이 아님</td></tr>
              <tr><td>국토교통부 실거래가</td><td>비교거래·가격 참고</td><td>{comps.length > 0 ? `${comps.length}건` : "미조회"}</td><td>지번 비식별·상품 차이·신고 지연 가능</td></tr>
              <tr><td>건축HUB 건축물대장</td><td>기존 건물·층수·면적·사용승인</td><td>{currentBuilding ? "조회됨" : "미조회"}</td><td>현장 상태·위반건축물·권리관계 별도 확인</td></tr>
              <tr><td>Kakao Local</td><td>주소 정규화·좌표·주변 거리</td><td>{parcel.lat && parcel.lng ? "조회됨" : "미조회"}</td><td>법적 경계나 측량성과가 아님</td></tr>
              <tr><td>ParcelGrid 금융 원장</td><td>손익·PF·IRR·분기 현금흐름</td><td>{PROJECT_LEDGER_MODEL_VERSION}</td><td>금융기관 약정과 세무조정 전 예비 모델</td></tr>
              <tr><td>OpenAI Image API</td><td>기준 이미지 기반 외장 콘셉트</td><td>선택 기능</td><td>형상 보존은 생성 후 원본과 육안 대조 필요</td></tr>
            </tbody>
          </table>
        </div>

        <div className="rpt-foot">
          <span>Double Edge · ParcelGrid v2.4</span>
          <span>예비 비교용 — 매입·대출·세무 의사결정 전 전문가 검토 필수</span>
        </div>
      </div>

      <style jsx>{`
        .rpt-two-col{display:grid;grid-template-columns:1fr 1fr;gap:18px}
        .rpt-reconciliation{display:grid;grid-template-columns:1fr auto 1fr auto;gap:10px;align-items:center;margin-top:12px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg-soft);font-size:10px}.rpt-reconciliation strong{color:var(--pos-fg)}
        .rpt-stage-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px}.rpt-stage-grid>div{display:grid;gap:4px;padding:10px;border:1px solid var(--border-faint);border-radius:7px}.rpt-stage-grid strong{font-size:10px}.rpt-stage-grid span{font-size:9px;color:var(--fg-muted)}
        @media(max-width:760px){.rpt-two-col,.rpt-stage-grid{grid-template-columns:1fr}.rpt-reconciliation{grid-template-columns:1fr auto}}
        @media print{.rpt-two-col{grid-template-columns:1fr 1fr}.rpt-stage-grid{grid-template-columns:1fr 1fr}.rpt-sec{break-inside:auto}.rpt-table{break-inside:auto}}
      `}</style>

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

function MoneyRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <tr style={strong ? { fontWeight: 800 } : undefined}>
      <td>{label}</td>
      <td className="num">{won(value)}</td>
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
