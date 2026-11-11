import { describe, expect, it } from "vitest";
import { canShowSavedFinance, describeNextAction, displayNumber, haveInputsChanged, isWorkspaceRole, projectHref, safeEvidenceUrl, type OverviewReadiness } from "@/components/workspace/presentation";

const ready: OverviewReadiness = {
  projectMatches: true, geometryReady: true, snapshotPresent: true, snapshotAligned: true,
  financeReady: true, inputsChanged: false, regulatoryVerified: true, sourceBacked: true,
};
describe("workspace presentation (no engine calculation)", () => {
  it("shows a matching saved result", () => expect(canShowSavedFinance(ready)).toBe(true));
  for (const field of ["projectMatches", "geometryReady", "snapshotPresent", "snapshotAligned", "financeReady"] as const) {
    it(`hides numbers when ${field} is false`, () => expect(canShowSavedFinance({ ...ready, [field]: false })).toBe(false));
  }
  it("hides saved numbers after input edits", () => expect(canShowSavedFinance({ ...ready, inputsChanged: true })).toBe(false));
  it("keeps source warnings separate from provisional saved figures", () => {
    const state = { ...ready, sourceBacked: false };
    expect(canShowSavedFinance(state)).toBe(true);
    expect(describeNextAction(state).path).toBe("#source-data-room");
  });
  it("does not call a regulatory evidence gap development failure", () => {
    expect(describeNextAction({ ...ready, regulatoryVerified: false }).state).toBe("근거 검토");
  });
  it("detects exact input changes without doing financial arithmetic", () => {
    expect(haveInputsChanged({ rate: 5 }, { rate: 6 }, {})).toBe(true);
    expect(haveInputsChanged({ rate: 5 }, { rate: 5 }, {})).toBe(false);
    expect(haveInputsChanged({ rate: 5 }, { rate: 6 }, { rate: { value: 5 } })).toBe(false);
    expect(haveInputsChanged({ rate: 5 }, {}, { rate: { value: Number.NaN } })).toBe(true);
  });
  it("treats zero as a real value and missing/nonfinite values as absent", () => {
    expect(displayNumber(0)).toBe("0");
    for (const value of [undefined, null, Number.NaN, Infinity]) expect(displayNumber(value)).toBe("—");
  });
  it("accepts only the four view presets", () => {
    for (const role of ["public", "architect", "developer", "insurer"]) expect(isWorkspaceRole(role)).toBe(true);
    for (const role of ["admin", "__proto__", "constructor", ""]) expect(isWorkspaceRole(role)).toBe(false);
  });
  it("makes safe routes for the existing root and source anchor", () => {
    expect(projectHref("P1", "")).toBe("/projects/P1");
    expect(projectHref("P1", "#source-data-room")).toBe("/projects/P1#source-data-room");
    expect(projectHref("P/1", "report/brief")).toBe("/projects/P%2F1/report/brief");
  });
  it("never executes a stored documentRef as a URL", () => {
    expect(safeEvidenceUrl("https://example.com/evidence")).toBe("https://example.com/evidence");
    for (const value of ["javascript:alert(1)", "data:text/html,test", "file:///secret", "CONTRACT-1", ""]) expect(safeEvidenceUrl(value)).toBeNull();
  });
  it("does not mutate readiness or numeric inputs", () => {
    const state = Object.freeze({ ...ready });
    const saved = Object.freeze({ rate: 5 });
    const drafts = Object.freeze({ rate: 6 });
    describeNextAction(state); haveInputsChanged(saved, drafts, {});
    expect(state).toEqual(ready); expect(saved.rate).toBe(5); expect(drafts.rate).toBe(6);
  });
});
