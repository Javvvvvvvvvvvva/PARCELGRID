import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  buildLeaseRollDraftKey,
  LEASE_ROLL_VERSION,
  type LeaseRollDraft,
} from "@/lib/finance/lease-roll-contract";
import { createBlankPlanningScenario } from "@/lib/planning/scenario-utils";
import type { PlanningScenario } from "@/lib/planning/types";
import { useProjectStore } from "@/lib/stores/project-store";
import { analysisReferenceFixture } from "./helpers/analysis-reference-fixture";
import { projectWorkspaceFixture } from "./helpers/project-workspace-fixture";

const P1 = "isolation-P1";
const P2 = "isolation-P2";
const ID = "IV-S1";
const AT = "2026-11-01T12:00:00.000Z";
const FOREIGN_KEY = buildLeaseRollDraftKey(P1, ID);
const ACTIVE_KEY = buildLeaseRollDraftKey(P2, ID);
type Store = ReturnType<typeof useProjectStore.getState>;

function plan(projectId: string | undefined, id = ID): PlanningScenario {
  const scenario = createBlankPlanningScenario({
    projectId,
    name: projectId === P1 ? "Foreign plan" : "Active plan",
    acquisitionCostManwon: projectId === P1 ? 11111 : 22222,
  });
  return {
    ...scenario,
    id,
    status: "saved",
    version: projectId === P1 ? 17 : 3,
    createdAt: AT,
    updatedAt: AT,
    placement: { ...scenario.placement, offsetXM: projectId === P1 ? 7 : 0 },
    economicsPreview: {
      ...scenario.economicsPreview,
      status: "estimated",
      calculatedAt: AT,
    },
  };
}

function leaseDraft(projectId: string, scenarioId = ID): LeaseRollDraft {
  return {
    version: LEASE_ROLL_VERSION,
    projectId,
    scenarioId,
    sourceBasis: (projectId === P1 ? "a" : "b").repeat(64),
    revision: projectId === P1 ? 4 : 1,
    updatedAt: AT,
    calendarStart: "2026-11-01",
    rows: [],
  };
}

function seedCollision(legacy = false) {
  const foreign = plan(P1);
  const active = plan(legacy ? undefined : P2);
  const data = projectWorkspaceFixture(P2).projectData;
  const leaseRollDrafts = {
    [FOREIGN_KEY]: leaseDraft(P1),
    [ACTIVE_KEY]: leaseDraft(P2),
  };
  // Workspace loading retains foreign plans before the newly active project's plans.
  useProjectStore.setState({
    data,
    planningScenarios: [foreign, active],
    selectedPlanningScenarioId: ID,
    activeScenarioId: ID,
    leaseRollDrafts,
    draftAssumptions: { [ID]: { salePricePerSqM: 1234 } },
    draftAcquisitionPrices: { [P1]: 11111, [P2]: 22222 },
  });
  return { foreign, active, data, leaseRollDrafts };
}

function expectForeignUnchanged(foreign: PlanningScenario, before: PlanningScenario) {
  const retained = useProjectStore.getState().planningScenarios.find(
    scenario => scenario.projectId === P1 && scenario.id === foreign.id,
  );
  expect(retained).toBe(foreign);
  expect(retained).toEqual(before);
}

function expectFinanceUnchanged(before: Store) {
  const state = useProjectStore.getState();
  expect(state.data).toEqual(before.data);
  expect(state.draftAssumptions).toEqual(before.draftAssumptions);
  expect(state.draftAcquisitionPrices).toEqual(before.draftAcquisitionPrices);
  expect(state.financialSources).toEqual(before.financialSources);
  expect(state.revenuePricingDrafts).toEqual(before.revenuePricingDrafts);
  expect(state.expertTaxContracts).toEqual(before.expertTaxContracts);
  expect(state.stage3FeasibilitySnapshots).toEqual(before.stage3FeasibilitySnapshots);
}

const targetedActions = [
  { name: "draft edit", run: (state: Store) => state.editPlanningScenarioDraft(ID, { name: "Edited" }), result: undefined },
  { name: "saved update", run: (state: Store) => state.updatePlanningScenario(ID, { name: "Updated" }), result: undefined },
  { name: "delete", run: (state: Store) => state.removePlanningScenario(ID), result: undefined },
  { name: "duplicate", run: (state: Store) => state.duplicatePlanningScenario(ID), result: null },
  { name: "select", run: (state: Store) => state.selectPlanningScenario(ID), result: undefined },
  { name: "verified representative", run: (state: Store) => state.setRepresentativePlanningScenarioId(ID), result: false },
  { name: "preliminary representative", run: (state: Store) => state.setRepresentativePlanningScenarioId(ID, "preliminary-analysis"), result: false },
];

beforeEach(() => useProjectStore.setState(useProjectStore.getInitialState(), true));
afterEach(() => useProjectStore.setState(useProjectStore.getInitialState(), true));

describe.each([
  { ownership: "explicit active project", legacy: false },
  { ownership: "legacy missing projectId", legacy: true },
])("same-ID plans with $ownership", ({ legacy }) => {
  it("edits only the active draft and invalidates only its economics", () => {
    const { foreign, active } = seedCollision(legacy);
    const foreignBefore = structuredClone(foreign);
    const before = useProjectStore.getState();
    const floorPrograms = structuredClone(active.floorPrograms);
    floorPrograms[0].zones[0].areaSqm = 84;
    before.editPlanningScenarioDraft(ID, {
      name: "Active draft",
      floorPrograms,
      placement: { ...active.placement, offsetXM: 2 },
    });
    const state = useProjectStore.getState();
    expectForeignUnchanged(foreign, foreignBefore);
    expect(state.planningScenarios[1]).toMatchObject({
      id: ID, projectId: P2, name: "Active draft", status: "draft",
      version: active.version, createdAt: AT, floorPrograms,
      placement: { offsetXM: 2 },
      economicsPreview: { ...active.economicsPreview, status: "stale" },
    });
    expect(state.activeScenarioId).toBeNull();
    expect(state.leaseRollDrafts).toEqual(before.leaseRollDrafts);
    expectFinanceUnchanged(before);
  });

  it("saves only the active version and economics patch", () => {
    const { foreign, active } = seedCollision(legacy);
    const foreignBefore = structuredClone(foreign);
    const before = useProjectStore.getState();
    const economicsPreview = { ...active.economicsPreview, profitManwon: 9000 };
    before.updatePlanningScenario(ID, { name: "Saved active plan", status: "saved", economicsPreview });
    expectForeignUnchanged(foreign, foreignBefore);
    expect(useProjectStore.getState().planningScenarios[1]).toMatchObject({
      id: ID, projectId: P2, name: "Saved active plan", status: "saved",
      version: active.version + 1, createdAt: AT, economicsPreview,
    });
    expect(useProjectStore.getState().leaseRollDrafts).toEqual(before.leaseRollDrafts);
    expectFinanceUnchanged(before);
  });

  it("duplicates the active plan's geometry and economics without sharing drafts", () => {
    const { foreign, active } = seedCollision(legacy);
    const foreignBefore = structuredClone(foreign);
    const activeBefore = structuredClone(active);
    const before = useProjectStore.getState();
    const copyId = before.duplicatePlanningScenario(ID, "Active copy");
    const state = useProjectStore.getState();
    expect(copyId).toBeTypeOf("string");
    expect(copyId).not.toBe(ID);
    const copy = state.planningScenarios.find(scenario => scenario.id === copyId)!;
    expect(copy).toMatchObject({
      projectId: P2, name: "Active copy", baseScenarioId: ID, version: 1,
      status: "draft", placement: active.placement,
      economicsPreview: { acquisitionCostManwon: 22222, status: "stale" },
    });
    expect(copy.floorPrograms[0].id).not.toBe(active.floorPrograms[0].id);
    expect(copy.floorPrograms[0].zones[0].areaSqm).toBe(active.floorPrograms[0].zones[0].areaSqm);
    expect(copy.floorPrograms[0].zones[0]).not.toBe(active.floorPrograms[0].zones[0]);
    expect(state.selectedPlanningScenarioId).toBe(copyId);
    expect(state.planningScenarios).toHaveLength(3);
    expect(state.planningScenarios[1]).toEqual(activeBefore);
    expectForeignUnchanged(foreign, foreignBefore);
    expect(state.leaseRollDrafts).toEqual(before.leaseRollDrafts);
    expectFinanceUnchanged(before);
  });

  it("deletes only the active plan and lease draft, selecting an active fallback", () => {
    const { foreign, leaseRollDrafts } = seedCollision(legacy);
    const foreignBefore = structuredClone(foreign);
    const remaining = plan(P2, "active-remaining");
    const remainingKey = buildLeaseRollDraftKey(P2, remaining.id);
    const remainingDraft = leaseDraft(P2, remaining.id);
    useProjectStore.setState({
      planningScenarios: [...useProjectStore.getState().planningScenarios, remaining],
      representativePlanningScenarioId: ID,
      representativeParcelBasisHash: "old-active-basis",
      leaseRollDrafts: { ...leaseRollDrafts, [remainingKey]: remainingDraft },
    });
    const before = useProjectStore.getState();
    before.removePlanningScenario(ID);
    const state = useProjectStore.getState();
    expect(state.planningScenarios).toEqual([foreign, remaining]);
    expectForeignUnchanged(foreign, foreignBefore);
    expect(state.leaseRollDrafts).toEqual({
      [FOREIGN_KEY]: leaseRollDrafts[FOREIGN_KEY], [remainingKey]: remainingDraft,
    });
    expect(state.selectedPlanningScenarioId).toBe(remaining.id);
    expect(state.activeScenarioId).toBeNull();
    expect(state.representativePlanningScenarioId).toBeNull();
    expect(state.representativeParcelBasisHash).toBeNull();
    expectFinanceUnchanged(before);
  });

  it("selects the active or legacy plan and allows an explicit deselection", () => {
    seedCollision(legacy);
    useProjectStore.setState({ selectedPlanningScenarioId: null });
    const before = useProjectStore.getState();
    before.selectPlanningScenario(ID);
    expect(useProjectStore.getState().selectedPlanningScenarioId).toBe(ID);
    before.selectPlanningScenario(null);
    expect(useProjectStore.getState().selectedPlanningScenarioId).toBeNull();
    expect(useProjectStore.getState().planningScenarios).toEqual(before.planningScenarios);
    expectFinanceUnchanged(before);
  });
});

describe("unresolvable project-scoped targets", () => {
  describe.each(["foreign-only ID", "no active project", "ambiguous active ID"])("%s", kind => {
    it.each(targetedActions)("$name fails closed", ({ run, result }) => {
      const { foreign, active } = seedCollision();
      if (kind === "foreign-only ID") {
        useProjectStore.setState({ planningScenarios: [foreign, { ...active, id: "other-active" }] });
      } else if (kind === "no active project") {
        useProjectStore.setState({ data: null });
      } else {
        useProjectStore.setState({ planningScenarios: [foreign, active, plan(undefined)] });
      }
      useProjectStore.setState({ selectedPlanningScenarioId: null });
      const before = useProjectStore.getState();
      const plansBefore = structuredClone(before.planningScenarios);
      const leasesBefore = structuredClone(before.leaseRollDrafts);
      expect(run(before)).toBe(result);
      const state = useProjectStore.getState();
      expect(state.planningScenarios).toEqual(plansBefore);
      expect(state.leaseRollDrafts).toEqual(leasesBefore);
      expect(state.selectedPlanningScenarioId).toBeNull();
      expect(state.activeScenarioId).toBe(before.activeScenarioId);
      expect(state.representativePlanningScenarioId).toBeNull();
      expect(state.representativeGeometrySnapshot).toBeNull();
      expectFinanceUnchanged(before);
    });
  });

  it.each(["editPlanningScenarioDraft", "updatePlanningScenario"] as const)(
    "%s cannot reparent an active plan",
    action => {
      seedCollision();
      const before = useProjectStore.getState();
      expect(() => before[action](ID, { projectId: P1, name: "Reparented" })).toThrow();
      expect(useProjectStore.getState()).toBe(before);
    },
  );
});

describe("active-project collection changes", () => {
  it("does not select a foreign same-ID survivor after deleting the last active plan", () => {
    const { foreign, leaseRollDrafts } = seedCollision();
    useProjectStore.getState().removePlanningScenario(ID);
    expect(useProjectStore.getState()).toMatchObject({
      planningScenarios: [foreign], selectedPlanningScenarioId: null,
      leaseRollDrafts: { [FOREIGN_KEY]: leaseRollDrafts[FOREIGN_KEY] },
    });
    expect(useProjectStore.getState().leaseRollDrafts).not.toHaveProperty(ACTIVE_KEY);
  });

  it.each([false, true])("adds an active plan despite a foreign ID collision (legacy=%s)", legacy => {
    const { foreign, active } = seedCollision(legacy);
    useProjectStore.setState({ planningScenarios: [foreign] });
    const before = useProjectStore.getState();
    expect(before.addPlanningScenario(active)).toBe(ID);
    const state = useProjectStore.getState();
    expect(state.planningScenarios).toEqual([foreign, { ...active, projectId: P2 }]);
    expect(state.planningScenarios[0]).toBe(foreign);
    expect(state.selectedPlanningScenarioId).toBe(ID);
    expect(state.leaseRollDrafts).toEqual(before.leaseRollDrafts);
  });

  it.each(["no active project", "foreign project", "duplicate active ID", "duplicate legacy ID"])(
    "rejects adding with %s without changing state",
    kind => {
      const { active } = seedCollision(kind === "duplicate legacy ID");
      if (kind === "no active project") useProjectStore.setState({ data: null });
      const candidate = kind === "foreign project" ? plan(P1, "new-foreign") : active;
      const before = useProjectStore.getState();
      expect(() => before.addPlanningScenario(candidate)).toThrow();
      expect(useProjectStore.getState()).toBe(before);
    },
  );

  it("bulk replacement preserves foreign objects and drafts and selects only a current plan", () => {
    const { foreign, leaseRollDrafts } = seedCollision();
    const foreignBefore = structuredClone(foreign);
    const replacement = plan(undefined, "replacement");
    const replacementKey = buildLeaseRollDraftKey(P2, replacement.id);
    const replacementDraft = leaseDraft(P2, replacement.id);
    useProjectStore.setState({
      representativePlanningScenarioId: ID,
      representativeParcelBasisHash: "old-active-basis",
      leaseRollDrafts: { ...leaseRollDrafts, [replacementKey]: replacementDraft },
    });
    const before = useProjectStore.getState();
    before.setPlanningScenarios([{ ...foreign, name: "Foreign overwrite" }, replacement]);
    const state = useProjectStore.getState();
    expect(state.planningScenarios).toEqual([foreign, { ...replacement, projectId: P2 }]);
    expectForeignUnchanged(foreign, foreignBefore);
    expect(state.selectedPlanningScenarioId).toBe(replacement.id);
    expect(state.representativePlanningScenarioId).toBeNull();
    expect(state.representativeParcelBasisHash).toBeNull();
    expect(state.leaseRollDrafts).toEqual({
      [FOREIGN_KEY]: leaseRollDrafts[FOREIGN_KEY], [replacementKey]: replacementDraft,
    });
    expectFinanceUnchanged(before);
  });

  it("rejects ambiguous current-project IDs in a bulk replacement atomically", () => {
    const { active } = seedCollision();
    const before = useProjectStore.getState();
    expect(() => before.setPlanningScenarios([active, plan(undefined)])).toThrow();
    expect(useProjectStore.getState()).toBe(before);
  });

  it.each(["setPlanningScenarios", "clearPlanningScenarios"] as const)(
    "%s clears only the active collection and its lease drafts",
    action => {
      const { foreign, leaseRollDrafts } = seedCollision(true);
      const before = useProjectStore.getState();
      if (action === "setPlanningScenarios") before.setPlanningScenarios([]);
      else before.clearPlanningScenarios();
      const state = useProjectStore.getState();
      expect(state.planningScenarios).toEqual([foreign]);
      expect(state.planningScenarios[0]).toBe(foreign);
      expect(state.selectedPlanningScenarioId).toBeNull();
      expect(state.leaseRollDrafts).toEqual({ [FOREIGN_KEY]: leaseRollDrafts[FOREIGN_KEY] });
      expectFinanceUnchanged(before);
    },
  );

  it.each(["setPlanningScenarios", "clearPlanningScenarios"] as const)(
    "%s fails closed without an active project",
    action => {
      seedCollision();
      useProjectStore.setState({ data: null });
      const before = useProjectStore.getState();
      if (action === "setPlanningScenarios") before.setPlanningScenarios([]);
      else before.clearPlanningScenarios();
      expect(useProjectStore.getState()).toBe(before);
    },
  );
});

describe("representative geometry and finance isolation", () => {
  let fixture: ReturnType<typeof analysisReferenceFixture>;
  beforeAll(() => { fixture = analysisReferenceFixture(24, 24, P2); }, 30000);

  it.each([false, true])("adopts only P2's same-ID plan and recalculates only P2 finance (legacy=%s)", legacy => {
    const input = structuredClone(fixture);
    const active = input.scenario;
    active.name = "P2 analysis reference";
    if (legacy) delete active.projectId;
    const foreign = structuredClone(input.scenario);
    foreign.projectId = P1;
    foreign.name = "P1 analysis reference";
    foreign.version = 91;
    foreign.economicsPreview.acquisitionCostManwon = 99999;
    const foreignSaved = plan(P1, "foreign-saved");
    const foreignBefore = structuredClone(foreign);
    const activeBefore = structuredClone(active);
    const { leaseRollDrafts } = seedCollision();
    useProjectStore.setState({
      data: input.input.data,
      planningScenarios: [foreign, foreignSaved, active],
    });

    const accepted = useProjectStore.getState().setRepresentativePlanningScenarioId(ID, "preliminary-analysis");
    const state = useProjectStore.getState();
    expect(accepted, state.geometryValidationError ?? "").toBe(true);
    expectForeignUnchanged(foreign, foreignBefore);
    expect(state.planningScenarios[1]).toBe(foreignSaved);
    const selected = state.planningScenarios[2];
    expect(selected.floorPrograms).toEqual(activeBefore.floorPrograms);
    expect(selected.parking).toEqual(activeBefore.parking);
    expect(selected.economicsPreview.acquisitionCostManwon).toBe(input.parcel.acquiredPrice);
    expect(state.representativePlanningScenarioId).toBe(ID);
    const geometry = state.representativeGeometrySnapshot!;
    expect(geometry).toMatchObject({ projectId: P2, scenarioId: ID, scenarioVersion: active.version });
    expect(geometry.analysisReference?.approvalStatus).toBe("unverified");
    expect(state.data?.parcel.id).toBe(P2);
    expect(state.data?.scenarios.map(scenario => scenario.id)).toEqual([ID]);
    const finance = state.data!.scenarios[0];
    expect(finance.name).toBe(active.name);
    expect(finance._raw.program.areaContract).toMatchObject({
      sourceScenarioId: ID,
      sourceScenarioVersion: active.version,
      geometrySource: { geometryHash: geometry.geometryHash },
    });
    expect(state.leaseRollDrafts).toEqual(leaseRollDrafts);

    state.editPlanningScenarioDraft(ID, { name: "Changed active reference" });
    expect(useProjectStore.getState().representativePlanningScenarioId).toBeNull();
    expect(useProjectStore.getState().representativeGeometrySnapshot).toBeNull();
    expect(useProjectStore.getState().representativeParcelBasisHash).toBeNull();
    expectForeignUnchanged(foreign, foreignBefore);
  }, 30000);
});
