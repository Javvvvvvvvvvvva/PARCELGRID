import { describe, expect, it } from "vitest";
import {
  evaluateSunlightRegulation,
  resolveSunlightRuleSet,
  toSunlightGeometryProfile,
  type SunlightRegulationInput,
} from "@/lib/regulatory/sunlight-rules";

function seoulResidentialInput(
  overrides: Partial<SunlightRegulationInput> = {}
): SunlightRegulationInput {
  return {
    context: {
      address: "서울특별시 도봉구 쌍문동 281-23",
      asOf: "2026-09-08",
    },
    zoning: "제2종일반주거지역",
    zoningStatus: "source-backed",
    buildingHeightM: 12,
    floorsAbove: 3,
    legalUse: "detached-house",
    legalUseStatus: "source-backed",
    northBoundary: {
      adjacentZoning: "제2종일반주거지역",
      adjacentZoningStatus: "source-backed",
      separatorType: "none",
      separatorStatus: "source-backed",
    },
    daylight: {
      sameLotBuildingCount: 1,
      sameLotBuildingCountStatus: "source-backed",
    },
    ...overrides,
  };
}

describe("versioned sunlight and daylight regulation engine", () => {
  it("resolves the current Seoul rule set with official source metadata", () => {
    const resolved = resolveSunlightRuleSet({
      address: "서울특별시 중구 세종대로",
      asOf: "2026-09-08",
    });

    expect(resolved.ruleSet.id).toBe("sunlight-kr-seoul-2026-03-30");
    expect(resolved.status).toBe("source-backed");
    expect(resolved.ruleSet.sources.map((source) => source.sourceRef)).toEqual(
      expect.arrayContaining(["제35조", "제61조", "제86조"])
    );
  });

  it("keeps the 1.5m north setback for a 2-floor 7.9m building in Seoul", () => {
    const result = evaluateSunlightRegulation(
      seoulResidentialInput({
        buildingHeightM: 7.9,
        floorsAbove: 2,
      })
    );

    expect(result.north.exception).toBe("none");
    expect(result.north.statutoryDistanceM).toBe(1.5);
    expect(result.north.effectiveDistanceM).toBe(1.5);
    expect(result.north.geometryApplies).toBe(true);
    expect(result.north.requirementDecisionGrade).toBe(true);
  });

  it("does not auto-exempt a low-rise building when the local ordinance is unknown", () => {
    const result = evaluateSunlightRegulation({
      ...seoulResidentialInput({
        context: {
          address: "부산광역시 중구 중앙대로",
          asOf: "2026-09-08",
        },
        buildingHeightM: 7.9,
        floorsAbove: 2,
      }),
    });

    expect(result.rule.status).toBe("reference-only");
    expect(result.north.geometryApplies).toBe(true);
    expect(result.north.effectiveDistanceM).toBe(1.5);
    expect(result.north.requirementDecisionGrade).toBe(false);
    expect(result.north.warnings.some((warning) =>
      warning.includes("관할 건축 조례")
    )).toBe(true);
  });

  it("marks a confirmed non-residential target zoning as not applicable", () => {
    const result = evaluateSunlightRegulation(
      seoulResidentialInput({
        zoning: "일반상업지역",
        legalUse: "general-building",
      })
    );

    expect(result.north.applicability).toBe("not-applicable");
    expect(result.north.exception).toBe("target-zoning");
    expect(result.north.geometryApplies).toBe(false);
    expect(result.north.requirementDecisionGrade).toBe(true);
  });

  it("uses a confirmed north-adjacent non-residential zoning exception", () => {
    const base = seoulResidentialInput();
    const result = evaluateSunlightRegulation({
      ...base,
      northBoundary: {
        ...base.northBoundary,
        adjacentZoning: "일반상업지역",
        adjacentZoningStatus: "expert-approved",
      },
    });

    expect(result.north.applicability).toBe("not-applicable");
    expect(result.north.exception).toBe("adjacent-zoning");
    expect(result.north.geometryApplies).toBe(false);
  });

  it("uses the opposite edge for north sunlight and centerline for communal daylight", () => {
    const base = seoulResidentialInput();
    const result = evaluateSunlightRegulation({
      ...base,
      legalUse: "apartment",
      northBoundary: {
        ...base.northBoundary,
        separatorType: "road",
        separatorStatus: "source-backed",
        separatorWidthM: 4,
        separatorWidthStatus: "source-backed",
      },
    });

    expect(result.north.statutoryDistanceM).toBe(6);
    expect(result.north.boundaryOffsetM).toBe(4);
    expect(result.north.effectiveDistanceM).toBe(2);
    expect(result.north.boundaryBasis).toBe("opposite-edge");
    expect(result.daylight.boundary.statutoryDistanceM).toBe(6);
    expect(result.daylight.boundary.boundaryOffsetM).toBe(2);
    expect(result.daylight.boundary.effectiveDistanceM).toBe(4);
    expect(result.daylight.boundary.boundaryBasis).toBe("centerline");
  });

  it("does not reduce geometry for a user-entered separator width", () => {
    const base = seoulResidentialInput();
    const result = evaluateSunlightRegulation({
      ...base,
      northBoundary: {
        ...base.northBoundary,
        separatorType: "road",
        separatorStatus: "user-entered",
        separatorWidthM: 4,
        separatorWidthStatus: "user-entered",
      },
    });
    const profile = toSunlightGeometryProfile(result);

    expect(result.north.boundaryOffsetM).toBe(0);
    expect(result.north.effectiveDistanceM).toBe(6);
    expect(profile.boundaryOffsetM).toBe(0);
    expect(profile.decisionGrade).toBe(false);
  });

  it("applies Seoul's 1m daylight boundary to a multi-unit house", () => {
    const result = evaluateSunlightRegulation(
      seoulResidentialInput({
        legalUse: "multi-unit-house",
        buildingHeightM: 15,
      })
    );

    expect(result.daylight.boundary.applicability).toBe("applies");
    expect(result.daylight.boundary.statutoryDistanceM).toBe(1);
    expect(result.daylight.boundary.requirementDecisionGrade).toBe(true);
  });

  it("uses one-quarter of height for communal housing in a quasi-residential zone", () => {
    const result = evaluateSunlightRegulation(
      seoulResidentialInput({
        zoning: "준주거지역",
        legalUse: "apartment",
        buildingHeightM: 16,
      })
    );

    expect(result.north.applicability).toBe("not-applicable");
    expect(result.daylight.boundary.statutoryDistanceM).toBe(4);
  });

  it("calculates same-lot urban housing and high-to-low distances", () => {
    const base = seoulResidentialInput({
      legalUse: "urban-housing",
      buildingHeightM: 20,
    });
    const urban = evaluateSunlightRegulation({
      ...base,
      daylight: {
        sameLotBuildingCount: 2,
        sameLotBuildingCountStatus: "source-backed",
        sameLotRelation: "urban-complex",
        sameLotRelationStatus: "source-backed",
      },
    });
    const highToLow = evaluateSunlightRegulation({
      ...base,
      daylight: {
        sameLotBuildingCount: 2,
        sameLotBuildingCountStatus: "source-backed",
        sameLotRelation: "high-opening-to-low",
        sameLotRelationStatus: "source-backed",
        facingBuildingHeightM: 8,
        facingBuildingHeightStatus: "source-backed",
      },
    });

    expect(urban.daylight.sameLot.statutoryDistanceM).toBe(5);
    expect(highToLow.daylight.sameLot.statutoryDistanceM).toBe(10);
  });

  it("keeps a historical date reference-only when registered sources were not effective", () => {
    const resolved = resolveSunlightRuleSet({
      address: "서울특별시 중구 세종대로",
      asOf: "2026-01-01",
    });

    expect(resolved.status).toBe("reference-only");
    expect(resolved.warnings[0]).toContain("규칙 이력이 완전하지 않아");
  });
});
