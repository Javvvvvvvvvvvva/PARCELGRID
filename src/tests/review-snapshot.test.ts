import { describe, expect, it } from "vitest";
import {
  buildReviewSnapshotKey,
  validateReviewSnapshotAlignment,
  type ReviewableStage3Snapshot,
} from "@/lib/handoff/review-snapshot";
import type { PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import type { ProjectComputed } from "@/lib/services/compute-project";

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
      version: "finance-model-1",
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
});
