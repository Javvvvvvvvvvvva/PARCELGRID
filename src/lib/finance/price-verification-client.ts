"use client";

import { clientSession } from "@/lib/auth/client-session";
import type { ProjectComputed } from "@/lib/services/compute-project";
import { useProjectStore } from "@/lib/stores/project-store";
import { useReviewStore } from "@/lib/stores/review-store";
import { priceVerificationRecordSchema } from "./price-verification-schema";
import {
  buildFinancialSourceFromPriceVerification,
  classifyPriceReviewSource,
  validatePriceVerification,
  type PriceVerificationRecord,
  type PriceVerificationTarget,
} from "./price-verification";

interface PriceVerificationContext {
  projectId: string;
  sessionContext: string | null;
  expectedData: ProjectComputed;
}

export interface PriceVerificationSourceOutcome {
  sourceAction: "applied" | "removed" | "preserved" | "none";
}

function preflight(input: PriceVerificationContext, target: PriceVerificationTarget) {
  clientSession.assertActive();
  const project = useProjectStore.getState();
  if (!input.sessionContext || clientSession.context !== input.sessionContext) {
    throw new Error("계정 또는 조직이 변경됐습니다. 가격 검토 화면을 다시 여세요.");
  }
  if (!clientSession.principal?.capabilities.includes("project.update")) {
    throw new Error("가격 검토를 변경할 프로젝트 수정 권한이 없습니다.");
  }
  if (!project.data || project.data !== input.expectedData || project.data.parcel.id !== input.projectId) {
    throw new Error("현재 프로젝트 또는 계산 결과가 변경됐습니다. 가격 검토 화면을 다시 확인하세요.");
  }
  if (target !== "acquisition" && target !== "sale") {
    throw new Error("가격 검토 대상이 올바르지 않습니다.");
  }
  const review = useReviewStore.getState();
  const previous = review.priceVerifications[input.projectId]?.[target];
  if (previous !== undefined && (!priceVerificationRecordSchema.safeParse(previous).success ||
      previous.projectId !== input.projectId || previous.target !== target)) {
    throw new Error("기존 가격 검토의 프로젝트·대상 또는 필수 필드가 올바르지 않습니다.");
  }
  const field: "acquisitionPrice" | "salePricePerSqM" =
    target === "acquisition" ? "acquisitionPrice" : "salePricePerSqM";
  const sources = project.financialSources[input.projectId] ?? {};
  for (const [key, source] of Object.entries(sources)) {
    if (key !== field && source?.priceReviewOrigin?.target === target) {
      throw new Error("가격 검토 출처 연결이 다른 재무 필드에 있습니다. 연결을 확인한 뒤 변경하세요.");
    }
  }
  const source = sources[field];
  const ownership = source ? classifyPriceReviewSource(source, previous) : null;
  if (ownership === "ambiguous") {
    throw new Error("기존 가격 검토와 같은 출처에 소유권 표식이 없어 자동 변경할 수 없습니다. 원문 근거를 확인해 출처를 직접 정리하세요.");
  }
  if (ownership === "invalid-link") {
    throw new Error("가격 검토 출처 연결이 기존 검토와 일치하지 않습니다. 연결을 확인한 뒤 변경하세요.");
  }
  if (ownership === "protected-link") {
    throw new Error("가격 검토 출처에 첨부 또는 별도 메타데이터가 있어 자동 교체·삭제할 수 없습니다. 연결된 근거를 먼저 확인하세요.");
  }
  return { project, review, field, source, ownership };
}

function mutatePriceVerificationPair(
  mutate: () => PriceVerificationSourceOutcome,
): PriceVerificationSourceOutcome {
  const project = useProjectStore.getState();
  const review = useReviewStore.getState();
  try {
    return mutate();
  } catch (error) {
    // Zustand updates memory before persisting; restore both even if a rollback write throws.
    const recoveryErrors: unknown[] = [];
    try { useProjectStore.setState(project, true); } catch (rollbackError) { recoveryErrors.push(rollbackError); }
    try { useReviewStore.setState(review, true); } catch (rollbackError) { recoveryErrors.push(rollbackError); }
    if (recoveryErrors.length > 0) {
      try { clientSession.invalidate(); } catch (lockError) { recoveryErrors.push(lockError); }
      throw new AggregateError([error, ...recoveryErrors],
        "가격 검토 변경과 이전 상태의 로컬 저장 복구에 실패해 세션을 잠갔습니다. 저장소 복구 여부를 확인할 수 없습니다. 원본을 보존한 뒤 복구가 필요합니다.");
    }
    throw new Error("가격 검토 변경을 저장하지 못해 이전 상태로 되돌렸습니다. 다시 시도해 주세요.", { cause: error });
  }
}

export function saveCurrentPriceVerification(
  input: PriceVerificationContext & { record: PriceVerificationRecord },
): PriceVerificationSourceOutcome {
  const parsed = priceVerificationRecordSchema.safeParse(input.record);
  if (!parsed.success || parsed.data.projectId !== input.projectId) {
    throw new Error("가격 검토의 프로젝트·대상 또는 필수 필드가 올바르지 않습니다.");
  }
  const record = structuredClone(input.record);
  const current = preflight(input, record.target);
  const validation = validatePriceVerification(record);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  const generated = buildFinancialSourceFromPriceVerification(record);
  if (generated && current.source && current.ownership !== "owned") {
    throw new Error("별도 재무 원문 근거가 있어 가격 검증값으로 교체할 수 없습니다. 기존 출처를 먼저 확인하세요.");
  }

  return mutatePriceVerificationPair(() => {
    let sourceAction: PriceVerificationSourceOutcome["sourceAction"] = current.source ? "preserved" : "none";
    if (generated) {
      current.project.setFinancialSource(input.projectId, generated);
      sourceAction = "applied";
    } else if (current.ownership === "owned") {
      current.project.removeFinancialSource(input.projectId, current.field);
      sourceAction = "removed";
    }
    current.review.setPriceVerification(input.projectId, record);
    return { sourceAction };
  });
}

export function resetCurrentPriceVerification(
  input: PriceVerificationContext & { target: PriceVerificationTarget },
): PriceVerificationSourceOutcome {
  const current = preflight(input, input.target);
  return mutatePriceVerificationPair(() => {
    let sourceAction: PriceVerificationSourceOutcome["sourceAction"] = current.source ? "preserved" : "none";
    if (current.ownership === "owned") {
      current.project.removeFinancialSource(input.projectId, current.field);
      sourceAction = "removed";
    }
    current.review.removePriceVerification(input.projectId, input.target);
    return { sourceAction };
  });
}
