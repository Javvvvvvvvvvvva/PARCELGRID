import { describe, expect, it } from "vitest";
import {
  evaluateBuildingUseConditions,
  getBuildingUse,
  resolveBuildingUse,
} from "@/lib/regulatory/building-use-catalog";

it("keeps ordinary multi-unit housing separate from urban housing subtypes", () => {
  const ordinary = resolveBuildingUse("multi-family", "BA-A1-2-C");
  expect(ordinary.status).toBe("exact");
  expect(ordinary.primaryUse?.limits.maxResidentialFloors).toBe(4);
  expect(ordinary.housingSubtypeCode).toBeUndefined();
  expect(resolveBuildingUse("multi-family").primaryUse?.code).toBe("BA-A1-1-C");
  expect(resolveBuildingUse("urban-housing", "BA-A1-2-C").housingSubtypeCode).toBe("HA-ED-A10-1-3");
});
describe("building use catalog", () => {
  it("maps unambiguous products to exact Building Act Appendix 1 codes", () => {
    expect(resolveBuildingUse("single-house")).toMatchObject({
      status: "exact",
      requestedCode: "BA-A1-1-A",
      primaryUse: { label: "단독주택" },
    });
    expect(resolveBuildingUse("multi-family")).toMatchObject({
      status: "exact",
      requestedCode: "BA-A1-1-C",
      primaryUse: { label: "다가구주택" },
    });
    expect(resolveBuildingUse("officetel")).toMatchObject({
      status: "exact",
      requestedCode: "BA-A1-14-B-2",
    });
  });

  it("requires a subtype for commercial product labels and urban housing", () => {
    expect(resolveBuildingUse("retail")).toMatchObject({
      status: "requires-subtype",
      alternatives: ["BA-A1-3-A"],
    });
    expect(resolveBuildingUse("coliving")).toMatchObject({
      status: "requires-subtype",
      alternatives: ["BA-A1-1-B", "BA-A1-2-D-2", "BA-A1-4-GEO"],
    });
    expect(resolveBuildingUse("urban-housing", "BA-A1-2-A")).toMatchObject({
      status: "exact",
      housingSubtypeCode: "HA-ED-A10-1-1",
      primaryUse: { label: "아파트" },
    });
  });

  it("rejects a legal code that is incompatible with the product", () => {
    expect(resolveBuildingUse("office", "BA-A1-1-A")).toMatchObject({
      status: "incompatible",
      requestedCode: "BA-A1-1-A",
    });
  });

  it("enforces the statutory dagagu floor, area, and household limits", () => {
    const dagagu = getBuildingUse("BA-A1-1-C");
    expect(
      evaluateBuildingUseConditions(dagagu, {
        residentialFloors: 3,
        useAreaSqm: 660,
        householdCount: 19,
      }),
    ).toMatchObject({ status: "pass" });

    const failed = evaluateBuildingUseConditions(dagagu, {
      residentialFloors: 4,
      useAreaSqm: 661,
      householdCount: 20,
    });
    expect(failed.status).toBe("fail");
    expect(failed.checks.filter((check) => check.status === "fail")).toHaveLength(3);
  });

  it("does not treat missing quantitative facts as a pass", () => {
    expect(evaluateBuildingUseConditions(getBuildingUse("BA-A1-1-C"))).toMatchObject({
      status: "missing-input",
    });
    expect(
      evaluateBuildingUseConditions(getBuildingUse("BA-A1-14-B-1"), {
        useAreaSqm: 499.9,
      }).status,
    ).toBe("fail");
  });
});
