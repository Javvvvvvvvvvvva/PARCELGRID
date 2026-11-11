import { describe, expect, it } from "vitest";
import { computeProject } from "@/lib/services/compute-project";
import { generateScenariosForParcel } from "@/lib/services/generate-scenarios";
import { DEMO_PARCEL } from "@/lib/seed/demo-project";
import type { Parcel } from "@/lib/finance/types";

function residentialParcel(address: string): Parcel {
  return {
    ...DEMO_PARCEL,
    id: `test-${address}`,
    address,
    lotArea: 118,
    zoning: "제2종일반주거지역",
  };
}

describe("generated scenario financial validity", () => {
  it.each([
    "서울 강남구 역삼동 1-1",
    "서울 용산구 한남동 1-1",
  ])("computes a small prime residential parcel without invalid cap rates: %s", (address) => {
    const parcel = residentialParcel(address);
    const scenarios = generateScenariosForParcel(parcel);
    const wholeSaleScenarios = scenarios.filter(
      (scenario) =>
        scenario.program.type === "single-house" ||
        scenario.program.type === "multi-family"
    );

    expect(wholeSaleScenarios).not.toHaveLength(0);
    expect(
      wholeSaleScenarios.every((scenario) => scenario.assumptions.capRate >= 0.01)
    ).toBe(true);
    expect(() => computeProject(parcel, scenarios)).not.toThrow();
  });

  it("converts whole-asset price assumptions from won per pyeong to won per square metre", () => {
    const parcel = residentialParcel("서울 도봉구 쌍문동 281-23");
    const scenarios = generateScenariosForParcel(parcel);
    const single = scenarios.find(
      (scenario) => scenario.program.type === "single-house",
    );
    const multi = scenarios.find(
      (scenario) => scenario.program.type === "multi-family",
    );

    expect(single?.assumptions.salePricePerSqM).toBe(
      Math.round((18_000_000 / 3.305785) * 0.65),
    );
    expect(multi?.assumptions.salePricePerSqM).toBe(
      Math.round((15_000_000 / 3.305785) * 0.65),
    );
    expect(multi?.program.floorsAbove).toBe(3);
    expect(multi!.program.far).toBeLessThanOrEqual(
      multi!.program.bcr * multi!.program.floorsAbove,
    );
    expect(multi?.generation?.useScreening).toMatchObject({
      conditionAssessment: { status: "pass" },
      legalUse: { requestedCode: "BA-A1-1-C" },
    });
    expect(single?.assumptions.vacancyRate).toBe(0);
    expect(multi?.assumptions.vacancyRate).toBe(0);
  });

  it("separates sale and stabilized-lease strategies without duplicate IDs", () => {
    const scenarios = generateScenariosForParcel(
      residentialParcel("서울 도봉구 쌍문동 281-23"),
    );
    const multi = scenarios.filter(
      (scenario) => scenario.program.type === "multi-family",
    );

    expect(new Set(scenarios.map((scenario) => scenario.id)).size)
      .toBe(scenarios.length);
    expect(multi).toHaveLength(2);
    expect(multi.map((scenario) => scenario.generation?.strategy)).toEqual([
      "sale-exit",
      "stabilized-lease-exit",
    ]);
    expect(multi[0].program.mix).toEqual({
      residentialSale: 1,
      residentialLease: 0,
      retail: 0,
    });
    expect(multi[1].program.mix).toEqual({
      residentialSale: 0,
      residentialLease: 1,
      retail: 0,
    });
    expect(multi[1].assumptions.salePricePerSqM).toBe(0);
    expect(multi[1].assumptions.rentPerSqMMonth).toBeGreaterThan(0);
  });

  it("never injects officetel, office, or coliving into exclusive residential zoning", () => {
    const parcel = {
      ...residentialParcel("서울 종로구 테스트 1"),
      zoning: "제1종전용주거지역",
    };
    const scenarios = generateScenariosForParcel(parcel);

    expect(scenarios.map((scenario) => scenario.program.type)).toEqual([
      "single-house",
      "multi-family",
      "multi-family",
    ]);
    expect(
      scenarios
        .filter((scenario) => scenario.program.type === "multi-family")
        .every(
          (scenario) =>
            scenario.generation?.useScreening.status ===
            "seoul-ordinance-reference",
        ),
    ).toBe(true);
  });

  it("keeps general-residential candidates free of unsupported officetel and coliving uses", () => {
    const parcel = {
      ...residentialParcel("서울 마포구 테스트 1"),
      lotArea: 420,
    };
    const scenarios = generateScenariosForParcel(parcel);
    const types = scenarios.map((scenario) => scenario.program.type);

    expect(types).toContain("urban-housing");
    expect(types).not.toContain("officetel");
    expect(types).not.toContain("coliving");
    expect(
      scenarios.every(
        (scenario) => scenario.generation?.useScreening.decisionGrade === false,
      ),
    ).toBe(true);
    expect(
      scenarios
        .filter((scenario) => scenario.program.type === "urban-housing")
        .every(
          (scenario) =>
            scenario.generation?.useScreening.legalUse.housingSubtypeCode ===
            "HA-ED-A10-1-1",
        ),
    ).toBe(true);
    expect(types).not.toContain("multi-family");
  });

  it("creates review-traceable mixed candidates in semi-residential zoning", () => {
    const parcel = {
      ...residentialParcel("서울 영등포구 테스트 1"),
      zoning: "준주거지역",
      lotArea: 500,
    };
    const scenarios = generateScenariosForParcel(parcel);
    const types = new Set(scenarios.map((scenario) => scenario.program.type));

    expect(types).toEqual(
      new Set(["urban-housing", "office", "officetel", "retail"]),
    );
    expect(
      scenarios.every(
        (scenario) =>
          scenario.generation?.useScreening.status ===
          "local-ordinance-review",
      ),
    ).toBe(true);
  });

  it("returns no speculative candidates for an unclassified zoning label", () => {
    const parcel = {
      ...residentialParcel("서울 테스트 1"),
      zoning: "도시지역",
    };

    expect(generateScenariosForParcel(parcel)).toEqual([]);
    expect(
      generateScenariosForParcel(parcel, { scenarioTypes: ["officetel"] }),
    ).toEqual([]);
  });

  it("drops an apartment-form urban housing candidate in a seven-floor subzone", () => {
    const parcel = {
      ...residentialParcel("서울 마포구 테스트 1"),
      zoning: "제2종일반주거지역(7층 이하)",
      lotArea: 420,
    };

    expect(
      generateScenariosForParcel(parcel).some(
        (scenario) => scenario.program.type === "urban-housing",
      ),
    ).toBe(false);
  });

  it("does not auto-generate local-review candidates outside configured Seoul rules", () => {
    const parcel = {
      ...residentialParcel("경기 성남시 테스트 1"),
      zoning: "준주거지역",
      lotArea: 500,
    };

    expect(generateScenariosForParcel(parcel)).toEqual([]);
  });

  it("does not back-apply the bundled ruleset before its effective date", () => {
    expect(
      generateScenariosForParcel(
        residentialParcel("서울 도봉구 테스트 1"),
        { asOf: "2026-09-07" },
      ),
    ).toEqual([]);
  });
});
