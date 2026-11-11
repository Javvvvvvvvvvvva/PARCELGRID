import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicAccessPrincipal } from "@/lib/auth/client-session";
import {
  buildLeaseRollDraftKey,
  createLeaseRollDraft,
  createLeaseRollRow,
  leaseRollBasis,
  LEASE_ROLL_VERSION,
  type LeaseRollDraft,
} from "@/lib/finance/lease-roll-contract";
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

const PROJECT_ID = "lease-project";
const OTHER_PROJECT_ID = "other-lease-project";
const SCENARIO_ID = "FINANCE-S1";
const AT = "2026-11-10T12:00:00.000Z";
const KEY = buildLeaseRollDraftKey(PROJECT_ID, SCENARIO_ID);
const OTHER_KEY = buildLeaseRollDraftKey(OTHER_PROJECT_ID, SCENARIO_ID);

function draft(patch: Partial<LeaseRollDraft> = {}): LeaseRollDraft {
  return {
    version: LEASE_ROLL_VERSION,
    projectId: PROJECT_ID,
    scenarioId: SCENARIO_ID,
    sourceBasis: "a".repeat(64),
    revision: 1,
    updatedAt: AT,
    calendarStart: "2026-11-01",
    rows: [{
      ...createLeaseRollRow("lease-101"),
      unitLabel: "Unit 101",
      areaSqm: 45,
      monthlyRentWon: 900_000,
      depositWon: 10_000_000,
      startDate: "2026-11-01",
      endDate: "2027-10-31",
      sourceName: "Synthetic lease",
      sourceRef: "fixture-101",
      sourceAsOf: "2026-11-10",
    }],
    ...patch,
  };
}

function resetStores() {
  useProjectStore.setState(useProjectStore.getInitialState(), true);
  useReviewStore.setState(useReviewStore.getInitialState(), true);
}

describe("lease-roll draft workspace persistence", () => {
  beforeEach(() => {
    resetStores();
    applyProjectWorkspace(projectWorkspaceFixture(PROJECT_ID));
  });

  afterEach(() => {
    resetStores();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("captures a new empty list while accepting an unchanged legacy payload", () => {
    const legacy = projectWorkspaceFixture(PROJECT_ID);
    expect(legacy).not.toHaveProperty("leaseRollDrafts");
    const originalJson = canonicalProjectWorkspaceJson(legacy);
    expect(validateProjectWorkspacePayload(legacy, PROJECT_ID)).toMatchObject({
      valid: true, errors: [], payload: legacy,
    });
    expect(canonicalProjectWorkspaceJson(legacy)).toBe(originalJson);
    expect(captureProjectWorkspace(PROJECT_ID)?.leaseRollDrafts).toEqual([]);
    expect(captureProjectWorkspace(OTHER_PROJECT_ID)).toBeNull();
  });

  it("round-trips all draft fields and includes them in the workspace hash", async () => {
    const emptyHash = await hashProjectWorkspacePayload(captureProjectWorkspace(PROJECT_ID)!);
    const saved = draft();
    useProjectStore.getState().saveLeaseRollDraft(saved);
    const captured = captureProjectWorkspace(PROJECT_ID)!;
    const hash = await hashProjectWorkspacePayload(captured);
    expect(hash).not.toBe(emptyHash);
    const wire = JSON.parse(canonicalProjectWorkspaceJson(captured));
    const validation = validateProjectWorkspacePayload(wire, PROJECT_ID);
    expect(validation.valid).toBe(true);
    resetStores();
    applyProjectWorkspace(validation.payload!);
    expect(useProjectStore.getState().leaseRollDrafts).toEqual({ [KEY]: saved });
    expect(await hashProjectWorkspacePayload(captureProjectWorkspace(PROJECT_ID)!)).toBe(hash);
    expect(captureProjectWorkspace(PROJECT_ID)?.leaseRollDrafts).toMatchInlineSnapshot(`
      [
        {
          "calendarStart": "2026-11-01",
          "projectId": "lease-project",
          "revision": 1,
          "rows": [
            {
              "areaSqm": 45,
              "depositWon": 10000000,
              "endDate": "2027-10-31",
              "id": "lease-101",
              "monthlyRentWon": 900000,
              "sourceAsOf": "2026-11-10",
              "sourceName": "Synthetic lease",
              "sourceRef": "fixture-101",
              "startDate": "2026-11-01",
              "unitId": "lease-101",
              "unitLabel": "Unit 101",
              "use": "residential",
            },
          ],
          "scenarioId": "FINANCE-S1",
          "sourceBasis": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "updatedAt": "2026-11-10T12:00:00.000Z",
          "version": "lease-roll-2026.1",
        },
      ]
    `);
    expect(() => useProjectStore.getState().saveLeaseRollDraft(saved)).toThrow(/revision/);
    useProjectStore.getState().saveLeaseRollDraft({ ...saved, revision: 2 });
    expect(useProjectStore.getState().leaseRollDrafts[KEY].revision).toBe(2);
  });

  it.each([0, 2, 10])("rejects first-save revision %s atomically", (revision) => {
    const before = useProjectStore.getState();
    expect(() => before.saveLeaseRollDraft(draft({ revision }))).toThrow(/revision/);
    expect(useProjectStore.getState()).toBe(before);
  });

  it("rejects stale or skipped revisions and detaches the saved draft from its caller", () => {
    const first = draft();
    useProjectStore.getState().saveLeaseRollDraft(first);
    first.rows[0].monthlyRentWon = 1;
    expect(useProjectStore.getState().leaseRollDrafts[KEY].rows[0].monthlyRentWon).toBe(900_000);
    const before = useProjectStore.getState();
    for (const revision of [0, 1, 3]) {
      expect(() => before.saveLeaseRollDraft(draft({ revision }))).toThrow(/revision/);
      expect(useProjectStore.getState()).toBe(before);
    }
    before.saveLeaseRollDraft(draft({ revision: 2 }));
    expect(useProjectStore.getState().leaseRollDrafts[KEY].revision).toBe(2);
    expect(before.leaseRollDrafts[KEY].revision).toBe(1);
  });

  it("validates the draft schema before saving without changing state on failure", () => {
    const invalid = draft();
    invalid.rows[0].monthlyRentWon = -1;
    const before = useProjectStore.getState();
    expect(() => before.saveLeaseRollDraft(invalid)).toThrow();
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
        const plan = createBlankPlanningScenario({ projectId: PROJECT_ID });
        useProjectStore.setState({ planningScenarios: [plan] });
        candidate.scenarioId = plan.id;
      }
      const before = useProjectStore.getState();
      expect(() => before.saveLeaseRollDraft(candidate)).toThrow(/현재 프로젝트/);
      expect(useProjectStore.getState()).toBe(before);
    },
  );

  it("rejects updating a draft after its computed scenario disappears", () => {
    useProjectStore.getState().saveLeaseRollDraft(draft());
    const data = useProjectStore.getState().data!;
    useProjectStore.setState({ data: { ...data, scenarios: [] } });
    const before = useProjectStore.getState();
    expect(() => before.saveLeaseRollDraft(draft({ revision: 2 }))).toThrow(/현재 프로젝트/);
    expect(useProjectStore.getState()).toBe(before);
  });

  it.each([null, "drafts", {}, 1])("rejects non-array workspace drafts: %j", (leaseRollDrafts) => {
    expect(validateProjectWorkspacePayload({
      ...projectWorkspaceFixture(PROJECT_ID), leaseRollDrafts,
    })).toMatchObject({ valid: false, payload: null });
  });

  it.each([
    ["foreign project", [draft({ projectId: OTHER_PROJECT_ID })]],
    ["unknown scenario", [draft({ scenarioId: "missing" })]],
    ["duplicate scenario", [draft(), draft({ revision: 2 })]],
    ["invalid basis", [draft({ sourceBasis: "invalid" })]],
    ["invalid row", [draft({ rows: [{ ...createLeaseRollRow("bad"), depositWon: -1 }] })]],
    ["null entry", [null]],
  ])("rejects %s in workspace drafts", (_label, leaseRollDrafts) => {
    const payload = { ...projectWorkspaceFixture(PROJECT_ID), leaseRollDrafts };
    const before = structuredClone(payload);
    expect(validateProjectWorkspacePayload(payload)).toMatchObject({ valid: false, payload: null });
    expect(payload).toEqual(before);
  });

  it("retains an existing draft while its planning owner awaits finance recomputation", () => {
    const payload = projectWorkspaceFixture(PROJECT_ID);
    const plan = createBlankPlanningScenario({ projectId: PROJECT_ID });
    payload.planningScenarios = [plan];
    payload.leaseRollDrafts = [draft({ scenarioId: plan.id })];
    expect(validateProjectWorkspacePayload(payload).valid).toBe(true);
    applyProjectWorkspace(payload);
    expect(captureProjectWorkspace(PROJECT_ID)?.leaseRollDrafts).toEqual(payload.leaseRollDrafts);
    expect(() => useProjectStore.getState().saveLeaseRollDraft({ ...payload.leaseRollDrafts![0], revision: 2 })).toThrow(/현재 프로젝트/);
  });

  it("removes a deleted plan's draft without removing another project's draft", () => {
    const plan = { ...createBlankPlanningScenario({ projectId: PROJECT_ID }), id: SCENARIO_ID };
    const other = draft({ projectId: OTHER_PROJECT_ID });
    useProjectStore.setState({ planningScenarios: [plan], leaseRollDrafts: { [KEY]: draft(), [OTHER_KEY]: other } });
    useProjectStore.getState().removePlanningScenario(plan.id);
    expect(useProjectStore.getState().leaseRollDrafts).toEqual({ [OTHER_KEY]: other });
    const payload = captureProjectWorkspace(PROJECT_ID)!;
    payload.projectData.scenarios = payload.projectData.scenarios.map(scenario => ({
      ...scenario, id: "REPLACEMENT", _raw: { ...scenario._raw, id: "REPLACEMENT" },
    }));
    expect(validateProjectWorkspacePayload(payload).errors).toEqual([]);
  });

  it("accepts 256 owned drafts but rejects 257", () => {
    const payload = projectWorkspaceFixture(PROJECT_ID);
    const scenario = payload.projectData.scenarios[0];
    payload.projectData.scenarios = Array.from({ length: 257 }, (_, index) => ({
      ...scenario, id: `FINANCE-${index}`,
    }));
    payload.leaseRollDrafts = payload.projectData.scenarios.slice(0, 256)
      .map(({ id }) => draft({ scenarioId: id, rows: [] }));
    expect(validateProjectWorkspacePayload(payload).valid).toBe(true);
    payload.leaseRollDrafts.push(draft({ scenarioId: "FINANCE-256", rows: [] }));
    expect(validateProjectWorkspacePayload(payload).valid).toBe(false);
  });

  it("cleans replaced current-project plans before finance recomputation without dropping retained or foreign drafts", () => {
    const makePlan = (id: string, projectId = PROJECT_ID) => ({ ...createBlankPlanningScenario({ projectId }), id });
    const removedPlan = makePlan(SCENARIO_ID), retainedPlan = makePlan("retained"), foreignPlan = makePlan(SCENARIO_ID, OTHER_PROJECT_ID);
    const retainedKey = buildLeaseRollDraftKey(PROJECT_ID, "retained");
    useProjectStore.setState({ planningScenarios: [removedPlan, retainedPlan, foreignPlan], leaseRollDrafts: {
      [KEY]: draft(), [retainedKey]: draft({ scenarioId: "retained" }), [OTHER_KEY]: draft({ projectId: OTHER_PROJECT_ID }),
    } });
    const replacement = makePlan("replacement");
    useProjectStore.getState().setPlanningScenarios([retainedPlan, replacement]);
    expect(useProjectStore.getState().leaseRollDrafts).toEqual({
      [retainedKey]: draft({ scenarioId: "retained" }), [OTHER_KEY]: draft({ projectId: OTHER_PROJECT_ID }),
    });
    const nextData = structuredClone(useProjectStore.getState().data!);
    nextData.scenarios = nextData.scenarios.map(scenario => ({ ...scenario, id: replacement.id,
      _raw: { ...scenario._raw, id: replacement.id } }));
    useProjectStore.getState().setData(nextData);
    const payload = captureProjectWorkspace(PROJECT_ID)!;
    expect(payload.leaseRollDrafts).toEqual([draft({ scenarioId: "retained" })]);
    expect(validateProjectWorkspacePayload(payload).errors).toEqual([]);
  });

  it("keeps a stale basis savable and round-trips it without rebinding", () => {
    const { scenario } = precisionFixture();
    scenario.id = SCENARIO_ID;
    scenario.program.areaContract!.sourceScenarioId = SCENARIO_ID;
    const original = createLeaseRollDraft(PROJECT_ID, scenario, AT);
    scenario.program.areaContract!.sourceScenarioVersion! += 1;
    const payload = projectWorkspaceFixture(PROJECT_ID);
    payload.projectData.scenarios[0]._raw = scenario;
    applyProjectWorkspace(payload);
    const stale = { ...original, revision: 1 };
    expect(stale.sourceBasis).not.toBe(leaseRollBasis(PROJECT_ID, scenario));
    useProjectStore.getState().saveLeaseRollDraft(stale);
    const captured = captureProjectWorkspace(PROJECT_ID)!;
    expect(validateProjectWorkspacePayload(captured).valid).toBe(true);
    applyProjectWorkspace(JSON.parse(JSON.stringify(captured)));
    expect(useProjectStore.getState().leaseRollDrafts[KEY]).toEqual(stale);
    useProjectStore.getState().saveLeaseRollDraft({ ...stale, revision: 2 });
    expect(useProjectStore.getState().leaseRollDrafts[KEY].sourceBasis).toBe(original.sourceBasis);
  });

  it.each(["absent", "empty", "replacement"])(
    "applies %s drafts only to their project and preserves another project with the same scenario ID",
    (mode) => {
      applyProjectWorkspace(projectWorkspaceFixture(OTHER_PROJECT_ID));
      const otherDraft = draft({ projectId: OTHER_PROJECT_ID });
      useProjectStore.getState().saveLeaseRollDraft(otherDraft);
      const payload = projectWorkspaceFixture(PROJECT_ID);
      payload.projectData.scenarios.push({ ...payload.projectData.scenarios[0], id: "FINANCE-S2" });
      applyProjectWorkspace(payload);
      useProjectStore.getState().saveLeaseRollDraft(draft());
      useProjectStore.getState().saveLeaseRollDraft(draft({ scenarioId: "FINANCE-S2" }));
      expect(captureProjectWorkspace(PROJECT_ID)?.leaseRollDrafts).toHaveLength(2);
      const retained = useProjectStore.getState().leaseRollDrafts[OTHER_KEY];
      const replacement = draft({ revision: 7, rows: [] });
      if (mode === "empty") payload.leaseRollDrafts = [];
      if (mode === "replacement") payload.leaseRollDrafts = [replacement];
      applyProjectWorkspace(payload);
      expect(useProjectStore.getState().leaseRollDrafts).toEqual({
        [OTHER_KEY]: otherDraft,
        ...(mode === "replacement" ? { [KEY]: replacement } : {}),
      });
      expect(useProjectStore.getState().leaseRollDrafts[OTHER_KEY]).toBe(retained);
      expect(captureProjectWorkspace(PROJECT_ID)?.leaseRollDrafts)
        .toEqual(mode === "replacement" ? [replacement] : []);
    },
  );

  it("removes only the requested project/scenario draft and allows a new revision 1", () => {
    useProjectStore.getState().saveLeaseRollDraft(draft());
    applyProjectWorkspace(projectWorkspaceFixture(OTHER_PROJECT_ID));
    const otherDraft = draft({ projectId: OTHER_PROJECT_ID });
    useProjectStore.getState().saveLeaseRollDraft(otherDraft);
    useProjectStore.getState().removeLeaseRollDraft(PROJECT_ID, SCENARIO_ID);
    expect(useProjectStore.getState().leaseRollDrafts).toEqual({ [OTHER_KEY]: otherDraft });
    applyProjectWorkspace(projectWorkspaceFixture(PROJECT_ID));
    useProjectStore.getState().saveLeaseRollDraft(draft());
    expect(useProjectStore.getState().leaseRollDrafts[KEY].revision).toBe(1);
  });

  it("never changes planning, representative geometry, finance or a saved Stage 3 snapshot", () => {
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
    const originalPayload = structuredClone(payload);
    applyProjectWorkspace(payload);
    const before = useProjectStore.getState();
    const baseline = structuredClone(captureProjectWorkspace(PROJECT_ID)!);
    const candidate = {
      ...createLeaseRollDraft(PROJECT_ID, f.data.scenarios[0]._raw, AT),
      revision: 1,
      rows: draft().rows,
    };
    before.saveLeaseRollDraft(candidate);
    const after = useProjectStore.getState();
    for (const key of Object.keys(before) as (keyof typeof before)[]) {
      if (key !== "leaseRollDrafts") expect(after[key]).toBe(before[key]);
    }
    expect(captureProjectWorkspace(PROJECT_ID)).toEqual({ ...baseline, leaseRollDrafts: [candidate] });
    expect(validateProjectWorkspacePayload(captureProjectWorkspace(PROJECT_ID)).valid).toBe(true);
    applyProjectWorkspace(JSON.parse(JSON.stringify(captureProjectWorkspace(PROJECT_ID))));
    expect(useProjectStore.getState().stage3FeasibilitySnapshots[PROJECT_ID]).toEqual(baseline.stage3Snapshot);
    useProjectStore.getState().removeLeaseRollDraft(PROJECT_ID, candidate.scenarioId);
    expect(captureProjectWorkspace(PROJECT_ID)).toEqual(JSON.parse(JSON.stringify(baseline)));
    expect(payload).toEqual(originalPayload);
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
      userId: "lease-user-a", orgId: "lease-org-a", role: "analyst", reviewerRoles: [],
      name: "A", email: "a@example.com", organization: "A", capabilities: ["project.read"],
    };
    const { clientSession } = await import("@/lib/auth/client-session");
    const { useProjectStore: store } = await import("@/lib/stores/project-store");
    localStorage.setItem("parcelgrid-envelope", JSON.stringify({
      state: { leaseRollDrafts: { [OTHER_KEY]: draft({ projectId: OTHER_PROJECT_ID }) } }, version: 0,
    }));
    expect(store.persist.hasHydrated()).toBe(false);
    expect(store.getState().leaseRollDrafts).toEqual({});
    clientSession.activate(account);
    await store.persist.rehydrate();
    expect(store.getState().leaseRollDrafts).toEqual({});
    store.setState({ data: projectWorkspaceFixture(PROJECT_ID).projectData });
    store.getState().saveLeaseRollDraft(draft());
    const storageKey = clientSession.storageKey("parcelgrid-envelope")!;
    const persisted = localStorage.getItem(storageKey)!;
    expect(JSON.parse(persisted).state.leaseRollDrafts).toEqual({ [KEY]: draft() });
    store.setState({ leaseRollDrafts: {} });
    localStorage.setItem(storageKey, persisted);
    await store.persist.rehydrate();
    expect(store.getState().leaseRollDrafts).toEqual({ [KEY]: draft() });
    clientSession.invalidate();
    store.setState(store.getInitialState(), true);
    expect(store.getState().leaseRollDrafts).toEqual({});
    expect(localStorage.getItem(storageKey)).toBe(persisted);
    expect(() => store.getState().saveLeaseRollDraft(draft())).toThrow();

    vi.resetModules();
    const nextSession = (await import("@/lib/auth/client-session")).clientSession;
    const nextStore = (await import("@/lib/stores/project-store")).useProjectStore;
    nextSession.activate({ ...account, userId: "lease-user-b", orgId: "lease-org-b" });
    await nextStore.persist.rehydrate();
    expect(nextStore.getState().leaseRollDrafts).toEqual({});
    expect(localStorage.getItem(storageKey)).toBe(persisted);
    nextSession.invalidate();
    nextStore.setState(nextStore.getInitialState(), true);
  });
});
