# PARCELGRID — 한국 시행사용 부동산 타당성 분석 도구

## 본인 정보
- 이름: C
- 경로: /Users/yoonseochoi/Desktop/mywork/koreabuild/PARCELGRID
- 환경: macOS, Next.js 15.5 + TypeScript + pnpm, dev :3000

## 도구의 차별화 (선두주자 못 하는 것)
- Smart Picker: 부지 크기 자동 시나리오 매칭
- 단독/다가구 신축매매 (작은 부지) + 다세대 (큰 부지)
- 최대 시행 가능 인수가 역산 (IRR 10/15/20%, binary search)
- 시장가 vs 시행 가능가 갭 정직 표시

## 완료 라운드 (Git 백업)
- 복구 Phase 1-3
- Round 1A: ScenarioTable / RiskMatrix / CompsTable / PFChart
- Round 2-1: 백엔드 (compute-project comps + MOLIT 4종)
- Round 2-2: 대시보드 PDF p1 풀 복원 (3-column + 사이드바)
- Round D: 최대 시행 가능 인수가 역산
- Round E: 단독/다가구 + Smart Picker
- Round F: calculateCore BuildingType별 (단독 효율 95%)
- Round G: 인수가 추정 정확도 (sizeMultiplier + 가중평균)

## 다음 라운드 — Round H (큰 작업)
**인수가 입력 UX 재설계**:
- 자동 추정 제거 (또는 참고용)
- 사용자가 직접 입력
- 주변 실거래 평당가 분포 그래프/히스토그램
- 부지의 percentile 표시
- 입력 시 "주변 시세 대비 N%ile" 컨텍스트

이유: 강남구 역삼동 같은 큰 부지에서 자동 추정이 2,058억 같은 비현실적 숫자 나옴. 시행사는 인수가 알고 있으니 직접 입력 + 분포 시각화로 컨텍스트 제공이 진짜 가치.

## API 키 (.env.local)
- KAKAO_REST_API_KEY=***REMOVED***
- MOLIT_SERVICE_KEY=***REMOVED***
- VWORLD_API_KEY=***REMOVED***

## 핵심 통찰
- "시장 평균 인수가 ≠ 시행 가능 인수가"
- 자동 추정 X, 분포 시각화 + 직접 입력
- 부지 크기별 시나리오 차등
- 정직한 답
