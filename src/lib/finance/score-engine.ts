/**
 * Score Engine — 시나리오 종합 평가 (최종형 구조).
 *
 * 별점·시공성·법적리스크를 여러 엔진 결과에서 종합한다.
 * 입력은 최종형으로 잡되, 아직 없는 값(주차 배치 용량 등)은 optional.
 * 나중에 Parking Engine·공사비 엔진이 값을 채우면 자동 반영된다.
 *
 * C 확정 규칙:
 *  시공성 = 층수 + 정북일조 + 주차 배치 (배치 여유 줄면 상층부 후퇴 가능성).
 *  법적리스크 = 정북일조 + 주차 + 용적률/건폐율 적합성.
 *  별점 = 시공성 + 법적리스크 종합.
 */

export type VerdictMark = "ok" | "warn" | "fail";
export type Grade = "높음" | "보통" | "낮음";
export type RiskGrade = "낮음" | "보통" | "높음";

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
}

export interface ScoreResult {
  buildability: { grade: Grade; note: string };
  legalRisk: { grade: RiskGrade; note: string };
  /** 주차 충족 여부 — capacity 미확정이면 null */
  parkingSufficient: boolean | null;
  /** 1~5 별점 */
  stars: number;
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

function deriveStars(
  build: { grade: Grade },
  risk: { grade: RiskGrade },
  parkingSufficient: boolean | null
): number {
  let stars: number;
  if (risk.grade === "높음") stars = 2;
  else if (build.grade === "높음" && risk.grade === "낮음") stars = 5;
  else if (build.grade !== "낮음" && risk.grade === "낮음") stars = 4;
  else if (build.grade === "보통" && risk.grade === "보통") stars = 3;
  else if (build.grade === "낮음") stars = 2;
  else stars = 3;

  // 주차 부족이 확정된 경우만 추가 감점 (미확정 null은 반영 안 함)
  if (parkingSufficient === false) stars = Math.max(1, stars - 1);
  return stars;
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
  const stars = deriveStars(buildability, legalRisk, parkingSufficient);

  return { buildability, legalRisk, parkingSufficient, stars };
}
