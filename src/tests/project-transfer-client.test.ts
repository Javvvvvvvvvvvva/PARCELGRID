import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureProjectTransferBundle, projectTransferWorkspaceKey, prepareCurrentProjectTransfer, applyCurrentProjectTransfer } from "@/lib/handoff/project-transfer-client";
import { createProjectTransferBundle, type ProjectTransferBundle } from "@/lib/handoff/project-transfer";
import { createLeaseRollDraft, buildLeaseRollDraftKey } from "@/lib/finance/lease-roll-contract";
import { createOperatingBudgetDraft, buildOperatingBudgetDraftKey } from "@/lib/finance/operating-budget-contract";
import { buildRevenuePricingDraftKey, REVENUE_PRICING_INPUT_VERSION, type RevenuePricingDraftContract } from "@/lib/finance/revenue-contract";
import { buildExpertTaxContractKey, createDraftExpertTaxContract } from "@/lib/finance/after-tax-ledger";
import { useProjectStore } from "@/lib/stores/project-store";
import { useReviewStore } from "@/lib/stores/review-store";
import { applyProjectWorkspace, captureProjectWorkspace } from "@/lib/workspace/project-workspace-client";
import { validateProjectWorkspacePayload } from "@/lib/workspace/project-workspace";
import { createBlankPlanningScenario } from "@/lib/planning/scenario-utils";
import { projectWorkspaceFixture } from "./helpers/project-workspace-fixture";
import { precisionFixture } from "./helpers/finance-precision-fixture";

const session = vi.hoisted(() => ({ active: true, context: "org/user", capabilities: ["project.read", "project.update"], clearLease: vi.fn(), clearBudget: vi.fn() }));
vi.mock("@/lib/auth/client-session", async original => ({
  ...await original<typeof import("@/lib/auth/client-session")>(),
  clientSession: {
    get active() { return session.active; }, get context() { return session.context; },
    get principal() { return { capabilities: session.capabilities }; },
    assertActive() { if (!session.active) throw new Error("Session inactive"); },
    subscribe() { return () => {}; },
  },
}));
vi.mock("@/lib/finance/lease-roll-editor-recovery", () => ({ clearLeaseRollEditorRecovery: session.clearLease }));
vi.mock("@/lib/finance/operating-budget-editor-recovery", () => ({ clearOperatingBudgetEditorRecovery: session.clearBudget }));

const P = "transfer-project", FOREIGN = "foreign-project", S = "FINANCE-S1";
function pricing(projectId = P, scenarioId = S): RevenuePricingDraftContract {
  return { version: REVENUE_PRICING_INPUT_VERSION, projectId, scenarioId, updatedAt: "2026-11-11T00:00:00.000Z", pools: {} };
}
function tax(projectId: string, scenarioId: string) {
  return createDraftExpertTaxContract({ projectId, scenarioId, strategy: "stabilized-sale",
    preTaxEquityCashFlowsManwon: [-100, 120], preTaxAcquisitionTaxManwon: 0, equityHurdleRatePct: 10 });
}
function fixture(projectId = P, scenarioId = S) {
  const workspace = projectWorkspaceFixture(projectId);
  workspace.projectData.scenarios[0].id = scenarioId;
  workspace.planningScenarios = [{ ...createBlankPlanningScenario({ projectId }), id: scenarioId }];
  const { scenario } = precisionFixture(); scenario.id = scenarioId; scenario.program.areaContract!.sourceScenarioId = scenarioId;
  workspace.leaseRollDrafts = [{ ...createLeaseRollDraft(projectId, scenario), sourceBasis: "1".repeat(64), revision: 7 }];
  workspace.operatingBudgetDrafts = [{ ...createOperatingBudgetDraft(projectId, scenario), sourceBasis: "2".repeat(64), revision: 8 }];
  workspace.revenuePricingDrafts = [pricing(projectId, scenarioId)];
  return workspace;
}
function args(bundle = captureProjectTransferBundle(P, session.context)) {
  return { bundle, projectId: P, sessionContext: session.context, expectedWorkspaceKey: projectTransferWorkspaceKey(P)! };
}
function resign(bundle: ProjectTransferBundle) {
  return createProjectTransferBundle({ projectId: bundle.projectId, payload: bundle.payload, exportedAt: bundle.exportedAt });
}
function snapshot() { return { project: useProjectStore.getState(), review: useReviewStore.getState() }; }

describe("project transfer client boundary", () => {
  beforeEach(() => {
    useProjectStore.setState(useProjectStore.getInitialState(), true);
    useReviewStore.setState(useReviewStore.getInitialState(), true);
    session.active = true; session.context = "org/user"; session.capabilities = ["project.read", "project.update"];
    session.clearLease.mockClear(); session.clearBudget.mockClear();
    applyProjectWorkspace(fixture());
  });
  afterEach(() => {
    useProjectStore.setState(useProjectStore.getInitialState(), true);
    useReviewStore.setState(useReviewStore.getInitialState(), true);
  });

  it("exports all three scoped draft collections and pending finance-only assumptions", () => {
    useProjectStore.setState({ pendingOverrides: [{ scenarioId: S, field: "salePricePerSqM", baseValue: 1, overrideValue: 2 }], draftAssumptions: { [S]: { salePricePerSqM: 2 } } });
    const bundle = captureProjectTransferBundle(P, session.context);
    const workspace = captureProjectWorkspace(P)!;
    for (const field of ["leaseRollDrafts", "operatingBudgetDrafts", "revenuePricingDrafts", "pendingOverrides", "draftAssumptions"] as const) {
      expect(bundle.payload[field]).toEqual(workspace[field]);
    }
    expect(bundle.payload.expertReviews).toEqual({});
    expect(bundle.payload).not.toHaveProperty("version");
    expect(bundle.payload).not.toHaveProperty("representativeParcelBasisHash");
  });

  it("prepares a valid import without writing either store or clearing recovery", () => {
    const input = args(), before = snapshot();
    const prepared = prepareCurrentProjectTransfer(input);
    expect(validateProjectWorkspacePayload(prepared, P).errors).toEqual([]);
    expect(snapshot()).toEqual(before);
    expect(session.clearLease).not.toHaveBeenCalled(); expect(session.clearBudget).not.toHaveBeenCalled();
    expect(prepared.leaseRollDrafts).toEqual(input.bundle.payload.leaseRollDrafts);
    expect(prepared.operatingBudgetDrafts).toEqual(input.bundle.payload.operatingBudgetDrafts);
  });

  it("preserves stale source bases and revisions without adopting financial changes", () => {
    const input = args(), data = useProjectStore.getState().data;
    applyCurrentProjectTransfer(input);
    const workspace = captureProjectWorkspace(P)!;
    expect(workspace.projectData).toEqual(data);
    expect(workspace.leaseRollDrafts![0]).toMatchObject({ sourceBasis: "1".repeat(64), revision: 7 });
    expect(workspace.operatingBudgetDrafts![0]).toMatchObject({ sourceBasis: "2".repeat(64), revision: 8 });
  });

  it("preserves foreign same-ID plans, all scoped drafts and authoritative reviews", () => {
    const foreign = fixture(FOREIGN);
    const current = useProjectStore.getState();
    const foreignPlan = foreign.planningScenarios[0];
    useProjectStore.setState({
      planningScenarios: [...current.planningScenarios, foreignPlan],
      leaseRollDrafts: { ...current.leaseRollDrafts, [buildLeaseRollDraftKey(FOREIGN, S)]: foreign.leaseRollDrafts![0] },
      operatingBudgetDrafts: { ...current.operatingBudgetDrafts, [buildOperatingBudgetDraftKey(FOREIGN, S)]: foreign.operatingBudgetDrafts![0] },
      revenuePricingDrafts: { ...current.revenuePricingDrafts, [buildRevenuePricingDraftKey(FOREIGN, S)]: foreign.revenuePricingDrafts[0] },
    });
    const reviews = { [P]: {}, [FOREIGN]: {} }; useReviewStore.setState({ expertReviews: reviews });
    applyCurrentProjectTransfer(args());
    const after = useProjectStore.getState();
    expect(after.planningScenarios.find(value => value.projectId === FOREIGN)).toBe(foreignPlan);
    expect(after.leaseRollDrafts[buildLeaseRollDraftKey(FOREIGN, S)]).toEqual(foreign.leaseRollDrafts![0]);
    expect(after.operatingBudgetDrafts[buildOperatingBudgetDraftKey(FOREIGN, S)]).toEqual(foreign.operatingBudgetDrafts![0]);
    expect(after.revenuePricingDrafts[buildRevenuePricingDraftKey(FOREIGN, S)]).toEqual(foreign.revenuePricingDrafts[0]);
    expect(useReviewStore.getState().expertReviews).toBe(reviews);
    expect(session.clearLease.mock.calls).toEqual([[P, S]]); expect(session.clearBudget.mock.calls).toEqual([[P, S]]);
  });

  it("replaces omitted legacy collections with empty target collections", () => {
    const bundle = captureProjectTransferBundle(P, session.context);
    delete bundle.payload.leaseRollDrafts; delete bundle.payload.operatingBudgetDrafts;
    delete bundle.payload.revenuePricingDrafts; delete bundle.payload.pendingOverrides;
    applyCurrentProjectTransfer(args(resign(bundle)));
    const workspace = captureProjectWorkspace(P)!;
    expect(workspace.leaseRollDrafts).toEqual([]); expect(workspace.operatingBudgetDrafts).toEqual([]);
    expect(workspace.revenuePricingDrafts).toEqual([]); expect(workspace.pendingOverrides).toEqual([]);
    expect(validateProjectWorkspacePayload(workspace).errors).toEqual([]);
  });

  it("clears old finance-only pending assumptions when replacing finance IDs", () => {
    useProjectStore.setState({ planningScenarios: [], pendingOverrides: [{ scenarioId: S, field: "salePricePerSqM", baseValue: 1, overrideValue: 2 }], draftAssumptions: { [S]: { salePricePerSqM: 2 } } });
    const incoming = fixture(P, "NEXT-FINANCE");
    const bundle = captureProjectTransferBundle(P, session.context);
    bundle.payload = { ...bundle.payload, projectData: incoming.projectData, planningScenarios: incoming.planningScenarios,
      draftAssumptions: incoming.draftAssumptions, pendingOverrides: incoming.pendingOverrides,
      leaseRollDrafts: incoming.leaseRollDrafts, operatingBudgetDrafts: incoming.operatingBudgetDrafts,
      revenuePricingDrafts: incoming.revenuePricingDrafts };
    applyCurrentProjectTransfer(args(resign(bundle)));
    const current = useProjectStore.getState();
    expect(current.pendingOverrides).toEqual([]); expect(current.draftAssumptions).not.toHaveProperty(S);
    expect(validateProjectWorkspacePayload(captureProjectWorkspace(P)).errors).toEqual([]);
  });

  it.each(["inactive", "identity", "project", "capability", "content", "tampered"])("rejects %s changes before any writes", kind => {
    const input = args();
    if (kind === "inactive") session.active = false;
    if (kind === "identity") session.context = "other/user";
    if (kind === "project") useProjectStore.setState({ data: fixture(FOREIGN).projectData });
    if (kind === "capability") session.capabilities = ["project.read"];
    if (kind === "content") useProjectStore.setState({ draftAcquisitionPrices: { [P]: 25 } });
    if (kind === "tampered") input.bundle.payload.draftAcquisitionPrice = 123;
    const before = snapshot();
    expect(() => applyCurrentProjectTransfer(input)).toThrow(); expect(snapshot()).toEqual(before);
    expect(session.clearLease).not.toHaveBeenCalled(); expect(session.clearBudget).not.toHaveBeenCalled();
  });

  it.each(["current-assumption", "incoming-assumption", "current-override", "incoming-override"])("rejects ambiguous unscoped %s without removing foreign data", kind => {
    const bundle = captureProjectTransferBundle(P, session.context);
    const current = useProjectStore.getState();
    useProjectStore.setState({ planningScenarios: [...current.planningScenarios, fixture(FOREIGN).planningScenarios[0]] });
    if (kind === "current-assumption") useProjectStore.setState({ draftAssumptions: { [S]: { salePricePerSqM: 2 } } });
    if (kind === "incoming-assumption") bundle.payload.draftAssumptions = { [S]: { salePricePerSqM: 2 } };
    const override = { scenarioId: S, field: "salePricePerSqM" as const, baseValue: 1, overrideValue: 2 };
    if (kind === "current-override") useProjectStore.setState({ pendingOverrides: [override] });
    if (kind === "incoming-override") bundle.payload.pendingOverrides = [override];
    const input = args(resign(bundle)), before = snapshot();
    expect(() => applyCurrentProjectTransfer(input)).toThrow(/같은 계획 ID/);
    expect(snapshot()).toEqual(before);
  });

  it("rejects a legacy pricing storage-key collision before any mutation", () => {
    applyProjectWorkspace(fixture("a", "b::c"));
    const current = useProjectStore.getState();
    useProjectStore.setState({ revenuePricingDrafts: { ...current.revenuePricingDrafts, [buildRevenuePricingDraftKey("a::b", "c")]: pricing("a::b", "c") } });
    const bundle = createProjectTransferBundle({ projectId: "a", payload: {
      ...captureProjectTransferBundle("a", session.context).payload, revenuePricingDrafts: [pricing("a", "b::c")],
    } });
    const before = snapshot();
    expect(() => applyCurrentProjectTransfer({ bundle, projectId: "a", sessionContext: session.context, expectedWorkspaceKey: projectTransferWorkspaceKey("a")! })).toThrow(/저장 키/);
    expect(snapshot()).toEqual(before);
  });

  it.each(["pricing", "lease", "budget", "tax", "snapshot"])("rejects foreign finance-only ownership evidenced by %s before clearing unscoped edits", kind => {
    const bundle = captureProjectTransferBundle(P, session.context);
    applyProjectWorkspace(fixture(P, "LOCAL"));
    const current = useProjectStore.getState(), foreign = fixture(FOREIGN);
    if (kind === "pricing") useProjectStore.setState({ revenuePricingDrafts: { ...current.revenuePricingDrafts, [buildRevenuePricingDraftKey(FOREIGN, S)]: foreign.revenuePricingDrafts[0] } });
    if (kind === "lease") useProjectStore.setState({ leaseRollDrafts: { ...current.leaseRollDrafts, [buildLeaseRollDraftKey(FOREIGN, S)]: foreign.leaseRollDrafts![0] } });
    if (kind === "budget") useProjectStore.setState({ operatingBudgetDrafts: { ...current.operatingBudgetDrafts, [buildOperatingBudgetDraftKey(FOREIGN, S)]: foreign.operatingBudgetDrafts![0] } });
    if (kind === "tax") useProjectStore.setState({ expertTaxContracts: { [buildExpertTaxContractKey(FOREIGN, S, "stabilized-sale")]: tax(FOREIGN, S) } });
    if (kind === "snapshot") useProjectStore.setState({ stage3FeasibilitySnapshots: { [FOREIGN]: {
      projectId: FOREIGN, representativeScenarioId: "FOREIGN-PLAN", representativeScenarioVersion: 1,
      geometryHash: "foreign-geometry", savedAt: "2026-11-11T00:00:00.000Z", data: foreign.projectData,
    } } });
    useProjectStore.setState({ draftAssumptions: { [S]: { salePricePerSqM: 2 } }, pendingOverrides: [
      { scenarioId: S, field: "salePricePerSqM", baseValue: 1, overrideValue: 2 },
    ] });
    const input = args(bundle), before = snapshot();
    expect(() => applyCurrentProjectTransfer(input)).toThrow(/같은 계획 ID/);
    expect(snapshot()).toEqual(before);
  });

  it("rejects a tax-contract storage-key collision without overwriting foreign authority or drafts", () => {
    applyProjectWorkspace(fixture("a", "b::c"));
    const foreign = tax("a::b", "c"), incoming = tax("a", "b::c");
    useProjectStore.setState({ expertTaxContracts: { [buildExpertTaxContractKey("a::b", "c", "stabilized-sale")]: foreign } });
    const bundle = captureProjectTransferBundle("a", session.context);
    bundle.payload.expertTaxContracts = [incoming];
    const before = snapshot();
    expect(() => applyCurrentProjectTransfer({ bundle: resign(bundle), projectId: "a", sessionContext: session.context,
      expectedWorkspaceKey: projectTransferWorkspaceKey("a")! })).toThrow(/세무 초안 저장 키/);
    expect(snapshot()).toEqual(before);
  });

  it("allows a read-only export but never import", () => {
    session.capabilities = ["project.read"];
    expect(captureProjectTransferBundle(P, session.context).projectId).toBe(P);
    expect(() => applyCurrentProjectTransfer(args())).toThrow(/권한/);
  });
  it("refuses export for another active project, inactive session or missing read capability", () => {
    expect(projectTransferWorkspaceKey(FOREIGN)).toBeNull();
    expect(() => captureProjectTransferBundle(FOREIGN, session.context)).toThrow();
    session.capabilities = []; expect(() => captureProjectTransferBundle(P, session.context)).toThrow();
    session.active = false; expect(() => captureProjectTransferBundle(P, session.context)).toThrow();
  });
});
