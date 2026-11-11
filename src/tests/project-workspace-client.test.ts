import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBlankPlanningScenario } from "@/lib/planning/scenario-utils";
import { useProjectStore } from "@/lib/stores/project-store";
import { useReviewStore } from "@/lib/stores/review-store";
import {
  applyProjectWorkspace,
  captureProjectWorkspace,
} from "@/lib/workspace/project-workspace-client";
import {
  buildRevenuePricingDraftKey,
  REVENUE_PRICING_INPUT_VERSION,
} from "@/lib/finance/revenue-contract";
import { projectWorkspaceFixture } from "@/tests/helpers/project-workspace-fixture";

const PROJECT_ID = "workspace-client-project";
const OTHER_PROJECT_ID = "workspace-other-project";

describe("project workspace client hydration", () => {
  beforeEach(() => {
    useProjectStore.setState(useProjectStore.getInitialState(), true);
    useReviewStore.setState(useReviewStore.getInitialState(), true);
  });

  afterEach(() => {
    useProjectStore.setState(useProjectStore.getInitialState(), true);
    useReviewStore.setState(useReviewStore.getInitialState(), true);
  });

  it("captures only the active project and restores it without erasing another project", () => {
    const payload = projectWorkspaceFixture(PROJECT_ID);
    const activePlan = createBlankPlanningScenario({
      projectId: PROJECT_ID,
      name: "활성 계획",
    });
    const otherPlan = createBlankPlanningScenario({
      projectId: OTHER_PROJECT_ID,
      name: "다른 프로젝트 계획",
    });
    const financeScenarioId = payload.projectData.scenarios[0].id;
    const activePricingKey = buildRevenuePricingDraftKey(
      PROJECT_ID,
      financeScenarioId,
    );
    const otherPricingKey = buildRevenuePricingDraftKey(
      OTHER_PROJECT_ID,
      otherPlan.id,
    );

    useProjectStore.setState({
      data: payload.projectData,
      planningScenarios: [activePlan, otherPlan],
      selectedPlanningScenarioId: activePlan.id,
      draftAssumptions: {
        [financeScenarioId]: { salePricePerSqM: 8_800_000 },
        [otherPlan.id]: { salePricePerSqM: 1 },
      },
      draftAcquisitionPrices: {
        [PROJECT_ID]: 123_456,
        [OTHER_PROJECT_ID]: 99,
      },
      financialSources: {
        [PROJECT_ID]: {},
        [OTHER_PROJECT_ID]: {},
      },
      revenuePricingDrafts: {
        [activePricingKey]: {
          version: REVENUE_PRICING_INPUT_VERSION,
          projectId: PROJECT_ID,
          scenarioId: financeScenarioId,
          pools: { retailSale: { baseUnitPriceWon: 7_700_000 } },
          updatedAt: "2026-09-09T12:00:00.000Z",
        },
        [otherPricingKey]: {
          version: REVENUE_PRICING_INPUT_VERSION,
          projectId: OTHER_PROJECT_ID,
          scenarioId: otherPlan.id,
          pools: { officeLease: { adjustments: { floor: 1.1 } } },
          updatedAt: "2026-09-09T12:00:00.000Z",
        },
      },
    });

    const captured = captureProjectWorkspace(PROJECT_ID);
    expect(captured).not.toBeNull();
    expect(captured?.planningScenarios.map((scenario) => scenario.id)).toEqual([
      activePlan.id,
    ]);
    expect(captured?.draftAssumptions).toEqual({
      [financeScenarioId]: { salePricePerSqM: 8_800_000 },
    });
    expect(captured?.draftAcquisitionPrice).toBe(123_456);
    expect(captured?.revenuePricingDrafts).toEqual([
      expect.objectContaining({
        projectId: PROJECT_ID,
        pools: { retailSale: { baseUnitPriceWon: 7_700_000 } },
      }),
    ]);

    const next = structuredClone(captured!);
    next.draftAcquisitionPrice = 654_321;
    next.draftAssumptions[financeScenarioId] = { salePricePerSqM: 9_900_000 };
    next.revenuePricingDrafts[0].pools.retailSale = {
      baseUnitPriceWon: 8_800_000,
      adjustments: { location: 1.05 },
    };
    applyProjectWorkspace(next);

    const restored = useProjectStore.getState();
    expect(restored.data?.parcel.id).toBe(PROJECT_ID);
    expect(restored.planningScenarios.map((scenario) => scenario.id)).toEqual([
      otherPlan.id,
      activePlan.id,
    ]);
    expect(restored.draftAssumptions[otherPlan.id]).toEqual({
      salePricePerSqM: 1,
    });
    expect(restored.draftAssumptions[financeScenarioId]).toEqual({
      salePricePerSqM: 9_900_000,
    });
    expect(restored.draftAcquisitionPrices).toMatchObject({
      [PROJECT_ID]: 654_321,
      [OTHER_PROJECT_ID]: 99,
    });
    expect(restored.revenuePricingDrafts[activePricingKey].pools.retailSale).toEqual({
      baseUnitPriceWon: 8_800_000,
      adjustments: { location: 1.05 },
    });
    expect(restored.revenuePricingDrafts[otherPricingKey].projectId).toBe(
      OTHER_PROJECT_ID,
    );
  });
});
