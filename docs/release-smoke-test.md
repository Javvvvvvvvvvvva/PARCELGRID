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
17. Open the DXF in AutoCAD-compatible software and confirm proposed floors, site boundary, road boundaries, frontage, north, context buildings, and adjacent parcels are separated by PG_* layers.
18. Confirm PG_ADJACENT_PARCELS, context buildings, road centerlines, and width samples are OFF by default.
19. Confirm the SketchUp and CAD metadata record PASS for the same project identity, WGS84 origin/axes, and target parcel outline.
20. Download the SketchUp package and confirm its DAE origin aligns with the DXF rule: DXF Y = - DAE Z.
