import { describe, expect, it } from "vitest";
import type { ScenarioVM } from "@/lib/adapters/view-model";
import type { PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import type { PlanningScenario } from "@/lib/planning/types";
import { resolveStage3DashboardContext } from "@/lib/stage3/dashboard-model";

const planning = {
  id: "PLAN-1",
  projectId: "PROJECT-1",
  version: 3,
  name: "대표 계획안",
  checks: [
    { code: "bcr", label: "건폐율", status: "pass", message: "확인" },
    { code: "far", label: "용적률", status: "pass", message: "확인" },
    { code: "height", label: "높이", status: "pass", message: "확인" },
    { code: "parking", label: "주차", status: "pass", message: "확인" },
  ],
} as PlanningScenario;

const geometry = {
  projectId: "PROJECT-1",
  scenarioId: "PLAN-1",
  scenarioVersion: 3,
  validation: {
    status: "pass",
    representativeEligible: true,
    exportable: true,
    issues: [],
  },
} as unknown as PlanningGeometrySnapshot;

const finance = {
  id: "PLAN-1",
  recommended: false,
} as ScenarioVM;

describe("Stage 3 dashboard source contract", () => {
  it("blocks legacy dashboard fallback when no representative is confirmed", () => {
    const result = resolveStage3DashboardContext({
      projectId: "PROJECT-1",
      representativeScenarioId: null,
      representativeGeometrySnapshot: null,
      planningScenarios: [planning],
      financeScenarios: [{ id: "LEGACY", recommended: true } as ScenarioVM],
    });

    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.code).toBe("missing-representative");
  });

  it("uses the exact representative ID instead of the finance recommended flag", () => {
    const result = resolveStage3DashboardContext({
      projectId: "PROJECT-1",
      representativeScenarioId: "PLAN-1",
      representativeGeometrySnapshot: geometry,
      planningScenarios: [planning],
      financeScenarios: [
        { id: "LEGACY", recommended: true } as ScenarioVM,
        finance,
      ],
    });

    expect(result.ready).toBe(true);
    if (result.ready) expect(result.financeScenario.id).toBe("PLAN-1");
  });

  it("blocks a representative whose core legal source is still review-only", () => {
    const result = resolveStage3DashboardContext({
      projectId: "PROJECT-1",
      representativeScenarioId: "PLAN-1",
      representativeGeometrySnapshot: geometry,
      planningScenarios: [
        {
          ...planning,
          checks: planning.checks.map((check) =>
            check.code === "height"
              ? { ...check, status: "review" as const }
              : check
          ),
        },
      ],
      financeScenarios: [finance],
    });

    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.code).toBe("invalid-planning-checks");
  });

  it("blocks a stale geometry snapshot after the plan version changes", () => {
    const result = resolveStage3DashboardContext({
      projectId: "PROJECT-1",
      representativeScenarioId: "PLAN-1",
      representativeGeometrySnapshot: {
        ...geometry,
        scenarioVersion: 2,
      },
      planningScenarios: [planning],
      financeScenarios: [finance],
    });

    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.code).toBe("stale-geometry");
  });

  it("blocks a geometry failure even when financial data exists", () => {
    const result = resolveStage3DashboardContext({
      projectId: "PROJECT-1",
      representativeScenarioId: "PLAN-1",
      representativeGeometrySnapshot: {
        ...geometry,
        validation: {
          ...geometry.validation,
          status: "fail",
          representativeEligible: false,
        },
      },
      planningScenarios: [planning],
      financeScenarios: [finance],
    });

    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.code).toBe("invalid-geometry");
  });

  it("blocks mismatched financial results instead of showing another plan", () => {
    const result = resolveStage3DashboardContext({
      projectId: "PROJECT-1",
      representativeScenarioId: "PLAN-1",
      representativeGeometrySnapshot: geometry,
      planningScenarios: [planning],
      financeScenarios: [{ id: "OTHER" } as ScenarioVM],
    });

    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.code).toBe("missing-finance-scenario");
  });
});
