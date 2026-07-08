/**
 * 신축 세대당 면적 표준값 — 상품 유형별 (V1).
 *
 * C 확정 (건축·상품 판단):
 *  - 기존(구)건물의 세대당 면적은 신축 설계와 무관 → 기본값으로 쓰지 않는다.
 *  - 다가구 매매 실거래엔 세대수/가구수 필드가 없어 세대당 면적을 직접 산출 불가.
 *  - 따라서 V1은 상품 유형별 표준값을 기본값으로 두고, 사용자가 수정 가능.
 *  - 화면에 반드시 출처(UNIT_AREA_SOURCE) 표시 — "사실만" 철학.
 *
 * 로드맵:
 *  - V2: RHTrade(다세대·연립) 지역 신축 실거래 전용면적 proxy 추천값.
 *  - V3: 추천값 적용 버튼 + 근거 사례 표시.
 *
 * ⚠️ 표준값은 여기 한 곳에서만 정의 (기준 바뀌면 이 파일만 수정).
 */

export type UnitProductType = "studio" | "two-room" | "family";

export interface UnitProductStandard {
  /** 표시명 */
  label: string;
  /** 세대당 면적 (㎡) */
  areaSqm: number;
  /** 상품 전략 설명 */
  description: string;
}

/** 상품 유형별 표준 세대당 면적 (C 확정) */
export const UNIT_AREA_STANDARDS: Record<UnitProductType, UnitProductStandard> = {
  studio: { label: "원룸형", areaSqm: 35, description: "세대수 극대화" },
  "two-room": { label: "투룸형", areaSqm: 50, description: "일반적인 다가구" },
  family: { label: "가족형", areaSqm: 65, description: "임대료 중심" },
};

/** 기본 상품 유형 (C 확정 — 가장 일반적인 신축 다가구) */
export const DEFAULT_UNIT_PRODUCT: UnitProductType = "two-room";

/** 기본 세대당 면적 (㎡) — 표준값 fallback */
export const DEFAULT_UNIT_AREA_SQM = UNIT_AREA_STANDARDS[DEFAULT_UNIT_PRODUCT].areaSqm;

/** 출처 문구 (화면 필수 표시 — C 확정) */
export const UNIT_AREA_SOURCE =
  "출처: 신축 소형주택 상품 유형 기본값 / 사용자 수정 가능";

/** 유형 배열 (UI 렌더 순서) */
export const UNIT_PRODUCT_ORDER: UnitProductType[] = ["studio", "two-room", "family"];
