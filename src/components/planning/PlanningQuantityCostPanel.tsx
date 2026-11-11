"use client";

import { useEffect, useMemo, useState } from "react";
import { Calculator, Check, RefreshCw, Trash2 } from "lucide-react";
import { isPlanningGeometryLocked } from "@/lib/planning/geometry-source";
import {
  applyQuantityCost, createQuantityCostDraft, evaluateQuantityCost, QUANTITY_COST_SCOPE,
  type QuantityCostAssessment,
} from "@/lib/planning/quantity-cost";
import {
  quantityCostPlanSchema, type QuantityCostInputs, type QuantityCostLine, type QuantityCostPlan,
} from "@/lib/planning/quantity-cost-contract";
import { takeoffPlanningQuantities } from "@/lib/planning/quantity-takeoff";
import { calculatePlanningScenario, type PlanningCalculationContext } from "@/lib/planning/scenario-calculator";
import type { PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import type { PlanningEconomicsPreview, PlanningScenario } from "@/lib/planning/types";

type Props = {
  scenario: PlanningScenario; geometry: PlanningGeometrySnapshot | null; context: PlanningCalculationContext;
  locked: boolean; getCurrentScenario: () => PlanningScenario | undefined;
  onChange: (patch: Partial<PlanningScenario>) => void;
};
type DraftState = { plan: QuantityCostPlan | null; savedKey: string | null; error: string };
type Preview = {
  key: string; assessment: QuantityCostAssessment; error: string;
  before: PlanningEconomicsPreview | null; after: PlanningEconomicsPreview | null;
};
const statusLabels: Record<QuantityCostAssessment["status"], string> = {
  absent: "저장된 조정 없음", ready: "예비 원가 산술 확인 · 승인 미확정", missing: "근거·범위 미확정",
  stale: "저장 기준 변경 · 재검토 필요", conflict: "입력 충돌 · 적용 보류",
};
const treatmentLabels: Record<QuantityCostLine["treatment"], string> = {
  unpriced: "미확정", included: "기본단가 포함", "replace-allowance": "포함액 차감 후 교체",
};
const number = (value: number, digits = 2) => Number.isFinite(value)
  ? value.toLocaleString("ko-KR", { maximumFractionDigits: digits }) : "미확정";
const errorText = (error: unknown) => error instanceof Error ? error.message : "수량·원가 계산을 완료하지 못했습니다.";
function serialized(value: unknown): string | null {
  try { return JSON.stringify(value ?? null); } catch { return null; }
}
function reviewKey(scenario: PlanningScenario, geometry: PlanningGeometrySnapshot | null,
  context: PlanningCalculationContext, draft: QuantityCostPlan | null) {
  // Bind the confirmation to raw inputs, not only the scenario version or geometry hash.
  return serialized({ scenario: { ...scenario, checks: undefined, economicsPreview: undefined }, geometry,
    parcel: context.parcel, assumptions: context.assumptions, draft });
}
function initialDraft(scenario: PlanningScenario, inputs: QuantityCostInputs): DraftState {
  const savedKey = serialized(scenario.quantityCost);
  try {
    if (!scenario.quantityCost) return { plan: createQuantityCostDraft(scenario, inputs), savedKey, error: "" };
    const parsed = quantityCostPlanSchema.safeParse(scenario.quantityCost);
    if (!parsed.success) throw new Error("저장 원가의 입력 형식을 확인해야 합니다. 현재 평면 기준으로 다시 작성할 수 있습니다.");
    return { plan: parsed.data, savedKey, error: "" };
  } catch (error) { return { plan: null, savedKey, error: errorText(error) }; }
}
function savedAssessment(scenario: PlanningScenario, inputs: QuantityCostInputs): QuantityCostAssessment {
  try { return evaluateQuantityCost(scenario, inputs); }
  catch (error) { return { status: "conflict", adjustmentManwon: null, issues: [errorText(error)], takeoff: null, contract: null }; }
}

export function PlanningQuantityCostPanel({ scenario, geometry, context, locked: lockedProp, getCurrentScenario, onChange }: Props) {
  const inputs = useMemo<QuantityCostInputs>(() => ({
    constructionCostPerSqmWon: context.assumptions.constructionCostPerSqmWon,
    basementCostMultiplier: context.assumptions.basementCostMultiplier,
  }), [context.assumptions.constructionCostPerSqmWon, context.assumptions.basementCostMultiplier]);
  const [draft, setDraft] = useState(() => initialDraft(scenario, inputs));
  const [numericErrors, setNumericErrors] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmedKey, setConfirmedKey] = useState("");
  const [message, setMessage] = useState("");
  const takeoff = useMemo(() => takeoffPlanningQuantities(scenario), [scenario]);
  const saved = useMemo(() => savedAssessment(scenario, inputs), [scenario, inputs]);
  const locked = lockedProp || isPlanningGeometryLocked(scenario) || scenario.fullQuoteAdoption !== undefined;
  const savedKey = serialized(scenario.quantityCost);
  const savedChanged = draft.savedKey !== savedKey;
  const stale = !!draft.plan && (draft.plan.sourceBasis !== takeoff.basis ||
    draft.plan.inputs.constructionCostPerSqmWon !== inputs.constructionCostPerSqmWon ||
    draft.plan.inputs.basementCostMultiplier !== inputs.basementCostMultiplier);
  const inputKey = useMemo(() => reviewKey(scenario, geometry, context, draft.plan), [scenario, geometry, context, draft.plan]);
  const invalidNumbers = Object.values(numericErrors).some(Boolean);
  const editable = !locked && !stale && !savedChanged;
  const currentPreview = preview?.key === inputKey ? preview : null;
  const ready = !!currentPreview && currentPreview.assessment.status === "ready" && !currentPreview.error &&
    !!currentPreview.before && !!currentPreview.after && !invalidNumbers && editable;

  useEffect(() => { setPreview(null); setConfirmedKey(""); }, [inputKey]);
  useEffect(() => {
    // Invalidate confirmations without changing the draft's original source basis or prices.
    setDraft(previous => {
      if (!previous.plan || (previous.plan.sourceBasis === takeoff.basis &&
        previous.plan.inputs.constructionCostPerSqmWon === inputs.constructionCostPerSqmWon &&
        previous.plan.inputs.basementCostMultiplier === inputs.basementCostMultiplier) ||
        !previous.plan.lines.some(line => line.scopeConfirmed)) return previous;
      return { ...previous, plan: { ...previous.plan, lines: previous.plan.lines.map(line => ({ ...line, scopeConfirmed: false })) } };
    });
  }, [takeoff.basis, inputs]);

  function updateLine(id: QuantityCostLine["id"], patch: Partial<QuantityCostLine>, confirm = false) {
    if (!editable) return;
    setDraft(previous => !previous.plan ? previous : { ...previous, plan: { ...previous.plan,
      lines: previous.plan.lines.map(line => line.id !== id ? line : { ...line, ...patch,
        scopeConfirmed: confirm ? patch.scopeConfirmed === true : false }) } });
    setPreview(null); setConfirmedKey(""); setMessage("");
  }
  function currentScenario() {
    const current = getCurrentScenario();
    if (!current || current.id !== scenario.id || current.projectId !== scenario.projectId) {
      setMessage("현재 계획안이 없거나 다른 계획안으로 변경됐습니다."); return undefined;
    }
    if (current.fullQuoteAdoption !== undefined) { setMessage("전체 견적 채택을 먼저 해제해야 수량 원가를 변경할 수 있습니다."); return undefined; }
    if (locked || isPlanningGeometryLocked(current)) { setMessage("잠긴 계획안은 변경할 수 없습니다."); return undefined; }
    return current;
  }
  function previewDraft() {
    const current = currentScenario();
    if (!current || !draft.plan || !editable || invalidNumbers) return;
    const key = reviewKey(current, geometry, context, draft.plan);
    if (!key || key !== inputKey) { setMessage("계획안이 변경됐습니다. 최신 입력을 확인한 뒤 다시 미리보기해 주세요."); return; }
    setConfirmedKey(""); setMessage("");
    const assessment = savedAssessment({ ...current, quantityCost: draft.plan }, inputs);
    const next: Preview = { key, assessment, before: null, after: null, error: "" };
    try {
      if (assessment.status === "ready") {
        const applied = applyQuantityCost(current, draft.plan, inputs, geometry);
        if (!applied.patch) throw new Error(applied.error ?? "현재 형상과 수량 원가의 연결을 확인해야 합니다.");
        const before = calculatePlanningScenario({ ...current, quantityCost: undefined }, context).economicsPreview;
        const after = calculatePlanningScenario({ ...current, quantityCost: draft.plan }, context).economicsPreview;
        if (before.status !== "estimated" || after.status !== "estimated" || after.quantityCostStatus !== "ready" ||
          [before, after].some(value => [value.constructionCostManwon, value.totalCostManwon, value.profitManwon]
            .some(amount => !Number.isFinite(amount)))) throw new Error("사업성 비교값이 미확정이거나 유효하지 않습니다.");
        next.before = before; next.after = after;
      }
    } catch (error) { next.error = errorText(error); }
    setPreview(next);
  }
  function applyDraft() {
    const current = currentScenario();
    if (!current || !draft.plan || !ready || !inputKey || confirmedKey !== inputKey) return;
    if (reviewKey(current, geometry, context, draft.plan) !== inputKey) {
      setPreview(null); setConfirmedKey(""); setMessage("확인 후 계획안이 변경됐습니다. 새 미리보기가 필요합니다."); return;
    }
    try {
      const result = applyQuantityCost(current, draft.plan, inputs, geometry);
      if (!result.patch) { setMessage(result.error ?? "수량 원가를 반영하지 못했습니다."); return; }
      onChange(result.patch);
      setDraft(previous => ({ ...previous, savedKey: serialized(result.patch?.quantityCost) }));
      setPreview(null); setConfirmedKey(""); setMessage("수량 원가 조정을 반영했습니다. 공식 경계·허가·전문가 승인은 미확정입니다.");
    } catch (error) { setConfirmedKey(""); setMessage(errorText(error)); }
  }
  function resetDraft() {
    const current = currentScenario();
    if (!current) return;
    try {
      setDraft({ plan: createQuantityCostDraft(current, inputs), savedKey: serialized(current.quantityCost), error: "" });
      setNumericErrors({}); setPreview(null); setConfirmedKey("");
      setMessage("현재 평면 기준의 새 초안입니다. 단가·포함액·근거·확인을 초기화했으며 저장된 조정은 유지됩니다.");
    } catch (error) { setMessage(errorText(error)); }
  }
  function removeSaved() {
    const current = currentScenario();
    if (!current?.quantityCost) return;
    if (serialized(current.quantityCost) !== savedKey) { setMessage("저장된 원가가 변경됐습니다. 최신 저장본을 먼저 확인해 주세요."); return; }
    if (!window.confirm("저장된 수량·원가 조정을 삭제하시겠습니까? 기본 연면적 공사비·재료비·세대 가산비는 유지됩니다.")) return;
    const latest = currentScenario();
    if (!latest || serialized(latest.quantityCost) !== savedKey) { setMessage("저장본이 변경되어 삭제하지 않았습니다."); return; }
    onChange({ quantityCost: undefined, checks: [], economicsPreview: { ...latest.economicsPreview, status: "stale" } });
    setDraft(previous => ({ ...previous, savedKey: serialized(undefined) }));
    setPreview(null); setConfirmedKey(""); setMessage("저장된 수량 원가 조정을 삭제했습니다. 편집 중인 초안은 미적용 상태로 유지됩니다.");
  }

  const comparison: Array<[string, number, number]> = currentPreview?.before && currentPreview.after ? [
    ["공사비", currentPreview.before.constructionCostManwon, currentPreview.after.constructionCostManwon],
    ["총사업비", currentPreview.before.totalCostManwon, currentPreview.after.totalCostManwon],
    ["예상 이익", currentPreview.before.profitManwon, currentPreview.after.profitManwon],
  ] : [];
  return <div className="lv-quantity">
    {scenario.fullQuoteAdoption && <p role="status">전체 견적 채택 중 · 아래 수량 원가는 비교 근거이며 사업비에 별도 가산되지 않습니다.</p>}
    <p className="lv-status" data-state={saved.status === "conflict" || saved.status === "stale" ? "conflict" : "review"}>
      저장 원가: {statusLabels[saved.status]}
      {saved.status === "ready" && saved.adjustmentManwon !== null && <> · {scenario.fullQuoteAdoption ? "기존 산식 증감" : "공사비 증감"} {number(saved.adjustmentManwon)}만원</>}
    </p>
    {saved.issues.length > 0 && <details><summary>저장 원가 확인 사항 ({saved.issues.length})</summary>
      <ul className="lv-issues">{saved.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>
    </details>}
    <dl className="lv-quantity-basis">
      <div><dt>기본 연면적 단가</dt><dd>{number(inputs.constructionCostPerSqmWon)} 원/㎡</dd></div>
      <div><dt>지하층 공사비 배율</dt><dd>{number(inputs.basementCostMultiplier)} 배</dd></div>
    </dl>
    <p className="lv-status" data-state={takeoff.status === "conflict" ? "conflict" : "review"}>
      현재 수량: {takeoff.status === "preliminary" ? "모델 기반 예비 산출 · 실측 아님" : takeoff.status === "missing" ? "자료 부족 · 수량 미확정" : "모델 충돌 · 수량 미확정"}
    </p>
    <p className="lv-note">외벽·구조체·공용부·기계전기배관(MEP)·소방 상세 수량은 제외됩니다. 지원하지 않는 구획·용도는 미확정이며, 공식 경계·허가·전문가 승인과 법정 적합 판정은 미확정입니다.</p>
    {takeoff.issues.length > 0 && <ul className="lv-issues">{takeoff.issues.map((issue, index) => <li key={index} data-state="fail">{issue}</li>)}</ul>}
    {draft.error && <p role="alert">{draft.error}</p>}
    {stale && <p role="alert">초안의 평면·층고·면적 또는 기본 공사비 기준이 변경됐습니다. 단가와 포함액을 자동으로 이전하지 않습니다.</p>}
    {savedChanged && <p role="alert">저장된 수량 원가가 변경됐습니다. 현재 기준으로 다시 작성하기 전에는 초안을 적용할 수 없습니다.</p>}
    <div className="lv-actions">
      <button type="button" disabled={locked} onClick={resetDraft}><RefreshCw size={15} aria-hidden="true" />현재 평면 기준으로 다시 작성</button>
      <button type="button" disabled={locked || !scenario.quantityCost} onClick={removeSaved}><Trash2 size={15} aria-hidden="true" />저장 조정 삭제</button>
    </div>
    <p className="lv-note">단가·포함액·견적 근거는 미입력 상태가 기본입니다. 초안은 미적용이며 저장된 조정을 대체하지 않습니다.</p>
    <p className="lv-note">단가와 기존 포함액은 기본 공사비와 부가세 포함·별도 여부 및 노무비·재료비 범위가 같아야 합니다. 확인되지 않은 기준을 임의로 가정하지 않습니다.</p>
    {takeoff.items.map(item => {
      const line = draft.plan?.lines.find(candidate => candidate.id === item.id);
      const unit = item.unit === "m2" ? "㎡" : item.unit === "count" ? "개" : "m";
      const replacement = line?.treatment === "replace-allowance";
      return <details className="lv-quantity-line" key={item.id}>
        <summary><span>{item.label}</span><span className="lv-quantity-value">
          {item.quantity === null ? "미확정" : `${number(item.quantity, item.unit === "count" ? 0 : 3)} ${unit}`}
        </span><span>{line ? treatmentLabels[line.treatment] : "초안 없음"}</span></summary>
        <p className="lv-note">{item.detail}</p>
        <p className="lv-quantity-scope"><strong>견적 범위: </strong>{QUANTITY_COST_SCOPE[item.id]}</p>
        {line && <fieldset disabled={!editable} aria-label={`${item.label} 원가 입력`}>
          <div className="lv-fields">
            <label className="lv-field">처리 방식<select aria-label={`${item.label} 처리 방식`} value={line.treatment} onChange={event => {
              updateLine(item.id, { treatment: event.target.value as QuantityCostLine["treatment"], unitRateWon: null,
                includedAllowanceWon: null, allowanceSource: "" });
              setNumericErrors(previous => ({ ...previous, [`${item.id}:unitRateWon`]: false, [`${item.id}:includedAllowanceWon`]: false }));
            }}>{Object.entries(treatmentLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            {replacement && (["unitRateWon", "includedAllowanceWon"] as const).map(field => {
              const errorKey = `${item.id}:${field}`;
              const invalid = numericErrors[errorKey] || (line[field] !== null && (line[field]! < 0 || line[field]! > 1e13));
              const label = field === "unitRateWon" ? `교체 단가 (원/${unit})` : "기본단가 내 동일 공종 포함액 합계 (원)";
              return <label className="lv-field" key={field}>{label}<input type="number" min={0} max={1e13} step="any"
                aria-label={`${item.label} ${label}`} aria-invalid={invalid || undefined} value={line[field] ?? ""}
                onChange={event => {
                  const input = event.currentTarget;
                  const invalidInput = input.validity.badInput || (input.value !== "" && !Number.isFinite(input.valueAsNumber));
                  updateLine(item.id, { [field]: input.value === "" || invalidInput ? null : input.valueAsNumber });
                  setNumericErrors(previous => ({ ...previous, [errorKey]: invalidInput || input.validity.rangeUnderflow || input.validity.rangeOverflow }));
                }} />{invalid && <span className="lv-quantity-error">0 이상 10조 원 이하의 숫자가 필요합니다.</span>}</label>;
            })}
            <label className="lv-field">근거 상태<select aria-label={`${item.label} 근거 상태`} value={line.evidenceStatus}
              onChange={event => updateLine(item.id, { evidenceStatus: event.target.value as QuantityCostLine["evidenceStatus"] })}>
              <option value="assumed">가정</option><option value="user-input">사용자 입력</option><option value="quoted">견적서 입력 · 진위 미검증</option>
            </select></label>
          </div>
          <div className="lv-fields">
            <label className="lv-field">{replacement ? "교체 단가·공종 근거" : "기본단가 포함·공종 근거"}
              <textarea rows={2} maxLength={2000} aria-label={`${item.label} 공종 근거`} value={line.source}
                onChange={event => updateLine(item.id, { source: event.target.value })} /></label>
            {replacement && <label className="lv-field">기존 포함액·동일 공종 차감 근거
              <textarea rows={2} maxLength={2000} aria-label={`${item.label} 포함액 차감 근거`} value={line.allowanceSource}
                onChange={event => updateLine(item.id, { allowanceSource: event.target.value })} /></label>}
          </div>
          <label className="lv-confirm"><input type="checkbox" aria-label={`${item.label} 범위 확인`} disabled={line.treatment === "unpriced"}
            checked={!stale && line.scopeConfirmed} onChange={event => updateLine(item.id, { scopeConfirmed: event.target.checked }, true)} />
            공종 포함·제외 및 중복 제외, 기본 공사비와 동일한 부가세·노무비·재료비 기준 확인</label>
        </fieldset>}
      </details>;
    })}
    <details><summary>예비 산출의 제한 사항</summary><ul className="lv-issues">{takeoff.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></details>
    <p className="lv-note">Stage 3 기본 연면적 단가 민감도는 교체 후 남은 기본 공사 범위만 비례 조정합니다. 교체 견적액은 고정됩니다.</p>
    <div className="lv-actions"><button type="button" disabled={!editable || !draft.plan || invalidNumbers || !inputKey} onClick={previewDraft}>
      <Calculator size={15} aria-hidden="true" />원가·사업성 미리보기</button></div>
    {currentPreview && <section aria-label="수량 원가 미리보기">
      <p className="lv-status" data-state={ready ? "review" : "conflict"}>
        {ready ? "미적용 비교안 · Stage 2 개략 계산" : "미리보기 보류 · 미확정 항목 확인 필요"}</p>
      {currentPreview.error && <p role="alert">{currentPreview.error}</p>}
      <ul className="lv-issues">{currentPreview.assessment.issues.map((issue, index) => <li key={index} data-state="fail">{issue}</li>)}</ul>
      {ready && currentPreview.assessment.contract && <p>
        교체 공사비 {number(currentPreview.assessment.contract.replacementCostWon)}원
        {" − "}기존 포함액 {number(currentPreview.assessment.contract.allowanceWon)}원
        {" = "}공사비 증감 {number(currentPreview.assessment.contract.adjustmentManwon)}만원
      </p>}
      {comparison.length > 0 && <>
        <p className="lv-note">비교 기준은 현재 저장된 수량 조정을 제외한 동일 계획입니다. 초안 전체의 증감을 비교하며, 기존 조정에 추가 합산하지 않습니다.</p>
        <div className="lv-table-wrap"><table aria-label="수량 원가 Stage 2 사업성 비교">
          <thead><tr><th scope="col">항목 (만원)</th><th scope="col">수량 조정 제외</th><th scope="col">초안 반영</th><th scope="col">증감</th></tr></thead>
          <tbody>{comparison.map(([label, before, after]) => <tr key={label}><th scope="row">{label}</th>
            <td>{number(before)}</td><td>{number(after)}</td><td>{after > before ? "+" : ""}{number(after - before)}</td></tr>)}</tbody>
        </table></div>
        <p className="lv-note">설계·예비비·개략 금융비 등 기존 가정에 따른 연쇄 증감을 포함합니다. 상세 금융·세금·공정 사업성은 별도 검토 대상이며, 면적·수익면적·주차대수는 변경하지 않습니다.</p>
      </>}
    </section>}
    <label className="lv-confirm"><input type="checkbox" aria-label="수량 원가 적용 확인" disabled={!ready}
      checked={!!inputKey && confirmedKey === inputKey && ready} onChange={event => setConfirmedKey(event.target.checked && inputKey ? inputKey : "")} />
      수량·포함액 차감·단가 근거와 미확정 항목 확인</label>
    <div className="lv-actions"><button type="button" disabled={!ready || !inputKey || confirmedKey !== inputKey} onClick={applyDraft}>
      <Check size={15} aria-hidden="true" />수량 원가 조정 반영</button></div>
    <p role="status" aria-live="polite">{message}</p>
  </div>;
}
