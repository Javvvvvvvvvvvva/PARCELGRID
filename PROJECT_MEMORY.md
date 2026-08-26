# PARCELGRID 현재 작업 기준

최종 갱신: 2026-08-26

이 파일은 다음 작업자가 오래된 “다음 세션” 메모를 현재 요구사항으로 오해하지 않도록, 실제 코드 기준의 짧은 인계 문서만 유지합니다. 6~7월 구현 과정은 `docs/PROGRESS-2026-07-10.md`와 `docs/SESSION-2026-07-08.md`의 역사 기록을 참고하세요.

## 제품 기준

- 대상 흐름: 주소 입력 → 현황 분석 → 계획 스튜디오 → 사업성 → 전문가 인계 → 보고서
- 기준 프로젝트: 서울 도봉구 쌍문동 281-23, PNU `1132010500102810023`
- 규제값은 출처와 검증 등급을 가진다. 전국 상한 참고값을 필지별 확정값처럼 사용하지 않는다.
- 사용자 입력, 공식·원문 근거, 알고리즘 추천은 저장과 화면에서 구분한다.
- 계획·3D·DAE·DXF·Stage 3는 같은 대표 계획안과 Geometry Hash를 사용한다.
- 기준 이미지의 정확 좌표가 없으면 층수·실루엣·후퇴·배치·회전·도로 관계를 새로 추정하지 않는다.

## 현재 코드 경로

| 역할 | 현재 구현 |
|---|---|
| Plan Studio 화면 | `src/app/projects/[projectId]/envelope/page.tsx` |
| 추천 비교 | `PlanningRecommendationPanelV2.tsx` |
| 빠른 계획·정밀 편집 | `PlanningScenarioWorkspaceV4.tsx` |
| 추천 생성 | `recommendation-engine-v2.ts` + `recommendation-analysis.ts` |
| 실제 층별 매스 | `planning-massing.ts` + `scenario-spatial-validation.ts` |
| 대표안·Geometry 잠금 | `project-store.ts` + `planning-geometry.ts` |
| Stage 3 연결 | `recompute-from-planning-scenarios.ts` |
| 전문가 인계 | `/projects/[projectId]/handoff` |
| 보고서 | `/projects/[projectId]/report` |

V1~V3 Plan Studio 컴포넌트와 중복 대시보드 UI는 제거됐습니다. 새 작업은 위 현재 경로를 확장하고 과거 버전 파일을 다시 만들지 않습니다.

## 추천안 계약

- 건축 타당성과 개략 손익은 같은 실행 가능 후보군에서 별도 순위를 계산한다.
- 두 기준이 같은 물리 계획을 선택하면 ID가 달라도 `통합 추천안` 한 개로 표시한다.
- 모든 후보가 적자면 “수익 최적”이 아니라 “손실 최소”로 표시한다.
- 법적 상한 참고안은 산술 FAR 자체가 아니다. 법규 외곽선·배치·층간 연결을 통과한 상위 실현 FAR 후보 중 층판 균형과 단순한 매스를 우선한다.
- 법적 상한 참고안의 주차 미충족은 숨기지 않으며 대표안 확정을 차단한다.

## 면적·재무 계약

- 대지면적, 건축면적, 총연면적, 용적률 산입면적을 분리한다.
- Stage 3는 대표 PlanningScenario의 실현 형상 면적을 사용한다. 산술 법정 BCR/FAR를 실제 계획 면적으로 대체하지 않는다.
- 총사업비 + 손익 = 매출, 자금조달과 사용액의 기준 차이를 자동 대사한다.
- 토지 매입가와 주요 금융·가격 가정은 원문 근거 상태를 함께 저장한다.

## 남은 실제 확인

자동 테스트가 대신할 수 없는 아래 항목은 수동 확인이 필요합니다.

- 새 브라우저에서 쌍문동 주소 검색부터 보고서까지 전체 흐름
- 내보낸 DAE를 SketchUp에서 열어 원점·축·층·주차 확인
- 내보낸 DXF를 AutoCAD 호환 프로그램에서 열어 meter 단위와 `PG_*` 레이어 확인
- 보고서 A4 인쇄 미리보기의 잘림·겹침
- 실제 API 키를 넣은 `/system/readiness`와 외부 API 실패 안내
- 다른 PC에서 인계 패키지 가져오기와 원문 재연결

수동 체크의 상세 절차는 `docs/release-smoke-test.md`를 사용합니다.

## 완료 조건

```bash
pnpm verify
```

lint, TypeScript, 전체 Vitest, production build를 모두 통과한 뒤에만 변경을 합칩니다. 형상·재무 변경은 관련 회귀 테스트와 사용자에게 보이는 근거 문구를 함께 갱신합니다.
