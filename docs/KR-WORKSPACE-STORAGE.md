# KR-U2 — 프로젝트 저장·복구

구현 기준: 2026-10-08. 한국 PARCELGRID 전용 변경이며 미국판 작업을 포함하지 않는다.

## 사용법

1. 부지를 확정하면 주소·PNU·원본 경계·취득대금을 포함한 입력이 이 브라우저에 저장된다. 첫 현황 단계의 취득대금은 여전히 `null`이며 재무 계산을 실행하지 않는다.
2. 첫 화면의 **저장한 프로젝트 → 열기**로 다시 시작한다. 이전 탭의 sessionStorage가 없어도 이어서 작업한다.
3. 계획 편집 후 상단의 **변경사항 저장 중… → 이 브라우저에 저장됨**을 확인한다. Plan Studio의 **편집 초안**은 계획 검토 상태이며 저장 실패를 뜻하지 않는다.
4. **계획 변경 취소 / 다시 적용**은 현재 프로젝트의 계획 입력을 최근 30묶음까지 되돌린다. 연속 편집은 400ms 기준으로 묶는다. 취득대금·재무 가정·승인 기록 자체를 이전 값으로 되돌리는 기능은 아니다. 페이지를 새로 열면 취소 이력은 초기화된다.
5. **저장 기록**은 프로젝트별 이전 저장본 최대 20개를 제공한다. 복구 시 현재 저장본도 기록에 남고, 과거 대표안·사업성 캐시·승인 상태는 재확인한다.
6. **현재 탭 백업**은 저장 실패·충돌 중인 화면의 입력도 포함한다. 다른 PC에서는 첫 화면의 **백업 파일 가져오기**로 연다. 기존 전문가 인계 패키지와 구분되는 `parcelgrid-workspace-backup` 형식이다.
7. 충돌 시 필요한 탭을 먼저 백업한 뒤 **최신 저장본 열기**를 선택한다. 두 탭의 변경을 임의로 합치거나 오래된 탭을 강제 저장하지 않는다.

브라우저/프로필/사이트 주소가 다르면 별도 저장소다. 시크릿 모드 종료, 사이트 데이터 삭제, 브라우저 용량 회수는 외부 JSON 백업 없이는 복구할 수 없다. 원문 PDF·Excel·CSV, 서버 AI 이미지, 외부 CAD 원본 파일은 JSON에 포함되지 않는다. 가져온 재무 첨부는 원본 재연결이 필요하다. 다른 PC 자동 동기화는 구현하지 않았다.

## master와 비교한 선택

| 대안 | 장점 | 남는 문제·선택 |
|---|---|---|
| 기존 sessionStorage + 두 개의 Zustand localStorage persist | 단순한 동기 접근 | 부지 한 건은 탭에 종속. 모든 프로젝트를 한 값에 저장하므로 오래된 탭이 최신 자료를 덮어쓸 수 있음 |
| persist의 저장기만 Dexie로 변경 | 비동기 대용량 저장을 빠르게 도입 | 전역 객체 덮어쓰기·hydration 순서·부지/검토 분리 저장 문제가 남음 |
| **프로젝트별 Dexie 행 + Zustand 메모리 상태** | 부지·계획·검토를 한 transaction에 저장하고 revision을 비교 | 구현량은 늘지만 복구·충돌을 명시적으로 다룰 수 있어 채택 |

KR-U1의 지도 선택·가격 흐름을 유지한다. KR-U2는 FAR·BCR·세금·면적·공사비·수익 계산식을 변경하지 않는다. 화면 초기화 전에 저장한 프로젝트를 읽어 다른 부지 또는 데모 값이 먼저 계산되는 일을 막는다.

## 의존성과 저장 계약

- `dexie@4.4.6` — Apache-2.0, production. 배포본 LICENSE를 확인했고 오픈소스 고지에 포함한다.
- `fake-indexeddb@6.2.5` — Apache-2.0, 테스트 전용. 실제 브라우저 검사는 기존 Playwright를 사용한다.
- [Dexie transaction 공식 문서](https://dexie.org/docs/Dexie/Dexie.transaction()): promise가 commit 이후 완료되는 계약을 사용한다. Web Crypto·네트워크 등 외부 비동기는 transaction 밖에서 처리한다.
- [Dexie blocked 공식 문서](https://dexie.org/docs/Dexie/Dexie.on.blocked): 버전 변경 시 이전 연결을 닫는다. 8초 이상 열기 지연 시 재연결을 안내하며 DB를 자동 삭제하지 않는다.

IndexedDB `parcelgrid-workspaces`, schema 1:

| 테이블 | 키 | 내용 |
|---|---|---|
| `projects` | `projectId` | schemaVersion, UUID revision, 저장 시각, 부지·계획·가격·근거·검토 |
| `history` | `[projectId, revision]` | 이전 값 최대 20개. 교체·복구와 같은 transaction으로 기록 |
| `legacyBackups` | 원본 SHA-256 | 옛 문자열 그대로, 이전 시각, 자동 이전 불가 안내 |

저장 시 읽었던 revision과 현재 DB revision을 비교한다. 다르면 transaction을 중단한다. BroadcastChannel과 창 포커스 이벤트는 안내를 빠르게 갱신하며 실제 덮어쓰기 방지는 transaction 안의 비교가 담당한다. 저장 중 새 편집은 대기열의 최신 입력으로 이어서 저장한다.

실패 시 기존 행과 history 변경을 모두 취소하고 현재 탭의 초안을 유지한다. 자동 재시도를 멈추고 명시적 재시도·백업을 제공한다. 페이지 이동 전 대기 중인 저장을 처리하고, 탭 종료 시 미저장 경고를 요청한다. 강제 종료 직전 입력까지 저장된다는 보장은 하지 않는다.

## 이전·복구 정합성

- `parcelgrid-envelope`, `parcelgrid-review-workflow`, `parcelgrid:draft-parcel` 원본은 읽기만 한다. 원본 백업과 최초 프로젝트 생성을 같은 transaction에 넣는다. 중단 시 전체 취소 후 재시도한다.
- 새 session 캐시 `parcelgrid:active-parcel-v1`은 선택 사항이다. 캐시 쓰기가 실패해도 완료된 IndexedDB 저장과 화면 입력은 유지한다.
- 이미 새 저장소에 있는 프로젝트는 옛 전체 값으로 덮어쓰지 않는다. 부지 입력이 없는 계획에 같은 ID의 부지 입력을 연결할 때만 별도 revision을 기록한다.
- projectId 없는 옛 계획, 미래 버전, 손상 자료는 임의 부지에 넣지 않는다. **이전 저장 원본 받기**로 원문을 확인한다. 부지 입력 없는 프로젝트는 같은 필지를 다시 확인해야 한다.
- 구조 검증은 객체 키 순서와 원본 속성을 재작성하지 않는다. 기존 내부 구획의 사업성 반영 서명과 Geometry 계약을 그대로 보존한다.
- 백업은 format/version, SHA-256, 20MB 한도, JSON 깊이·개수·유한 수, Zod 입력 구조, ID 소속을 검사한다. SHA-256은 손상 탐지이며 발신자 인증이 아니다.
- 복구 시 intakeRevision을 새로 발급하고 대표안/Geometry/Stage 3 캐시를 해제한다. 가격 확정과 전문가 승인도 재검토로 돌린다. 입력 형상·좌표·단위와 과거 기록은 보존한다.
- 정상 재접속은 프로젝트·부지 revision·계획 ID/버전·Geometry Hash가 일치하는 저장 결과만 재사용한다. 새 부지 선택·취득대금 입력은 과거 가격 근거·가격 검토를 현재 값으로 재사용하지 않으며 이전 기록에서 확인할 수 있다.
- 외벽 사양과 내부 구획은 계획 객체의 일부로 저장한다. 계산 결과 `data` 전체를 매번 저장하지 않고, 명시적으로 확정한 Stage 3 스냅샷만 보존한다.

## 검증

`pnpm verify`: lint·typecheck·100개 파일/449개 테스트·production build. 추가한 15개 테스트는 격리, 동시 저장, 저장 중 추가 편집, 실패 재시도, 20개 기록, 승인 해제, 이전 중단/재개·원본 보존, 미래/손상 형식 거절, 취소/다시 적용, 검증·저장·백업 전후 내부 구획/Geometry 서명 보존을 검증한다.

빌드 후 `pnpm test:browser:storage`는 실제 Chromium IndexedDB에서 파일 가져오기, 탭 종료 후 목록에서 재접속, 취소/다시 적용, 강제 용량 오류와 rollback, 미저장 백업·재시도, 두 탭 충돌, 명시적 최신본 열기, 기록 복구, 손상 백업 거절, 390px 모바일을 검사한다. API 입력은 합성 자료다. 스크린샷은 `test-results/workspace-storage`에 남는다.

`pnpm test:browser:intake`는 기존 지도·현황·가격 단계를 검사한다. `pnpm test:browser`는 내부 구획·3D·금융 반영·DXF/3DM 내보내기 뒤 재접속 보존을 검사한다. Windows 별도 Chrome 프로필, Safari, 실제 API·실지도 확인은 Chromium 자동 검사와 별개다.

`/projects/new` First Load JS는 변경 전 약 285kB, 변경 후 약 297kB다. Dexie 저장 모듈은 동적으로 불러온다. 생산 의존성 audit의 high/critical은 없으며 기존 moderate 2건은 남아 있다.
