import { won } from "@/lib/utils/format";
import { FINANCIAL_SOURCE_FIELD_META, validateFinancialSourceEvidence } from "@/lib/finance/source-data-gate";
import type { ProjectOverviewModel } from "./useProjectOverview";
import type { EvidenceItem } from "./EvidenceSheet";
import { displayNumber, projectHref } from "./presentation";

export type EvidenceKey = "land" | "zoning" | "far" | "bcr" | "height" | "geometry" | "profit" | "equity" | "cost" | "afterTax" | "sources" | "readiness";
const STATUS: Record<string, string> = { unknown: "미확인", "reference-only": "참고값", "user-entered": "사용자 입력", "source-backed": "원문 등록", "expert-approved": "전문가 확인" };
export function moneyText(value: number | undefined): string {
  return value !== undefined && Number.isFinite(value) ? won(value) : "—";
}
export function makeEvidence(model: ProjectOverviewModel, key: EvidenceKey): EvidenceItem {
  const parcel = model.data?.parcel;
  const rows: EvidenceItem["rows"] = [
    { label: "프로젝트", value: parcel?.address ?? model.projectId },
    { label: "대표 계획안", value: model.plan ? `${model.plan.name} · v${model.plan.version}` : "미선택" },
    { label: "검증된 Geometry Hash", value: model.geometry?.geometryHash ?? "없음" },
  ];
  const base = { rows, href: projectHref(model.projectId, "status"), action: "부지 근거 확인" };
  if (key === "far" || key === "bcr" || key === "height") {
    const record = parcel?.regulatoryConstraints?.[key];
    const title = { far: "용적률 기준", bcr: "건폐율 기준", height: "높이 기준" }[key];
    const fallback = key === "far" ? parcel?.maxFAR : key === "bcr" ? parcel?.maxBCR : parcel?.heightLimit;
    rows.push(
      { label: "원본 필드", value: `parcel.regulatoryConstraints.${key}` },
      { label: "출처", value: record?.sourceName || "출처 미기록" },
      { label: "원문", value: record?.sourceRef || "미등록", url: record?.sourceRef },
      { label: "원문 기준일", value: record?.asOf || "미기록" },
      { label: "확인자", value: record?.checkedBy || "미기록" },
    );
    return { ...base, title, value: `${displayNumber(record?.value ?? fallback)} ${record?.unit ?? (key === "height" ? "m" : "%")}`, status: STATUS[record?.status ?? "unknown"], note: record?.note || "저장된 기준값입니다. 필지별 적용과 인허가 가능성을 이 화면에서 새로 판정하지 않습니다." };
  }
  if (key === "zoning" || key === "land") {
    const zoning = parcel?.regulatoryConstraints?.zoningSource;
    rows.push({ label: "원본 필드", value: key === "land" ? "parcel.lotArea (㎡)" : "parcel.zoning" },
      { label: "데이터 동기화", value: model.data?.meta.lastSyncedAt ?? "미기록" });
    if (key === "zoning") rows.push({ label: "원문 출처", value: zoning?.sourceName || "미기록" }, { label: "원문", value: zoning?.sourceRef || "미등록", url: zoning?.sourceRef });
    return { ...base, title: key === "land" ? "대지면적" : "용도지역", value: key === "land" ? `${displayNumber(parcel?.lotArea, 2)} ㎡` : parcel?.zoning ?? "—", status: key === "land" ? "저장된 부지 입력 · 원문 확인 필요" : STATUS[zoning?.status ?? "unknown"], note: key === "land" ? "저장된 면적을 그대로 표시합니다. 도면의 화면상 넓이로 다시 계산하지 않으며, 별도의 측량 확인을 의미하지 않습니다." : zoning?.note || "용도지역 명칭과 수치 기준의 필지별 적용 확인은 서로 다릅니다." };
  }
  if (key === "geometry") {
    rows.push({ label: "좌표 출처", value: model.geometry ? "representativeGeometrySnapshot · 기존 검증 결과" : "parcel.boundary / parcel.roads · 저장된 좌표" },
      { label: "형상 생성 시각", value: model.geometry?.generatedAt ?? "검증 매스 없음" },
      ...((model.geometry?.sourceNotes ?? []).map((value) => ({ label: "원본 주의사항", value }))));
    return { ...base, title: "도면·형상 근거", value: model.geometry ? "형상 검증 통과" : "대표 매스 미확인", status: model.geometry ? "기존 엔진 검증 결과 · 인허가 승인 아님" : "저장된 부지 좌표만 표시", note: "입체도는 기존 층별 좌표의 카메라 투영입니다. 형상·면적·도로 폭을 새로 생성하지 않습니다. 생성형 이미지가 아니며 도로 선은 중심선 참고입니다.", href: projectHref(model.projectId, "envelope"), action: "계획 스튜디오에서 확인" };
  }
  if (["profit", "equity", "cost", "afterTax"].includes(key)) {
    const field = key === "profit" ? "profit" : key === "equity" ? "equity" : "cost";
    rows.push({ label: "저장 시각", value: model.snapshot?.savedAt ?? "저장 결과 없음" },
      { label: "저장된 계산 버전", value: model.snapshot?.data.meta.version ?? "미기록" },
      { label: "원본 필드·단위", value: key === "afterTax" ? "세후 금액 필드 없음 · taxBurden은 부분 추정액" : `ScenarioVM.${field} · 만원` },
      { label: "현재 입력과의 일치", value: model.readiness.inputsChanged ? "변경됨 · 사업성 재저장 필요" : "변경 감지 없음 (근거 원문 이력 보증 아님)" });
    if (key === "afterTax") rows.push({ label: "저장된 세금 부분 추정액", value: moneyText(model.finance?.taxBurden) });
    const note = key === "afterTax" ? "기존 세금 모델은 부분 추정액만 제공합니다. 재산세·부가세 등 미산정 항목이 있어 세전 손익에서 부분 세금을 빼 세후 수익으로 표시하지 않습니다. 세무 검토 승인만으로 계산 범위가 완성되는 것도 아닙니다." : key === "equity" ? "기존 엔진의 필요 자기자본을 그대로 표시합니다. 총사업비 − PF 최고잔액으로 재계산하지 않습니다. 세금 등 모델 제외 항목과 실제 조달조건은 별도로 확인해야 합니다." : "대표안과 일치하는 저장 결과를 그대로 표시합니다. 세전·예비 모델이며 최신 입력과 다르면 수치를 숨기고 재저장을 안내합니다.";
    return { ...base, title: { profit: "세전 예상손익", equity: "필요 자기자본", cost: "세전 총사업비", afterTax: "세후 예상수익" }[key as "profit" | "equity" | "cost" | "afterTax"], value: key === "afterTax" ? "산정 불가" : moneyText(model.finance?.[field]), status: key === "afterTax" ? "모델 범위 미완료" : model.finance ? "대표안과 일치하는 저장 결과" : "결과 저장·정합성 확인 필요", note, href: projectHref(model.projectId, ""), action: "사업성 원본 확인" };
  }
  if (key === "sources") {
    for (const record of Object.values(model.sources)) {
      if (!record) continue;
      const meta = FINANCIAL_SOURCE_FIELD_META[record.field];
      rows.push({ label: meta.label, value: `${displayNumber(record.value, 4)} ${meta.unit} · ${validateFinancialSourceEvidence(record).valid ? "등록 근거 형식 확인" : "근거 보완 필요"}` },
        { label: "발급기관·기준일·확인자", value: `${record.sourceName} / ${record.asOf} / ${record.verifiedBy}` },
        { label: "원문 식별자", value: record.documentRef || "미등록", url: record.documentRef });
    }
    return { ...base, title: "현재 등록된 계산 근거", value: model.sourceGate?.status === "source-backed" ? "필수 근거 등록" : "근거 보완 필요", status: "현재 등록 기록 · 저장 시점 원문 복사본 아님", note: "이 목록은 현재 등록된 원문입니다. 저장된 금액에 적용된 원문의 변경 이력까지 보증하지 않습니다. 원문 검증과 전문가 승인은 기존 사업성·인계 화면에서 확인하세요.", href: projectHref(model.projectId, "#source-data-room"), action: "근거 등록 화면" };
  }
  rows.push(...model.alignmentErrors.map((value) => ({ label: "기존 정합성 검사", value })),
    { label: "계획 검토", value: model.planningMessage ?? "대표안과 결과 연결 확인" },
    { label: "세후 수익", value: "산정 범위 미완료 · 총 세부담 아님" });
  return { ...base, title: "검토 상태와 다음 행동", value: model.next.state, status: "기존 검증·저장 상태의 요약", note: "검토 가능성과 법적 인허가 승인은 다릅니다. 미확인·계산 실패·자료 부족을 개발 불가 또는 손익 0원으로 바꾸지 않습니다.", href: projectHref(model.projectId, model.next.path), action: model.next.label };
}
