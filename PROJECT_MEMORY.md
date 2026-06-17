# PARCELGRID — 한국 시행사용 부동산 타당성 분석 도구

## 본인 정보
- 이름: C (최윤서)
- 경로: /Users/yoonseochoi/Desktop/mywork/koreabuild/PARCELGRID
- 환경: macOS, Next.js 15.5 + TypeScript + pnpm, dev :3000

## 도구의 진짜 차별화 (선두주자 못 하는 것)
- Smart Picker: 부지 크기 자동 시나리오 매칭
- 단독/다가구 신축매매 (작은 부지) + 다세대 시행 (큰 부지)
- 최대 시행 가능 인수가 역산 (IRR 10/15/20%, binary search)
- 시장가 vs 시행 가능가 갭 정직히 표시
- 부지 크기별 인수가 추정 정확도 (sizeMultiplier)

## 완료된 라운드 (Git 백업됨)
- 복구 Phase 1-3: 며칠 잃은 작업 부활 (Layout, 4 API routes, 부지 등록 페이지)
- Round 1A: ScenarioTable / RiskMatrix / CompsTable / PFChart 컴포넌트
- Round 2-1: 백엔드 (compute-project comps + MOLIT 4종 병렬)
- Round 2-2: 대시보드 PDF p1 풀 복원 (3-column + 우측 사이드바)
- Round D: 최대 시행 가능 인수가 역산 (max-acquisition.ts + MaxAcquisitionPanel)
- Round E: 단독/다가구 시나리오 + Smart Picker
- Round F: calculateCore BuildingType별 처리 (단독 효율 95%)
- Round G: 인수가 추정 정확도 (sizeMultiplier + 가중평균 + marketMedian)

## API 키 (.env.local)
- KAKAO_REST_API_KEY=***REMOVED***
- MOLIT_SERVICE_KEY=***REMOVED***
- VWORLD_API_KEY=***REMOVED***

## 다음 라운드 후보 (우선순위 순)
- [ ] /projects/new UI에 marketMedian 표시 (Round G 후속 - 추정가 vs 실거래 중앙값 둘 다 보여주기)
- [ ] /projects/[id]/comparison 페이지 (PDF p2 - S1/S2/S4 가로 비교)
- [ ] /projects/[id]/scenarios/[id] 정교화 (PDF p3-4 - 분기별 cashflow + PF구조)
- [ ] /projects/[id]/comps 페이지 (PDF p5 - 필터 + 테이블 + 지도)
- [ ] /projects/[id]/override 가정 편집 (PDF p6 - 슬라이더 + 실시간 영향)
- [ ] /projects/[id]/pdf 보고서 (PDF p7 - A4 미리보기)
- [ ] comps 필터링 (임야/도로/중복 호실 제거)

## 테스트 부지
- 도봉구 쌍문동 281-23 (38평, 제2종일반주거) - 작은 부지, Smart Picker로 단독 위주
- 강남구 역삼동 824-11 (195평) - 큰 부지, 다세대 4종 (PDF 디자인 예시)

## 핵심 통찰 (본인이 짚은 것)
- "시장 평균 인수가 ≠ 시행 가능 인수가" - 본인 도구의 진짜 가치
- 부지 크기별 multiplier 차등 - 작은 부지는 시장가 추정 낮춤
- 단독/다가구 신축매매 시나리오 - 다른 PropTech가 안 하는 영역
- 정직한 답 - 손실 시나리오는 음수 IRR, 불가능하면 "불가" 표시
