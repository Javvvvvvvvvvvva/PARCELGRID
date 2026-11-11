import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicAccessPrincipal } from "@/lib/auth/client-session";
import type { OperatingBudgetEditorRecovery } from "@/lib/finance/operating-budget-editor-recovery";

const principal: PublicAccessPrincipal = { userId: "synthetic-a", orgId: "org-a", role: "analyst", reviewerRoles: [],
  email: "a@example.test", name: "A", organization: "A", capabilities: ["project.read", "project.update", "analysis.run"] };
function value(projectId = "P1", scenarioId = "S1"): OperatingBudgetEditorRecovery {
  return { draft: { version: "operating-budget-2026.1", projectId, scenarioId, sourceBasis: "a".repeat(64), revision: 0,
    updatedAt: "2026-11-11T00:00:00.000Z", calendarStart: "2027-01-01", baselineCalendarStart: null,
    scopeConfirmed: false, allocationNote: "", categories: [{ category: "insurance", sourceName: "", sourceRef: "", sourceAsOf: null,
      amounts: [{ month: "2027-01", amountWon: -1 }] }] },
    savedKey: "null", cleanKey: "original", invalidNumbers: { "insurance:2027-01": true } };
}
beforeEach(() => vi.resetModules());
async function setup() {
  const { clientSession } = await import("@/lib/auth/client-session");
  const recovery = await import("@/lib/finance/operating-budget-editor-recovery");
  return { clientSession, ...recovery };
}
describe("per-tab operating budget recovery", () => {
  it("retains unfinished invalid inputs without sharing mutable references", async () => {
    const api = await setup(); api.clientSession.activate(principal);
    const draft = value(); api.writeOperatingBudgetEditorRecovery(draft);
    expect(api.readOperatingBudgetEditorRecovery("P1", "S1")).toEqual(draft);
    draft.draft.categories[0].amounts[0].amountWon = 123;
    expect(api.readOperatingBudgetEditorRecovery("P1", "S1")!.draft.categories[0].amounts[0].amountWon).toBe(-1);
    const read = api.readOperatingBudgetEditorRecovery("P1", "S1")!; read.savedKey = "altered";
    expect(api.readOperatingBudgetEditorRecovery("P1", "S1")!.savedKey).toBe("null");
  });
  it("isolates same-ID projects and clears only the requested draft", async () => {
    const api = await setup(); api.clientSession.activate(principal);
    for (const draft of [value(), value("P2"), value("P1", "S2")]) api.writeOperatingBudgetEditorRecovery(draft);
    api.clearOperatingBudgetEditorRecovery("P1", "S1");
    expect(api.readOperatingBudgetEditorRecovery("P1", "S1")).toBeNull();
    expect(api.readOperatingBudgetEditorRecovery("P2", "S1")).toEqual(value("P2"));
    expect(api.readOperatingBudgetEditorRecovery("P1", "S2")).toEqual(value("P1", "S2"));
  });
  it("clears at logout and refuses unauthenticated reads/writes", async () => {
    const api = await setup();
    expect(() => api.writeOperatingBudgetEditorRecovery(value())).toThrow();
    expect(api.readOperatingBudgetEditorRecovery("P1", "S1")).toBeNull();
    api.clientSession.activate(principal); api.writeOperatingBudgetEditorRecovery(value()); api.clientSession.invalidate();
    expect(api.readOperatingBudgetEditorRecovery("P1", "S1")).toBeNull();
    expect(() => api.writeOperatingBudgetEditorRecovery(value())).toThrow();
  });
  it("never transfers a prior identity's recovery into a new session", async () => {
    const first = await setup(); first.clientSession.activate(principal); first.writeOperatingBudgetEditorRecovery(value());
    expect(() => first.clientSession.activate({ ...principal, userId: "B", orgId: "org-b" })).toThrow();
    expect(first.readOperatingBudgetEditorRecovery("P1", "S1")).toBeNull();
    vi.resetModules(); const next = await setup(); next.clientSession.activate({ ...principal, userId: "B", orgId: "org-b" });
    expect(next.readOperatingBudgetEditorRecovery("P1", "S1")).toBeNull();
  });
});
