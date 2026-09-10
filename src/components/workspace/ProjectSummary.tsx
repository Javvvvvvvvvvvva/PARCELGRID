"use client";

import { useState } from "react";
import Link from "next/link";
import { DEMO_PROJECT_ID } from "@/lib/seed/demo-project-meta";
import { useProjectOverview } from "./useProjectOverview";
import { useWorkspaceRole } from "./WorkspaceShell";
import { ParcelDrawing } from "./ParcelDrawing";
import { EvidenceSheet } from "./EvidenceSheet";
import { makeEvidence, moneyText, type EvidenceKey } from "./evidence";
import { displayNumber, projectHref } from "./presentation";

export function ProjectSummary({ projectId, variant = "workspace" }: { projectId: string; variant?: "workspace" | "brief" }) {
  const model = useProjectOverview(projectId);
  const role = useWorkspaceRole();
  const [evidence, setEvidence] = useState<EvidenceKey | null>(null);
  const brief = variant === "brief";
  const parcel = model.data?.parcel;
  const href = (path: string) => projectHref(projectId, path);
  const open = (key: EvidenceKey) => setEvidence(key);
  if (!parcel) return <div className="pg-summary" role="status">프로젝트 상태를 불러오는 중입니다.</div>;
  const financeMetrics = [
    { key: "profit" as const, label: "세전 예상손익", value: moneyText(model.finance?.profit), note: model.finance ? "저장된 예비 모델" : "사업성 저장 필요" },
    { key: "afterTax" as const, label: "세후 예상수익", value: "산정 불가", note: "미산정 세금 있음" },
    { key: "equity" as const, label: "필요 자기자본", value: moneyText(model.finance?.equity), note: "기존 자금 원장 기준" },
    { key: "cost" as const, label: "세전 총사업비", value: moneyText(model.finance?.cost), note: "포함·제외 범위 확인" },
  ];
  const checks: Array<{ key: EvidenceKey; label: string; status: string }> = [
    { key: "land", label: "부지 원문·면적", status: "원문 확인" },
    { key: "far", label: "법규의 필지별 적용", status: model.readiness.regulatoryVerified ? "근거 등록" : "검토 필요" },
    { key: "geometry", label: "대표안·형상 검증", status: model.geometry ? "검증 통과" : "검토 필요" },
    { key: "sources", label: "가격·공사비·금융 근거", status: model.readiness.sourceBacked ? "필수 근거 등록" : "보완 필요" },
    { key: "afterTax", label: "세금 반영 범위", status: "부분 추정" },
  ];
  // Role presets change reading order only, never source values or rankings.
  const orderedChecks = role === "architect" ? [checks[2], checks[1], checks[0], checks[3], checks[4]]
    : role === "developer" ? [checks[3], checks[4], checks[2], checks[1], checks[0]] : checks;
  const metricStrip = <section className="pg-finance-strip" aria-label="주요 사업 지표">{financeMetrics.map((metric) => <button type="button" key={metric.key} onClick={() => open(metric.key)}><span>{metric.label} <span aria-hidden="true">↗</span></span><strong className={metric.key === "afterTax" ? "pg-word-value" : ""}>{metric.value}</strong><small>{metric.note}</small></button>)}</section>;
  const conditions = <section id="pg-checks"><header className="pg-section-title"><h2>{brief ? "검토 조건" : "먼저 확인할 항목"}</h2><span>근거·확인 상태</span></header><div className="pg-checks">{orderedChecks.map((check, index) => <button type="button" key={check.key} onClick={() => open(check.key)}><span className="pg-index">{String(index + 1).padStart(2, "0")}</span><span>{check.label}</span><small>{check.status}</small><span aria-hidden="true">↗</span></button>)}</div></section>;
  const properties = <section><header className="pg-section-title"><h2>부지 기준값</h2><span>적용 근거 확인</span></header><dl className="pg-properties">{([
    ["land", "대지면적", `${displayNumber(parcel.lotArea, 2)} ㎡`], ["zoning", "용도지역", parcel.zoning],
    ["bcr", "건폐율 기준", `${displayNumber(parcel.regulatoryConstraints?.bcr.value ?? parcel.maxBCR)} %`],
    ["far", "용적률 기준", `${displayNumber(parcel.regulatoryConstraints?.far.value ?? parcel.maxFAR)} %`],
  ] as const).map(([key, label, value]) => <div key={key}><dt>{label}</dt><dd><button type="button" onClick={() => open(key)}>{value} ↗</button></dd></div>)}</dl></section>;
  const decision = <aside className="pg-decision"><div className="pg-section-title"><span>현재 검토 상태</span><button type="button" onClick={() => open("readiness")}>근거 ↗</button></div><h2>{model.next.title}</h2>
    <p>{model.finance ? "현재 대표안과 일치하는 저장 결과입니다. 미확인 조건과 세금 범위는 별도로 검토해야 합니다." : model.readiness.inputsChanged ? "저장 후 입력이 바뀌었습니다. 이전 금액은 최신 수익으로 표시하지 않습니다." : "대표안·검증 매스·저장 결과가 갖춰지면 같은 기준으로 사업성을 확인할 수 있습니다."}</p>
    <dl><div><dt>개발 가능성</dt><dd><button type="button" onClick={() => open("readiness")}>{model.geometry ? "예비 검토 · 인허가 별도" : "판단 보류"}</button></dd></div><div><dt>선택한 대표안</dt><dd><button type="button" onClick={() => open("geometry")}>{model.plan?.name ?? "미선택"}</button></dd></div><div><dt>추천·대안</dt><dd><Link href={href("envelope")}>기준별 추천 확인 ↗</Link></dd></div></dl>
    <div className="pg-next"><small>다음 행동</small><Link className="pg-button pg-button-solid" href={href(model.next.path)}>{model.next.label} <span aria-hidden="true">→</span></Link></div>
  </aside>;
  const warnings = <p className="pg-summary-notice" role="status">{projectId === DEMO_PROJECT_ID && "데모 데이터 · 현장 검증 전. "}세후 수익 미산정 · 인허가·투자·보험 인수 확정 판단 자료가 아닙니다.{model.readiness.inputsChanged && " 입력 변경: 사업성 재저장 필요."}</p>;
  const riskNotes = model.data?.parcelRisks.filter((risk) => risk.level === "med" || risk.level === "high") ?? [];
  return <article className={brief ? "pg-summary pg-brief" : "pg-summary"}>
    <header className={brief ? "pg-brief-heading" : "pg-project-heading"}><div><p className="pg-location">{brief ? "PARCELGRID / 프로젝트 예비 검토" : "프로젝트 요약"}</p><h1>{parcel.address}</h1>{brief && <p className="pg-brief-subtitle">{parcel.zoning} · 대표안 {model.plan?.name ?? "미선택"}</p>}</div><div className="pg-heading-actions">{brief ? <button type="button" className="pg-button" onClick={() => window.print()}>요약 인쇄</button> : <><button type="button" className="pg-button" onClick={() => open("readiness")}>자료 상태</button><Link className="pg-button pg-button-solid" href={href("envelope")}>계획 스튜디오 →</Link></>}</div></header>
    {warnings}
    {brief ? <>
      <section className="pg-brief-conclusion"><div><h2>{model.next.title}</h2><p>{model.finance ? "대표안과 일치하는 저장된 예비 사업성입니다." : "금액 표시 전 대표안과 사업성 저장 상태를 확인해야 합니다."} 확인되지 않은 조건은 아래에 별도로 남겼습니다.</p></div><Link className="pg-button" href={href(model.next.path)}>{model.next.label} →</Link></section>
      {metricStrip}<div className="pg-brief-body"><section><header className="pg-section-title"><h2>부지·대표안</h2><button type="button" onClick={() => open("geometry")}>형상 근거 ↗</button></header><ParcelDrawing model={model} compact onEvidence={() => open("geometry")} />{properties}</section><div>{conditions}<section className="pg-brief-next"><h2>검토 대상</h2><p>선택한 대표안: {model.plan?.name ?? "미선택"}</p><p>추천안과 대표안은 다릅니다. 기준별 추천과 검토 기록은 상세 화면에서 확인하세요.</p><Link href={href("report")}>상세 보고서·원문·승인 기록 →</Link></section></div></div>
    </> : <><div className="pg-work-top"><ParcelDrawing model={model} onEvidence={() => open("geometry")} />{decision}</div>{metricStrip}<div className="pg-summary-below">{conditions}{properties}</div></>}
    {riskNotes.length > 0 && <section className="pg-existing-risks"><h2>기존 분석의 주의 항목</h2><p>부지 분석 결과의 경고입니다. 현재 대표안에 대한 새 위험 평가가 아닙니다.</p>{riskNotes.map((risk) => <div key={risk.code}><strong>{risk.label}</strong><span>{risk.note}</span><Link href={href("status")}>원본 확인 ↗</Link></div>)}</section>}
    <footer className="pg-summary-footer"><span>{model.finance && model.snapshot ? `계산 저장 ${model.snapshot.savedAt} · ${model.snapshot.data.meta.version}` : "현재 대표안의 사업성 저장·정합성 확인 필요"}</span><button type="button" onClick={() => open("sources")}>현재 등록 근거 ↗</button></footer>
    <EvidenceSheet item={evidence ? makeEvidence(model, evidence) : null} onClose={() => setEvidence(null)} />
  </article>;
}
