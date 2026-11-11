import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicAccessPrincipal } from "@/lib/auth/client-session";
import {
  buildLeaseRollDraftKey,
  createLeaseRollDraft,
} from "@/lib/finance/lease-roll-contract";
import {
  buildOperatingBudgetDraftKey,
  createOperatingBudgetDraft,
  operatingBudgetBasis,
  type OperatingBudgetDraft,
} from "@/lib/finance/operating-budget-contract";
import { buildRepresentativeParcelBasisHash } from "@/lib/planning/representative-basis";
import { createBlankPlanningScenario } from "@/lib/planning/scenario-utils";
import { useProjectStore } from "@/lib/stores/project-store";
import { useReviewStore } from "@/lib/stores/review-store";
import {
  canonicalProjectWorkspaceJson,
  hashProjectWorkspacePayload,
  validateProjectWorkspacePayload,
} from "@/lib/workspace/project-workspace";
import {
  applyProjectWorkspace,
  captureProjectWorkspace,
} from "@/lib/workspace/project-workspace-client";
import { precisionFixture } from "@/tests/helpers/finance-precision-fixture";
import { integratedVerificationFixture } from "@/tests/helpers/integrated-verification-fixture";
import { projectWorkspaceFixture } from "@/tests/helpers/project-workspace-fixture";

const PROJECT_ID = "budget-project";
const OTHER_PROJECT_ID = "other-budget-project";
const SCENARIO_ID = "FINANCE-S1";
const AT = "2026-11-10T12:00:00.000Z";
const KEY = buildOperatingBudgetDraftKey(PROJECT_ID, SCENARIO_ID);
const OTHER_KEY = buildOperatingBudgetDraftKey(OTHER_PROJECT_ID, SCENARIO_ID);

function financeScenario() {
  const { scenario } = precisionFixture();
  scenario.id = SCENARIO_ID;
  scenario.program.areaContract!.sourceScenarioId = SCENARIO_ID;
  return scenario;
}

function draft(patch: Partial<OperatingBudgetDraft> = {}): OperatingBudgetDraft {
  const initial = createOperatingBudgetDraft(PROJECT_ID, financeScenario(), AT);
  return {
    ...initial,
    revision: 1,
    calendarStart: "2026-11-01",
    baselineCalendarStart: "2026-10-01",
    scopeConfirmed: true,
    allocationNote: "Owner costs for the retained portfolio and common areas.",
    categories: initial.categories.map((category, index) => ({
      ...category,
      sourceName: "Synthetic operating budget",
      sourceRef: `budget-${index}`,
      sourceAsOf: "2026-11-10",
      amounts: [
        { month: "2026-11", amountWon: index * 12_500.5 },
        { month: "2026-12", amountWon: null },
      ],
    })),
    ...patch,
  };
}

function plan(id: string, projectId = PROJECT_ID) {
  return { ...createBlankPlanningScenario({ projectId }), id };
}

function resetStores() {
  useProjectStore.setState(useProjectStore.getInitialState(), true);
  useReviewStore.setState(useReviewStore.getInitialState(), true);
}

describe("operating-budget draft workspace persistence", () => {
  beforeEach(() => {
    resetStores();
    applyProjectWorkspace(projectWorkspaceFixture(PROJECT_ID));
  });

  afterEach(() => {
    resetStores();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("accepts a legacy omission without changing its object, JSON or hash", async () => {
    const legacy = projectWorkspaceFixture(PROJECT_ID);
    const originalJson = canonicalProjectWorkspaceJson(legacy);
    const originalHash = await hashProjectWorkspacePayload(legacy);
    const validation = validateProjectWorkspacePayload(legacy, PROJECT_ID);
    expect(validation).toMatchObject({ valid: true, errors: [] });
    expect(validation.payload).toBe(legacy);
    expect(validation.payload).not.toHaveProperty("operatingBudgetDrafts");
    expect(canonicalProjectWorkspaceJson(validation.payload)).toBe(originalJson);
    expect(await hashProjectWorkspacePayload(validation.payload!)).toBe(originalHash);
    expect(await hashProjectWorkspacePayload({ ...legacy, operatingBudgetDrafts: [] })).not.toBe(originalHash);
    expect(captureProjectWorkspace(PROJECT_ID)?.operatingBudgetDrafts).toEqual([]);
    expect(captureProjectWorkspace(OTHER_PROJECT_ID)).toBeNull();
  });

  it("round-trips all draft fields and includes them in the workspace hash", async () => {
    const emptyHash = await hashProjectWorkspacePayload(captureProjectWorkspace(PROJECT_ID)!);
    const saved = draft();
    useProjectStore.getState().saveOperatingBudgetDraft(saved);
    const captured = captureProjectWorkspace(PROJECT_ID)!;
    const hash = await hashProjectWorkspacePayload(captured);
    expect(hash).not.toBe(emptyHash);
    const wire = JSON.parse(canonicalProjectWorkspaceJson(captured));
    const validation = validateProjectWorkspacePayload(wire, PROJECT_ID);
    expect(validation.errors).toEqual([]);
    resetStores();
    applyProjectWorkspace(validation.payload!);
    expect(useProjectStore.getState().operatingBudgetDrafts).toEqual({ [KEY]: saved });
    expect(captureProjectWorkspace(PROJECT_ID)?.operatingBudgetDrafts).toEqual([saved]);
    expect(await hashProjectWorkspacePayload(captureProjectWorkspace(PROJECT_ID)!)).toBe(hash);
    useProjectStore.getState().saveOperatingBudgetDraft({ ...saved, revision: 2, allocationNote: "Revised allocation" });
    expect(await hashProjectWorkspacePayload(captureProjectWorkspace(PROJECT_ID)!)).not.toBe(hash);
  });

  it.each([0, 2, 10])("rejects first-save revision %s atomically", (revision) => {
    const before = useProjectStore.getState();
    expect(() => before.saveOperatingBudgetDraft(draft({ revision }))).toThrow(/revision/);
    expect(useProjectStore.getState()).toBe(before);
  });

  it("requires an explicit revision on every save", () => {
    const candidate: Partial<OperatingBudgetDraft> = draft();
    delete candidate.revision;
    const before = useProjectStore.getState();
    expect(() => before.saveOperatingBudgetDraft(candidate as OperatingBudgetDraft)).toThrow(/revision/);
    expect(useProjectStore.getState()).toBe(before);
    before.saveOperatingBudgetDraft(draft());
    const saved = useProjectStore.getState();
    expect(() => saved.saveOperatingBudgetDraft(candidate as OperatingBudgetDraft)).toThrow(/revision/);
    expect(useProjectStore.getState()).toBe(saved);
  });

  it("rejects stale or skipped revisions and detaches nested saved values from the caller", () => {
    const first = draft();
    useProjectStore.getState().saveOperatingBudgetDraft(first);
    first.categories[0].amounts[0].amountWon = 1;
    first.categories[0].sourceName = "Changed after saving";
    expect(useProjectStore.getState().operatingBudgetDrafts[KEY]).toEqual(draft());
    const before = useProjectStore.getState();
    for (const revision of [0, 1, 3]) {
      expect(() => before.saveOperatingBudgetDraft(draft({ revision }))).toThrow(/revision/);
      expect(useProjectStore.getState()).toBe(before);
    }
    before.saveOperatingBudgetDraft(draft({ revision: 2 }));
    expect(useProjectStore.getState().operatingBudgetDrafts[KEY].revision).toBe(2);
    expect(before.operatingBudgetDrafts[KEY].revision).toBe(1);
  });

  it("validates nested amounts before saving without changing state on failure", () => {
    const invalid = draft();
    invalid.categories[0].amounts[0].amountWon = -1;
    const before = useProjectStore.getState();
    expect(() => before.saveOperatingBudgetDraft(invalid)).toThrow();
    expect(useProjectStore.getState()).toBe(before);
  });

  it.each(["no-project", "foreign-project", "unknown-scenario", "planning-only"])(
    "rejects saving with %s ownership",
    (ownership) => {
      const candidate = draft();
      if (ownership === "no-project") useProjectStore.setState({ data: null });
      if (ownership === "foreign-project") candidate.projectId = OTHER_PROJECT_ID;
      if (ownership === "unknown-scenario") candidate.scenarioId = "missing";
      if (ownership === "planning-only") {
        const planning = plan("planning-only");
        useProjectStore.setState({ planningScenarios: [planning] });
        candidate.scenarioId = planning.id;
      }
      const before = useProjectStore.getState();
      expect(() => before.saveOperatingBudgetDraft(candidate)).toThrow(/현재 프로젝트/);
      expect(useProjectStore.getState()).toBe(before);
    },
  );

  it("rejects updating a draft after its computed scenario disappears", () => {
    useProjectStore.getState().saveOperatingBudgetDraft(draft());
    const data = useProjectStore.getState().data!;
    useProjectStore.setState({ data: { ...data, scenarios: [] } });
    const before = useProjectStore.getState();
    expect(() => before.saveOperatingBudgetDraft(draft({ revision: 2 }))).toThrow(/현재 프로젝트/);
    expect(useProjectStore.getState()).toBe(before);
  });

  it.each([null, "drafts", {}, 1])("rejects non-array workspace drafts: %j", (operatingBudgetDrafts) => {
    expect(validateProjectWorkspacePayload({
      ...projectWorkspaceFixture(PROJECT_ID), operatingBudgetDrafts,
    })).toMatchObject({ valid: false, payload: null });
  });

  it.each([
    ["foreign project", [draft({ projectId: OTHER_PROJECT_ID })]],
    ["unknown scenario", [draft({ scenarioId: "missing" })]],
    ["duplicate scenario", [draft(), draft({ revision: 2 })]],
    ["invalid basis", [draft({ sourceBasis: "invalid" })]],
    ["invalid timestamp", [draft({ updatedAt: "yesterday" })]],
    ["invalid calendar", [draft({ calendarStart: "2026-11-02" })]],
    ["invalid baseline", [draft({ baselineCalendarStart: "2026-13-01" })]],
    ["negative revision", [draft({ revision: -1 })]],
    ["invalid scope", [{ ...draft(), scopeConfirmed: null }]],
    ["invalid note", [{ ...draft(), allocationNote: 10 }]],
    ["null categories", [{ ...draft(), categories: null }]],
    ["invalid category", [{ ...draft(), categories: [{ ...draft().categories[0], category: "debt" }] }]],
    ["invalid amount", [draft({ categories: [{ ...draft().categories[0], amounts: [{ month: "2026-11", amountWon: -1 }] }] })]],
    ["duplicate category", [draft({ categories: [draft().categories[0], draft().categories[0]] })]],
    ["duplicate month", [draft({ categories: [{ ...draft().categories[0], amounts: [
      { month: "2026-11", amountWon: 0 }, { month: "2026-11", amountWon: 1 },
    ] }] })]],
    ["unknown field", [{ ...draft(), financialResult: 123 }]],
    ["null entry", [null]],
  ])("rejects %s in workspace drafts without rewriting the payload", (_label, operatingBudgetDrafts) => {
    const payload = { ...projectWorkspaceFixture(PROJECT_ID), operatingBudgetDrafts };
    const before = structuredClone(payload);
    expect(validateProjectWorkspacePayload(payload)).toMatchObject({ valid: false, payload: null });
    expect(payload).toEqual(before);
  });

  it.each([0, 1, 6])("saves and restores an incomplete draft with %s categories", (count) => {
    const initial = createOperatingBudgetDraft(PROJECT_ID, financeScenario(), AT);
    const candidate = { ...initial, revision: 1, categories: initial.categories.slice(0, count) };
    useProjectStore.getState().saveOperatingBudgetDraft(candidate);
    const captured = captureProjectWorkspace(PROJECT_ID)!;
    expect(validateProjectWorkspacePayload(captured).errors).toEqual([]);
    applyProjectWorkspace(JSON.parse(JSON.stringify(captured)));
    expect(useProjectStore.getState().operatingBudgetDrafts[KEY]).toEqual(candidate);
  });

  it("retains an existing draft while its planning owner awaits finance recomputation", () => {
    const payload = projectWorkspaceFixture(PROJECT_ID);
    payload.planningScenarios = [plan(SCENARIO_ID)];
    payload.operatingBudgetDrafts = [draft()];
    applyProjectWorkspace(payload);
    const nextData = structuredClone(payload.projectData);
    nextData.scenarios = nextData.scenarios.map(scenario => ({ ...scenario, id: "RECOMPUTED" }));
    useProjectStore.getState().setData(nextData);
    const captured = captureProjectWorkspace(PROJECT_ID)!;
    expect(captured.operatingBudgetDrafts).toEqual(payload.operatingBudgetDrafts);
    expect(validateProjectWorkspacePayload(captured).errors).toEqual([]);
    applyProjectWorkspace(JSON.parse(JSON.stringify(captured)));
    const before = useProjectStore.getState();
    expect(() => before.saveOperatingBudgetDraft(draft({ revision: 2 }))).toThrow(/현재 프로젝트/);
    expect(useProjectStore.getState()).toBe(before);
  });

  it("accepts 256 owned drafts but rejects 257", () => {
    const payload = projectWorkspaceFixture(PROJECT_ID);
    const scenario = payload.projectData.scenarios[0];
    payload.projectData.scenarios = Array.from({ length: 257 }, (_, index) => ({
      ...scenario, id: `FINANCE-${index}`,
    }));
    payload.operatingBudgetDrafts = payload.projectData.scenarios.slice(0, 256)
      .map(({ id }) => draft({ scenarioId: id, categories: [] }));
    expect(validateProjectWorkspacePayload(payload).errors).toEqual([]);
    payload.operatingBudgetDrafts.push(draft({ scenarioId: "FINANCE-256", categories: [] }));
    expect(validateProjectWorkspacePayload(payload).valid).toBe(false);
  });

  it("removes only a deleted current-project plan's draft", () => {
    const current = plan(SCENARIO_ID), retained = plan("retained"), foreign = plan(SCENARIO_ID, OTHER_PROJECT_ID);
    const retainedKey = buildOperatingBudgetDraftKey(PROJECT_ID, retained.id);
    const other = draft({ projectId: OTHER_PROJECT_ID });
    const retainedDraft = draft({ scenarioId: retained.id });
    useProjectStore.setState({
      planningScenarios: [current, retained, foreign],
      operatingBudgetDrafts: { [KEY]: draft(), [retainedKey]: retainedDraft, [OTHER_KEY]: other },
    });
    useProjectStore.getState().removePlanningScenario(current.id);
    expect(useProjectStore.getState().planningScenarios).toEqual([retained, foreign]);
    expect(useProjectStore.getState().operatingBudgetDrafts).toEqual({ [retainedKey]: retainedDraft, [OTHER_KEY]: other });
    expect(useProjectStore.getState().operatingBudgetDrafts[OTHER_KEY]).toBe(other);
    const payload = captureProjectWorkspace(PROJECT_ID)!;
    payload.projectData.scenarios = payload.projectData.scenarios.map(scenario => ({ ...scenario, id: retained.id }));
    expect(validateProjectWorkspacePayload(payload).errors).toEqual([]);
  });

  it("cleans replaced plans before recomputation while retaining current and foreign owners", () => {
    const removed = plan(SCENARIO_ID), retained = plan("retained"), foreign = plan(SCENARIO_ID, OTHER_PROJECT_ID);
    const retainedKey = buildOperatingBudgetDraftKey(PROJECT_ID, retained.id);
    const other = draft({ projectId: OTHER_PROJECT_ID });
    const retainedDraft = draft({ scenarioId: retained.id });
    useProjectStore.setState({
      planningScenarios: [removed, retained, foreign],
      operatingBudgetDrafts: { [KEY]: draft(), [retainedKey]: retainedDraft, [OTHER_KEY]: other },
    });
    const replacement = plan("replacement");
    useProjectStore.getState().setPlanningScenarios([retained, replacement]);
    expect(useProjectStore.getState().planningScenarios).toEqual([foreign, retained, replacement]);
    expect(useProjectStore.getState().operatingBudgetDrafts).toEqual({ [retainedKey]: retainedDraft, [OTHER_KEY]: other });
    expect(useProjectStore.getState().operatingBudgetDrafts[OTHER_KEY]).toBe(other);
    const nextData = structuredClone(useProjectStore.getState().data!);
    nextData.scenarios = nextData.scenarios.map(scenario => ({ ...scenario, id: replacement.id }));
    useProjectStore.getState().setData(nextData);
    const payload = captureProjectWorkspace(PROJECT_ID)!;
    expect(payload.operatingBudgetDrafts).toEqual([retainedDraft]);
    expect(validateProjectWorkspacePayload(payload).errors).toEqual([]);
  });

  it("clears drafts belonging to current plans while preserving foreign same-ID and computed-only drafts", () => {
    const first = plan(SCENARIO_ID), second = plan("second"), foreign = plan(SCENARIO_ID, OTHER_PROJECT_ID);
    const secondKey = buildOperatingBudgetDraftKey(PROJECT_ID, second.id);
    const computedKey = buildOperatingBudgetDraftKey(PROJECT_ID, "computed-only");
    const other = draft({ projectId: OTHER_PROJECT_ID });
    const computed = draft({ scenarioId: "computed-only" });
    useProjectStore.setState({
      planningScenarios: [first, second, foreign],
      operatingBudgetDrafts: {
        [KEY]: draft(), [secondKey]: draft({ scenarioId: second.id }), [OTHER_KEY]: other, [computedKey]: computed,
      },
    });
    useProjectStore.getState().clearPlanningScenarios();
    expect(useProjectStore.getState().planningScenarios).toEqual([foreign]);
    expect(useProjectStore.getState().operatingBudgetDrafts).toEqual({ [OTHER_KEY]: other, [computedKey]: computed });
    expect(useProjectStore.getState().operatingBudgetDrafts[OTHER_KEY]).toBe(other);
  });

  it("does not clean foreign plans or drafts when the current project has no matching plan", () => {
    const foreign = plan(SCENARIO_ID, OTHER_PROJECT_ID);
    const other = draft({ projectId: OTHER_PROJECT_ID });
    useProjectStore.setState({ planningScenarios: [foreign], operatingBudgetDrafts: { [OTHER_KEY]: other } });
    useProjectStore.getState().removePlanningScenario(SCENARIO_ID);
    expect(useProjectStore.getState().planningScenarios).toEqual([foreign]);
    expect(useProjectStore.getState().operatingBudgetDrafts).toEqual({ [OTHER_KEY]: other });
    useProjectStore.setState({ data: null });
    const before = useProjectStore.getState();
    before.removePlanningScenario(SCENARIO_ID);
    before.setPlanningScenarios([]);
    before.clearPlanningScenarios();
    expect(useProjectStore.getState()).toBe(before);
  });

  it("keeps a stale basis savable and round-trips it without rebinding", () => {
    const scenario = financeScenario();
    const original = createOperatingBudgetDraft(PROJECT_ID, scenario, AT);
    scenario.program.areaContract!.sourceScenarioVersion! += 1;
    const payload = projectWorkspaceFixture(PROJECT_ID);
    payload.projectData.scenarios[0]._raw = scenario;
    applyProjectWorkspace(payload);
    const stale = { ...original, revision: 1 };
    expect(stale.sourceBasis).not.toBe(operatingBudgetBasis(PROJECT_ID, scenario));
    useProjectStore.getState().saveOperatingBudgetDraft(stale);
    const captured = captureProjectWorkspace(PROJECT_ID)!;
    expect(validateProjectWorkspacePayload(captured).errors).toEqual([]);
    applyProjectWorkspace(JSON.parse(JSON.stringify(captured)));
    expect(useProjectStore.getState().operatingBudgetDrafts[KEY]).toEqual(stale);
    useProjectStore.getState().saveOperatingBudgetDraft({ ...stale, revision: 2 });
    expect(useProjectStore.getState().operatingBudgetDrafts[KEY].sourceBasis).toBe(original.sourceBasis);
  });

  it.each(["absent", "empty", "replacement"])(
    "applies %s drafts only to their project, including another project with the same scenario ID",
    (mode) => {
      applyProjectWorkspace(projectWorkspaceFixture(OTHER_PROJECT_ID));
      const otherDraft = draft({ projectId: OTHER_PROJECT_ID });
      useProjectStore.getState().saveOperatingBudgetDraft(otherDraft);
      const payload = projectWorkspaceFixture(PROJECT_ID);
      payload.projectData.scenarios.push({ ...payload.projectData.scenarios[0], id: "FINANCE-S2" });
      applyProjectWorkspace(payload);
      useProjectStore.getState().saveOperatingBudgetDraft(draft());
      useProjectStore.getState().saveOperatingBudgetDraft(draft({ scenarioId: "FINANCE-S2" }));
      expect(captureProjectWorkspace(PROJECT_ID)?.operatingBudgetDrafts).toEqual([
        draft(), draft({ scenarioId: "FINANCE-S2" }),
      ]);
      const retained = useProjectStore.getState().operatingBudgetDrafts[OTHER_KEY];
      const replacement = draft({ revision: 7, categories: [] });
      if (mode === "empty") payload.operatingBudgetDrafts = [];
      if (mode === "replacement") payload.operatingBudgetDrafts = [replacement];
      applyProjectWorkspace(payload);
      expect(useProjectStore.getState().operatingBudgetDrafts).toEqual({
        [OTHER_KEY]: otherDraft,
        ...(mode === "replacement" ? { [KEY]: replacement } : {}),
      });
      expect(useProjectStore.getState().operatingBudgetDrafts[OTHER_KEY]).toBe(retained);
      expect(captureProjectWorkspace(PROJECT_ID)?.operatingBudgetDrafts)
        .toEqual(mode === "replacement" ? [replacement] : []);
    },
  );

  it("removes only the requested project/scenario draft and allows a new revision 1", () => {
    const payload = projectWorkspaceFixture(PROJECT_ID);
    payload.projectData.scenarios.push({ ...payload.projectData.scenarios[0], id: "FINANCE-S2" });
    applyProjectWorkspace(payload);
    useProjectStore.getState().saveOperatingBudgetDraft(draft());
    const second = draft({ scenarioId: "FINANCE-S2" });
    const secondKey = buildOperatingBudgetDraftKey(PROJECT_ID, second.scenarioId);
    useProjectStore.getState().saveOperatingBudgetDraft(second);
    applyProjectWorkspace(projectWorkspaceFixture(OTHER_PROJECT_ID));
    const other = draft({ projectId: OTHER_PROJECT_ID });
    useProjectStore.getState().saveOperatingBudgetDraft(other);
    useProjectStore.getState().removeOperatingBudgetDraft(PROJECT_ID, SCENARIO_ID);
    expect(useProjectStore.getState().operatingBudgetDrafts).toEqual({ [OTHER_KEY]: other, [secondKey]: second });
    applyProjectWorkspace(payload);
    useProjectStore.getState().saveOperatingBudgetDraft(draft());
    expect(useProjectStore.getState().operatingBudgetDrafts[KEY].revision).toBe(1);
    expect(useProjectStore.getState().operatingBudgetDrafts[OTHER_KEY]).toEqual(other);
  });

  it("never changes lease drafts, planning, finance, review or a saved Stage 3 snapshot", () => {
    const f = integratedVerificationFixture(PROJECT_ID);
    const payload = projectWorkspaceFixture(PROJECT_ID);
    payload.projectData = f.data;
    payload.planningScenarios = [f.planningScenario!];
    payload.selectedScenarioId = f.representativeScenarioId;
    payload.representativeScenarioId = f.representativeScenarioId;
    payload.representativeGeometry = f.geometry!;
    payload.representativeParcelBasisHash = buildRepresentativeParcelBasisHash(f.data.parcel);
    payload.stage3Snapshot = {
      projectId: PROJECT_ID,
      representativeScenarioId: f.representativeScenarioId,
      representativeScenarioVersion: f.representativeScenarioVersion,
      geometryHash: f.geometryHash,
      savedAt: AT,
      data: structuredClone(f.data),
    };
    payload.leaseRollDrafts = [{ ...createLeaseRollDraft(PROJECT_ID, f.data.scenarios[0]._raw, AT), revision: 1 }];
    const originalPayload = structuredClone(payload);
    applyProjectWorkspace(payload);
    const before = useProjectStore.getState();
    const reviewBefore = useReviewStore.getState();
    const baseline = structuredClone(captureProjectWorkspace(PROJECT_ID)!);
    const candidate = { ...createOperatingBudgetDraft(PROJECT_ID, f.data.scenarios[0]._raw, AT), revision: 1 };
    before.saveOperatingBudgetDraft(candidate);
    const after = useProjectStore.getState();
    for (const key of Object.keys(before) as (keyof typeof before)[]) {
      if (key !== "operatingBudgetDrafts") expect(after[key]).toBe(before[key]);
    }
    expect(useReviewStore.getState()).toBe(reviewBefore);
    expect(captureProjectWorkspace(PROJECT_ID)).toEqual({ ...baseline, operatingBudgetDrafts: [candidate] });
    expect(validateProjectWorkspacePayload(captureProjectWorkspace(PROJECT_ID)).errors).toEqual([]);
    applyProjectWorkspace(JSON.parse(JSON.stringify(captureProjectWorkspace(PROJECT_ID))));
    expect(useProjectStore.getState().stage3FeasibilitySnapshots[PROJECT_ID]).toEqual(baseline.stage3Snapshot);
    const beforeRemoval = useProjectStore.getState();
    const reviewBeforeRemoval = useReviewStore.getState();
    beforeRemoval.removeOperatingBudgetDraft(PROJECT_ID, candidate.scenarioId);
    const afterRemoval = useProjectStore.getState();
    for (const key of Object.keys(beforeRemoval) as (keyof typeof beforeRemoval)[]) {
      if (key !== "operatingBudgetDrafts") expect(afterRemoval[key]).toBe(beforeRemoval[key]);
    }
    expect(useReviewStore.getState()).toBe(reviewBeforeRemoval);
    expect(captureProjectWorkspace(PROJECT_ID)).toEqual(JSON.parse(JSON.stringify(baseline)));
    expect(payload).toEqual(originalPayload);
  });

  it("deleting a lease draft preserves the independent operating-budget source", () => {
    const lease = { ...createLeaseRollDraft(PROJECT_ID, financeScenario(), AT), revision: 1 };
    useProjectStore.getState().saveLeaseRollDraft(lease);
    useProjectStore.getState().saveOperatingBudgetDraft(draft());
    const before = useProjectStore.getState();
    before.removeLeaseRollDraft(PROJECT_ID, SCENARIO_ID);
    expect(useProjectStore.getState().leaseRollDrafts[buildLeaseRollDraftKey(PROJECT_ID, SCENARIO_ID)]).toBeUndefined();
    expect(useProjectStore.getState().operatingBudgetDrafts).toBe(before.operatingBudgetDrafts);
    expect(captureProjectWorkspace(PROJECT_ID)?.operatingBudgetDrafts).toEqual([draft()]);
    expect(validateProjectWorkspacePayload(captureProjectWorkspace(PROJECT_ID)).errors).toEqual([]);
  });

  it("persists per account, resets on logout, and never hydrates another account's drafts", async () => {
    vi.resetModules();
    const values = new Map<string, string>();
    const localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    vi.stubGlobal("window", { localStorage });
    const account: PublicAccessPrincipal = {
      userId: "budget-user-a", orgId: "budget-org-a", role: "analyst", reviewerRoles: [],
      name: "A", email: "a@example.com", organization: "A", capabilities: ["project.read"],
    };
    const { clientSession } = await import("@/lib/auth/client-session");
    const { useProjectStore: store } = await import("@/lib/stores/project-store");
    localStorage.setItem("parcelgrid-envelope", JSON.stringify({
      state: { operatingBudgetDrafts: { [OTHER_KEY]: draft({ projectId: OTHER_PROJECT_ID }) } }, version: 0,
    }));
    expect(store.persist.hasHydrated()).toBe(false);
    expect(store.getState().operatingBudgetDrafts).toEqual({});
    clientSession.activate(account);
    await store.persist.rehydrate();
    expect(store.getState().operatingBudgetDrafts).toEqual({});
    store.setState({ data: projectWorkspaceFixture(PROJECT_ID).projectData });
    store.getState().saveOperatingBudgetDraft(draft());
    const storageKey = clientSession.storageKey("parcelgrid-envelope")!;
    const persisted = localStorage.getItem(storageKey)!;
    expect(JSON.parse(persisted).state.operatingBudgetDrafts).toEqual({ [KEY]: draft() });
    store.setState({ operatingBudgetDrafts: {} });
    localStorage.setItem(storageKey, persisted);
    await store.persist.rehydrate();
    expect(store.getState().operatingBudgetDrafts).toEqual({ [KEY]: draft() });
    clientSession.invalidate();
    store.setState(store.getInitialState(), true);
    expect(store.getState().operatingBudgetDrafts).toEqual({});
    expect(localStorage.getItem(storageKey)).toBe(persisted);
    expect(() => store.getState().saveOperatingBudgetDraft(draft())).toThrow();

    vi.resetModules();
    const nextSession = (await import("@/lib/auth/client-session")).clientSession;
    const nextStore = (await import("@/lib/stores/project-store")).useProjectStore;
    nextSession.activate({ ...account, userId: "budget-user-b", orgId: "budget-org-b" });
    await nextStore.persist.rehydrate();
    expect(nextStore.getState().operatingBudgetDrafts).toEqual({});
    expect(localStorage.getItem(storageKey)).toBe(persisted);
    nextSession.invalidate();
    nextStore.setState(nextStore.getInitialState(), true);
  });
});
