import { describe, expect, it } from "vitest";
import {
  classifyZoningFamily,
  screenZoningUse,
} from "@/lib/regulatory/zoning-use-screening";

describe("zoning use screening", () => {
  it("classifies exact residential subzones even when spacing or qualifiers exist", () => {
    expect(classifyZoningFamily("제2종 일반주거지역(7층 이하)"))
      .toBe("second-general-residential");
    expect(classifyZoningFamily("주거지역")).toBe("unknown");
  });

  it("uses the current Seoul snapshot for a quantified first-exclusive dagagu", () => {
    const single = screenZoningUse("제1종전용주거지역", "single-house", {
      address: "서울 종로구 테스트 1",
    });
    const multi = screenZoningUse("제1종전용주거지역", "multi-family", {
      address: "서울 종로구 테스트 1",
      residentialFloors: 3,
      useAreaSqm: 420,
      householdCount: 12,
    });
    const officetel = screenZoningUse("제1종전용주거지역", "officetel");

    expect(single).toMatchObject({
      jurisdictionCode: "KR-11",
      ordinanceCoverage: "seoul-current",
      status: "national-reference",
      autoGeneratable: true,
      decisionGrade: false,
      legalUse: { requestedCode: "BA-A1-1-A" },
    });
    expect(multi).toMatchObject({
      status: "seoul-ordinance-reference",
      autoGeneratable: true,
      conditionAssessment: { status: "pass" },
      legalUse: { requestedCode: "BA-A1-1-C" },
    });
    expect(officetel).toMatchObject({
      status: "unsupported-auto",
      autoGeneratable: false,
    });
    expect(single.sources.some((source) => source.title.includes("서울특별시")))
      .toBe(true);
  });

  it("requires an exact subtype for urban housing and retail product labels", () => {
    expect(screenZoningUse("제2종일반주거지역", "urban-housing")).toMatchObject({
      status: "building-use-input-required",
      autoGeneratable: false,
    });
    expect(screenZoningUse("제2종일반주거지역", "retail")).toMatchObject({
      status: "building-use-input-required",
      autoGeneratable: false,
    });

    expect(
      screenZoningUse("제2종일반주거지역", "urban-housing", {
        legalUseCode: "BA-A1-2-A",
        residentialFloors: 8,
        useAreaSqm: 900,
        householdCount: 28,
      }),
    ).toMatchObject({
      status: "national-reference",
      legalUse: { housingSubtypeCode: "HA-ED-A10-1-1" },
    });
    expect(
      screenZoningUse("제2종일반주거지역", "retail", {
        legalUseCode: "BA-A1-3-A",
        useAreaSqm: 900,
      }),
    ).toMatchObject({ status: "national-reference" });
  });

  it("blocks a product when statutory quantitative limits fail or are missing", () => {
    expect(screenZoningUse("제2종일반주거지역", "multi-family")).toMatchObject({
      status: "condition-input-required",
      autoGeneratable: false,
    });
    expect(
      screenZoningUse("제2종일반주거지역", "multi-family", {
        residentialFloors: 4,
        useAreaSqm: 661,
        householdCount: 20,
      }),
    ).toMatchObject({
      status: "condition-failed",
      autoGeneratable: false,
    });
    expect(
      screenZoningUse("제2종일반주거지역(7층 이하)", "urban-housing", {
        legalUseCode: "BA-A1-2-A",
        residentialFloors: 8,
        aboveGroundFloors: 8,
        useAreaSqm: 900,
        householdCount: 28,
      }),
    ).toMatchObject({ status: "condition-failed", autoGeneratable: false });
  });

  it("only auto-generates local-review uses when the Seoul ordinance is covered", () => {
    const seoul = screenZoningUse("준주거지역", "office", {
      address: "서울 영등포구 테스트 1",
      useAreaSqm: 1_200,
    });
    const unconfigured = screenZoningUse("준주거지역", "office", {
      address: "경기 성남시 테스트 1",
      useAreaSqm: 1_200,
    });

    expect(seoul).toMatchObject({
      status: "local-ordinance-review",
      autoGeneratable: true,
      jurisdictionCode: "KR-11",
    });
    expect(unconfigured).toMatchObject({
      status: "local-ordinance-review",
      autoGeneratable: false,
      ordinanceCoverage: "national-only",
    });
  });

  it("does not back-apply the current ruleset to an older analysis date", () => {
    expect(
      screenZoningUse("제2종일반주거지역", "single-house", {
        asOf: "2026-09-07",
      }),
    ).toMatchObject({
      status: "source-date-uncovered",
      autoGeneratable: false,
    });
  });

  it("does not auto-generate ambiguous coliving or unknown zoning uses", () => {
    expect(screenZoningUse("준주거지역", "coliving")).toMatchObject({
      status: "building-use-input-required",
      autoGeneratable: false,
    });
    expect(screenZoningUse("도시지역", "retail")).toMatchObject({
      zoningFamily: "unknown",
      status: "unknown",
      autoGeneratable: false,
    });
  });
});
