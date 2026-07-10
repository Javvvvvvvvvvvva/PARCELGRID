/**
 * Score Engine — 시나리오 종합 평가 (최종형 구조).
 *
 * 시공성·법적리스크를 여러 엔진 결과에서 종합한다.
 * 입력은 최종형으로 잡되, 아직 없는 값(주차 배치 용량 등)은 optional.
 * 나중에 Parking Engine·공사비 엔진이 값을 채우면 자동 반영된다.
 *
 * C 확정 규칙:
 *  시공성 = 층수 + 정북일조 + 주차 배치 (배치 여유 줄면 상층부 후퇴 가능성).
 *  법적리스크 = 정북일조 + 주차 + 용적률/건폐율 적합성.
 *
 * 사업 타당성 점수 (Buildability Score, 건축사 확정):
 *  - 100점 = "이 건물을 무리 없이 지을 수 있는가"만 평가 (투자성/IRR은 절대 불포함).
 *  - 감점식: 100에서 축별 미충족만큼 차감하고, 감점 사유를 함께 보여준다.
 *  - 배점: 법규 30 · 정북일조 20 · 주차 20 · 시공성 15 · 확장성 15.
 *  - 권장안이라도 100점이 아닐 수 있다 (부지의 실제 한계를 그대로 반영).
 */

export type VerdictMark = "ok" | "warn" | "fail";
export type Grade = "높음" | "보통" | "낮음";
export type RiskGrade = "낮음" | "보통" | "높음";

/** 배점 (합계 100) — 건축사 확정 */
export const SCORE_WEIGHTS = {
  legal: 25,
  sun: 20,
  parking: 15,
  buildability: 15,
  /** 세대 계획 적정성 — 실제 세대당 면적 ÷ 선택 상품 기준면적 */
  unitFit: 15,
  /** 확장성 — 용적률 잔여(향후 증축 여유) */
  extensibility: 10,
} as const;

/** 감점 1건 — 어느 축에서 몇 점, 왜 깎였는지 */
export interface ScoreDeduction {
  axis: keyof typeof SCORE_WEIGHTS;
  label: string;
  /** 깎인 점수 (양수) */
  deduction: number;
  reason: string;
}

/** Score Engine 입력 — 최종형 (미확정 값은 optional/null) */
export interface ScoreInput {
  floors: number;
  /** 정북일조 판정 */
  sun: { mark: VerdictMark; remainDepthM: number | null };
  /** 주차 — required는 필수, capacity는 배치엔진(Level 2~3) 나오면 채움 */
  parking: { required: number; capacity: number | null };
  /** 용적률 사용/상한 (%) */
  farUsedPct: number;
  farCapPct: number;
  /** 건폐율 사용/상한 (%) */
  bcrUsedPct: number;
  bcrCapPct: number;
  /**
   * 세대 계획 적정성 비율 = 실제 세대당 면적 ÷ 선택 상품유형 기준면적.
   * 다가구 등 세대 개념이 있는 경우만. 해당 없으면 null (감점 없음).
   */
  unitAdequacyRatio: number | null;
}

export interface ScoreResult {
  buildability: { grade: Grade; note: string };
  legalRisk: { grade: RiskGrade; note: string };
  /** 주차 충족 여부 — capacity 미확정이면 null */
  parkingSufficient: boolean | null;
  /** 사업 타당성 점수 0~100 (감점식) */
  score: number;
  /** 감점 내역 (deduction > 0 인 축만) */
  breakdown: ScoreDeduction[];
}

function deriveBuildability(
  floors: number,
  sunMark: VerdictMark
): { grade: Grade; note: string } {
  if (floors <= 3 && sunMark === "ok") {
    return { grade: "높음", note: "저층·단순 구조로 시공 용이" };
  }
  if (floors >= 5 || sunMark === "fail") {
    return {
      grade: "낮음",
      note: "배치 여유 부족 — 상층부 후퇴·매스 조정 가능성",
    };
  }
  return { grade: "보통", note: "정북일조 배치 검토 — 상층부 조정 가능성" };
}

function deriveLegalRisk(
  sunMark: VerdictMark,
  parkingSufficient: boolean | null,
  farUsedPct: number,
  farCapPct: number,
  bcrUsedPct: number,
  bcrCapPct: number
): { grade: RiskGrade; note: string } {
  if (
    sunMark === "fail" ||
    parkingSufficient === false ||
    farUsedPct > farCapPct ||
    bcrUsedPct > bcrCapPct
  ) {
    return { grade: "높음", note: "인허가 리스크 — 배치·법규 미충족 가능" };
  }
  if (sunMark === "warn" || farUsedPct >= farCapPct * 0.9) {
    return { grade: "보통", note: "검토 항목 존재 — 상세 설계 확인 필요" };
  }
  return { grade: "낮음", note: "법규 여유 — 무리 없는 계획" };
}

/** 용적률 잔여 비율 (0~1) — 확장성(향후 증축 여유) 판단 */
function remainingFarRatio(farUsedPct: number, farCapPct: number): number {
  if (farCapPct <= 0) return 0;
  const r = (farCapPct - farUsedPct) / farCapPct;
  return Math.max(0, Math.min(1, r));
}

/**
 * 사업 타당성 점수 (감점식). 각 축의 만점에서 미충족분을 차감하고 사유를 남긴다.
 * 권장안도 부지 한계에 따라 100점 미만일 수 있다.
 */
function deriveBuildabilityScore(
  build: { grade: Grade },
  risk: { grade: RiskGrade },
  sunMark: VerdictMark,
  parkingSufficient: boolean | null,
  farUsedPct: number,
  farCapPct: number,
  unitAdequacyRatio: number | null
): { score: number; breakdown: ScoreDeduction[] } {
  const breakdown: ScoreDeduction[] = [];
  const push = (
    axis: keyof typeof SCORE_WEIGHTS,
    label: string,
    earnedRaw: number,
    reason: string
  ) => {
    const earned = Math.round(earnedRaw);
    const deduction = SCORE_WEIGHTS[axis] - earned;
    if (deduction > 0) breakdown.push({ axis, label, deduction, reason });
    return earned;
  };

  // 법규 적합성 (25)
  const legalEarned = push(
    "legal",
    "법규",
    risk.grade === "낮음" ? 25 : risk.grade === "보통" ? 15 : 5,
    risk.grade === "보통" ? "검토 항목 존재" : "인허가 리스크"
  );

  // 정북일조 (20)
  const sunEarned = push(
    "sun",
    "정북일조",
    sunMark === "ok" ? 20 : sunMark === "warn" ? 10 : 3,
    sunMark === "warn" ? "이격 여유 부족" : "정북일조 미달"
  );

  // 주차 (15) — 배치엔진 전이면 미확정(중립 감점)
  const parkEarned = push(
    "parking",
    "주차",
    parkingSufficient === true ? 15 : parkingSufficient === null ? 11 : 4,
    parkingSufficient === null ? "배치 미확정" : "주차 미충족"
  );

  // 시공성 (15)
  const buildEarned = push(
    "buildability",
    "시공성",
    build.grade === "높음" ? 15 : build.grade === "보통" ? 9 : 5,
    build.grade === "보통" ? "상층부 조정 가능성" : "배치 여유 부족"
  );

  // 세대 계획 적정성 (15) — 실제 세대당 면적 ÷ 선택 상품 기준면적 (연속).
  // 해당 없으면(단독·근생 등) 만점 처리 (감점 없음).
  const fitRatio =
    unitAdequacyRatio === null ? 1 : Math.max(0, Math.min(1, unitAdequacyRatio));
  const unitFitEarned = push(
    "unitFit",
    "세대적정",
    SCORE_WEIGHTS.unitFit * fitRatio,
    "상품 기준면적 대비 세대 협소"
  );

  // 확장성 (10) — 용적률 잔여(향후 증축 여유, 연속).
  // 잔여 30% 이상이면 만점, 그 아래는 선형 감소.
  const rem = remainingFarRatio(farUsedPct, farCapPct);
  const extEarned = push(
    "extensibility",
    "확장성",
    SCORE_WEIGHTS.extensibility * Math.min(1, rem / 0.3),
    "용적률 여유 적음"
  );

  const score =
    legalEarned + sunEarned + parkEarned + buildEarned + unitFitEarned + extEarned;
  return { score, breakdown };
}

/** 종합 평가 */
export function computeScore(input: ScoreInput): ScoreResult {
  const parkingSufficient =
    input.parking.capacity === null
      ? null
      : input.parking.capacity >= input.parking.required;

  const buildability = deriveBuildability(input.floors, input.sun.mark);
  const legalRisk = deriveLegalRisk(
    input.sun.mark,
    parkingSufficient,
    input.farUsedPct,
    input.farCapPct,
    input.bcrUsedPct,
    input.bcrCapPct
  );
  const { score, breakdown } = deriveBuildabilityScore(
    buildability,
    legalRisk,
    input.sun.mark,
    parkingSufficient,
    input.farUsedPct,
    input.farCapPct,
    input.unitAdequacyRatio
  );

  return { buildability, legalRisk, parkingSufficient, score, breakdown };
}
