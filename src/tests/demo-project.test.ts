import { describe, expect, it } from "vitest";
import { buildDemoProject, DEMO_PARCEL } from "@/lib/seed/demo-project";
import { DEMO_PROJECT_ID } from "@/lib/seed/demo-project-meta";

describe("demo project", () => {
  it("builds the documented Ssangmun regression project without external APIs", () => {
    const project = buildDemoProject();

    expect(DEMO_PARCEL).toMatchObject({
      id: DEMO_PROJECT_ID,
      address: "서울 도봉구 쌍문동 281-23",
      lotArea: 118.02,
    });
    expect(project.parcel.id).toBe(DEMO_PROJECT_ID);
    expect(project.scenarios).toHaveLength(3);
    expect(project.scenarios.map((scenario) => scenario.name)).toEqual([
      "단독주택 신축매매",
      "다가구주택 신축매매",
      "근린생활시설 (저층)",
    ]);
    expect(project.scenarios.every((scenario) => Number.isFinite(scenario.profit))).toBe(
      true,
    );
    expect(project.maxAcquisition).not.toHaveLength(0);
  });
});
