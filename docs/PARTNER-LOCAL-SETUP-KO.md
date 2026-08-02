# 형 PC에서 PARCELGRID 실행하기

## 처음 한 번

1. GitHub 계정으로 초대 메일을 수락합니다.
2. Node.js 24를 설치합니다.
3. 터미널에서 아래 명령을 실행합니다.

```bash
git clone <저장소-주소>
cd PARCELGRID
corepack enable
corepack prepare pnpm@11.1.0 --activate
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

4. 브라우저에서 [http://localhost:3000](http://localhost:3000)을 엽니다.
5. [환경 점검](http://localhost:3000/system/readiness)에서 필요한 API 연결을 확인합니다.

GitHub 로그인만으로 `.env.local` 값이 생기지는 않습니다. 실제 공공 API 키가 든 `.env.local`은 저장소와 분리해 개인적으로 전달받아 프로젝트 최상위 폴더에 저장합니다. 로컬 데모만 볼 때는 빈 파일이어도 됩니다.

## 다음부터

```bash
cd PARCELGRID
git pull --ff-only
pnpm install --frozen-lockfile
pnpm dev
```

종료는 터미널에서 `Ctrl+C`입니다.

## 자주 생기는 문제

| 증상 | 확인 |
|---|---|
| `pnpm: command not found` | `corepack enable`과 pnpm prepare 명령을 다시 실행 |
| 주소 검색 실패 | `.env.local`의 Kakao REST 키 확인 |
| 지적·도로·주변 건물 없음 | V월드 키와 등록 도메인 `http://localhost:3000` 확인 |
| 실거래·건축물대장 없음 | MOLIT 서비스 키와 승인 상태 확인 |
| 원문 업로드 실패 | `.parcelgrid-data` 쓰기 권한과 환경 점검 화면 확인 |
| 다른 PC에서 작업이 안 보임 | 브라우저 세션 데이터는 자동 공유되지 않음. Git 또는 PostgreSQL 사용 |

## 업데이트 전 안전 확인

```bash
pnpm verify
```

오류가 나면 화면 캡처와 터미널의 첫 오류부터 공유합니다. API 키 값 자체는 보내지 않습니다.
