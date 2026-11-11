import { molitEvidenceFixture } from "./helpers/molit-evidence-fixture";
import { describe, expect, it } from "vitest";
import {
  buildReviewSnapshotPayload,
  buildReviewSnapshotKey,
  buildServerReviewSnapshotKey,
  validateReviewSnapshotPayload,
  validateReviewSnapshotAlignment,
  type ReviewableStage3Snapshot,
} from "@/lib/handoff/review-snapshot";
import type { PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import { PROJECT_CALCULATION_VERSION, type ProjectComputed } from "@/lib/services/compute-project";
import { createDraftExpertTaxContract } from "@/lib/finance/after-tax-ledger";
import { createRevenuePricingSnapshot } from "@/lib/finance/revenue-contract";
import { integratedVerificationFixture } from "./helpers/integrated-verification-fixture";
import { DEFAULT_VEHICLE_PROFILE } from "@/lib/planning/vehicle-circulation";

function revenuePricing(retailSalePricePerSqM: number) {
  return createRevenuePricingSnapshot({
    unitPricesWon: {
      residentialSale: 0,
      retailSale: retailSalePricePerSqM,
      officeSale: 0,
      residentialLease: 0,
      retailLease: 0,
      officeLease: 0,
    },
    vacancyRatePct: 0,
    capRatePct: 5,
  });
}

function computed(acquiredPrice = 100_000, lastSyncedAt = "2026-08-21T10:00:00.000Z") {
  return {
    parcel: {
      id: "P1",
      address: "서울 테스트",
      lotArea: 100,
      acquiredPrice,
    },
    scenarios: [
      {
        id: "S1",
        recommended: true,
        _raw: {
          id: "S1",
          name: "대표안",
          shortName: "대표",
          program: { floorsAbove: 4 },
          assumptions: { salePricePerSqM: 10_000_000 },
        },
      },
    ],
    pfSchedule: [],
    parcelRisks: [],
    comps: [],
    maxAcquisition: [],
    meta: {
      lastSyncedAt,
      version: PROJECT_CALCULATION_VERSION,
    },
  } as unknown as ProjectComputed;
}

function snapshot(
  data = computed(),
  overrides: Partial<ReviewableStage3Snapshot> = {}
): ReviewableStage3Snapshot {
  return {
    projectId: "P1",
    representativeScenarioId: "S1",
    representativeScenarioVersion: 3,
    geometryHash: "GEO-1",
    savedAt: "2026-08-21T10:00:00.000Z",
    data,
    ...overrides,
  };
}

function geometry(
  overrides: Partial<PlanningGeometrySnapshot> = {}
): PlanningGeometrySnapshot {
  return {
    projectId: "P1",
    scenarioId: "S1",
    scenarioVersion: 3,
    geometryHash: "GEO-1",
    validation: {
      status: "pass",
      representativeEligible: true,
      exportable: true,
    },
    ...overrides,
  } as unknown as PlanningGeometrySnapshot;
}

describe("review snapshot fingerprint", () => {
  it("invalidates review identity when transaction evidence changes", () => {
    const data = computed();
    const oldKey = buildReviewSnapshotKey({ snapshot: snapshot(data), financialSources: {}, priceVerifications: {} });
    data.transactionEvidence = [molitEvidenceFixture()];
    const nextKey = buildReviewSnapshotKey({ snapshot: snapshot(data), financialSources: {}, priceVerifications: {} });
    expect(nextKey).not.toBe(oldKey);
  });
  it("builds a stable cryptographic server key and validates project scope", async () => {
    const payload = buildReviewSnapshotPayload({
      snapshot: snapshot(),
      financialSources: {},
      priceVerifications: {},
    });
    const timestampOnly = buildReviewSnapshotPayload({
      snapshot: snapshot(
        computed(100_000, "2026-08-23T09:00:00.000Z"),
        { savedAt: "2026-08-23T09:00:00.000Z" },
      ),
      financialSources: {},
      priceVerifications: {},
    });

    await expect(buildServerReviewSnapshotKey(payload)).resolves.toMatch(
      /^PG-REVIEW-SHA256-[A-F0-9]{64}$/,
    );
    await expect(buildServerReviewSnapshotKey(timestampOnly)).resolves.toBe(
      await buildServerReviewSnapshotKey(payload),
    );
    expect(validateReviewSnapshotPayload(payload, "P1").valid).toBe(true);
    expect(validateReviewSnapshotPayload(payload, "P2")).toMatchObject({
      valid: false,
    });
  });

  it("stays stable when only save/sync timestamps change", () => {
    const first = buildReviewSnapshotKey({
      snapshot: snapshot(),
      financialSources: {},
      priceVerifications: {},
    });
    const second = buildReviewSnapshotKey({
      snapshot: snapshot(
        computed(100_000, "2026-08-22T09:00:00.000Z"),
        { savedAt: "2026-08-22T09:00:00.000Z" }
      ),
      financialSources: {},
      priceVerifications: {},
    });

    expect(second).toBe(first);
  });

  it("changes when a material financial input changes", () => {
    const first = buildReviewSnapshotKey({
      snapshot: snapshot(computed(100_000)),
      financialSources: {},
      priceVerifications: {},
    });
    const changed = buildReviewSnapshotKey({
      snapshot: snapshot(computed(120_000)),
      financialSources: {},
      priceVerifications: {},
    });

    expect(changed).not.toBe(first);
  });

  it("changes when an independent revenue pool price changes", () => {
    const original = computed();
    original.scenarios[0]._raw.revenuePricing = revenuePricing(7_000_000);
    const repriced = structuredClone(original);
    repriced.scenarios[0]._raw.revenuePricing = revenuePricing(7_500_000);

    const first = buildReviewSnapshotKey({
      snapshot: snapshot(original),
      financialSources: {},
      priceVerifications: {},
    });
    const changed = buildReviewSnapshotKey({
      snapshot: snapshot(repriced),
      financialSources: {},
      priceVerifications: {},
    });

    expect(changed).not.toBe(first);
  });

  it("changes when a tax payment changes but ignores the contract save timestamp", () => {
    const contract = createDraftExpertTaxContract({
      projectId: "P1",
      scenarioId: "S1",
      strategy: "stabilized-sale",
      preTaxEquityCashFlowsManwon: [-100, 120],
      preTaxAcquisitionTaxManwon: 10,
      equityHurdleRatePct: 10,
      updatedAt: "2026-08-21T00:00:00.000Z",
    });
    const first = buildReviewSnapshotKey({
      snapshot: snapshot(),
      financialSources: {},
      priceVerifications: {},
      expertTaxContracts: [contract],
    });
    const timestampOnly = buildReviewSnapshotKey({
      snapshot: snapshot(),
      financialSources: {},
      priceVerifications: {},
      expertTaxContracts: [
        { ...contract, updatedAt: "2026-08-22T00:00:00.000Z" },
      ],
    });
    const changed = buildReviewSnapshotKey({
      snapshot: snapshot(),
      financialSources: {},
      priceVerifications: {},
      expertTaxContracts: [
        {
          ...contract,
          assessments: contract.assessments.map((assessment) =>
            assessment.category === "corporate-or-income-tax"
              ? {
                  ...assessment,
                  assessmentStatus: "confirmed",
                  note: "세무조정 반영",
                  payments: [
                    { month: 24, amountManwon: 500, direction: "payment" },
                  ],
                }
              : assessment
          ),
        },
      ],
    });

    expect(timestampOnly).toBe(first);
    expect(changed).not.toBe(first);
  });

  it("binds tax contracts for all displayed comparisons, excluding other projects and absent scenarios", () => {
    const contract = createDraftExpertTaxContract({
      projectId: "P1", scenarioId: "S1", strategy: "stabilized-sale",
      preTaxEquityCashFlowsManwon: [-100, 120], preTaxAcquisitionTaxManwon: 10,
      equityHurdleRatePct: 10, updatedAt: "2026-10-26T00:00:00Z",
    });
    const data = computed();
    data.scenarios.push({ ...data.scenarios[0], id: "comparison" });
    const input = { snapshot: snapshot(data), financialSources: {}, priceVerifications: {} };
    const comparison = { ...contract, scenarioId: "comparison" };
    const handoff = buildReviewSnapshotPayload({ ...input, expertTaxContracts: [contract, comparison] });
    const report = buildReviewSnapshotPayload({ ...input, expertTaxContracts: [
      comparison, contract, { ...contract, projectId: "another-customer" }, { ...contract, scenarioId: "not-displayed" },
    ] });
    expect(report).toEqual(handoff);
    expect(validateReviewSnapshotPayload(report, "P1").valid).toBe(true);
    expect(buildReviewSnapshotPayload({ ...input, expertTaxContracts: [contract] })).not.toEqual(report);
  });

  it("rejects old-format or omitted reports instead of carrying forward approvals", () => {
    const payload = buildReviewSnapshotPayload({ snapshot: snapshot(), financialSources: {}, priceVerifications: {} });
    expect(validateReviewSnapshotPayload({ ...payload, version: "review-snapshot-2026.3" }).valid).toBe(false);
    expect(validateReviewSnapshotPayload({ ...payload, verification: undefined }).valid).toBe(false);
    const changed = structuredClone(payload);
    changed.verification.checks = [];
    expect(validateReviewSnapshotPayload(changed).valid).toBe(false);
  });

  it.each(["integrated-verification-2026.7", "integrated-verification-2026.8", "integrated-verification-2026.9", "integrated-verification-2026.10", "integrated-verification-2026.11", "integrated-verification-2026.15"])("requires a new review identity after %s validation", async version => {
    const input = integratedVerificationFixture();
    const current = buildReviewSnapshotPayload({ snapshot: { ...input, savedAt: "2026-10-28T00:00:00Z" },
      planningScenario: input.planningScenario, geometry: input.geometry, financialSources: {}, priceVerifications: {} });
    const old = structuredClone(current);
    Object.assign(old.verification, { version });
    old.verification.modelVersions.integrated = version;
    old.verification.checks = old.verification.checks.filter(check =>
      !["binding.geometry-content", "binding.geometry-quantities", ...(version.endsWith(".7") ? ["binding.geometry-heights"] : [])].includes(check.id));
    expect(validateReviewSnapshotPayload(old).valid).toBe(false);
    expect(validateReviewSnapshotPayload(current).valid).toBe(true);
    expect(await buildServerReviewSnapshotKey(old)).not.toBe(await buildServerReviewSnapshotKey(current));
    expect(current.verification.approvalStatus).toBe("unverified");
  });

  it.each(["room", "door", "core", "vehicle", "geometry"])("binds raw %s edits even when scenario id/version/hash stay unchanged", async (kind) => {
    const original = integratedVerificationFixture();
    const build = (fixture: typeof original) => buildReviewSnapshotPayload({
      snapshot: { ...fixture, savedAt: "2026-10-26T00:00:00Z" },
      planningScenario: fixture.planningScenario, geometry: fixture.geometry,
      financialSources: {}, priceVerifications: {},
    });
    const before = build(original);
    const changed = structuredClone(original);
    const layout = changed.planningScenario!.floorPrograms[1].interiorLayout!;
    if (kind === "room") layout.roomLayouts![0].spaces[0].depthM -= 0.1;
    if (kind === "door") layout.doors[0].widthM -= 0.1;
    if (kind === "core") changed.planningScenario!.egressPlan!.settings.flightWidthM += 0.1;
    if (kind === "vehicle") changed.planningScenario!.parking.vehicleProfile = { ...DEFAULT_VEHICLE_PROFILE, minRearAxleRadiusM: 6 };
    if (kind === "geometry") changed.geometry!.building.floors[1].shape[0].x += 0.1;
    const after = build(changed);
    expect(after.geometryHash).toBe(before.geometryHash);
    expect(after.representativeScenarioVersion).toBe(before.representativeScenarioVersion);
    expect(await buildServerReviewSnapshotKey(after)).not.toBe(await buildServerReviewSnapshotKey(before));
    expect(validateReviewSnapshotPayload(before).valid).toBe(true);
    const forged = { ...after, verification: { ...before.verification, checks: [] } };
    expect(validateReviewSnapshotPayload(forged).valid).toBe(false);
  });

  it("requires the saved calculation, current scenario and geometry to align", () => {
    expect(
      validateReviewSnapshotAlignment({
        snapshot: snapshot(),
        geometry: geometry(),
        currentScenario: { id: "S1", version: 3 },
      }).valid
    ).toBe(true);

    const stale = validateReviewSnapshotAlignment({
      snapshot: snapshot(),
      geometry: geometry(),
      currentScenario: { id: "S1", version: 4 },
    });

    expect(stale.valid).toBe(false);
    expect(stale.errors.join(" ")).toContain("다시 저장");
  });

  it.each(["v223", "", undefined, "v999"])("preserves but rejects a saved %s calculation as the current review basis", (version) => {
    const saved = snapshot();
    Object.assign(saved.data.meta, { version });
    const before = structuredClone(saved);
    const result = validateReviewSnapshotAlignment({ snapshot: saved, geometry: geometry(), currentScenario: { id: "S1", version: 3 } });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("계산 모델");
    expect(saved).toEqual(before);
  });
});
