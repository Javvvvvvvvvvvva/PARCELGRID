# PARCELGRID 현재 작업 기준

최종 갱신: 2026-10-07

이 파일은 다음 작업자가 오래된 “다음 세션” 메모를 현재 요구사항으로 오해하지 않도록, 실제 코드 기준의 짧은 인계 문서만 유지합니다. 6~7월 구현 과정은 `docs/PROGRESS-2026-07-10.md`와 `docs/SESSION-2026-07-08.md`의 역사 기록을 참고하세요.

## 현재 업데이트 순서

- 사용자 우선순위는 라이브러리를 활용한 기능·편의성·정확성 개선이다. [업데이트 실행 계획](docs/KR-UPGRADE-PLAN-2026-10-07.md)에 단계별 도입 후보와 완료 기준을 기록했다.
- 다음 구현은 KR-U1 부지 선택 환경이며 KR-U0 기준선 기록을 포함한다. 이후 저장·복구 → 외벽 수량·재료 → 내부 평면 → CAD/GIS 교환 → 환경·상세 3D·인계 순서다.
- 이번 갱신은 계획 문서다. Dexie·Flatten.js·HiGHS 등 신규 후보는 아직 설치하지 않았고, 현재 앱의 기능 완료 상태를 바꾸지 않는다.

## 제품 기준

- 대상 흐름: 주소·지도 부지 선택 → 가격 없는 현황 요약 → 취득대금 입력 → 계획 스튜디오 → 사업성 → 전문가 인계 → 보고서
- 기준 프로젝트: 서울 도봉구 쌍문동 281-23, PNU `1132010500102810023`
- 규제값은 출처와 검증 등급을 가진다. 전국 상한 참고값을 필지별 확정값처럼 사용하지 않는다.
- 사용자 입력, 공식·원문 근거, 알고리즘 추천은 저장과 화면에서 구분한다.
- 계획·3D·DAE·DXF·Stage 3는 같은 대표 계획안과 Geometry Hash를 사용한다.
- 기준 이미지의 정확 좌표가 없으면 층수·실루엣·후퇴·배치·회전·도로 관계를 새로 추정하지 않는다.

## 지도·주소 진입 흐름

- `/`와 `/projects/new`는 하나의 부지 탐색 화면이다. 주소/지역 검색과 지도 이동·확대·위성·클릭을 지원한다.
- 선택 단계는 PNU·경계·면적만 확인하며, 확인 버튼 뒤에 건축물대장·주변 GIS를 조회한다. 클릭 지점이 경계 밖이거나 다른 PNU이면 선택을 거절한다.
- `/status`는 `site-only` 데이터로 동작한다. 취득대금은 `null`, 취득일은 빈 값으로 저장하며 재무 엔진을 호출하지 않는다. 호환용 Parcel VM의 0은 계산 입력이 아니다.
- 현황은 세 카드로 요약하고 상세 대장·3D·도로를 펼친다. 기존 계획 스튜디오에는 손익이 있으므로 진입 전 양수 취득대금과 예정일을 받는다.
- 주변 토지 거래 분포는 가격 단계에서 요청할 때만 조회한다. 미확인 가격을 자동 추정해 채우지 않는다.
- 새 선택의 `intakeRevision`은 캐시·재계산·저장 사업성의 동일성을 구분한다. 같은 PNU를 재선택해도 이전 사업성·승인을 현재 결과로 표시하지 않는다. 저장 계획은 보존하지만 대표안은 재확정한다.
- `docs/KR-MAP-INTAKE.md` 참조. 브라우저 검사는 합성 SDK/응답이며 실제 Kakao·VWorld 승인 계정 확인은 남아 있다.

## 현재 코드 경로

한국판 업그레이드: 내부 구획·사업성 대사·예비 일영·DXF/3DM 인계를 추가했다. 사용법·현재 한계는 `docs/KR-INTERIOR-UPGRADE.md`, 9월 라이선스 조사 기록은 `docs/KR-UPGRADE-RESOURCES-2026-09-28.md`, 현재 후속 구현 순서는 `docs/KR-UPGRADE-PLAN-2026-10-07.md`를 참조한다. 미국판 변경은 포함하지 않는다. 후속 공공 원문 품질 구현은 `docs/KR-BUILDING-EVIDENCE.md`: 건축HUB 페이지/오류 상태, 층별·전유공용 속성, PK·면적제외 대조, 키 없는 근거 JSON을 연결했다. 실제 승인 계정 검증은 남아 있다.

| 역할 | 현재 구현 |
|---|---|
| 부지 탐색·가격 없는 현황 | `/projects/new` + `ParcelSelectionMap.tsx` + `SiteProjectAccess.tsx` |
| Plan Studio 화면 | `src/app/projects/[projectId]/envelope/page.tsx` |
| 추천 비교 | `PlanningRecommendationPanelV2.tsx` |
| 빠른 계획·정밀 편집 | `PlanningScenarioWorkspaceV4.tsx` |
| 추천 생성 | `recommendation-engine-v2.ts` + `recommendation-analysis.ts` |
| 실제 층별 매스 | `planning-massing.ts` + `scenario-spatial-validation.ts` |
| 대표안·Geometry 잠금 | `project-store.ts` + `planning-geometry.ts` |
| 내부 구획 편집 | `components/planning/interior/InteriorPlanWorkspace.tsx` |
| 독립 구획·검증·사업성·출력 | `lib/planning/interior/` |
| 건축물대장 조회·근거 | `lib/integrations/molit-building-client.ts` + `lib/building-registry/` + `BuildingRegistryEvidence.tsx` |
| 예비 일영·Worker | `solar-access.ts` + `workers/interior.worker.ts` |
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
- 내부 구획의 추정 수익 면적은 명시적 반영 후 사용한다. 총 층 면적은 보존하고 공용 구획·잔여 면적은 비수익으로 처리한다.
- 내부 구획이나 재무 구역 변경 후 반영 서명이 달라지면 대표안 확정을 차단한다. 개념 내부 도면은 별도로 내보낼 수 있다.

- 대장 0건은 실제 나대지를 뜻하지 않는다. 이전 `hasBuilding: false`는 조회 미확인으로 두고 토지 단독 취득세를 자동 계산하지 않는다. `tax-evidence-2026.2` 이전 세금 부분 추정값은 Stage 3 재저장을 안내한다.
- 표제부·층별개요는 정확한 원본 PK와 면적제외 값으로 대조한다. 전유공용의 수신 행 합계를 신축 면적이나 동 연면적에 더하지 않는다.

## 남은 실제 확인

자동 테스트가 대신할 수 없는 아래 항목은 수동 확인이 필요합니다.

- 새 브라우저에서 쌍문동 주소 검색부터 보고서까지 전체 흐름
- 내보낸 DAE를 SketchUp에서 열어 원점·축·층·주차 확인
- 내보낸 DXF를 AutoCAD 호환 프로그램에서 열어 meter 단위와 `PG_*` 레이어 확인
- 보고서 A4 인쇄 미리보기의 잘림·겹침
- 실제 API 키를 넣은 `/system/readiness`와 외부 API 실패 안내
- 건축HUB 승인 계정의 실제 다동·집합건물·0건·페이지 초과 응답과 PK/면적제외 값 확인
- 다른 PC에서 인계 패키지 가져오기와 원문 재연결

수동 체크의 상세 절차는 `docs/release-smoke-test.md`를 사용합니다.

## 완료 조건

```bash
pnpm verify
```

lint, TypeScript, 전체 Vitest, production build를 모두 통과한 뒤에만 변경을 합칩니다. 형상·재무 변경은 관련 회귀 테스트와 사용자에게 보이는 근거 문구를 함께 갱신합니다.
