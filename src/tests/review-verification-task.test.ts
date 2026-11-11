import { describe, expect, it } from "vitest";
import { prepareReviewVerification } from "@/lib/handoff/review-verification-task";
import { buildIntegratedVerification } from "@/lib/handoff/integrated-verification";
import { buildReviewSnapshotPayload, buildServerReviewSnapshotKey } from "@/lib/handoff/review-snapshot";
import { integratedVerificationFixture } from "./helpers/integrated-verification-fixture";

describe("review worker domain parity", () => {
  it("preserves the entire saved packet and the exact server SHA-256 key", async () => {
    const fixture = integratedVerificationFixture();
    const input = { snapshot: { ...fixture, savedAt: "2026-10-29T00:00:00Z" }, planningScenario: fixture.planningScenario,
      geometry: fixture.geometry, financialSources: {}, priceVerifications: {} };
    const before = structuredClone(input), expected = buildReviewSnapshotPayload(input);
    const result = await prepareReviewVerification({ kind: "saved", input });
    expect(result).toEqual({ kind: "saved", payload: expected, snapshotKey: await buildServerReviewSnapshotKey(expected) });
    expect(input).toEqual(before);
    expect(expected.verification.approvalStatus).toBe("unverified");
  });

  it("returns the same unsealed preview including all missing/conflicting findings", async () => {
    const input = integratedVerificationFixture(); input.geometry = null;
    const expected = buildIntegratedVerification(input);
    expect(await prepareReviewVerification({ kind: "preview", input })).toEqual({ kind: "preview", report: expected });
    expect(expected.status).not.toBe("preliminary");
    expect(expected.approvalStatus).toBe("unverified");
  });
});
