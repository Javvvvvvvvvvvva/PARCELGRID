import { describe, expect, it } from "vitest";
import { buildPlanningDesignIntent } from "@/lib/planning/design-intent";
import {
  createBlankPlanningScenario,
  createFloorProgram,
  createFloorZone,
} from "@/lib/planning/scenario-utils";

const PROJECT_ID = "1132010500102810023";
const ADDRESS = "서울 도봉구 쌍문동 281-23";
const PARCEL_AREA_SQM = 118.02;

describe("Ssangmun 281-23 release contract", () => {
  it("preserves the two-floor reference-image mass and keeps unpriced materials out of cost", () => {
    const scenario = createBlankPlanningScenario({
      projectId: PROJECT_ID,
      name: "쌍문동 기준 이미지 보존안",
    });
    const floor1 = createFloorProgram(1, [
      createFloorZone("residential", 28.3, 1),
    ]);
    const floor2 = createFloorProgram(2, [
      createFloorZone("residential", 28.3, 1),
    ]);
    floor2.footprintScalePct = 90;
    scenario.floorPrograms = [floor1, floor2];
    scenario.parking = { strategy: "none", providedCars: 0 };
    scenario.geometrySource = {
      mode: "reference-image",
      exactGeometryAvailable: false,
      sourceName: "PARCELGRID 3D 기준 이미지",
      locked: false,
    };
    scenario.materials = {
      primaryFacadeMaterial: "brick-veneer",
      secondaryFacadeMaterial: "exposed-concrete",
      primaryFacadeSharePct: 75,
      windowRatioPct: 25,
      facadeAreaOverrideSqm: 0,
      baselineFacadeUnitCostPerSqmWon: 0,
      selectedFacadeUnitCostPerSqmWon: 0,
    };

    const intent = buildPlanningDesignIntent(scenario, {
      projectId: PROJECT_ID,
      address: ADDRESS,
      parcelAreaSqm: PARCEL_AREA_SQM,
      maxBuildingCoveragePct: 60,
      maxFloorAreaRatioPct: 250,
    });

    const representedArea = intent.geometryLock.floors.reduce(
      (sum, floor) =>
        sum + floor.zones.reduce((floorSum, zone) => floorSum + zone.areaSqm, 0),
      0,
    );

    expect(intent.project).toMatchObject({
      projectId: PROJECT_ID,
      address: ADDRESS,
      parcelAreaSqm: PARCEL_AREA_SQM,
    });
    expect(intent.geometryLock).toMatchObject({
      source: "reference-image",
      exactGeometryAvailable: false,
      referenceImageRequired: true,
    });
    expect(intent.geometryLock.floors).toHaveLength(2);
    expect(intent.geometryLock.floors[1].footprintScalePct).toBe(90);
    expect(intent.geometryLock.mustNotAdd).toContain("unverified-parking");
    expect(representedArea).toBeCloseTo(56.6, 6);
    expect((representedArea / PARCEL_AREA_SQM) * 100).toBeCloseTo(48, 1);
    expect(intent.materials).toMatchObject({
      primaryFacade: "brick-veneer",
      secondaryFacade: "exposed-concrete",
      primaryFacadeSharePct: 75,
    });
    expect(intent.costEvidence.priced).toBe(false);
    expect(intent.generationInstruction.promptKo).toContain("추가 층");
    expect(intent.generationInstruction.conceptOnly).toBe(true);
  });
});
