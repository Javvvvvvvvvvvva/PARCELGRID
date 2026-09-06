export type RoadLine = {
  name: string | null;
  points: [number, number][];
};

/**
 * 사용자/설계자가 입력하는 계획 여유거리.
 *
 * 이 값은 법적 최대 외곽선을 확정하는 법규값이 아니다. Planning UI의 배치
 * 대안·설계 여유를 표현하기 위한 입력이며, 대표안 법규 판정과 Geometry
 * Contract는 `legalEdgeSetbacksFromFrontage()`가 만든 별도 법적 검토 외곽선을
 * 사용한다.
 */
export type SetbackSpec = {
  road: number;
  side: number;
  rear: number;
};
