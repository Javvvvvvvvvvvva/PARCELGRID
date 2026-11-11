# 한국판 업그레이드 리소스와 구현 경계

기준: 원본 PARCELGRID `master@e6fd8e01baa711954aeeb3878b5b89247e676e1e`, 2026-09-28.
미국판 저장소는 이번 작업 대상이 아니다. 이 문서는 조사한 49개 코드 리소스와 10개 한국 데이터 축의 도입 상태를 기록한다. 전체 후보를 설치 완료했다는 뜻이 아니다.

2026-10-07 추가 조사와 현재 작업 순서는 [한국판 업데이트 실행 계획](KR-UPGRADE-PLAN-2026-10-07.md)을 따른다. 이 문서의 49개 목록과 아래 후속 순서는 9월 조사 기록으로 보존하며, 새 후보의 설치 완료를 의미하지 않는다.

## 채택 원칙

- 실제 사용자 흐름에 연결하고 회귀 검증할 수 있는 라이브러리부터 채택한다. 대체 관계의 지도·평면·솔버 엔진을 한꺼번에 설치하지 않는다.
- 코드, 데이터셋, 학습 가중치, 지도 타일, 폰트의 권리를 따로 확인한다. 공개 열람·GitHub 공개 상태만으로 상업적 복제 권한을 추정하지 않는다.
- 명시적 허가가 없는 코드나 연구 전용 데이터·가중치를 복사·번역·변형해 제품에 넣지 않는다. 필요한 기능은 독립된 요구사항과 공개 수학 원리에 따라 구현한다.
- AGPL/MPL/LGPL/EPL은 일률적으로 사용 금지가 아니다. 각 배포·수정·결합 방식의 의무를 충족할 수 있는지 판단하고 해당 방식이 정해진 뒤 도입한다.
- 원문 라이선스·저작권 고지를 유지한다. 배포용 [고지 파일](../public/third-party-notices.txt)은 `pnpm notices:generate`로 갱신한다. 이 파일은 설치된 production 패키지 목록이며, 패키지에 고지 원문이 빠진 기존 의존성의 추가 검토까지 완료했다는 뜻은 아니다.

## 이번에 연결한 기능

| 기능 | 공개 리소스 | 우리 구현 |
|---|---|---|
| 공간 관계 편집 | React Flow / MIT | 인접·분리 선호와 구획 검증 연결 |
| 후보 생성·일영 계산 Worker | Comlink / Apache-2.0 | 취소, 시간 제한, 이전 결과 폐기 |
| 지면 일영 | SunCalc / BSD-2-Clause, three-mesh-bvh / MIT | KST 시각, 북=-Z 축, 계획 매스 차폐 검사 |
| Rhino 인계 | rhino3dm / MIT | 미터·레이어·원점·Geometry Hash·개념 단계 기록 |
| 평면·3D 구획 | 기존 Turf·Three·Drei | 직접 작성한 SVG 편집과 동일 구획 미리보기 |

Rhino 배포 JS/WASM은 설치 패키지에서 그대로 복사한다. `predev/prebuild`가 로컬 vendor 자산과 MIT 고지를 준비한다. 외부 CDN 요청이나 비공개 API 키가 필요하지 않다. 무거운 Rhino 모듈은 내보내기를 선택할 때 로드한다.

## 독립 구현 기록

| 소스 | 독립 구현 내용 | 편입하지 않은 자료 |
|---|---|---|
| `src/lib/planning/interior/generator.ts` | 주축 2방향 × 좌/우/중앙 동선 템플릿, 오목 외곽의 16×16 포함 격자 탐색 | House-GAN++/Graph2Plan 코드·모델·RPLAN |
| `interior/geometry.ts` | 직사각 구획, 공유 변, 문 개구, 경계·겹침·폭·면적·코어 연결 검증 | 타사 실내 도면·비공개 규칙 |
| `interior/finance.ts` | 총면적 보존, 가정 벽 두께 기준 추정 내부 면적, 사업성 반영 서명 | 타사 원가·매출 데이터 |
| `interior/export.ts` | DXF 레이어·한글 이스케이프·메타데이터 패키지 | 상용 DWG SDK |
| `solar-access.ts` | 계획 매스만을 대상으로 한 지면 직사광 시간 근사 | 승인되지 않은 3D 도시 데이터 |

이 엔진은 학습형 AI 모델이 아니다. 후보를 못 찾았다는 결과는 현재 템플릿의 한계이며, 건축 불가능이나 최적해 부재를 증명하지 않는다. 세대 안의 모든 방·가구·설비를 자동 완성하거나 인허가 도면을 생성하는 기능은 아직 없다.

## 조사 리소스 49개

| 분류 | 리소스 / 원문 | 확인한 라이선스 | 현재 상태 | 적용 조건 |
|---|---|---|---|---|
| 공간 편집 | [React Flow](https://github.com/xyflow/xyflow) | MIT | 적용 · @xyflow/react 12.12.0 | 그래프 UI다. 방 경계·치수·복도를 자동 생성하지 않는다. |
| 공간 편집 | [Dagre](https://github.com/dagrejs/dagre) | MIT | 후속 검토 · 현재 미도입 | ELK와 대안 관계. 화면상 배치일 뿐 건축 공간 배치가 아니다. |
| 공간 편집 | [ELK.js](https://github.com/kieler/elkjs) | EPL-2.0 | 후속 검토 · 현재 미도입 | 단순 그래프면 Dagre로 충분. 배포·수정 방식에 맞춰 EPL 조건 확인. |
| 공간 편집 | [React Konva](https://github.com/konvajs/react-konva) | MIT | 현재 미도입 · 자체 SVG 편집 | 기존 SVG 편집 확장과 먼저 비교. 제약·스냅·undo는 직접 구현. |
| 공간 편집 | [Drei](https://github.com/pmndrs/drei) | MIT | 기존 의존성 재사용 · 3D 구획 | 이미 설치됨. 현재 SVG 이동·회전을 유지하고 3D 편집 연결을 추가. |
| 생성·최적화 | [OR-Tools CP-SAT](https://github.com/google/or-tools) | Apache-2.0 | 후속 검토 · 현재 미도입 | 완성형 건축 솔버가 아니다. 정수 좌표, 자체 제약 모델, 별도 Python/C++ 실행부 필요. |
| 생성·최적화 | [pymoo](https://github.com/anyoptimization/pymoo) | Apache-2.0 | 후속 검토 · 현재 미도입 | 우선 기존 후보에 Pareto 필터를 적용. 최적성·법규 적합성을 보증하지 않는다. |
| 생성·최적화 | [topoGenesis 라이브러리](https://github.com/shervinazadi/topoGenesis) | MIT | 후속 검토 · 현재 미도입 | topogenesis.xyz 전체 구현과 동일시 금지. Python 의존성과 구현 범위를 따로 검토. |
| 생성·최적화 | [House-GAN++](https://github.com/ennauata/houseganpp) | 연구용 제한 + GPL 본문 | 제품 제외 · 독립 엔진으로 구현 | LICENSE 첫머리에 연구용 제한 명시. 코드·학습 데이터·가중치 권한 확인 전 제품에 복사하지 않는다. |
| 생성·최적화 | [Graph2Plan](https://github.com/HanHan55/Graph2plan) | 명시적 허가 미확인 | 제품 제외 · 독립 엔진으로 구현 | 저장소 트리에서 LICENSE/COPYING 미발견. RPLAN 권리 및 Matlab 후처리 의존성도 별도. |
| 생성·최적화 | [Blueprint3D](https://github.com/furnishup/blueprint3d) | MIT | 후속 검토 · 현재 미도입 | 저장소 마지막 push는 2021년. 현재 React/Three 기반에 통째 도입하는 방식은 비추천. |
| 형상·좌표 | [Proj4js](https://github.com/proj4js/proj4js) | MIT 계열 본문 확인 | 후속 검토 · 현재 미도입 | 원본 CRS/축/원점/단위를 기록. 자료마다 EPSG가 달라 하나로 가정하면 안 된다. |
| 형상·좌표 | [Turf](https://github.com/Turfjs/turf) | MIT | 기존 의존성 재사용 · 평면 검증 | 이미 설치됨. 지리 좌표 연산과 투영 좌표 연산의 단위 계약을 구분. |
| 형상·좌표 | [Clipper2](https://github.com/AngusJohnson/Clipper2) | Boost Software License 1.0 | 후속 검토 · 현재 미도입 | 원본은 C++/C#/Delphi. JS/WASM 바인딩은 별도 선택·검증. 변별 후퇴 규칙은 직접 구현. |
| 형상·좌표 | [Manifold](https://github.com/elalish/manifold) | Apache-2.0 | 후속 검토 · 현재 미도입 | JS/TS/WASM 지원. 입력 유효성·허용오차·면적 대사를 확인해야 한다. |
| 형상·좌표 | [Shapely](https://github.com/shapely/shapely) | BSD-3-Clause | 후속 검토 · 현재 미도입 | Python/GEOS 구성. 브라우저와 서버가 서로 다른 허용오차로 판정하지 않도록 통일. |
| 형상·좌표 | [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) | MIT | 적용 · three-mesh-bvh 0.9.15 | 일조 계산의 일부를 가속한다. 자체로 일조시간·일사량을 산출하는 엔진은 아니다. |
| 형상·좌표 | [three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg) | MIT | 후속 검토 · 현재 미도입 | README가 실험적이라고 명시. 핵심 면적·공사량 판정의 유일한 기반으로 두지 않는다. |
| 환경·지형 | [SunCalc](https://github.com/mourner/suncalc) | BSD-2-Clause | 적용 · suncalc 2.0.2 | 차폐 판정은 주변 3D 모델과 raycast로 별도 구현. API 버전 변화와 좌표축 확인. |
| 환경·지형 | [Ladybug](https://github.com/ladybug-tools/ladybug) | AGPL-3.0 | 후속 검토 · 현재 미도입 | 서버에서 실행한다는 이유만으로 AGPL 의무가 사라진다고 가정하지 않는다. |
| 환경·지형 | [Honeybee Core](https://github.com/ladybug-tools/honeybee-core) | AGPL-3.0 | 후속 검토 · 현재 미도입 | 내부 공간·개구부·재료가 있어야 의미 있는 모델이 된다. 구형 honeybee 저장소와 구분. |
| 환경·지형 | [Honeybee Radiance](https://github.com/ladybug-tools/honeybee-radiance) | AGPL-3.0 | 후속 검토 · 현재 미도입 | 하늘·재료·개구부·기후 입력과 결과 검증 필요. 단순 그림자와 다른 범위. |
| 환경·지형 | [EnergyPlus](https://github.com/NatLabRockies/EnergyPlus) | BSD 계열 별도 조건 | 후속 검토 · 현재 미도입 | 명칭 사용 조건 포함. 외피·용도 스케줄·설비·기후가 없으면 결과 신뢰 불가. |
| 환경·지형 | [GeoTIFF.js](https://github.com/geotiffjs/geotiff.js) | MIT | 후속 검토 · 현재 미도입 | IMG를 직접 읽는 도구로 간주하지 말 것. 래스터 CRS·NoData·표고 기준 확인. |
| 환경·지형 | [GDAL](https://github.com/OSGeo/gdal) | 주로 MIT 계열, 구성별 고지 | 후속 검토 · 현재 미도입 | 원본 포맷 확인 후 GeoTIFF/COG 등으로 변환. 번들 드라이버별 조건도 확인. |
| 지도·주변 | [3D Tiles Renderer](https://github.com/NASA-AMMOS/3DTilesRendererJS) | Apache-2.0 | 후속 검토 · 현재 미도입 | 타일 공급원·좌표 정합·LOD·사용권이 먼저다. VWorld가 바로 호환된다는 보장은 없다. |
| 지도·주변 | [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) | BSD-3-Clause | 후속 검토 · 현재 미도입 | 지도 렌더러와 배경지도 데이터 이용권은 별개. 현재 지도와 교체 필요성부터 검토. |
| 지도·주변 | [CesiumJS](https://github.com/CesiumGS/cesium) | Apache-2.0 | 후속 검토 · 현재 미도입 | 같은 화면에 Three와 대형 엔진을 중복 탑재하지 않도록 화면 책임 분리. |
| 지도·주변 | [deck.gl](https://github.com/visgl/deck.gl) | MIT | 후속 검토 · 현재 미도입 | 단일 소규모 부지 편집에는 우선순위가 낮다. |
| 도면·BIM | [rhino3dm](https://github.com/mcneel/rhino3dm) | MIT | 적용 · rhino3dm 8.35.0 | Rhino와 독립적으로 사용 가능. Rhino Compute의 전체 모델링 기능과는 다름. |
| 도면·BIM | [ezdxf](https://github.com/mozman/ezdxf) | MIT | DXF 교차 검증 도구 · 런타임 미포함 | 기존 TypeScript DXF와 비용 비교. DWG는 ODA 변환 등 별도 의존성·권리 필요. |
| 도면·BIM | [web-ifc](https://github.com/ThatOpen/engine_web-ifc) | MPL-2.0 | 후속 검토 · 현재 미도입 | IFC 의미 구조·단위·층·부재 매핑은 우리 구현. MPL 적용 파일과 WASM 배포 조건 확인. |
| 도면·BIM | [That Open Components](https://github.com/ThatOpen/engine_components) | MIT | 후속 검토 · 현재 미도입 | 의존하는 web-ifc 등은 별도 라이선스. Three 버전과 실제 선택 패키지를 확인. |
| 도면·BIM | [IfcOpenShell](https://github.com/IfcOpenShell/IfcOpenShell) | 코어 LGPL-3.0-or-later | 후속 검토 · 현재 미도입 | Bonsai 등 일부 구성은 GPL. IfcTester/IDS 검증은 한국 법규 전부를 판정하는 기능이 아니다. |
| 주차·동선 | [PythonRobotics](https://github.com/AtsushiSakai/PythonRobotics) | MIT | 후속 검토 · 현재 미도입 | 차체 폭·휠베이스·조향·앞뒤 돌출·회전 포락선을 모델링해야 주차 검증에 쓸 수 있다. |
| 문서·근거 | [Docling](https://github.com/docling-project/docling) | MIT, 모델은 별도 | 후속 검토 · 현재 미도입 | 한국어 고시·도면으로 정확도 시험. 코드 라이선스가 모든 모델 사용권을 포함하지 않는다. |
| 문서·근거 | [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) | Apache-2.0, 모델 확인 | 후속 검토 · 현재 미도입 | 숫자·소수점·단위 오류 가능. 추출값 승인과 원문 좌표 연결이 필요. |
| 문서·근거 | [PDF.js](https://github.com/mozilla/pdf.js) | Apache-2.0 | 후속 검토 · 현재 미도입 | OCR 엔진은 아니다. 원문 확인 UI와 추출 엔진을 구분. |
| 문서·근거 | [pgvector](https://github.com/pgvector/pgvector) | PostgreSQL License | 후속 검토 · 현재 미도입 | 소규모면 검색 DB 추가 전 기존 필터/전문검색부터. 유사 문장이 적용 법규라는 뜻은 아니다. |
| 보고서·재무 | [ExcelJS](https://github.com/exceljs/exceljs) | MIT | 후속 검토 · 현재 미도입 | Excel 수식 자체를 계산하는 엔진은 아님. Decimal 결과와 저장값을 대사. |
| 보고서·재무 | [pdf-lib](https://github.com/Hopding/pdf-lib) | MIT | 후속 검토 · 현재 미도입 | HTML 페이지 조판 도구가 아님. 한글 폰트 임베딩과 폰트 사용권 확인. |
| 성능·운영 | [Comlink](https://github.com/GoogleChromeLabs/comlink) | Apache-2.0 | 적용 · comlink 4.4.2 | 알고리즘 복잡도를 줄이지는 않는다. 취소·진행률·오래된 결과 폐기 구현. |
| 성능·운영 | [Dexie](https://github.com/dexie/Dexie.js) | Apache-2.0 | 2026-10-08 도입 · 4.4.6 · [저장 계약](KR-WORKSPACE-STORAGE.md) | 브라우저 저장은 별도 PC 동기화·백업과 다름. 서버 동기화 및 복구 경로 별도. |
| 성능·운영 | [Yjs](https://github.com/yjs/yjs) | MIT | 후속 검토 · 현재 미도입 | 동시 수정의 데이터 병합이 유효한 형상·승인을 보장하지 않음. |
| 성능·운영 | [BullMQ](https://github.com/taskforcesh/bullmq) | MIT | 후속 검토 · 현재 미도입 | 현재 배포 구조와 영속 작업 실행 환경을 먼저 정한다. Pro 기능과 별개. |
| 성능·운영 | [Playwright](https://github.com/microsoft/playwright) | Apache-2.0 | 브라우저 검증 도구 · 런타임 미포함 | 스크린샷만으로 면적·재무 정합성을 증명할 수 없음. 단위/통합 테스트와 함께. |
| 성능·운영 | [PostGIS](https://github.com/postgis/postgis) | GPL-2.0 | 후속 검토 · 현재 미도입 | 별도 DB 확장. 애플리케이션과 결합·배포 방식을 검토하며 무조건 전체 앱 공개라고 단정하지 않음. |
| 한국 연동 참고 | [PublicDataReader](https://github.com/WooilJeong/PublicDataReader) | MIT | 후속 검토 · 현재 미도입 | 기존 TS 어댑터를 전부 Python으로 바꾸지 말고 필요한 처리와 테스트 사례만 선별. |
| 한국 연동 참고 | [Korean Land MCP](https://github.com/UrbanWatcherKr/korean-land-mcp) | MIT | 후속 검토 · 현재 미도입 | 실제 backend는 VWorld. 토지이음 공식 API나 독립 장애 대체원으로 취급하면 안 됨. |

## 한국 공식 데이터 10개 축

“지도에서 보인다”와 “상용 서비스가 저장·재배포할 수 있다”는 별개다. 공급자별 활용신청, 이용범위, 갱신주기, 공간 정밀도를 기록한다. 아래는 키 발급이나 실제 대량 호출까지 완료했다는 뜻이 아니다.

| 공식 원천 | 한국판에서 추가할 기능 | 연결·주의점 |
|---|---|---|
| [VWorld/국토부 연속지적도형정보](https://www.data.go.kr/data/15045882/fileData.do) | 필지 경계·규제 레이어·주변 건물 자료 보강 | 기존 연동 활용. 공식 설명은 연속지적을 참조 도면으로 구분한다. 측량 경계를 보증하지 않으며, 이 데이터셋은 EPSG:5186 표기다. |
| [건축HUB 건축물대장정보](https://www.data.go.kr/data/15134735/openapi.do) | 층별 용도·면적, 전유/공용 대사, 기존 건물 검토 개선 | 표제부·층별개요·전유공용면적의 상태·페이지·원본 근거를 연결했다. 공식 페이지에 건축데이터 PK 변경 안내가 있으므로 ID 전환·누락·페이지네이션도 점검. 실제 실내 평면도 제공으로 오해하지 않는다. |
| [토지이음 데이터개방](https://www.eum.go.kr/web/op/sv/svItemList.jsp) | 지구단위계획구역·시설·용도지역·행위제한의 근거 연결 | 항목마다 SHP/CSV/PDF/API가 다르다. 모든 규정을 필지별 단일 API로 받는 구조를 가정하지 않는다. 도면·고시 확인이 남을 수 있다. |
| [국가법령정보 공동활용](https://open.law.go.kr/LSO/openApi/guideList.do) | 법령·조례 원문, 적용일·개정 이력, 규칙 근거 링크 | 문서를 얻는 기능과 적용 조건을 기계 판정하는 기능은 별개. 관할·시행일·부칙·특례를 포함한 자체 규칙·승인 절차 필요. |
| [국토지리정보원 DEM](https://www.data.go.kr/catalog/15059920/fileData.json) | 경사지·대지 높이차·지형 단면의 참고 분석 | 카탈로그 형식은 IMG. 실제 파일 포맷 확인 후 GDAL 전처리 → GeoTIFF.js 등을 연결. 해상도·NoData·수직 기준 확인 전 토공량 확정 금지. |
| [서울 S-Map 오픈랩](https://openlab.eseoul.go.kr/) | 서울 파일럿의 주변 지형·건물 맥락 데이터 검토 | 지원·신청·자료별 조건을 먼저 확인. 전국 무료 3D 타일 API로 단정하지 않는다. |
| [기상청 ASOS](https://data.kma.go.kr/data/grnd/selectAsosList.do?pgmNo=36) | 지역 기후·일사·일조 참고, 환경 시뮬레이션 입력 검토 | 관측소 기후와 특정 방의 차폐·실내 채광은 다른 데이터다. 결측·품질·시간대·관측 지점을 기록. |
| [국토부 실거래가 공개 API](https://www.data.go.kr/data/15126469/openapi.do) | 비교사례 시점·표본수·용도·면적 일치 검토, 가격 시나리오 | 기존 `molit.ts` 연동의 품질을 높인다. 링크는 아파트 자료 예시이며 연립/다가구/오피스텔/토지는 대상별 서비스를 사용. 신축 매출을 그대로 확정하는 근거가 아니다. |
| [한국부동산원 R-ONE API](https://www.reb.or.kr/r-one/portal/openapi/openApiDevPage.do) | 지역별 시장 시계열과 사업성 가정의 기준 시점 관리 | 통계표·지역·항목 코드를 맞춘다. 통계 지수를 개별 필지 시세나 공사비로 사용하지 않는다. |
| [홍수위험지도](https://www.floodmap.go.kr/intro) | 지하·반지하 계획의 침수 위험 참고와 검토 요청 | 시나리오에 따른 침수 범위다. 실제 발생 확률/보험료로 바꾸지 않는다. 자동 수집·API·재배포 조건은 추가 확인 대상. |

신뢰도 개선은 공급자를 늘리는 것만으로 해결되지 않는다. 같은 VWorld 자료를 다른 MCP로 조회해도 독립적인 교차 검증이 아니다. 각 값에 원본 ID·URL·조회일·자료 기준일·적용 지역·좌표계·확인 상태를 보존해야 한다.

공사비는 일률적 평당값을 바로 고급 모델로 바꾸기보다, 기존 Decimal/ledger 구조에서 형상 수량·재료·단가 출처·기준일·사용자 견적을 분리하는 작업부터 권장한다. 공개 지수의 개별 이용범위와 품목 매핑은 도입 전에 추가 확인해야 한다.

## 9월 조사 당시 후속 항목과 완료 조건

1. **공공 원문 품질 — 기반 구현 완료:** 건축물대장 0건/미확인/부분 조회, 층별·전유공용 관측 근거, PK·면적제외 대조, 근거 JSON을 연결했다. [구현·사용 계약](KR-BUILDING-EVIDENCE.md). 합성 응답 회귀는 검증했고 실제 승인 계정의 응답·권한 사례 확보는 남아 있다.
2. **규제·좌표:** 자료별 EPSG/축/원점 계약, 법령·고시의 시행일·적용 지역·원문 페이지 추적. 검토되지 않은 규칙은 자동 확정 금지.
3. **평면 솔버 확장:** 주거 세대 내부 방·코어 상세·피난·접근성, OR-Tools 제약 모델, 수동 잠금과 조건 충돌 설명. 건축가 검토 사례로 정확도 측정.
4. **주변·지형 환경:** 허용된 주변 건물·DEM을 같은 좌표계에 연결. NoData·높이 기준·갱신일을 기록하고 분석 누락을 표시.
5. **인계 확장:** IFC 부재·층·단위 의미 모델, XLSX 계산 대사, PDF 원문 확인. 실제 수신 프로그램에서 읽기와 수치 비교.
6. **장기 작업·저장:** 실제 계산량을 측정해 서버 솔버 큐 또는 IndexedDB를 도입. 취소·복구·버전 전환·데이터 백업부터 검증.

대안 라이브러리의 채택 여부는 위 기능의 필요에 따라 결정한다. API 활용신청, 고객 데이터 반출, 신규 서비스 구매는 이번 코드 도입으로 완료된 것이 아니다.

상세 사용·계산 계약: [내부 구획 및 일영 가이드](KR-INTERIOR-UPGRADE.md).
