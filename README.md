# PARCELGRID

주소 하나에서 시작해 필지 현황, 계획 매스, 사업성, 전문가 인계, 예비 보고서까지 연결하는 **한국 저층 개발 의사결정 도구**입니다.

PARCELGRID는 자동 설계 도구가 아니라, 공공데이터와 사용자 가정, 알고리즘 추천을 분리해 개발 초기 의사결정을 설명 가능하게 만드는 로컬 우선 플랫폼입니다. 현재 회귀 기준 프로젝트는 **서울 도봉구 쌍문동 281-23**이며, 화면·사업성·SketchUp(COLLADA DAE)·CAD(DXF)가 같은 대표 계획안과 Geometry Hash를 사용합니다.

> 현재 구현 기준은 [PROJECT_MEMORY.md](PROJECT_MEMORY.md), 최신 변경은 [2026-08-26 릴리스 노트](docs/RELEASE-NOTES-2026-08-26.md), 출시 전 실제 확인 절차는 [릴리스 스모크 테스트](docs/release-smoke-test.md)를 확인하세요.

## 제품 원칙

- **사실과 추천을 분리합니다.** 공공 원문, 사용자 입력, 알고리즘 추천, 참고값을 같은 확정값처럼 표시하지 않습니다.
- **모든 주요 숫자에 근거를 연결합니다.** 출처, 확인 상태, 신뢰도와 수정 이력을 함께 다룹니다.
- **사용자 값을 자동으로 덮어쓰지 않습니다.** 추천안은 비교·복제 후 사용자가 확정합니다.
- **하나의 형상을 끝까지 유지합니다.** 계획 스튜디오, 3D, 사업성, DAE, DXF, 인계와 보고서가 같은 대표안을 사용합니다.
- **법적 최대와 실제 가능안을 구분합니다.** 법적 상한 참고안은 산술 FAR 적층이 아니라 공간 검증을 통과한 비교용 형상입니다.

## 핵심 기능

| 영역 | 현재 기능 |
|---|---|
| 부지 입력 | 주소 자동완성, PNU, 지적 경계, 용도지역, 도로·주변 건물, 건축물대장, 실거래 조회 |
| 현황 분석 | 출처·신뢰도 표시, 기존 건축물과 접도 조건, 주변 거래·역세권·리스크 요약 |
| Plan Studio | 실행 가능 후보 생성, 건축 타당성안·개략 손익안·법적 상한 참고안 비교, 빠른 계획·정밀 편집 |
| 3D·형상 검증 | 층별 매스, 배치·회전, 도로 침범, 층 지지, 면적 오차, 주차와 Geometry Hash 검증 |
| 사업성 | 토지비, 공사비, 금융비, 매출, 손익, 수익률과 자금조달·사용액 대사 |
| 전문가 인계 | 건축·시공·금융·세무 근거, 승인 기록, 다른 PC로 옮길 수 있는 프로젝트 패키지 |
| 보고서 | 현황·계획·사업성·리스크·근거·승인·AI 외장 콘셉트를 포함한 A4 인쇄형 결과 |
| 내보내기 | SketchUp용 COLLADA DAE, AutoCAD 호환 R2000 ASCII DXF, 메타데이터·안내문 |

## 사용자 흐름

| 단계 | 경로 | 주요 결과 |
|---|---|---|
| 0. 새 프로젝트 | `/projects/new` | 주소, PNU, 필지, 규제 출처 확인 |
| 1. 현황 분석 | `/projects/[projectId]/status` | 기존 건축물·도로·실거래·주변 환경 검토 |
| 2. 계획 스튜디오 | `/projects/[projectId]/envelope` | 추천 비교, 층별 프로그램, 배치, 주차, 3D, 대표안 확정 |
| 3. 사업성 | `/projects/[projectId]` | 인수가·공사비·금융비·매출·수익성 재계산 |
| 4. 전문가 인계 | `/projects/[projectId]/handoff` | 근거·승인 기록과 로컬 인계 패키지 |
| 5. 보고서 | `/projects/[projectId]/report` | 인쇄 가능한 통합 예비 검토 보고서 |

보조 화면으로 거래사례 비교(`/comps`), 가격 검토(`/price-review`), 시나리오 비교(`/comparison`), 계산 수정 근거(`/overrides`), 실행 환경 점검(`/system/readiness`)을 제공합니다.

## 빠른 시작

### 요구 환경

- Node.js `24.x`
- pnpm `11.1.0`
- 최신 Chrome 또는 Chromium 계열 브라우저

### 설치 및 실행

```bash
git clone <repository-url>
cd PARCELGRID
corepack enable
corepack prepare pnpm@11.1.0 --activate
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

[http://localhost:3000](http://localhost:3000)을 열고 `서울 도봉구 쌍문동 281-23`을 회귀 데모 주소로 사용할 수 있습니다. PostgreSQL과 외부 API 키가 없어도 로컬 시드와 브라우저 저장 기반의 데모 흐름은 동작합니다.

실행 준비 상태는 [http://localhost:3000/system/readiness](http://localhost:3000/system/readiness) 또는 다음 API로 확인합니다. 비밀 키 원문은 응답에 포함되지 않습니다.

```bash
curl http://localhost:3000/api/system/readiness
```

## 환경변수

실제 값은 `.env.local`에만 저장하고 Git에 커밋하지 않습니다. 전체 기본값과 주석은 [.env.example](.env.example)을 기준으로 합니다.

| 변수 | 필요도 | 용도 |
|---|---|---|
| `DATABASE_URL` | 선택 | PostgreSQL 영구 저장과 여러 PC 간 데이터 공유 |
| `KAKAO_REST_API_KEY` | 실제 주소 조회 | 주소 검색, 좌표와 거리 계산 |
| `NEXT_PUBLIC_KAKAO_JS_KEY` | 선택 | 브라우저 카카오 지도 표시 |
| `VWORLD_API_KEY` | 실제 필지 조회 | 지적 경계, 용도지역, 도로와 주변 건물 |
| `VWORLD_API_DOMAIN` | V월드 사용 시 | V월드에 등록된 호출 도메인. 로컬 기본값은 `http://localhost:3000` |
| `MOLIT_SERVICE_KEY` | 실제 원문 조회 | 건축물대장과 실거래 공공데이터 |
| `OPENAI_API_KEY` | 선택 | 기준 이미지 기반 AI 외장 콘셉트 렌더 |
| `SITE_ACCESS_PASSWORD` | 공유 서버 | 공개·공유 환경의 화면 접근 보호. 운영 모드는 12자 이상 |
| `SOURCE_DOCUMENT_UPLOAD_KEY` | 공유 서버 | 원문 파일 API 보호. 운영 모드는 16자 이상 |

AI 렌더 모델·저장 경로·호출 제한과 원문 저장 경로는 `OPENAI_IMAGE_MODEL`, `CONCEPT_RENDER_STORAGE_DIR`, `CONCEPT_RENDER_DAILY_LIMIT`, `SOURCE_DOCUMENT_STORAGE_DIR`로 조정합니다.

## Plan Studio 비교 계약

- 건축 타당성안과 개략 손익안은 같은 실행 가능 후보군을 서로 다른 기준으로 평가합니다.
- 두 기준의 1위가 같은 물리 계획이면 저장 ID가 달라도 `통합 추천안` 한 개로 표시합니다.
- 모든 후보가 적자면 `수익 최적` 대신 `손실 최소`로 표시합니다.
- 법적 상한 참고안은 규제 외곽선·배치·층간 연결을 통과한 상위 실현 FAR 후보 중 안정적인 층판과 단순한 매스를 우선합니다.
- 법적 상한 참고안의 주차 미충족과 기타 차단 사유를 숨기지 않으며, 검증 실패안은 대표안으로 확정할 수 없습니다.
- 추천안은 자동 적용하지 않습니다. 사용자가 복제한 후 빠른 계획 또는 정밀 편집에서 조정합니다.

## 형상·내보내기 계약

- 대지, 도로, 주변 건물, 계획 매스와 주차는 각각 출처와 신뢰도를 가집니다.
- V월드 도로 중심선은 방향·접도 참고이며 확인되지 않은 도로 폭을 임의로 만들지 않습니다.
- 대표안과 내보내기는 Geometry Hash, 면적 오차, 층 지지, 도로 침범 검사를 통과해야 합니다.
- SketchUp 패키지는 DAE와 메타데이터를, CAD 패키지는 DXF와 `PG_*` 레이어·메타데이터·한국어 안내문을 제공합니다.
- DWG가 필요하면 AutoCAD 호환 프로그램에서 DXF를 연 뒤 DWG로 저장합니다.
- 기준 이미지 기반 작업은 원본 층수·실루엣·후퇴·배치·회전·도로 관계·카메라를 보존합니다. 좌표 원본이 없으면 보이지 않는 형상을 새로 추정하지 않습니다.
- AI 콘셉트 렌더는 PARCELGRID 기준 이미지가 있을 때만 허용하며, 텍스트만으로 새 매스를 생성하는 요청은 서버에서 차단합니다.

## 면적·재무 계약

- 대지면적, 건축면적, 총연면적, 용적률 산입면적을 구분합니다.
- 사업성 계산은 대표 PlanningScenario의 실현 형상 면적을 사용하며 산술 법정 BCR/FAR를 실제 계획 면적으로 대체하지 않습니다.
- 총사업비·손익·매출과 자금조달·사용액 사이의 차이를 자동 대사합니다.
- 토지 매입가, 공사비, 금리, 분양·매각 가정은 원문 근거와 확인 상태를 함께 저장합니다.
- 핵심 계산 정의는 [계산식 문서](docs/CALCULATION-FORMULAS-2026-07-08.md)와 [재무 무결성 지침](docs/FINANCIAL_INTEGRITY_GUIDELINE.md)을 따릅니다.

## 기술 구성

- **웹:** Next.js 15 App Router, React 19, TypeScript 5.9, Tailwind CSS
- **상태·검증:** Zustand, TanStack Query, Zod
- **3D·공간:** Three.js, React Three Fiber, Drei, Turf
- **계산·저장:** Decimal.js, Drizzle ORM, 선택형 PostgreSQL
- **품질:** ESLint, TypeScript, Vitest, Next.js production build

### 주요 코드 경로

| 역할 | 경로 |
|---|---|
| 페이지·서버 API | `src/app` |
| 현재 Plan Studio UI | `src/components/planning/PlanningScenarioWorkspaceV4.tsx` |
| 추천 비교 UI | `src/components/planning/PlanningRecommendationPanelV2.tsx` |
| 추천·형상 생성 | `src/lib/planning` |
| 규제 검토 | `src/lib/regulatory` |
| 사업성·재무 원장 | `src/lib/finance`, `src/lib/stage3` |
| 외부 공공데이터 | `src/lib/integrations` |
| 전문가 인계 | `src/lib/handoff`, `src/components/handoff` |
| 프로젝트 상태 | `src/lib/stores` |
| 회귀 테스트 | `src/tests` |

V1~V3 Plan Studio와 중복 대시보드 UI는 제거했습니다. 새 기능은 위 현재 경로를 확장하며, 과거 버전 파일을 다시 만들지 않습니다.

## 로컬 데이터와 보안

- 원문 PDF·Excel·CSV는 기본적으로 `.parcelgrid-data/source-documents`에, AI 결과는 `.parcelgrid-data/concept-renders`에 저장되며 Git에서 제외됩니다.
- 로컬 개발에서는 접근 비밀번호와 업로드 키를 비워둘 수 있지만, 공유 서버에서는 `.env.example`의 최소 길이 조건을 지켜야 합니다.
- PostgreSQL이 없으면 브라우저와 로컬 시드 중심으로 동작하므로 다른 PC와 프로젝트가 자동 동기화되지 않습니다.
- 인계 패키지는 계획·Geometry·사업성·검토 기록을 옮기지만 원문 PDF·Excel과 AI 이미지는 포함하지 않습니다. 대상 PC에서 원문을 다시 연결하고 승인을 갱신해야 합니다.
- 현재 접근 제한과 호출 제한은 단일 Node 프로세스 기준입니다. 다중 인스턴스 운영에는 외부 인증과 공유 rate limiter가 필요합니다.

## 검증

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build

# 전체 검증
pnpm verify
```

GitHub Actions는 lint, 타입 검사, 전체 Vitest, production build를 실행합니다. 프로젝트의 출시 기준은 로컬 우선이며, 호스팅 플랫폼의 PR 미리보기는 보조 확인 수단으로만 사용합니다.

자동 검증이 통과해도 다음 항목은 실제 프로그램과 브라우저에서 확인해야 합니다.

- 새 브라우저에서 주소 검색부터 보고서까지 전체 흐름
- DAE를 SketchUp에서 열어 원점·축·층·주차 확인
- DXF를 AutoCAD 호환 프로그램에서 열어 meter 단위와 `PG_*` 레이어 확인
- 보고서 A4 인쇄 미리보기의 잘림·겹침
- 실제 API 키를 사용한 외부 API 성공·실패 안내
- 다른 PC에서 인계 패키지 가져오기와 원문 재연결

## 문서 안내

| 문서 | 용도 |
|---|---|
| [PROJECT_MEMORY.md](PROJECT_MEMORY.md) | 현재 구현 계약과 다음 작업자를 위한 짧은 인계 |
| [파트너 로컬 실행 안내](docs/PARTNER-LOCAL-SETUP-KO.md) | 다른 PC에서 설치·업데이트·문제 해결 |
| [릴리스 체크리스트](docs/RELEASE-CHECKLIST-2026-08-23.md) | 자동·수동 출시 조건 |
| [릴리스 스모크 테스트](docs/release-smoke-test.md) | 주소 입력부터 보고서·DAE·DXF까지 실제 확인 절차 |
| [계산식 문서](docs/CALCULATION-FORMULAS-2026-07-08.md) | 면적·사업성 계산 정의와 데이터 출처 |
| [재무 무결성 지침](docs/FINANCIAL_INTEGRITY_GUIDELINE.md) | 회계 대사와 오류 차단 규칙 |
| [제품 로드맵](docs/PRODUCT-ROADMAP-MATERIAL-COST-AND-AI-VISUAL.md) | 외장재·공사비·AI 시각화 현황과 다음 범위 |
| [2026-08-26 릴리스 노트](docs/RELEASE-NOTES-2026-08-26.md) | 최신 추천 로직·성능·레거시 정리 내역 |

## 협업 규칙

- 변경은 기능 브랜치와 Pull Request로 합칩니다.
- `.env.local`, `.parcelgrid-data`, 실제 고객 원문과 비밀 키는 커밋하지 않습니다.
- 형상·재무 로직을 바꾸면 관련 회귀 테스트와 사용자에게 보이는 근거 문구를 함께 갱신합니다.
- 합치기 전 `pnpm verify`를 통과해야 합니다.
- 세부 규칙은 [CONTRIBUTING.md](CONTRIBUTING.md)를 따릅니다.

## 면책

PARCELGRID 결과는 AI·공공데이터 기반의 초기 콘셉트 검토입니다. 건축설계도서, 인허가 도면, 측량성과도, 시공도, 감정평가서, 금융 약정 또는 공사비 견적서가 아닙니다. 매입·설계·인허가·대출·세무 판단 전 각 분야 전문가가 원문과 현장을 확인하고 승인해야 합니다.
