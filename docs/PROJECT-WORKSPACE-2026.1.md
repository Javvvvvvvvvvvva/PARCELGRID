# Project Workspace Contract 2026.1

## 목적

프로젝트의 계산 결과와 편집 상태를 브라우저 한 탭에만 두지 않고, 로그인 조직에 귀속된 서버 revision으로 저장한다. 같은 프로젝트를 다른 사용자나 탭에서 열 때 오래된 본문이 최신본을 조용히 덮어쓰지 않도록 낙관적 동시성 제어를 적용한다.

## 저장 본문

`project-workspace-2026.1`은 다음 상태를 하나의 정규화 본문으로 저장한다.

- 최신 `ProjectComputed`와 Stage 2 계획안 목록
- 선택안, 대표안, Geometry Snapshot, 대표안 부지 기준 Hash
- 미적용 가정 변경, 가정 초안, 검토 중 토지 매입가, 계획안별 여섯 수익 풀 단가·보정 초안
- 금융 원문 근거, 가격 검증, 전문가 세무 계약
- 보고서 기준으로 명시 저장한 Stage 3 Snapshot

서버 전문가 승인과 검토 Snapshot 봉인은 Workspace 본문에 복제하지 않는다. 해당 기록은 서버 감사 원장과 `/reviews`, `/review-snapshots` API가 유일한 권위 원본이다. PDF·Excel 원문과 AI 이미지 바이너리도 Workspace가 아닌 조직별 파일 저장소에 둔다.

## 무결성

1. 서버는 본문 버전, 프로젝트 소유권, 필수 계산 목록, 계획안 ID, 대표안·Geometry 버전, 부지 기준 Hash, 유한 숫자와 교차 프로젝트 참조를 검증한다.
2. 검증한 본문을 키 정렬 canonical JSON으로 정규화하고 SHA-256을 계산한다.
3. 각 revision은 `project.workspace_saved` 감사 이벤트의 entry hash를 보존한다.
4. 읽을 때 본문 SHA-256과 조직 감사 원장 참조를 다시 검증한다. 하나라도 다르면 정상 데이터로 반환하지 않고 `503`으로 중단한다.
5. 요청 본문의 canonical 크기는 10 MB를 초과할 수 없다.

## 동시성 계약

클라이언트는 마지막으로 읽은 `baseRevision`을 `PUT /api/projects/[projectId]/workspace`에 보낸다.

- 현재 revision과 같으면 새 불변 revision을 추가한다.
- 본문 SHA-256이 최신본과 같으면 중복 revision을 만들지 않는다.
- revision이 다르면 `409 PROJECT_WORKSPACE_CONFLICT`와 서버의 현재 revision을 반환한다.
- 충돌한 클라이언트는 자동 재시도하거나 서버를 덮어쓰지 않는다. 로컬 상태를 유지하고 JSON 사본 내보내기와 서버 최신본 열기를 제공한다.
- 첫 분석 결과는 짧은 지연 후 즉시 저장하며 이후 변경은 2초 debounce로 묶는다. 저장되지 않은 상태에서 페이지를 닫으려 하면 브라우저 이탈 경고를 요청한다.
- 편집 즉시 탭별 복구 초안에 본문과 기준 revision을 보존한다. 화면 이동/새로고침 시 서버를 다시 조회하되 미저장 초안을 우선 복원하며 revision이 어긋나면 충돌로 중단한다. 오래된 Query 캐시는 초안을 덮어쓰지 않는다.
- 저장 중 더 최신 편집이 있으면 이전 응답으로 저장 완료를 표시하지 않는다. 해당 편집이 서버에 확인될 때까지 dirty/saving 상태와 이탈 경고를 유지한다.

## 조직과 권한

- 목록·읽기: `project.read`
- 생성·새 revision 저장: `project.update`
- 모든 조회와 저장은 인증 주체의 `orgId`로 제한한다.
- 클라이언트가 조직 ID나 저장 주체를 제출하지 않는다. `savedBy`와 감사 actor는 서명 세션 및 DB의 활성 멤버십에서 결정한다.
- `/api/projects`는 현재 조직의 최신 revision 요약만 반환한다.
- 브라우저는 확인된 계정·조직·역할 context로 로컬 저장소를 분리하고 API 요청에도 이를 결속한다. 로그아웃·계정 변경 시 진행 중 저장을 중단하며 서버가 현재 인증 주체와 다른 context 요청을 거부한다. 상세 계약은 `CLIENT-SESSION-ISOLATION-2026.1.md`를 따른다.

## 저장 backend

### PostgreSQL

`project_workspace_versions`에 `(org_id, project_id, revision)` 단위로 append한다. 프로젝트 advisory lock으로 revision을 직렬화하고, 감사 이벤트와 Workspace row를 같은 transaction에 기록한다. migration의 trigger가 UPDATE, DELETE, TRUNCATE를 거부한다.

운영 배포 전 다음을 실행한다.

```bash
pnpm db:migrate
```

### 로컬 단일 프로세스

`PROJECT_WORKSPACE_STORAGE_DIR` 또는 `.parcelgrid-data/project-workspaces` 아래 조직·프로젝트 ID의 SHA-256 경로에 revision 파일을 기록한다. 파일 권한은 디렉터리 `0700`, 파일 `0600`이며, 프로세스 내부 lock과 atomic rename을 사용한다.

로컬 backend는 개발과 단일 Node 프로세스용이다. 여러 프로세스의 동시 쓰기, 네트워크 파일시스템 transaction, 운영 수준 백업을 제공하지 않는다. OS 사용자가 파일을 바꾸면 다음 읽기에서 해시 또는 감사 참조 검증이 실패한다. 감사 append 후 최종 rename 전에 프로세스가 종료되면 사용되지 않는 감사 이벤트가 남을 수 있지만 완성되지 않은 Workspace 파일은 최신본으로 노출되지 않는다.

## 복구 절차

1. 충돌 배너에서 `로컬 사본`을 내려받는다.
2. `서버 최신본 열기`로 현재 revision을 다시 hydrate한다.
3. 로컬 JSON과 서버 본문의 가정·계획안을 검토해 필요한 변경만 다시 적용한다.
4. 저장 표시의 revision이 증가했는지 확인한다.

서버 오류 때는 로컬 상태를 유지한 채 다시 저장할 수 있다. 무결성 오류는 재시도로 덮지 말고 감사 원장과 version 파일 또는 DB row를 운영자가 조사해야 한다.

## 회귀 기준

- 동일 본문 dedupe와 연속 revision
- 오래된 `baseRevision`의 충돌
- 다른 조직의 조회 차단과 빈 목록
- 파일 본문 변조 탐지
- 교차 프로젝트 계획안·세무·가정·수익 단가 초안 참조 거부
- 유한하지 않은 기준단가와 0 이하 또는 10 초과 보정계수 거부
- 클라이언트 capture/apply 시 다른 프로젝트 상태 보존
- 목록 API의 최신 revision과 역할 권한
