import { describe, expect, it } from "vitest";
import {
  buildScenarioDecisionSupport,
  type ScenarioDecisionCandidate,
} from "@/lib/finance/scenario-decision-support";

function candidate(
  id: string,
  patch: Partial<ScenarioDecisionCandidate> = {},
): ScenarioDecisionCandidate {
  return {
    id,
    viable: true,
    profit: 100,
    downsideProfit: 70,
    npv: 60,
    irr: 18,
    requiredEquity: 80,
    maxExposure: 130,
    durationMonths: 24,
    regulatoryScore: 90,
    fundingStatus: "unverified",
    ...patch,
  };
}

describe("scenario decision support", () => {
  it("keeps trade-off candidates on the Pareto frontier without weights", () => {
    const result = buildScenarioDecisionSupport([
      candidate("PROFIT", {
        profit: 140,
        downsideProfit: 90,
        npv: 100,
        irr: 21,
        requiredEquity: 110,
        maxExposure: 170,
        durationMonths: 28,
        regulatoryScore: 88,
      }),
      candidate("CAPITAL", {
        profit: 110,
        downsideProfit: 95,
        npv: 80,
        irr: 24,
        requiredEquity: 65,
        maxExposure: 100,
        durationMonths: 20,
        regulatoryScore: 95,
      }),
      candidate("DOMINATED", {
        profit: 80,
        downsideProfit: 50,
        npv: 40,
        irr: 14,
        requiredEquity: 90,
        maxExposure: 140,
        durationMonths: 30,
        regulatoryScore: 82,
      }),
    ]);

    expect(result.method).toBe("pareto-no-weights");
    expect(result.paretoScenarioIds).toEqual(["PROFIT", "CAPITAL"]);
    expect(result.focusScenarioId).toBe("PROFIT");
    expect(result.focusMode).toBe("highest-profit");
    expect(
      result.entries.find((entry) => entry.scenarioId === "DOMINATED"),
    ).toMatchObject({
      status: "dominated",
      dominatedByScenarioIds: ["CAPITAL"],
    });
  });

  it("does not rank sale scenarios down for an inapplicable lease take-out DSCR", () => {
    const result = buildScenarioDecisionSupport([
      candidate("SALE", { profit: 130, irr: 22 }),
      candidate("LEASE", { profit: 100, irr: 19 }),
    ]);

    expect(result.focusScenarioId).toBe("SALE");
    expect(result.excludedMetrics).toEqual([
      expect.objectContaining({ metric: "lease-takeout-dscr" }),
    ]);
  });

  it("preserves zoning review items as advisories without excluding the candidate", () => {
    const result = buildScenarioDecisionSupport([
      candidate("REVIEW", {
        regulatoryReviewIssues: ["관할 조례의 세부 용도를 확인하세요."],
      }),
    ]);

    expect(result.paretoScenarioIds).toEqual(["REVIEW"]);
    expect(result.entries[0]).toMatchObject({
      status: "pareto",
      exclusionReasons: [],
      advisoryReasons: ["관할 조례의 세부 용도를 확인하세요."],
    });
    expect(result.warnings).toContain(
      "용도지역 스크리닝은 예비 후보 생성 근거이며 관할 조례·지구단위계획 확인 전에는 허가 가능 판정이 아닙니다.",
    );
  });

  it("excludes confirmed funding shortfalls and loss cases from the frontier", () => {
    const result = buildScenarioDecisionSupport([
      candidate("VALID"),
      candidate("SHORTFALL", {
        profit: 200,
        fundingStatus: "shortfall",
      }),
      candidate("LOSS", { profit: -10, downsideProfit: -30 }),
    ]);

    expect(result.paretoScenarioIds).toEqual(["VALID"]);
    expect(
      result.entries.find((entry) => entry.scenarioId === "SHORTFALL"),
    ).toMatchObject({ status: "ineligible" });
    expect(
      result.entries.find((entry) => entry.scenarioId === "LOSS")
        ?.exclusionReasons,
    ).toContain("현재 가정에서 세전 손실입니다.");
  });

  it("preserves a user-selected representative and reports its eligibility", () => {
    const result = buildScenarioDecisionSupport(
      [candidate("BEST", { profit: 160 }), candidate("SELECTED", { profit: -5 })],
      "SELECTED",
    );

    expect(result.focusScenarioId).toBe("SELECTED");
    expect(result.focusMode).toBe("explicit-selection");
    expect(
      result.entries.find((entry) => entry.scenarioId === "SELECTED")?.status,
    ).toBe("ineligible");
    expect(result.warnings).toContain(
      "사용자가 선택한 대표안은 비교 기준으로 유지되지만 파레토 후보 자격은 충족하지 못합니다.",
    );
  });

  it("falls back safely when an explicit focus ID is stale", () => {
    const result = buildScenarioDecisionSupport(
      [candidate("A", { profit: 90 }), candidate("B", { profit: 120 })],
      "MISSING",
    );

    expect(result.focusScenarioId).toBe("B");
    expect(result.focusMode).toBe("highest-profit");
  });

  it("uses least-loss fallback only when no candidate meets minimum conditions", () => {
    const result = buildScenarioDecisionSupport([
      candidate("LOSS-A", { profit: -40 }),
      candidate("LOSS-B", { profit: -10 }),
    ]);

    expect(result.paretoScenarioIds).toEqual([]);
    expect(result.focusScenarioId).toBe("LOSS-B");
    expect(result.focusMode).toBe("least-loss-fallback");
  });

  it("rejects duplicate candidate IDs because decision evidence would be ambiguous", () => {
    expect(() =>
      buildScenarioDecisionSupport([candidate("SAME"), candidate("SAME")]),
    ).toThrow("후보 ID는 서로 달라야 합니다");
  });
});
