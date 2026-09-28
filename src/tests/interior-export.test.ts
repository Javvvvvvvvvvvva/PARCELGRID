import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import rhino3dm from "rhino3dm";
import { buildInteriorDxfPackage } from "@/lib/planning/interior/export";
import { buildInterior3dm } from "@/lib/planning/interior/rhino-export";
import { interiorFixture } from "./helpers/interior-fixture";

function exportFixture() {
  const fixture = interiorFixture();
  fixture.scenario.floorPrograms[0].interior = fixture.layout;
  return { planning: fixture.build(), floorId: fixture.scenario.floorPrograms[0].id, layout: fixture.layout };
}
describe("concept interior handoff", () => {
  it("exports meter DXF and provenance with the same geometry and Korean labels", () => {
    const input = exportFixture();
    const result = buildInteriorDxfPackage(input);
    expect(result.dxf).toContain("$INSUNITS\n70\n6\n");
    expect(result.dxf).toContain("PG_DOOR_OPENING");
    expect(result.dxf).toContain("\\U+");
    expect(result.bytes.slice(0, 2)).toEqual(new Uint8Array([80, 75]));
    expect(JSON.parse(result.metadataText)).toMatchObject({ stage: "concept", geometryHash: input.planning.geometryHash, floorId: input.floorId, coordinateSystem: { unit: "meter", northAxis: "+Y" } });
    expect(() => buildInteriorDxfPackage({ ...input, layout: { ...input.layout, wallThicknessM: 0.3 } })).toThrow("다릅니다");
  });

  it("round-trips a native 3DM with layers, meters, origin, and matching geometry hash", async () => {
    const require = createRequire(import.meta.url);
    const wasmBinary = fs.readFileSync(path.join(path.dirname(require.resolve("rhino3dm")), "rhino3dm.wasm"));
    const input = exportFixture();
    const rhino = await rhino3dm({ wasmBinary });
    const result = await buildInterior3dm(input, rhino);
    const model = rhino.File3dm.fromByteArray(result.bytes);
    try {
      expect(model).toBeTruthy();
      expect(model.settings().modelUnitSystem).toEqual(rhino.UnitSystem.Meters);
      expect(model.layers().count).toBe(4);
      expect(model.objects().count).toBe(1 + input.layout.spaces.length * 2 + input.layout.doors.length);
      expect(model.strings().get(0)).toEqual(["PARCELGRID", expect.any(String)]);
      const [, metadata] = model.strings().get(0) as [string, string];
      expect(JSON.parse(metadata)).toMatchObject({ stage: "concept", geometryHash: input.planning.geometryHash, north: "+Y", up: "+Z" });
      const curve = model.objects().get(0).geometry();
      expect(curve.getBoundingBox(true).min[2]).toBeCloseTo(input.planning.building.floors[0].baseHeightM);
    } finally { model.destroy(); }
  }, 20000);
});
