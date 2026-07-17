import { describe, expect, it } from "vitest";
import type {
  ExistingBuildingFootprint,
  ExistingBuildingGeometry,
} from "@/lib/geo/existing-building-geometry";
import {
  buildSketchupDae,
  buildSketchupDaeExport,
  SketchupExportBlockedError,
} from "@/lib/planning/sketchup-dae-export";
import { buildPlanningGeometry, planningRingCentroid, planningRingToLocalMeters } from "@/lib/planning/planning-geometry";
import { buildSketchupExportPackage } from "@/lib/planning/sketchup-export-package";
import { polygonAreaSqm } from "@/lib/planning/planning-massing";
import {
  createBlankPlanningScenario,
  createFloorProgram,
  createFloorZone,
} from "@/lib/planning/scenario-utils";

function squareBoundary(sizeM = 24): [number, number][] {
  const centerLng = 127.034;
  const centerLat = 37.65;
  const halfLat = sizeM / 2 / 111_000;
  const halfLng =
    sizeM / 2 / (111_000 * Math.cos((centerLat * Math.PI) / 180));
  return [
    [centerLng - halfLng, centerLat - halfLat],
    [centerLng + halfLng, centerLat - halfLat],
    [centerLng + halfLng, centerLat + halfLat],
    [centerLng - halfLng, centerLat + halfLat],
    [centerLng - halfLng, centerLat - halfLat],
  ];
}

function footprint(
  id: string,
  offsetXM: number,
  offsetNorthM: number,
  heightM: number,
  groundFloors: number
): ExistingBuildingFootprint {
  const centerLng = 127.034;
  const centerLat = 37.65;
  const lngScale = 111_000 * Math.cos((centerLat * Math.PI) / 180);
  const centerX = centerLng + offsetXM / lngScale;
  const centerY = centerLat + offsetNorthM / 111_000;
  const halfLng = 3 / lngScale;
  const halfLat = 3 / 111_000;
  return {
    id,
    pnu: "",
    buildingName: id,
    polygons: [
      [
        [
          [centerX - halfLng, centerY - halfLat],
          [centerX + halfLng, centerY - halfLat],
          [centerX + halfLng, centerY + halfLat],
          [centerX - halfLng, centerY + halfLat],
          [centerX - halfLng, centerY - halfLat],
        ],
      ],
    ],
    footprintAreaSqm: 36,
    totalAreaSqm: 0,
    heightM,
    groundFloors,
    undergroundFloors: 0,
    useApprovalDate: "",
    purposeCode: "",
    structureCode: "",
    violationStatus: "unknown",
    violationRaw: "",
    matchMethod: "geometry",
    source: "vworld-dt_d010",
  };
}

function packageSnapshot(footprintScalePct = 100) {
  const boundary = squareBoundary();
  const origin = planningRingCentroid(boundary);
  const scenario = createBlankPlanningScenario({
    projectId: "parcel-export",
    name: "건축가 전달 기준안",
  });
  scenario.id = "scenario-export";
  scenario.version = 4;
  const floor1 = createFloorProgram(1, [
    createFloorZone("residential", 100, 1),
  ]);
  const floor2 = createFloorProgram(2, [
    createFloorZone("residential", 100, 1),
  ]);
  floor1.id = "floor-1";
  floor2.id = "floor-2";
  floor1.footprintScalePct = footprintScalePct;
  floor2.footprintScalePct = footprintScalePct;
  scenario.floorPrograms = [floor1, floor2];
  scenario.placement = {
    rotationDeg: 0,
    offsetXM: 0,
    offsetZM: 0,
    roadSetbackM: 0,
    northSetbackM: 0,
  };
  const lotAreaSqm = polygonAreaSqm(
    planningRingToLocalMeters(boundary, origin)
  );
  const roadLatA = 37.65 - 20 / 111_000;
  const roadLatB = 37.65 + 20 / 111_000;
  const roadLng = 127.034 + 15 / (111_000 * Math.cos((37.65 * Math.PI) / 180));
  const planning = buildPlanningGeometry({
    projectId: "parcel-export",
    scenario,
    boundary,
    lotAreaSqm,
    zoning: "일반상업지역",
    roads: [{ name: "테스트길", points: [[roadLng, roadLatA], [roadLng, roadLatB]] }],
    setback: { road: 0, side: 0, rear: 0 },
    generatedAt: "2026-07-14T00:00:00.000Z",
  }).snapshot;
  const existing: ExistingBuildingGeometry = {
    source: "vworld-dt_d010",
    status: "matched",
    footprints: [],
    contextFootprints: [
      footprint("verified-context", -16, 3, 12.4, 4),
      footprint("estimated-context", 17, -2, 0, 3),
    ],
    contextRadiusM: 35,
    queryFeatureCount: 2,
  };
  return buildSketchupExportPackage({
    planning,
    existingGeometry: existing,
    generatedAt: "2026-07-14T00:00:00.000Z",
  });
}

function storedZipNames(bytes: Uint8Array): string[] {
  const decoder = new TextDecoder();
  const names: string[] = [];
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
    if (view.getUint32(0, true) !== 0x04034b50) break;
    const compressedSize = view.getUint32(18, true);
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    names.push(decoder.decode(bytes.slice(offset + 30, offset + 30 + nameLength)));
    offset += 30 + nameLength + extraLength + compressedSize;
  }
  return names;
}

describe("SketchUp DAE export", () => {
  it("creates a meter-based Y-up COLLADA scene with named ParcelGrid groups", () => {
    const snapshot = packageSnapshot();
    const dae = buildSketchupDae(snapshot);

    expect(dae).toContain('<unit name="meter" meter="1"/>');
    expect(dae).toContain("<up_axis>Y_UP</up_axis>");
    expect(dae).toContain('name="PG_PARCEL"');
    expect(dae).toContain('name="PG_PROPOSED_MASS"');
    expect(dae).toContain('name="PG_CONTEXT_BUILDINGS_VERIFIED"');
    expect(dae).toContain('name="PG_CONTEXT_BUILDINGS_ESTIMATED"');
    expect(dae).toContain('name="PG_ROADS"');
    expect(dae).toContain('name="PG_NORTH"');
    expect(dae).toContain('name="PG_METADATA"');
    expect(dae).toContain(snapshot.exportPackageHash);
    expect(dae).toContain("<triangles");
  });

  it("builds one ZIP containing DAE, metadata JSON, and Korean README", () => {
    const snapshot = packageSnapshot();
    const result = buildSketchupDaeExport(snapshot);
    const names = storedZipNames(result.zipBytes);

    expect(result.filename.endsWith(".zip")).toBe(true);
    expect(names).toContain(result.daeFilename);
    expect(names).toContain(result.metadataFilename);
    expect(names).toContain("README-KO.txt");
    expect(result.metadataText).toContain(snapshot.planningGeometryHash);
    expect(result.metadataText).toContain(snapshot.contextGeometryHash);
    expect(result.metadataText).toContain(snapshot.exportPackageHash);
    expect(result.readmeText).toContain("PG_PROPOSED_MASS");
    expect(result.zipBytes[0]).toBe(0x50);
    expect(result.zipBytes[1]).toBe(0x4b);
  });

  it("blocks file generation when the proposed mass geometry is invalid", () => {
    const blocked = packageSnapshot(90);
    expect(blocked.validation.exportable).toBe(false);
    expect(() => buildSketchupDae(blocked)).toThrow(SketchupExportBlockedError);
  });
});
