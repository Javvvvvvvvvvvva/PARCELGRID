import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicAccessPrincipal } from "@/lib/auth/client-session";
import { createLeaseRollRow, LEASE_ROLL_VERSION } from "@/lib/finance/lease-roll-contract";
import type { LeaseRollEditorRecovery } from "@/lib/finance/lease-roll-editor-recovery";

const principal: PublicAccessPrincipal = { userId: "synthetic-a", orgId: "org-a", role: "analyst", reviewerRoles: [],
  email: "a@example.test", name: "A", organization: "A", capabilities: ["project.read", "project.update", "analysis.run"] };
function value(projectId = "P1", scenarioId = "S1"): LeaseRollEditorRecovery {
  return { draft: { version: LEASE_ROLL_VERSION, projectId, scenarioId, sourceBasis: "a".repeat(64), revision: 0,
    updatedAt: "2026-11-11T00:00:00.000Z", calendarStart: null, rows: [{ ...createLeaseRollRow("row"), unitId: "", monthlyRentWon: -1 }] },
    savedKey: "null", cleanKey: "original", invalidNumbers: { "row:monthlyRentWon": true } };
}
beforeEach(() => vi.resetModules());
async function setup() {
  const { clientSession } = await import("@/lib/auth/client-session");
  const recovery = await import("@/lib/finance/lease-roll-editor-recovery");
  return { clientSession, ...recovery };
}
describe("per-tab lease editor recovery", () => {
  it("retains incomplete and invalid edits independently of a valid server contract", async () => {
    const api = await setup(); api.clientSession.activate(principal);
    const draft = value(); api.writeLeaseRollEditorRecovery(draft);
    expect(api.readLeaseRollEditorRecovery("P1", "S1")).toEqual(draft);
    draft.draft.rows[0].unitId = "changed after write";
    expect(api.readLeaseRollEditorRecovery("P1", "S1")!.draft.rows[0].unitId).toBe("");
    const read = api.readLeaseRollEditorRecovery("P1", "S1")!; read.savedKey = "changed after read";
    expect(api.readLeaseRollEditorRecovery("P1", "S1")!.savedKey).toBe("null");
  });
  it("keeps project/scenario contexts separate and clears only the selected draft", async () => {
    const api = await setup(); api.clientSession.activate(principal);
    for (const draft of [value(), value("P2"), value("P1", "S2")]) api.writeLeaseRollEditorRecovery(draft);
    api.clearLeaseRollEditorRecovery("P1", "S1");
    expect(api.readLeaseRollEditorRecovery("P1", "S1")).toBeNull();
    expect(api.readLeaseRollEditorRecovery("P2", "S1")).toEqual(value("P2"));
    expect(api.readLeaseRollEditorRecovery("P1", "S2")).toEqual(value("P1", "S2"));
  });
  it("does not retain data before activation or after logout", async () => {
    const api = await setup();
    expect(() => api.writeLeaseRollEditorRecovery(value())).toThrow();
    expect(api.readLeaseRollEditorRecovery("P1", "S1")).toBeNull();
    api.clientSession.activate(principal); api.writeLeaseRollEditorRecovery(value()); api.clientSession.invalidate();
    expect(api.readLeaseRollEditorRecovery("P1", "S1")).toBeNull();
    expect(() => api.writeLeaseRollEditorRecovery(value())).toThrow();
  });
  it("rejects identity switching in one document and exposes no prior draft to the new document", async () => {
    const first = await setup(); first.clientSession.activate(principal); first.writeLeaseRollEditorRecovery(value());
    expect(() => first.clientSession.activate({ ...principal, userId: "B", orgId: "org-b" })).toThrow();
    expect(first.readLeaseRollEditorRecovery("P1", "S1")).toBeNull();
    vi.resetModules(); const next = await setup(); next.clientSession.activate({ ...principal, userId: "B", orgId: "org-b" });
    expect(next.readLeaseRollEditorRecovery("P1", "S1")).toBeNull();
  });
});
