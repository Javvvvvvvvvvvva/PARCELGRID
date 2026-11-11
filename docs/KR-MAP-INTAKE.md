# 한국판 지도·주소 부지 선택

2026-10-08 · 한국 PARCELGRID의 첫 진입 흐름과 KR-U1 주변 도형. 미국판 변경은 포함하지 않는다.

## 사용자 흐름

1. `/` 또는 `/projects/new`에서 주소를 검색하거나 지도를 이동·확대한다. 동 이름만 검색하면 지역으로 이동한다.
2. 필지 안을 클릭하거나 지도 중심 선택을 누른다. 넓은 지도에서는 먼저 확대하고 다시 선택하도록 안내한다.
3. 주소·면적·용도지역·경계 확인 상태를 확인한다. 확인된 필지 주변에는 필지·건물 외곽·도로 필지를 비동기로 표시하며 범례에서 켜고 끌 수 있다. **이 부지 살펴보기**를 누른다.
4. 건축물대장과 주변 GIS를 조회한 후 현황을 연다. 토지·기존 건물·확인할 규제 세 카드가 먼저 보이며 상세 정보는 펼쳐본다.
5. **계획 검토하기**에서 총 취득대금과 취득 예정일을 입력한다. 현재 Plan Studio에는 손익 비교가 포함돼 있어 이 단계에는 가격이 필요하다.
6. 필요하면 주변 토지 거래 분포를 펼친다. 참고값은 가격 입력을 대체하지 않으며 자동 적용하지 않는다.

데스크톱은 검색/선택 패널과 지도를 나란히, 모바일은 검색 → 지도 → 선택 카드를 순서대로 배치한다. 기존 계획·사업성·인계·보고서 화면은 계속 사용한다.

## 조회·경계 계약

- `POST /api/parcels/lookup`은 `address` 또는 `location: { lat, lng }` 중 하나를 받는다. 좌표 범위와 유한수를 검사한다.
- `phase: "selection"`은 건축물대장·기존 건물 GIS·주변 필지·도로 조회를 생략한다. 기존 호출과의 호환을 위해 생략 시 `details`가 기본이다.
- 지번 없는 지역 검색은 `mode: "area"`를 반환한다. 지역 중심점을 실제 필지로 저장하지 않는다.
- 지도 클릭은 Kakao 좌표→지번 주소, 지번 주소→법정동·본번·부번을 통해 PNU를 만든다. VWorld 반환 PNU와 다르면 409로 거절한다.
- 클릭한 점은 반환 지적 폴리곤 내부에 있어야 한다. 공유 경계와 경계 밖의 점은 다시 선택하도록 안내한다. 경계가 없는 정상 확인 결과를 만들지 않는다.
- 확인 시 `expectedPnu`로 선택한 필지를 재검증한다. 다른 필지의 현황으로 바뀌면 진행하지 않는다.
- VWorld 미설정/비활성/실패는 기존 수동 입력으로 연결한다. 수동 값과 GeoJSON의 출처는 사용자 입력으로 유지하며 경계 미확인 상태를 숨기지 않는다.
- 연속 검색·클릭·입력 변경·취소 시 이전 요청을 중단하고 늦은 응답을 무시한다. 지도 인스턴스는 선택할 때마다 재생성하지 않는다.

## KR-U1 주변 지도 레이어

- `POST /api/parcels/selection-context` 입력은 `{ pnu, center: { lat, lng }, revision }`이다. 원래 선택 응답이 `vworld`일 때만 호출한다. 수동·지역 검색에는 확인되지 않은 도형을 붙이지 않는다.
- 선택 중심의 동서남북 약 80m **사각 범위**에서 VWorld 지적 `LP_PA_CBND_BUBUN`과 건물 WFS `dt_d010`을 병렬 조회한다. 각 원천은 최대 100개, 서버 타임아웃 12초다. 전체 필지 또는 현재 지도 화면 전체를 포괄한다는 뜻은 아니다.
- 지적 도형의 선택 PNU는 주변 필지에서 제외한다. 지목 명칭이 `도로`인 도형은 도로 필지 레이어로 분리한다. 도시계획 예정 도로를 섞지 않는다. 건물은 독립된 원본 ID로 유지하고 중심점이나 주소로 소유 필지를 확정하지 않는다.
- Polygon의 모든 링과 MultiPolygon의 모든 영역을 보존한다. 불완전한 구멍·자기 교차·범위 밖 좌표·지원하지 않는 CRS를 임의의 정상 도형으로 바꾸지 않는다. 한국 범위에서 명확하게 위경도가 뒤집힌 건물 WFS 좌표만 EPSG:4326 경위도 순서로 정규화한다.
- `available / partial / empty / error / unavailable`을 구분한다. 상한 도달·해석 제외는 부분 조회이며, 원천 한 곳의 실패가 다른 레이어를 지우지 않는다. 원천·데이터셋·조회 시각·제외 건수·상한을 펼쳐 볼 수 있다. 원자료 갱신일은 제공되지 않으면 미제공으로 표시한다.
- TanStack Query 키는 PNU·중심 위경도·매 선택 UUID를 포함한다. 요청을 취소하고 반환된 세 값도 대조한다. 지도 이동·확대·레이어 전환·창 복귀는 추가 조회를 일으키지 않는다. 실패는 명시적으로 재시도할 수 있다.
- 선택 경계가 최상위에 남고 각 레이어를 독립적으로 켜고 끈다. 확대된 지도에서 최대 40개 지번 후보 중 서로 겹치거나 선택 지점을 가리는 글자는 숨긴다. 토글이나 늦은 주변 응답이 지도 중심·확대 수준을 바꾸지 않는다.
- 주변 API는 건축물대장·시장 가격·재무 엔진을 호출하지 않는다. 표시된 도형은 원래 부지 경계·면적·저장안·Geometry Hash를 변경하지 않는다.

도로 필지는 **실제 포장·통행 가능 여부·도로 폭·접도 적합성**의 판정이 아니다. 건물 도형 미수신·부분 조회는 **빈 부지**의 증거가 아니다. 선택 경계는 기존 주소/PNU/클릭 위치 계약으로 확인하며, 주변 도형은 현황 상세 분석과 별도로 유지한다.

## 가격과 저장 데이터

- 새 선택은 `sessionStorage`의 `parcelgrid:draft-parcel`에 저장한다. 같은 탭 새로고침에 유지되며 다른 PC와 자동 동기화되지 않는다.
- 가격은 `null`, 취득일은 빈 문자열이다. 공시지가 배수나 시세 참고값으로 매입가를 만들지 않는다.
- 현황 전용 `ProjectComputed.meta.mode = "site-only"`는 시나리오·현금흐름·최대 인수가 배열이 비어 있다. 기존 숫자형 Parcel VM 호환용 가격 0은 재무 입력으로 사용하지 않는다.
- `buildDynamicProjectRequest`와 API는 가격이 없거나 0이면 재무 계산을 거절한다. 가격을 입력하기 전 금융 화면 자식 컴포넌트를 마운트하지 않는다.
- `intakeRevision`은 새 선택/가격 입력 때 바뀐다. 조회 캐시와 재계산·Stage 3 저장에도 전파해 같은 PNU의 다른 입력이 섞이지 않게 한다.
- 다시 선택하면 저장된 계획과 과거 사업성 기록은 보존한다. 대표안·기존 Envelope 선택·미저장 취득대금은 해제하여 새 부지 상태에서 다시 확인하게 한다. 이전 revision의 사업성은 현재 보고서·승인·인계에 자동 채택하지 않는다.
- 데모 PNU를 사용자가 직접 선택한 경우에는 사용자가 확인한 부지 데이터를 우선한다.

## 사용 기술

| 목적 | 기존 기술 재사용 |
|---|---|
| 지도 이동·확대·클릭·위성 | Kakao Maps JavaScript SDK |
| 주소 및 좌표의 지번 확인 | Kakao Local REST API |
| 실제 필지·용도지역 | 기존 VWorld 어댑터 |
| 경계 내부·도형 유효성·범위 교차·라벨 위치 | Turf `booleanPointInPolygon`, `booleanValid`, `kinks`, `booleanIntersects`, `pointOnFeature` |
| 요청 형식·응답 검사 | Zod |
| 조회 캐시·선택 저장 | TanStack Query, sessionStorage, 기존 Zustand |
| 화면 | 기존 Next.js/React, 반응형 CSS, Lucide |

새 npm 라이브러리나 생성형 AI 의존성은 추가하지 않았다. SDK 로더를 기존 현황 지도와 공유하고 실패 후 재시도할 수 있게 했다.

KR-U1 검증에 사용한 설치 버전은 Turf 7.3.5, Zod 3.25.76, TanStack Query 5.100.9다. 다른 좌표계는 거절하므로 Proj4js를 선제 설치하지 않았다. 원천별 어댑터는 `vworld-selection-context.ts`, 응답 계약은 `parcels/selection-context.ts`, 조회·취소는 `use-selection-context.ts`에 둔다.

지도에는 `NEXT_PUBLIC_KAKAO_JS_KEY`, 주소와 좌표 조회에는 `KAKAO_REST_API_KEY`가 필요하다. 개발자 설정에 실제 사용 도메인을 등록한다. 지도가 실패해도 주소 입력은 유지된다. 실제 필지에는 VWorld, 건축물대장에는 승인된 MOLIT 키가 필요하다. [환경변수](../.env.example)를 참고한다.

공식 API 참고: [Kakao 지도 클릭](https://apis.map.kakao.com/web/sample/addMapClickEvent/), [Kakao Local REST](https://developers.kakao.com/docs/ko/local/dev-guide).
다중 링·도형 클릭·라벨 화면 좌표는 [Kakao Web API 문서](https://apis.map.kakao.com/web/documentation/)의 Polygon, CustomOverlay, MapProjection 계약을 따른다.

## 검증

```bash
pnpm verify
pnpm test:browser:intake
pnpm test:browser:registry
```

브라우저 검사는 Playwright Chromium이 필요하다. 기존 스모크와 동일하게 `PARCELGRID_CHROMIUM_PATH`, `PARCELGRID_CHROMIUM_MODULE`로 준비된 브라우저를 지정할 수 있다. 스크린샷은 Git 제외 경로 `test-results/site-intake`에 생성된다.

자동 검사에는 지역 검색, 이동만으로 조회하지 않음, 확대 후 클릭, 지도 재생성 방지, 위성 전환, 부지 확인, 가격 없는 현황·새로고침, 상세 펼치기, 명시적 거래 조회, 가격 변환, 같은 PNU의 새 입력, 취소·늦은 응답·경계 오류·수동 입력·저장 실패·지도 실패·390px 화면을 포함한다.

KR-U1에서는 구멍·복수 영역·축 순서·잘못된 CRS·자기 교차·상한·원천 부분 실패를 단위 검사한다. 브라우저 SDK 대역은 좌표마다 SVG 꼭짓점을 투영하며, 실제 전달 경로의 전체 링을 원본 fixture와 비교한다. 레이어 토글의 경계 고정, 확대 시 재투영, 라벨 겹침, 같은 PNU/위치의 새 revision, 이전 주변 응답 폐기, 실패 후 재시도도 검사한다.

2026-10-08: Node 24.19.0에서 `pnpm verify` 통과(98개 테스트 파일·434개 테스트·16개 정적 페이지 생성). 신규 기능용 production 패키지 없이 기존 Turf·Zod·TanStack Query·Kakao SDK를 활용했다. `sharp` 0.35.5와 `source-map-js` 1.2.2 보안 수정 및 고지 갱신 후 production high 등급 audit가 통과했다. moderate 2건은 남아 있다. 기준선 `/projects/new` First Load JS 284kB → 285kB(Next 빌드 표 기준; 지연 로딩 지도 청크·실제 네트워크 지연을 포함한 측정은 아님).

**검증 범위:** 브라우저에서는 합성 지도 SDK와 합성 API 응답을 사용한다. 실제 지도 타일·터치 제스처·승인 계정의 Kakao/VWorld/MOLIT 응답 정확성을 대신 검증하지 않는다. 실제 연결 확인 절차는 [릴리스 스모크 테스트](release-smoke-test.md)에 남겼다.
