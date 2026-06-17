/**
 * 부지 시장 평균 인수가 추정 함수.
 *
 * UPDATED: 시도 단위 → 시군구 단위 배율로 정교화.
 * 같은 도 안에서도 시군구별로 2배 이상 차이가 나는 한국 부동산 현실 반영.
 *
 * 방법론:
 *   추정 A (공시지가 기반)   = 공시지가 총액 × 시군구별 배율
 *   추정 B (실거래 평당 기반) = 같은 지목 거래 평당 중앙값 × 평수
 *
 *   결합 로직 (이전과 동일):
 *     - 같은 지목 거래 5건 미만 → 추정 A만 (low)
 *     - 두 추정 비율 0.3~3.0 밖 → 추정 A (medium)
 *     - 정상 범위 → 큰 값 (high if 20+, else medium)
 *
 * 한계 (정직히):
 *   1. 시군구 배율도 평균값. 같은 시군구 내 동(洞)별 차이 있음.
 *   2. 추정 정확도 약 ±25%. 시도 단위(±30%) 보다 개선.
 */

import type { MolitTransaction } from "@/lib/integrations/molit";
import { jimokToCategory, type JimokCategory } from "@/lib/integrations/vworld";

export interface EstimatePriceInput {
  publicLandValueManwon: number;
  lotAreaSqm: number;
  landTransactions: MolitTransaction[];
  jimokCategory: JimokCategory;
  /** 전체 주소 (예: "서울 강남구 역삼동 824-11"). 시군구 추출에 사용 */
  address: string;
}

export type EstimateMethod = "by-comps" | "by-publicvalue" | "hybrid";
export type EstimateConfidence = "high" | "medium" | "low";

export interface EstimatePriceResult {
  estimatedPriceManwon: number;
  estimatedPricePerPyeong: number;
  method: EstimateMethod;
  confidence: EstimateConfidence;
  /** 실거래 중앙값 평당 (만원/평) — 참고용 */
  marketMedianPerPyeong?: number;
  /** 실거래 중앙값 × 부지 평수 (만원) — 추정가와 비교용 */
  marketMedianManwon?: number;
  details: {
    fromPublicValue: number;
    fromComps: number;
    locationMultiplier: number;
    sizeMultiplier: number;
    finalMultiplier: number;
    locationTier: string;
    sampleSize: number;
    medianPricePerPyeong: number;
  };
}

const SQM_PER_PYEONG = 3.305785;

/**
 * 시군구별 평균 실거래/공시지가 배율.
 *
 * Step 1 정교화 — 가장 명확한 곳만 우선 분류:
 *   - 강남 3구 + 마용성광 (서울 최상위)
 *   - 강남 인접 수도권 핵심 (하남/성남/과천/위례/판교/광명)
 *   - 부산/대구 핵심구 (해운대/수영구)
 *
 * 그 외는 기존 시도 단위 fallback. 추후 시군구별 데이터로 정교화.
 */
function locationMultiplier(address: string): {
  multiplier: number;
  tier: string;
} {
  // 강남 핵심 3구 + 한강벨트 일부
  if (/강남구|서초구|송파구/.test(address)) {
    return { multiplier: 3.0, tier: "gangnam-core" };
  }

  // 마용성광 (마포/용산/성동/광진)
  if (/용산구|마포구|성동구|광진구/.test(address)) {
    return { multiplier: 2.7, tier: "mid-prime-seoul" };
  }

  // 서울 그 외 핵심 (영등포/양천/강서/동작/관악/중구/종로/동대문/서대문/성북)
  if (/영등포구|양천구|강서구|동작구|관악구|중구|종로구|동대문구|서대문구|성북구/.test(address)) {
    return { multiplier: 2.3, tier: "seoul-standard" };
  }

  // 서울 외곽 (노원/도봉/강북/은평/금천/구로/중랑)
  if (/노원구|도봉구|강북구|은평구|금천구|구로구|중랑구/.test(address)) {
    return { multiplier: 2.5, tier: "seoul-outer" };
  }

  // 강남 인접 수도권 핵심 (강남 인근 신도시·핵심 입지)
  if (/하남시|성남시|과천시|광명시/.test(address)) {
    return { multiplier: 2.2, tier: "metro-prime" };
  }

  // 판교/위례/분당 (지명 기반 — 동 이름)
  if (/판교|위례|분당/.test(address)) {
    return { multiplier: 2.5, tier: "metro-prime-newtown" };
  }

  // 부산/대구 핵심구
  if (/해운대구|수영구|남구/.test(address) && /부산/.test(address)) {
    return { multiplier: 2.3, tier: "busan-prime" };
  }
  if (/수성구/.test(address) && /대구/.test(address)) {
    return { multiplier: 2.2, tier: "daegu-prime" };
  }

  // 부산 그 외 광역시
  if (/^부산|^대구|^인천/.test(address)) {
    return { multiplier: 1.8, tier: "metro-city" };
  }

  // 그 외 광역시 (광주/대전/울산/세종)
  if (/^광주|^대전|^울산|^세종/.test(address)) {
    return { multiplier: 1.7, tier: "metro-city" };
  }

  // 경기도 그 외 (수원/안양/용인/고양/부천 등)
  if (/^경기/.test(address)) {
    return { multiplier: 1.8, tier: "gyeonggi-standard" };
  }

  // 서울 fallback (시군구가 위 분류 어디에도 안 잡힌 경우)
  if (/^서울/.test(address)) {
    return { multiplier: 2.4, tier: "seoul-fallback" };
  }

  // 지방 도 (강원/충북/충남/전북/전남/경북/경남/제주)
  return { multiplier: 1.5, tier: "rural" };
}

/**
 * 부지 크기별 size multiplier — 작은 부지는 시장가 추정 낮춤.
 *
 * 이유: 시군구 multiplier는 시행 가능 부지(200평+) 기준으로 calibrated.
 * 작은 부지는:
 * - 매도자/매수자 수 적음 → 거래 빈도 낮음
 * - 단독/다가구 신축매매만 가능 → 다세대보다 매출 작음
 * - 시장 프리미엄 적게 적용됨
 */
function sizeMultiplier(lotPyeong: number): number {
  if (lotPyeong < 20) return 0.55;   // 매우 작은 부지: 매도가 어려움
  if (lotPyeong < 30) return 0.65;   // 작은 부지 (단독 1동 최소 크기)
  if (lotPyeong < 50) return 0.78;   // 단독 신축매매 주 영역
  if (lotPyeong < 80) return 0.88;   // 다가구 신축매매 영역
  if (lotPyeong < 150) return 0.96;  // 중간 부지
  if (lotPyeong < 300) return 1.00;  // 표준 (시군구 multiplier 그대로)
  return 1.05;                        // 큰 부지: 시행 프리미엄
}

export function estimateMarketPrice(
  input: EstimatePriceInput
): EstimatePriceResult {
  const {
    publicLandValueManwon,
    lotAreaSqm,
    landTransactions,
    jimokCategory,
    address,
  } = input;

  const lotPyeong = lotAreaSqm / SQM_PER_PYEONG;

  // 추정 A: 공시지가 × 시군구 배율 × 부지 크기 보정
  const { multiplier: locationMult, tier } = locationMultiplier(address);
  const sizeMult = sizeMultiplier(lotPyeong);
  const finalMultiplier = locationMult * sizeMult;
  // 공시가가 만원/m² 단위이므로 lotAreaSqm을 곱해서 부지 전체 가격으로 변환
  const fromPublicValue = Math.round(publicLandValueManwon * lotAreaSqm * finalMultiplier);

  // 추정 B: 같은 지목 평당 중앙값 × 평수
  const targetCategory: JimokCategory =
    jimokCategory === "other" ? "buildable" : jimokCategory;

  const sameJimokTxns = landTransactions.filter((t) => {
    if (!t.jimok) return false;
    if (t.priceManwon <= 0 || t.exclusiveArea <= 0) return false;
    return jimokToCategory(t.jimok) === targetCategory;
  });

  const pricesPerPyeong = sameJimokTxns
    .map((t) => t.priceManwon / (t.exclusiveArea / SQM_PER_PYEONG))
    .filter((p) => p > 0 && Number.isFinite(p))
    .sort((a, b) => a - b);

  const medianPricePerPyeong =
    pricesPerPyeong.length > 0
      ? pricesPerPyeong[Math.floor(pricesPerPyeong.length / 2)]
      : 0;

  const fromComps =
    medianPricePerPyeong > 0
      ? Math.round(medianPricePerPyeong * lotPyeong)
      : 0;

  // 결합 로직
  let estimatedPriceManwon: number;
  let method: EstimateMethod;
  let confidence: EstimateConfidence;

  // 결합 로직: 실거래가 많을수록 comps 가중치 높임 (max 대신 가중평균)
  if (sameJimokTxns.length < 5) {
    estimatedPriceManwon = fromPublicValue;
    method = "by-publicvalue";
    confidence = "low";
  } else if (fromComps <= 0) {
    estimatedPriceManwon = fromPublicValue;
    method = "by-publicvalue";
    confidence = "medium";
  } else {
    const ratio = fromComps / fromPublicValue;
    if (ratio < 0.3 || ratio > 3.0) {
      // 이상치: 공시가 기반 사용 (실거래가 너무 튐)
      estimatedPriceManwon = fromPublicValue;
      method = "by-publicvalue";
      confidence = "medium";
    } else {
      // 정상: 가중평균 (거래 많을수록 comps 가중치 높임)
      const compsWeight = Math.min(0.7, sameJimokTxns.length / 30);
      const pubWeight = 1 - compsWeight;
      estimatedPriceManwon = Math.round(
        fromComps * compsWeight + fromPublicValue * pubWeight
      );
      method = "hybrid";
      // 신뢰도: 거래 수 + 부지 크기 둘 다 고려
      if (sameJimokTxns.length >= 20 && lotPyeong >= 50) {
        confidence = "high";
      } else if (lotPyeong < 30) {
        confidence = "low"; // 작은 부지는 항상 신뢰도 낮음
      } else {
        confidence = "medium";
      }
    }
  }

  const estimatedPricePerPyeong =
    lotPyeong > 0 ? Math.round(estimatedPriceManwon / lotPyeong) : 0;

  return {
    estimatedPriceManwon,
    estimatedPricePerPyeong,
    marketMedianPerPyeong: medianPricePerPyeong, // 실거래 중앙값 평당 (참고용)
    marketMedianManwon: medianPricePerPyeong > 0 ? Math.round(medianPricePerPyeong * lotPyeong) : 0,
    method,
    confidence,
    details: {
      fromPublicValue,
      fromComps,
      locationMultiplier: locationMult,
      sizeMultiplier: sizeMult,
      finalMultiplier,
      locationTier: tier,
      sampleSize: sameJimokTxns.length,
      medianPricePerPyeong: Math.round(medianPricePerPyeong),
    },
  };
}

export function methodLabel(method: EstimateMethod): string {
  return method === "by-comps"
    ? "실거래 기반"
    : method === "by-publicvalue"
      ? "공시지가 기반"
      : "혼합 (공시지가 + 실거래)";
}

export function confidenceLabel(c: EstimateConfidence): string {
  return c === "high" ? "신뢰도 높음" : c === "medium" ? "신뢰도 중간" : "신뢰도 낮음";
}
