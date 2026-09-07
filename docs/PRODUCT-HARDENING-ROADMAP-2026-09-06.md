# PARCELGRID Product Hardening Roadmap

기준일: 2026-09-06

## 현재 판정

코드 기준선은 다시 검증 가능한 상태다. 프로덕션 의존성 취약점, 깨진 데모 링크, 외부 조회 실패의 오표시, 건축물대장 미조회/빈 토지 혼동, 모바일 핵심 화면 넘침을 이번 배치에서 수정했다. VWorld가 차단된 환경에서도 Kakao 주소와 MOLIT 건축물 조회 뒤 사용자가 토지 수치와 선택 GeoJSON 경계를 입력해 분석을 계속할 수 있다.

아직 "운영 출시 완료"로 판정하지 않는다. 실제 API 키를 사용한 전체 흐름, 외부 CAD/SketchUp/PDF 결과, 개인정보·운영 주체 문구, 운영 저장소와 백업은 사람과 운영 환경에서 확인해야 한다.

## 2026-09-06 완료

| 영역 | 변경 | 검증 |
| --- | --- | --- |
| 공급망 | Next.js 15.5.25, React 19.2.8, Drizzle 0.45 계열로 갱신하고 취약한 전이 의존성을 override | `pnpm audit --prod --audit-level high`: 알려진 취약점 0건 |
| 런타임 | Node 24가 아니면 개발·빌드·전체 검증을 중단하는 runtime gate 추가 | Node 22 실패, Node 24.20.0 통과 확인 |
| 데모 | 존재하지 않던 `/projects/sample` 링크를 실제 PNU 기반 결정론적 데모 API로 교체 | 외부 API 없이 데모 계산 회귀 테스트 통과 |
| 데이터 신뢰성 | 건축물대장 상태를 `건물 있음 / 등록 건물 없음 확인 / 조회 미확인`으로 분리 | 요약·현황·검토안 회귀 테스트 및 브라우저 확인 |
| 규제 출처 | 전국 시행령 참고 상한을 필지별 법정 상한 확보로 집계하지 않도록 수정 | 데이터 준비도에서 `파생·원문 미확인` 표시 확인 |
| 외부 연동 | 카카오 역세권 설정 누락을 빈 검색 결과와 분리 | HTTP 503 `KAKAO_NOT_CONFIGURED`, 화면 `조회 불가` 확인 |
| API 안전성 | 동적 프로젝트 계산 요청에 좌표·면적·금액·경계 크기·규제 근거 검증 추가 | 잘못된 JSON 400, 잘못된 입력 422 회귀 테스트 통과 |
| 모바일 | 프로젝트 레일을 하단 내비게이션으로 전환하고 status/comps 그리드와 표 스크롤 수정 | 390px에서 문서 넘침 없음, 표만 내부 스크롤 |
| 접근성 | 프로젝트 단계 내비게이션 이름, 현재 단계, 44px 모바일 터치 영역 추가 | DOM 접근성 스냅샷 확인 |
| HTTP 보안 | nosniff, frame deny, referrer, permissions 헤더와 `X-Powered-By` 제거 | 실제 localhost 응답 헤더 확인 |
| 저장소 | 부작용 import를 놓치던 감사기 수정, 참조 없는 중복 타입 파일 제거 | runtime 미도달 후보 3개에서 테스트 전용 후보 1개로 축소 |
| VWorld 없는 등록 | `VWORLD_ENABLED=false`에서 외부 요청을 생략하고 수동 토지 정보·GeoJSON 입력으로 전환 | 모드·PNU·경계 검증·lookup fallback 13개 회귀 테스트 통과 |
| 입력 출처 | 수동 면적·용도지역·법규·경계를 `user-entered`/`user-geojson`으로 보존하고 하위 화면에 표시 | 동적 프로젝트 저장과 현황·계획·내보내기 경계 확인 |
| AI 이미지 | `OPENAI_API_KEY` 준비 상태, 버튼 차단, Image API request id 보존 추가 | route 계약 테스트와 desktop/mobile 브라우저 확인 |

## P0 출시 차단 항목

| 순서 | 항목 | 완료 기준 | 필요한 입력 |
| --- | --- | --- | --- |
| 1 | VWorld 없는 실제 키 골든 패스 | 새 브라우저에서 주소 검색, 수동 토지 검증, Stage 5 보고서와 AI 이미지 생성까지 완주하고 출처·기준일·OpenAI request id 보존 | Kakao, MOLIT, OpenAI 운영 키와 확인된 필지 수치·GeoJSON |
| 2 | 실제 흑자 회귀 사례 | 검증된 주소 1건을 고정하고 Low/Base/High 손익, IRR, 최대 인수가를 원장과 대사 | 공개 가능한 주소와 검증 기준 |
| 3 | 내보내기 실물 QA | A4 PDF에 잘림이 없고 GLB를 실제 SketchUp에서 열어 Geometry Hash와 단위를 대조. 지적·도로 의존 DAE/DXF는 VWorld 복구 전 차단 유지 | 대상 앱이 설치된 검수 환경 |
| 4 | 개인정보·면책·문의 | 수집 항목, 외부 처리자, 보관·삭제, 책임 범위, 운영자·문의 정보를 화면과 문서에 게시하고 법률 검토 기록 | 운영 법인/개인명, 연락처, 보관 정책 |
| 5 | 운영 저장·복구 | 로컬 파일 저장을 운영 객체 저장소/DB로 교체하고 암호화, 보존 기간, 백업 복원 훈련을 통과 | 배포 환경과 저장소 선택 |
| 6 | 자동 브라우저 회귀 | desktop/mobile 골든 패스를 CI에서 실행하고 실패 스크린샷·trace를 보존 | CI 브라우저 실행 정책 |

## P1 안정화

| 항목 | 현재 위험 | 목표 |
| --- | --- | --- |
| CSP | inline style과 Kakao SDK 때문에 미적용 | nonce/hash 기반 CSP와 허용 도메인 최소화 |
| API 오류 계약 | route별 code/details 형식이 일부 다름 | 공통 오류 스키마, request id, 상태 코드 표준화 |
| 관측성 | console 로그 중심 | 구조화 로그, 외부 API 지연·실패율, 계산 오류 추적 |
| 다중 프로젝트 | 핵심 부지 초안이 단일 `sessionStorage`에 의존 | 프로젝트 목록, autosave, 명시적 삭제, 가져오기/복구 |
| 분산 제한 | 일부 quota/rate limit가 프로세스 메모리 기반 | 공유 저장소 기반 사용자·IP·프로젝트 제한 |
| 성능 | Plan Studio 첫 로드 JS 약 635 kB | 3D/내보내기 지연 로드와 번들 예산으로 25% 이상 감축 |
| 유지보수 | Stage 3 페이지 2,600줄, Plan Studio workspace 1,300줄 이상 | 계산/상태/뷰 경계를 나누고 단위 테스트 유지 |
| 접근성 | 수동 표본만 확인 | 키보드, focus, 이름/역할/값, 대비 자동 검사 |
| VWorld 재연결 | VPN에서 API가 차단되어 지적·도로 원문 자동 조회 중단 | 네트워크가 허용되는 실행 환경에서 별도 연동 검사 후 `VWORLD_ENABLED=true`로 복구 |

## P2 품질 정리

- React Three Fiber 내부의 `THREE.Clock` 폐기 예정 경고를 후속 라이브러리 업데이트에서 제거한다.
- 런타임에서 사용하지 않고 테스트에서만 남은 `src/lib/finance/comps.ts`의 폐기 또는 새 비교 모델 편입을 결정한다.
- 하드코딩된 제품 버전 표기를 단일 release metadata에서 생성한다.
- 보고서 인쇄 CSS, 빈 상태, 로딩 skeleton, 긴 한국 주소와 극단 금액 표기를 시각 회귀로 고정한다.

## 완료 정의

1. Node 24에서 lint, typecheck, 모든 unit/integration test, production build가 통과한다.
2. 프로덕션 의존성 high 이상 취약점이 0건이다.
3. 규제·건축물·실거래·역세권 데이터는 `확인`, `참고`, `미확인`, `실패`를 서로 바꾸어 표시하지 않는다.
4. desktop/mobile 골든 패스와 새로고침·복구 흐름이 CI에서 통과한다.
5. 회계 원장, Geometry Snapshot, PDF/DAE/DXF가 같은 project/scenario/version/hash를 가리킨다.
6. 운영 저장·백업·삭제와 개인정보 문구가 배포 환경에서 검증된다.

## 이번 검증 기록

- Node.js 24.20.0
- Next.js 15.5.25 production build 성공
- Vitest 89 files / 347 tests 통과
- ESLint 및 TypeScript 통과
- 프로덕션 의존성 취약점 0건
- 390x844 신규 부지·환경 진단·보고서 및 1280x720 환경 진단·보고서 브라우저 확인
- VWorld 비활성 지적·도로 API 503 응답과 OpenAI 키 미설정 버튼 차단 확인
