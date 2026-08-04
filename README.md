# PARCELGRID

한국 저층 개발 부지를 주소 입력부터 계획 매스, 사업성, 전문가 인계, 예비 보고서까지 한 흐름으로 검토하는 로컬 우선 도구입니다.

현재 기준은 서울 도봉구 쌍문동 281-23 프로젝트이며, 계획 스튜디오는 화면·SketchUp(COLLADA DAE)·CAD(DXF)가 같은 Geometry Hash와 로컬 미터 좌표를 사용하도록 구성돼 있습니다.

## 5분 실행

필수 환경은 Node.js 24와 pnpm 11.1입니다.

```bash
corepack enable
corepack prepare pnpm@11.1.0 --activate
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000)을 엽니다. DB와 비밀번호가 없어도 로컬 개발 모드와 데모 프로젝트는 동작합니다. 실제 주소·지적·실거래 조회에는 `.env.local`의 공공 API 키가 필요합니다.

설정 상태는 [http://localhost:3000/system/readiness](http://localhost:3000/system/readiness) 또는 아래 API에서 비밀 값을 노출하지 않고 확인할 수 있습니다.

```bash
curl http://localhost:3000/api/system/readiness
```

## 제품 흐름

| 단계 | 화면 | 결과 |
|---|---|---|
| 0 | `/projects/new` | 주소, PNU, 필지, 규제 출처 확인 |
| 1 | `/projects/[id]/status` | 기존 건축물·도로·실거래 현황 |
| 2 | `/projects/[id]/envelope` | 층별 프로그램, 배치, 주차, 3D, 대표 계획안 |
| 3 | `/projects/[id]` | 인수가·공사비·금융비·매출·수익성 재계산 |
| 4 | `/projects/[id]/handoff` | 건축·시공·금융·세무 근거와 승인 기록 |
| 5 | `/projects/[id]/report` | 근거·현황·계획·사업성·리스크·전문가 승인·AI 콘셉트 렌더를 포함한 인쇄형 보고서 |

## 계획·내보내기 계약

- 계획 매스, 주차, 도로, 주변 건물은 출처와 신뢰도를 분리합니다.
- V월드 도로 중심선은 방향·접도 참고이며 확인되지 않은 폭을 임의 생성하지 않습니다.
- 대표안 확정과 내보내기는 Geometry Hash, 면적 오차, 층 지지, 도로 침범 검사를 통과해야 합니다.
- SketchUp 패키지는 DAE와 메타데이터를 제공합니다.
- CAD 패키지는 AutoCAD R2000 ASCII DXF, 레이어, 메타데이터, 한국어 안내문을 제공합니다. DWG가 필요하면 CAD에서 DXF를 연 뒤 Save As로 변환합니다.
- 기준 이미지 기반 디자인은 원본 층수·실루엣·후퇴·위치·회전·도로 관계·카메라를 잠그며, 좌표 원본이 없으면 형상을 새로 추정하지 않습니다.
- AI 외장 콘셉트 렌더는 `OPENAI_API_KEY`가 있을 때만 활성화됩니다. 기준 이미지 없는 텍스트 전용 매스 생성은 서버에서 차단합니다.
- 생성 이미지는 기본적으로 `.parcelgrid-data/concept-renders`에 저장되고 모델·원본/결과 SHA-256·Geometry Hash를 보고서에 남깁니다.

## 로컬 데이터와 보안

- `.env.local`은 Git에 포함되지 않습니다. 이메일이나 메신저로 전달할 때도 저장소 ZIP과 분리하세요.
- 원문 PDF/Excel/CSV는 기본적으로 `.parcelgrid-data/source-documents`에 저장되고 Git에서 제외됩니다.
- 로컬 개발에서는 `SITE_ACCESS_PASSWORD`와 `SOURCE_DOCUMENT_UPLOAD_KEY`를 비워 둘 수 있습니다.
- 다른 사람에게 공개되는 서버에서는 각각 12자, 16자 이상으로 반드시 설정해야 합니다.
- PostgreSQL이 없으면 브라우저 세션과 시드 데이터로 동작하므로 다른 PC와 프로젝트가 자동 동기화되지는 않습니다.

## 검증

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
# 또는 한 번에
pnpm verify
```

GitHub Actions도 동일한 네 단계를 실행합니다. Vercel 배포 구성은 사용하지 않습니다.

## 협업

형에게 넘길 때는 [로컬 실행 안내](docs/PARTNER-LOCAL-SETUP-KO.md)를 그대로 전달하세요. 변경은 기능 브랜치와 Pull Request로 합치고, `.env.local`과 `.parcelgrid-data`는 커밋하지 않습니다. 상세 규칙은 [CONTRIBUTING.md](CONTRIBUTING.md)를 따릅니다.

## 면책

PARCELGRID 결과는 AI·공공데이터 기반 콘셉트 검토입니다. 건축설계도서, 인허가 도면, 측량성과도, 시공도, 금융 약정 또는 공사비 견적서가 아닙니다. 매입·설계·인허가·대출·세무 판단 전 각 분야 전문가의 원문 확인과 승인이 필요합니다.
