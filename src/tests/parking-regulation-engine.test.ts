import { describe, expect, it } from "vitest";
import {
  calculateParkingRequirement,
  resolveParkingRuleSet,
} from "@/lib/regulatory/parking-rules";

describe("versioned parking regulation engine", () => {
  const mixContext = { jurisdictionCode: "KR-11", asOf: "2026-10-19" };

  it.each([
    [20.75, 43.5, 170],
    [26.45, 54.9, 215.6],
  ])("sums mixed six-dwelling bands before rounding (%s/%s sqm)", (small, large, total) => {
    const result = calculateParkingRequirement({ context: mixContext, uses: [{
      use: "multi-family", facilityAreaSqm: 305, unitCount: 6,
      exclusiveAreaSqm: total, exclusiveAreaStatus: "source-backed",
      dwellingGroups: [
        { unitCount: 4, exclusiveAreaPerUnitSqm: small },
        { unitCount: 2, exclusiveAreaPerUnitSqm: large },
      ],
    }] });
    expect(result.requiredCars).toBe(4);
    expect(result.components[0].unitMinimumCars).toBe(3.6);
    expect(result.components[0].distributionStatus).toBe("per-dwelling");
    expect(result.decisionGrade).toBe(true);
  });

  it("keeps the85sqm area denominators separate within one building", () => {
    const result = calculateParkingRequirement({ context: mixContext, uses: [{
      use: "multi-family", facilityAreaSqm: 150, unitCount: 2,
      exclusiveAreaStatus: "expert-approved",
      dwellingGroups: [{ unitCount: 1, exclusiveAreaPerUnitSqm: 30 }, { unitCount: 1, exclusiveAreaPerUnitSqm: 90 }],
    }] });
    expect(result.components[0].areaRuleCars).toBeCloseTo(30 / 75 + 90 / 65, 2);
    expect(result.components[0].denominatorSqmPerCar).toBeUndefined();
    expect(result.requiredCars).toBe(2);
  });

  it("distinguishes the30sqm boundary for ordinary and urban housing", () => {
    const base = { facilityAreaSqm: 180, unitCount: 6, exclusiveAreaStatus: "source-backed" as const,
      dwellingGroups: [{ unitCount: 6, exclusiveAreaPerUnitSqm: 30 }] };
    expect(calculateParkingRequirement({ context: mixContext, uses: [{ ...base, use: "multi-family" }] }).requiredCars).toBe(3);
    expect(calculateParkingRequirement({ context: mixContext, uses: [{ ...base, use: "urban-housing" }] }).requiredCars).toBe(4);
  });

  it("does not certify an aggregate area as an observed equal-size distribution", () => {
    const result = calculateParkingRequirement({ context: mixContext, uses: [{
      use: "multi-family", facilityAreaSqm: 200, unitCount: 6,
      exclusiveAreaSqm: 174, exclusiveAreaStatus: "source-backed",
    }] });
    expect(result.requiredCars).toBe(3);
    expect(result.estimated).toBe(true);
    expect(result.decisionGrade).toBe(false);
    expect(result.components[0].distributionStatus).toBe("equal-area-assumption");
  });

  it.each([
    [{ unitCount: 5, exclusiveAreaPerUnitSqm: 29 }],
    [{ unitCount: 6, exclusiveAreaPerUnitSqm: 28 }],
    [{ unitCount: 6, exclusiveAreaPerUnitSqm: NaN }],
    [{ unitCount: 6, exclusiveAreaPerUnitSqm: -29 }],
    [],
  ])("does not certify inconsistent dwelling groups %j", (...groups) => {
    const result = calculateParkingRequirement({ context: mixContext, uses: [{
      use: "multi-family", facilityAreaSqm: 200, unitCount: 6,
      exclusiveAreaSqm: 174, exclusiveAreaStatus: "source-backed", dwellingGroups: groups,
    }] });
    expect(result.decisionGrade).toBe(false);
    expect(result.components[0].distributionStatus).toBe("invalid");
    expect(Number.isFinite(result.requiredCars)).toBe(true);
  });

  it("resolves the current Seoul rule set with auditable source metadata", () => {
    const resolved = resolveParkingRuleSet({
      address: "서울특별시 도봉구 쌍문동 281-23",
      asOf: "2026-09-08",
    });

    expect(resolved.ruleSet.id).toBe("parking-kr-seoul-2026-07-13");
    expect(resolved.ruleSet.jurisdictionCode).toBe("KR-11");
    expect(resolved.ruleSet.effectiveFrom).toBe("2026-07-13");
    expect(resolved.status).toBe("source-backed");
    expect(resolved.ruleSet.sources.some((source) =>
      source.sourceUrl.includes("ordinSeq=2147707")
    )).toBe(true);
  });

  it("selects the October 2026 Seoul ordinance snapshot on its effective date", () => {
    const resolved = resolveParkingRuleSet({
      address: "서울특별시 도봉구 쌍문동 281-23",
      asOf: "2026-10-17",
    });

    expect(resolved.ruleSet.id).toBe("parking-kr-seoul-2026-10-01");
    expect(resolved.ruleSet.effectiveFrom).toBe("2026-10-01");
    expect(resolved.status).toBe("source-backed");
    expect(resolved.ruleSet.sources.some((source) =>
      source.sourceUrl.includes("ordinSeq=2171833")
    )).toBe(true);
  });

  it("does not call a snapshot source-backed before every cited source is effective", () => {
    const resolved = resolveParkingRuleSet({
      address: "서울특별시 도봉구 쌍문동 281-23",
      asOf: "2026-07-20",
    });

    expect(resolved.status).toBe("reference-only");
    expect(resolved.warnings).toContain(
      "2026-07-20에 적용되는 주차 규칙 이력이 완전하지 않아 2026-08-28 이후 출처를 포함한 현행 규칙을 참고값으로 사용했습니다."
    );
  });

  it("keeps Seoul office and neighborhood-living ratios separate", () => {
    const office = calculateParkingRequirement({
      context: { address: "서울특별시 중구 세종대로", asOf: "2026-09-08" },
      uses: [{ use: "office", facilityAreaSqm: 100 }],
    });
    const retail = calculateParkingRequirement({
      context: { address: "서울특별시 중구 세종대로", asOf: "2026-09-08" },
      uses: [{ use: "retail", facilityAreaSqm: 100 }],
    });

    expect(office.requiredCars).toBe(1);
    expect(office.components[0].denominatorSqmPerCar).toBe(100);
    expect(retail.requiredCars).toBe(0);
    expect(retail.components[0].denominatorSqmPerCar).toBe(134);
  });

  it("rounds combined non-housing uses once instead of ceilling each use", () => {
    const result = calculateParkingRequirement({
      context: { jurisdictionCode: "KR-11", asOf: "2026-09-08" },
      uses: [
        { use: "office", facilityAreaSqm: 60 },
        { use: "retail", facilityAreaSqm: 70 },
      ],
    });

    expect(result.components.map((component) => component.rawCars)).toEqual([
      0.6,
      0.52,
    ]);
    expect(result.requiredCars).toBe(1);
  });

  it("applies the annex rounding rule above 150 square metres for a detached house", () => {
    const context = { jurisdictionCode: "KR-11" as const, asOf: "2026-09-08" };

    expect(calculateParkingRequirement({
      context,
      uses: [{ use: "single-house", facilityAreaSqm: 151, unitCount: 1 }],
    }).requiredCars).toBe(1);
    expect(calculateParkingRequirement({
      context,
      uses: [{ use: "single-house", facilityAreaSqm: 200, unitCount: 1 }],
    }).requiredCars).toBe(2);
  });

  it("uses the greater of the Seoul area ratio and per-household minimum", () => {
    const result = calculateParkingRequirement({
      context: { jurisdictionCode: "KR-11", asOf: "2026-09-08" },
      uses: [
        {
          use: "multi-family",
          facilityAreaSqm: 520,
          unitCount: 10,
          exclusiveAreaSqm: 400,
          exclusiveAreaStatus: "source-backed",
          dwellingGroups: [{ unitCount: 10, exclusiveAreaPerUnitSqm: 40 }],
        },
      ],
    });

    expect(result.requiredCars).toBe(8);
    expect(result.components[0].areaRuleCars).toBe(5.33);
    expect(result.components[0].unitMinimumCars).toBe(8);
    expect(result.decisionGrade).toBe(true);
    expect(result.estimated).toBe(false);
  });

  it("preserves a user-entered exclusive area without upgrading it to decision-grade", () => {
    const result = calculateParkingRequirement({
      context: { jurisdictionCode: "KR-11", asOf: "2026-09-08" },
      uses: [
        {
          use: "multi-family",
          facilityAreaSqm: 80,
          unitCount: 2,
          exclusiveAreaSqm: 60,
          exclusiveAreaStatus: "user-entered",
          dwellingGroups: [{ unitCount: 2, exclusiveAreaPerUnitSqm: 30 }],
        },
      ],
    });

    expect(result.components[0].exclusiveAreaStatus).toBe("user-entered");
    expect(result.estimated).toBe(false);
    expect(result.decisionGrade).toBe(false);
    expect(result.warnings).toContain(
      "주거 전용면적이 사용자 입력 상태라 도면 근거 또는 전문가 승인 전에는 예비값입니다."
    );
  });

  it("does not present an estimated exclusive area as decision-grade", () => {
    const result = calculateParkingRequirement({
      context: { jurisdictionCode: "KR-11", asOf: "2026-09-08" },
      uses: [
        { use: "multi-family", facilityAreaSqm: 400, unitCount: 8 },
      ],
    });

    expect(result.estimated).toBe(true);
    expect(result.decisionGrade).toBe(false);
    expect(result.warnings).toContain(
      "주거 전용면적이 없어 시설면적의 75%를 사용한 예비값입니다."
    );
  });

  it("keeps the national table reference-only when the local ordinance is unknown", () => {
    const result = calculateParkingRequirement({
      context: { address: "부산광역시 중구 중앙대로", asOf: "2026-09-08" },
      uses: [{ use: "office", facilityAreaSqm: 150 }],
    });

    expect(result.rule.status).toBe("reference-only");
    expect(result.decisionGrade).toBe(false);
    expect(result.warnings).toContain(
      "관할 지방자치단체의 현행 주차 조례가 등록되지 않아 국가 기준 참고값만 계산했습니다."
    );
  });
});
