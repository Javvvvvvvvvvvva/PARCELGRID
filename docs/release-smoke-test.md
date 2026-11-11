# Release Smoke Test

Use `서울 도봉구 쌍문동 281-23` as the primary end-to-end demo parcel.

1. Create a project from the address and enter a total acquisition price.
2. Confirm official facts, user inputs, and algorithm recommendations are visually distinct.
3. Expand the land proxy evidence and confirm no price is adopted until `이 값으로 입력` is clicked.
4. Open Plan Studio and edit one value in Quick Plan.
5. Switch to Expert Edit and confirm the same plan and value are retained.
6. Confirm reference-only constraints remain review items and do not hard-block edits.
7. Select the representative plan and confirm Stage 3 opens the finance scenario with the same scenario ID.
8. Edit acquisition price and construction cost, click `현재안 저장`, refresh, and confirm the saved values remain.
9. Confirm construction cost and profit show Low / Base / High ranges.
10. Confirm total cost plus profit reconciles to revenue.
11. Confirm equity plus PF loan reconciles to the financed project cost basis.
12. Open the Stage 5 preliminary report and confirm its saved profit range and Geometry Snapshot match Stage 3.
13. Register the required source-backed inputs, continue to expert handoff, and confirm approval remains blocked until every required discipline is complete.
14. Export the preliminary/final report as applicable and confirm sources, assumptions, warnings, geometry basis, and financial basis are readable.

## CAD / SketchUp export

15. Lock the representative Geometry Snapshot and wait for cadastral/road context to become ready.
16. Download the CAD package and confirm the ZIP contains a meter-unit R2000 DXF, WGS84 GeoJSON, metadata, and Korean README.
17. Open the DXF in AutoCAD-compatible software and confirm proposed floors, site boundary, road boundaries, frontage, north, context buildings, adjacent parcels, parking stalls, parking aisle, parking core, reference columns, and reference access path are separated by PG_* layers.
18. In Plan Studio, select a surface or piloti parking alternative and confirm the exact stalls and vehicle aisle appear in 3D with a PGP Parking Geometry Hash.
19. Export both SketchUp and CAD packages and confirm PG_PARKING_STALLS and PG_PARKING_AISLE exist and the metadata Parking Geometry Hash exactly matches the hash shown in Plan Studio.
20. Confirm PG_PARKING_COLUMNS_REFERENCE and PG_PARKING_ACCESS_REFERENCE are explicitly reference-only, and that no road width is generated when a verified cadastral width is unavailable.
21. Confirm PG_ADJACENT_PARCELS, context buildings, road centerlines, and width samples are OFF by default.
22. Confirm the SketchUp and CAD metadata record PASS for the same project identity, WGS84 origin/axes, and target parcel outline.
23. Download the SketchUp package and confirm its DAE origin aligns with the DXF rule: DXF Y = - DAE Z.


## 외부 형상 재연결

24. Plan Studio에서 형상 출처를 외부 설계 모델로 변경한다.
25. 원본 PARCELGRID DAE를 선택하고 단위·원점·축·층 외곽선·높이·Geometry Hash 검증이 PASS인지 확인한다.
26. CAD DXF를 선택할 때 같은 패키지의 metadata.json도 함께 선택하고 모든 층 레이어가 현재 계획과 일치하는지 확인한다.
27. DAE 좌표 하나 또는 DXF 층 외곽선을 변경한 사본은 검증 실패하며 대표안·SketchUp·CAD 내보내기가 차단되는지 확인한다.
28. 검증 통과 파일은 SHA-256 지문과 검증 버전을 남기고 해당 Geometry Hash로 자동 잠기는지 확인한다.


## 지도·주소 부지 선택 (2026-09-28)

- 빌드 후 `pnpm test:browser:intake`: 합성 SDK/응답으로 주소·지역·클릭·취소·연속 선택·모바일·저장 실패·가격 없는 현황·가격 입력·같은 PNU 재선택 검증.
- 실제 등록 도메인에서 Kakao SDK의 이동·휠·터치 확대·위성·중심 선택을 확인한다. SDK 실패 시 주소 검색을 사용할 수 있어야 한다.
- 쌍문동을 검색해 지역으로 이동한 뒤 필지 안을 선택한다. 지번·19자리 PNU·지적 경계·면적이 실제 대상과 일치해야 한다. 이웃 필지·공유 경계는 잘못 확정되지 않아야 한다.
- 확인 전 건축물대장/실거래/사업성 호출이 없어야 한다. 확인 후 가격 없이 현황을 열고 대장 0건을 나대지로 표시하지 않는지 확인한다.
- 주변 거래는 가격 단계에서 펼칠 때 조회하며 취득대금을 자동으로 채우지 않아야 한다.
- 새 필지 선택·같은 PNU 재선택·탭 새로고침을 확인한다. 과거 사업성/승인이 새 부지 입력에 재사용되지 않고, 기존 저장 계획은 남아 재확정할 수 있어야 한다.


## 프로젝트 저장·복구 (2026-10-08)

- 프로덕션 빌드 후 `pnpm test:browser:storage`로 IndexedDB 재접속·저장 실패·충돌·기록 복구·손상 백업·390px 화면을 검사한다.
- 계획 수정 후 저장 완료를 확인하고 모든 프로젝트 탭을 닫는다. 새 탭의 저장 목록에서 같은 부지를 열어 계획·가격·내부 구획을 대조한다.
- 두 탭에서 같은 부지를 열어 한쪽을 수정한다. 충돌한 탭의 미저장 초안은 파일로 보관할 수 있어야 하며 최신 저장본을 자동 덮어쓰면 안 된다.
- 기록/파일 복구 후 대표안과 과거 승인·가격 확정이 재검토 상태인지 확인한다. 부지 경계·미터 단위·계획 입력은 복구 전 파일과 같아야 한다.
- 별도 Windows Chrome 프로필에 백업을 가져와 같은 부지를 열고 원문 첨부를 다시 연결한다. 이 항목은 Linux Chromium 자동 검사와 별도 수동 확인이다.
- [저장·복구 계약](KR-WORKSPACE-STORAGE.md)의 원본 보존·형식·한계를 따른다.
