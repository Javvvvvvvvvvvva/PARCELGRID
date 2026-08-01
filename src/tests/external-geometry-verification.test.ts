import { describe, expect, it } from "vitest";
import {
  verifyDaeGeometryText,
  verifyDxfGeometryText,
  verifyGlbGeometryBuffer,
} from "@/lib/planning/external-geometry-verification";
import {
  buildPlanningGeometry,
  planningRingCentroid,
  planningRingToLocalMeters,
} from "@/lib/planning/planning-geometry";
import { polygonAreaSqm } from "@/lib/planning/planning-massing";
import {
  createBlankPlanningScenario,
  createFloorProgram,
  createFloorZone,
} from "@/lib/planning/scenario-utils";
import { buildSketchupDae } from "@/lib/planning/sketchup-dae-export";
import { buildSketchupExportPackage } from "@/lib/planning/sketchup-export-package";

function squareBoundary(sizeM = 20): [number, number][] {
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

function planning() {
  const boundary = squareBoundary();
  const origin = planningRingCentroid(boundary);
  const scenario = createBlankPlanningScenario({
    projectId: "external-geometry-project",
    name: "외부 형상 검증안",
  });
  scenario.id = "external-geometry-scenario";
  const first = createFloorProgram(1, [
    createFloorZone("residential", 80, 1),
  ]);
  first.id = "external-floor-1";
  const second = createFloorProgram(2, [
    createFloorZone("residential", 60, 1),
  ]);
  second.id = "external-floor-2";
  scenario.floorPrograms = [first, second];

  return buildPlanningGeometry({
    projectId: "external-geometry-project",
    scenario,
    boundary,
    lotAreaSqm: polygonAreaSqm(
      planningRingToLocalMeters(boundary, origin)
    ),
    zoning: "제2종일반주거지역",
    roads: [],
    setback: { road: 0, side: 0, rear: 0 },
    generatedAt: "2026-08-01T00:00:00.000Z",
  }).snapshot;
}

function dxfForPlanning(snapshot: ReturnType<typeof planning>): string {
  let text =
    "0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n6\n0\nENDSEC\n" +
    "0\nSECTION\n2\nENTITIES\n";
  for (const floor of snapshot.building.floors) {
    const suffix = Math.abs(floor.level).toString().padStart(2, "0");
    const layer =
      floor.level < 0
        ? "PG_PROPOSED_MASS_B" + suffix
        : "PG_PROPOSED_MASS_F" + suffix;
    text +=
      "0\nLWPOLYLINE\n8\n" +
      layer +
      "\n90\n" +
      floor.shape.length +
      "\n70\n1\n";
    for (const point of floor.shape) {
      text += "10\n" + point.x + "\n20\n" + -point.z + "\n";
    }
  }
  return text + "0\nENDSEC\n0\nEOF\n";
}

function glbForPlanning(snapshot: ReturnType<typeof planning>): ArrayBuffer {
  const json = {
    asset: {
      version: "2.0",
      extras: {
        PARCELGRID: {
          planningGeometryHash: snapshot.geometryHash,
          coordinateSystem: snapshot.coordinateSystem,
          floors: snapshot.building.floors.map((floor) => ({
            id: floor.id,
            baseHeightM: floor.baseHeightM,
            topHeightM: floor.topHeightM,
            shape: floor.shape,
          })),
        },
      },
    },
    nodes: snapshot.building.floors.map((floor) => ({
      name: "PG_PROPOSED_MASS-" + floor.id,
    })),
  };
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const paddedLength = Math.ceil(encoded.length / 4) * 4;
  const buffer = new ArrayBuffer(12 + 8 + paddedLength);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, buffer.byteLength, true);
  view.setUint32(12, paddedLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  const bytes = new Uint8Array(buffer, 20, paddedLength);
  bytes.fill(0x20);
  bytes.set(encoded);
  return buffer;
}

describe("External geometry verification", () => {
  it("accepts an unchanged PARCELGRID DAE and rejects changed vertices", () => {
    const snapshot = planning();
    const dae = buildSketchupDae(
      buildSketchupExportPackage({
        planning: snapshot,
        generatedAt: "2026-08-01T00:00:00.000Z",
      })
    );

    const verified = verifyDaeGeometryText(dae, snapshot);
    expect(verified.status).toBe("pass");
    expect(verified.matchedFloorCount).toBe(2);
    expect(verified.embeddedGeometryHash).toBe(snapshot.geometryHash);

    const changed = dae.replace(
      /(<float_array[^>]*PG_PROPOSED_MASS-external-floor-1-positions-array[^>]*>)([^<]+)/,
      (_match, prefix: string, values: string) => {
        const numbers = values.trim().split(/\s+/);
        numbers[0] = String(Number(numbers[0]) + 1);
        return prefix + numbers.join(" ");
      }
    );
    const rejected = verifyDaeGeometryText(changed, snapshot);
    expect(rejected.status).toBe("fail");
    expect(
      rejected.issues.some(
        (item) => item.code === "dae-floor-geometry-mismatch"
      )
    ).toBe(true);
  });

  it("requires matching CAD metadata and exact floor layers for DXF", () => {
    const snapshot = planning();
    const metadata = JSON.stringify({
      planningGeometryHash: snapshot.geometryHash,
      coordinateSystem: {
        unit: "meter",
        eastAxis: "+X",
        northAxis: "+Y",
        originLngLat: snapshot.coordinateSystem.originLngLat,
      },
    });

    const verified = verifyDxfGeometryText(
      dxfForPlanning(snapshot),
      metadata,
      snapshot
    );
    expect(verified.status).toBe("pass");
    expect(verified.matchedFloorCount).toBe(2);

    const missingMetadata = verifyDxfGeometryText(
      dxfForPlanning(snapshot),
      null,
      snapshot
    );
    expect(missingMetadata.status).toBe("fail");
    expect(
      missingMetadata.issues.some(
        (item) => item.code === "dxf-metadata-missing"
      )
    ).toBe(true);
  });

  it("accepts a GLB only when its PARCELGRID floor signatures match", () => {
    const snapshot = planning();
    const verified = verifyGlbGeometryBuffer(
      glbForPlanning(snapshot),
      snapshot
    );
    expect(verified.status).toBe("pass");
    expect(verified.matchedFloorCount).toBe(2);

    const changedSnapshot = {
      ...snapshot,
      geometryHash: "PG-DIFFERENT",
    };
    const rejected = verifyGlbGeometryBuffer(
      glbForPlanning(snapshot),
      changedSnapshot
    );
    expect(rejected.status).toBe("fail");
    expect(
      rejected.issues.some((item) => item.code === "glb-planning-hash")
    ).toBe(true);
  });
});
