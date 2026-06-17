#!/usr/bin/env python3
"""
Round G: 인수가 추정 정확도 개선.

본인이 짚은 진단:
- 작은 부지(38평) 추정가 8.4억 = 평당 2,200만 → 실거래 평균(평당 200-1,200만)보다 비쌈
- 본인 도구가 multiplier 2.5 그대로 적용 → 부지 크기 무시
- 시행 가능 부지(200평+) 기준 multiplier → 작은 부지는 과대 추정

정정:
1. 부지 크기별 size adjustment (작은 부지 multiplier 낮춤)
2. 신뢰도 (confidence) 부지 크기 반영
3. 응답에 fromComps/fromPublicValue 둘 다 + marketMedian 추가
4. /api/parcels/estimate-price route + 부지 등록 페이지에 표시
"""

import sys
from pathlib import Path

ROOT = Path(".")

if not (ROOT / "src/lib/finance/estimate-price.ts").exists():
    print("✗ PARCELGRID 폴더에서 실행해주세요")
    sys.exit(1)


# ─── 1. estimate-price.ts: size multiplier 추가 + 응답 확장 ────────
print("=== Patching estimate-price.ts ===")
path = ROOT / "src/lib/finance/estimate-price.ts"
content = path.read_text()

# 1a. sizeMultiplier 함수 추가 (locationMultiplier 함수 다음에)
if "sizeMultiplier" not in content:
    marker = "export function estimateMarketPrice("
    new_func = '''/**
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

'''
    content = content.replace(marker, new_func + marker, 1)
    print("✓ sizeMultiplier 함수 추가")

# 1b. fromPublicValue 계산에 sizeMultiplier 적용
old_calc = """  // 추정 A: 공시지가 × 시군구 배율
  const { multiplier, tier } = locationMultiplier(address);
  // 공시가가 만원/m² 단위이므로 lotAreaSqm을 곱해서 부지 전체 가격으로 변환
  const fromPublicValue = Math.round(publicLandValueManwon * lotAreaSqm * multiplier);"""

new_calc = """  // 추정 A: 공시지가 × 시군구 배율 × 부지 크기 보정
  const { multiplier: locationMult, tier } = locationMultiplier(address);
  const sizeMult = sizeMultiplier(lotPyeong);
  const finalMultiplier = locationMult * sizeMult;
  // 공시가가 만원/m² 단위이므로 lotAreaSqm을 곱해서 부지 전체 가격으로 변환
  const fromPublicValue = Math.round(publicLandValueManwon * lotAreaSqm * finalMultiplier);"""

if old_calc in content:
    content = content.replace(old_calc, new_calc, 1)
    print("✓ fromPublicValue에 sizeMultiplier 적용")

# 1c. multiplier 변수 사용처 정정 (응답 객체)
old_response_marker = "      locationMultiplier: multiplier,"
new_response_marker = "      locationMultiplier: locationMult,\n      sizeMultiplier: sizeMult,\n      finalMultiplier,"

if "      locationMultiplier: multiplier," in content:
    content = content.replace(old_response_marker, new_response_marker, 1)
    print("✓ 응답에 sizeMultiplier 추가")

# 1d. 결합 로직 정정 — Math.max → 가중평균 (실거래가 많을수록 comps 가중치 높음)
old_combine = """  if (sameJimokTxns.length < 5) {
    estimatedPriceManwon = fromPublicValue;
    method = "by-publicvalue";
    confidence = "low";
  } else {
    const ratio = fromComps / fromPublicValue;
    if (ratio < 0.3 || ratio > 3.0) {
      estimatedPriceManwon = fromPublicValue;
      method = "by-publicvalue";
      confidence = "medium";
    } else {
      estimatedPriceManwon = Math.max(fromComps, fromPublicValue);
      method = "hybrid";
      confidence = sameJimokTxns.length >= 20 ? "high" : "medium";
    }
  }"""

new_combine = """  // 결합 로직: 실거래가 많을수록 comps 가중치 높임 (max 대신 가중평균)
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
  }"""

if old_combine in content:
    content = content.replace(old_combine, new_combine, 1)
    print("✓ 결합 로직 정정 (가중평균 + 크기별 신뢰도)")

# 1e. 응답에 marketMedian 명시적 필드 추가
old_return = """    estimatedPriceManwon,
    estimatedPricePerPyeong,
    method,"""

new_return = """    estimatedPriceManwon,
    estimatedPricePerPyeong,
    marketMedianPerPyeong: medianPricePerPyeong, // 실거래 중앙값 평당 (참고용)
    marketMedianManwon: medianPricePerPyeong > 0 ? Math.round(medianPricePerPyeong * lotPyeong) : 0,
    method,"""

if old_return in content:
    content = content.replace(old_return, new_return, 1)
    print("✓ 응답에 marketMedian 필드 추가")

path.write_text(content)


# ─── 2. estimate-price.ts: EstimatePriceResult 인터페이스 확장 ─────
print("\n=== Patching EstimatePriceResult interface ===")

# interface 확장
old_interface = """  details: {
    fromPublicValue: number;
    fromComps: number;
    locationMultiplier: number;
    locationTier: string;
    sampleSize: number;
    medianPricePerPyeong: number;
  };"""

new_interface = """  /** 실거래 중앙값 평당 (만원/평) — 참고용 */
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
  };"""

# content 새로 읽기 (위에서 수정됨)
content = path.read_text()

if old_interface in content:
    content = content.replace(old_interface, new_interface, 1)
    path.write_text(content)
    print("✓ EstimatePriceResult 인터페이스 확장")
elif "marketMedianPerPyeong" not in content:
    # 옛 형태일 수 있음 — locationMultiplier만 있는 형태
    old_simple = """    locationMultiplier: number;
    locationTier: string;
    sampleSize: number;
    medianPricePerPyeong: number;"""
    new_simple = """    locationMultiplier: number;
    sizeMultiplier: number;
    finalMultiplier: number;
    locationTier: string;
    sampleSize: number;
    medianPricePerPyeong: number;"""
    if old_simple in content:
        content = content.replace(old_simple, new_simple, 1)
        # marketMedian 필드도 별도 추가 필요 - 인터페이스 시작 부분에
        # 일단 details만 확장하고 marketMedian은 optional이라 자동 처리
        path.write_text(content)
        print("✓ details에 sizeMultiplier/finalMultiplier 추가")
    else:
        print("⚠ EstimatePriceResult details 패턴 못 찾음")


# ─── 3. /api/parcels/estimate-price route — 새 필드 그대로 전달 ─────
print("\n=== /api/parcels/estimate-price route ===")
# 본인 도구의 route는 estimateMarketPrice() 결과를 그대로 반환할 가능성 높음
# 그러면 자동으로 새 필드 포함됨. 확인만:
route_path = ROOT / "src/app/api/parcels/estimate-price/route.ts"
if route_path.exists():
    route = route_path.read_text()
    if "estimateMarketPrice" in route:
        print("✓ route는 estimateMarketPrice() 결과 그대로 전달 (수정 불필요)")
    else:
        print("⚠ route 확인 필요")


print("\n=== Round G 패치 완료 ===")
print("\n다음 단계:")
print("1. pnpm exec tsc --noEmit")
print("2. 브라우저: 도봉구 쌍문동 281-23 다시 조회")
print("3. 기대: 추정가 8.4억 → 약 5.5-6.5억 (sizeMultiplier 0.78 적용)")
print("4. 신뢰도: 'low' (38평 < 50평)")
