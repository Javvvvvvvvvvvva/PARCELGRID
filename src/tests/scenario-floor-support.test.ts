import { describe, expect, it } from "vitest";
import { calculatePlanningSpatialValidation } from "@/lib/planning/scenario-spatial-validation";
import {
  createBlankPlanningScenario,
  createFloorProgram,
  createFloorZone,
} from "@/lib/planning/scenario-utils";

const boundary: [number, number][] = [
  [126.9999, 37.4999],
  [127.0001, 37.4999],
  [127.0001, 37.5001],
  [126.9999, 37.5001],
  [126.9999, 37.4999],
];

describe("Stage 2 unified floor-support validation", () => {
  it("fails the structural-support check when an upper floor is displaced away from the floor below", () => {
    const scenario = createBlankPlanningScenario({ name: "상층 지지 검토안" });
    const first = createFloorProgram(
      1,
      [createFloorZone("residential", 60, 1)],
      3
    );
    const second = createFloorProgram(
      2,
      [createFloorZone("residential", 20, 1)],
      3
    );
    second.northSetbackM = 50;
    scenario.floorPrograms = [first, second];

    const result = calculatePlanningSpatialValidation(
      boundary,
      "제2종일반주거지역",
      scenario
    );

    const supportCheck = result?.checks.find(
      (check) => check.code === "spatial-floor-support"
    );
    expect(supportCheck?.status).toBe("fail");
    expect(supportCheck?.message).toContain("2층");
  });

  it("passes the structural-support check for a normal centered stack", () => {
    const scenario = createBlankPlanningScenario({ name: "정상 적층안" });
    scenario.floorPrograms = [
      createFloorProgram(
        1,
        [createFloorZone("residential", 60, 1)],
        3
      ),
      createFloorProgram(
        2,
        [createFloorZone("residential", 30, 1)],
        3
      ),
    ];

    const result = calculatePlanningSpatialValidation(
      boundary,
      "제2종일반주거지역",
      scenario
    );

    expect(
      result?.checks.find((check) => check.code === "spatial-floor-support")
        ?.status
    ).toBe("pass");
  });
});
