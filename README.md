# PARCELGRID

서울 강남권 부동산 개발 타당성 분석 도구. 한국 시행사·건축·투자팀을 위한
부지 분석 / 시나리오 비교 / PF·세무·리스크 / 실거래 / 보고서 워크플로우.

**상태: 운영 가능한 풀스택 MVP** — 6개 화면 + 6개 API + 41개 테스트 통과 + Next 빌드 성공 + 라이브 서버 검증.

---

## 빠른 시작

```bash
pnpm install                    # 의존성
docker compose up -d postgres   # 로컬 DB
cp .env.example .env.local      # 환경변수
pnpm db:generate && pnpm db:migrate
pnpm dev                        # http://localhost:3000/projects/sample
pnpm test                       # 41/41 passing
```

DB 없이도 동작 — `DATABASE_URL` 미설정 시 시드 데이터로 fallback.

---

## 동작 검증 (실제 서버 응답)

```
부지: 서울특별시 강남구 역삼동 824-11
용도: 제3종일반주거지역 (FAR 250%, BCR 60%, 645.3m²)

시나리오 4개:
   S1 오피스텔 + 근생       이익 123.5억 | IRR 144.2% | DSCR 0.48
   S2 도시형생활주택        이익 110.2억 | IRR 135.1% | DSCR 0.16
   S3 근린생활시설         이익  31.5억 | IRR  45.9% | DSCR 2.88
★ S4 공유주거 (코리빙)     이익 138.5억 | IRR 158.3% | DSCR 4.01

PF 분기 (9개):
  2025-Q3 토지비   유출 26.8억              누적  -26.8억
  2026-Q2 골조1    유출  9.1억              누적  -44.2억 ← 최대 노출
  2026-Q3 골조2    유출  9.9억 유입  10.0억  누적  -44.1억
  2026-Q4 마감1    유출  8.3억 유입  35.2억  누적  -17.2억
  2027-Q1 마감2    유출  6.6억 유입  57.8억  누적  +34.0억 ← 손익분기
  2027-Q3 잔여     유출  0.8억 유입  45.2억  누적 +178.9억
```

권장이 S4 코리빙인 이유: 단순 이익이 아니라 **0.5 × 이익 + 0.3 × DSCR + 0.2 × 규제** 가중 합.
S1 IRR 144%는 매력적이지만 DSCR 0.48 — 임대 NOI 거의 없어 PF 상환능력 위험.

---

## 모듈 인벤토리

### 재무 엔진 (`src/lib/finance/`)

| 모듈 | 역할 |
|---|---|
| `math.ts` | Decimal NPV, IRR (Newton + bisection 폴백), DSCR, annuity |
| `scenario.ts` | 입력 → 매출/사업비/이익/IRR/DSCR/EM 일괄 계산 |
| `cashflow.ts` | 분기 PF 스케줄 (토지비→인허가→철거→골조→마감→준공→잔여) |
| `tax.ts` | 취득세/재산세/법인세/부가세 분개 (rate 출처 인용 포함) |
| `compliance.ts` | GFA-01/02/03 + SUN-02 + PRK-04 + CUL-01 + ENV-03 |
| `sensitivity.ts` | 2D 그리드 (자유 조합 가능) |
| `comps.ts` | 헤도닉 회귀 (거리/FAR/규모/시점) |

순수 함수. 같은 입력 → 같은 출력. 5년 뒤 같은 보고서 재생성 가능.

### DB (`src/lib/db/schema.ts`)
10개 테이블, Drizzle ORM, PostgreSQL. `orgs`/`users`/`projects`/`scenarios`/
`assumption_overrides`/`comps`/`risk_findings`/`reports`/`audit_log`.
JSONB로 가변 shape + 핫 필드 denormalized. Append-only 감사 추적.

### API
| Endpoint | Method | 역할 |
|---|---|---|
| `/api/projects/[id]` | GET | 프로젝트 풀 (4개 시나리오 + PF + 리스크) |
| `/api/scenarios/calculate` | POST | 단일 풀 계산 |
| `/api/scenarios/sensitivity` | POST | 2D 그리드 |
| `/api/scenarios/[id]/overrides` | POST | 가정 편집 저장 (append-only) |
| `/api/comps/analyze` | POST | 헤도닉 조정 |
| `/api/cron/sync-molit` | POST | 일별 국토교통부 동기화 |

### 화면 (`src/app/projects/[id]/`)
| URL | 역할 |
|---|---|
| `/` | 대시보드 — Decision banner + 5 KPI + 4안 표 + PF 미니 차트 + 규제 매트릭스 |
| `/comparison` | 4개 안 비교 — 헤더 카드 + 4섹션 (수익성/자본/건축/세무) + 자동 diff% |
| `/scenarios/[sid]` | 상세 — 6 KPI + 5 탭 (PF/세무/리스크/민감도/가정) |
| `/comps` | 실거래 — 필터 + 8건 + 헤도닉 4인자 패널 |
| `/overrides` | 가정 편집 — 3열 라이브 재계산 |
| `/report` | 투자 보고서 — 10섹션 + window.print() PDF |

### 외부 연동
- `src/lib/integrations/molit.ts` — 국토교통부 실거래가 어댑터
- Vercel Cron 03:00 KST 자동 동기화

### 인프라
- `Dockerfile` (3-stage, non-root), `docker-compose.yml`, `vercel.json`, `.env.example`

---

## 아키텍처 핵심

**Decimal everywhere.** `Number` 누적 오차로 IRR이 0.3% 어긋남 → 투자위 신뢰 박살. Decimal은 8x 느리지만 한 계산 sub-ms.

**순수 함수 엔진.** `calculateScenario(input) → output` — I/O 없음, Date.now() 없음. Reproducible, 테스트 trivial, 어디든 이동 가능.

**JSONB + 핫 필드.** 가변 shape는 JSONB, 정렬·필터 쓰는 profit/IRR/DSCR만 numeric 컬럼. Zod로 shape drift 차단.

**Append-only 감사.** 가정 편집 history는 update 아니라 insert. 보고서는 시점 스냅샷 JSONB로 박제 → 5년 뒤도 같은 결과.

**한국 LTC 구조 정확 반영.** equity = 토지비 + (1−LTC) × 건축비, pfLoan = LTC × 건축비.

---

## 미완성 (정직)

| 영역 | 상태 | 다음 단계 |
|---|---|---|
| NextAuth 로그인 | 스키마만 | 어댑터 + 로그인 페이지 |
| 권한 (org/role) | DB 컬럼만 | 미들웨어 |
| MOLIT 실연동 | 어댑터 완성 | API 키 발급 (1-2일) |
| V월드 지적도 | — | 어댑터 |
| Playwright PDF | window.print() | 백그라운드 잡 |
| Sentry/OTel | DSN 슬롯만 | 통합 |
| 백업/DR | — | 정책 |

각 미완성은 인터페이스가 깔려 있어 다음 작업 단순.

---

## 검증

- ✅ `pnpm tsc --noEmit` — 깨끗
- ✅ `pnpm vitest run` — 41/41
- ✅ `pnpm next build` — 12 라우트 모두 빌드
- ✅ `pnpm next start` + curl — 모든 API 200, 모든 페이지 200, 의미 있는 JSON
