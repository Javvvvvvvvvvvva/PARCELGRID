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
      maxFAR: 200,
      maxBCR: 60,
      heightLimit: 0,
    });
    expect(DEMO_PARCEL.regulatoryConstraints).toMatchObject({
      far: {
        value: 200,
        status: "reference-only",
        sourceName: "서울특별시 도시계획 조례 제48조",
      },
      bcr: {
        value: 60,
        status: "reference-only",
        sourceName: "서울특별시 도시계획 조례 제44조",
      },
      height: { value: null, status: "unknown" },
    });
    expect(project.parcel.id).toBe(DEMO_PROJECT_ID);
    expect(project.scenarios).toHaveLength(4);
    expect(project.scenarios.map((scenario) => scenario.name)).toEqual([
      "단독주택 신축매매",
      "다가구주택 통매각",
      "다가구 임대 안정화 후 매각",
      "제1종 근린생활시설 소매점 임대 안정화 후 매각",
    ]);
    expect(project.scenarios.every((scenario) => Number.isFinite(scenario.profit))).toBe(
      true,
    );
    expect(project.decisionSupport.entries.every((entry) =>
      entry.advisoryReasons.length > 0
    )).toBe(true);
    expect(project.maxAcquisition).not.toHaveLength(0);
  });
});
