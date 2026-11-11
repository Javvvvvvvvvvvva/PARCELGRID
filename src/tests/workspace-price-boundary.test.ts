import { describe, expect, it } from "vitest";
import {
  buildFinancialSourceFromPriceVerification,
  validatePriceVerification,
} from "@/lib/finance/price-verification";
import { priceVerificationRecordSchema } from "@/lib/finance/price-verification-schema";
import { revenuePricingDraftSchema } from "@/lib/finance/revenue-pricing-schema";
import {
  createProjectTransferBundle,
  parseProjectTransferBundle,
  prepareProjectTransferWorkspace,
  serializeProjectTransferBundle,
} from "@/lib/handoff/project-transfer";
import { createBlankPlanningScenario } from "@/lib/planning/scenario-utils";
import {
  canonicalProjectWorkspaceJson,
  hashProjectWorkspacePayload,
  validateProjectWorkspacePayload,
} from "@/lib/workspace/project-workspace";
import {
  priceVerificationFixture,
  revenuePricingFixture,
  workspacePriceFixture,
} from "@/tests/helpers/workspace-price-fixture";

const PROJECT_ID = "workspace-price-project";

function rejectWorkspace(value: unknown, label: string) {
  const before = structuredClone(value);
  expect(validateProjectWorkspacePayload(value, PROJECT_ID), label)
    .toMatchObject({ valid: false, payload: null });
  expect(value, label).toEqual(before);
}

function rejectPrice(record: unknown, label: string) {
  expect(priceVerificationRecordSchema.safeParse(record).success, label).toBe(false);
  rejectWorkspace({ ...workspacePriceFixture(PROJECT_ID), priceVerifications: { acquisition: record } }, label);
}

function rejectPricing(draft: unknown, label: string) {
  expect(revenuePricingDraftSchema.safeParse(draft).success, label).toBe(false);
  rejectWorkspace({ ...workspacePriceFixture(PROJECT_ID), revenuePricingDrafts: [draft] }, label);
}

describe("workspace price verification boundary", () => {
  it("rejects null, missing and malformed selected comparables before consumers run", () => {
    const record = priceVerificationFixture(PROJECT_ID);
    for (const selectedComps of [undefined, null, {}, [null], [{}]]) {
      rejectPrice({ ...record, selectedComps }, `selectedComps=${JSON.stringify(selectedComps)}`);
    }
    const comp = record.selectedComps[0];
    for (const field of Object.keys(comp)) {
      const incomplete = { ...comp } as Record<string, unknown>;
      delete incomplete[field];
      rejectPrice({ ...record, selectedComps: [incomplete] }, `missing comparable ${field}`);
    }
    rejectPrice({ ...record, selectedComps: [{ ...comp, address: 7 }] }, "non-string address");
  });

  it("rejects nonfinite and string comparable numbers without coercion", () => {
    const record = priceVerificationFixture(PROJECT_ID);
    for (const field of ["lotAreaSqm", "pricePerPyeongManwon"]) {
      for (const value of [NaN, Infinity, -Infinity, "0"]) {
        rejectPrice({ ...record, selectedComps: [{ ...record.selectedComps[0], [field]: value }] },
          `${field}=${String(value)}`);
      }
    }
  });

  it("accepts 10,000 comparables and rejects 10,001", () => {
    const record = priceVerificationFixture(PROJECT_ID);
    record.selectedComps = Array.from({ length: 10_000 }, () => ({ ...record.selectedComps[0] }));
    expect(priceVerificationRecordSchema.safeParse(record).success).toBe(true);
    expect(validateProjectWorkspacePayload({
      ...workspacePriceFixture(PROJECT_ID), priceVerifications: { acquisition: record },
    }, PROJECT_ID).valid).toBe(true);
    rejectPrice({ ...record, selectedComps: [...record.selectedComps, record.selectedComps[0]] }, "10,001 comps");
  });

  it("requires every consumer string and finite numeric field", () => {
    const record = priceVerificationFixture(PROJECT_ID);
    for (const field of ["reviewer", "organization", "rationale", "verifiedAt",
      "medianPricePerPyeongManwon", "adjustmentPct", "verifiedPricePerPyeongManwon",
      "verifiedTotalManwon", "verifiedPricePerSqmWon"]) {
      const incomplete = { ...record } as Record<string, unknown>;
      delete incomplete[field];
      rejectPrice(incomplete, `missing record ${field}`);
    }
    for (const patch of [{ reviewer: null }, { organization: 1 }, { rationale: {} },
      { verifiedAt: null }, { medianPricePerPyeongManwon: "0" }, { adjustmentPct: NaN },
      { verifiedPricePerPyeongManwon: Infinity }, { verifiedTotalManwon: -Infinity },
      { verifiedPricePerSqmWon: null }, { sourceModelVersion: 1 }]) {
      rejectPrice({ ...record, ...patch }, `invalid ${Object.keys(patch)[0]}`);
    }
  });

  it("binds record ownership and target to the workspace and validates status and update date", () => {
    const record = priceVerificationFixture(PROJECT_ID);
    for (const patch of [{ projectId: "foreign" }, { target: "sale" }]) {
      rejectWorkspace({ ...workspacePriceFixture(PROJECT_ID),
        priceVerifications: { acquisition: { ...record, ...patch } } }, JSON.stringify(patch));
    }
    rejectWorkspace({ ...workspacePriceFixture(PROJECT_ID), priceVerifications: { unknown: record } }, "unknown target");
    for (const patch of [{ projectId: null }, { target: "unknown" }, { status: "approved" },
      { updatedAt: "not-a-date" }, { updatedAt: null }]) {
      rejectPrice({ ...record, ...patch }, JSON.stringify(patch));
    }
  });

  it("preserves incomplete drafts, zero values and omitted/null source versions without approval", () => {
    const input = workspacePriceFixture(PROJECT_ID), before = structuredClone(input);
    const result = validateProjectWorkspacePayload(input, PROJECT_ID);
    expect(result).toEqual({ valid: true, errors: [], payload: before });
    expect(input).toEqual(before);
    expect(result.payload!.priceVerifications.acquisition).not.toHaveProperty("sourceModelVersion");
    expect(result.payload!.priceVerifications.sale!.sourceModelVersion).toBeNull();
    for (const record of Object.values(result.payload!.priceVerifications)) {
      expect(priceVerificationRecordSchema.safeParse(record).success).toBe(true);
      expect(validatePriceVerification(record).valid).toBe(false);
      expect(buildFinancialSourceFromPriceVerification(record)).toBeNull();
    }
    expect(result.payload!.financialSources).toEqual({});
    expect(result.payload!.draftAcquisitionPrice).toBeNull();
  });

  it("retains historical finite negatives without treating shape validation as approval readiness", () => {
    const record = { ...priceVerificationFixture(PROJECT_ID), status: "verified" as const,
      medianPricePerPyeongManwon: -10, adjustmentPct: -40,
      verifiedPricePerPyeongManwon: -20, verifiedTotalManwon: -30, verifiedPricePerSqmWon: -40 };
    record.selectedComps[0].lotAreaSqm = -1;
    record.selectedComps[0].pricePerPyeongManwon = -2;
    expect(priceVerificationRecordSchema.safeParse(record).success).toBe(true);
    const input = { ...workspacePriceFixture(PROJECT_ID), priceVerifications: { acquisition: record } };
    expect(validateProjectWorkspacePayload(input, PROJECT_ID)).toEqual({ valid: true, errors: [], payload: input });
    expect(buildFinancialSourceFromPriceVerification(record)).toBeNull();
  });

  it("preserves and hash-binds unknown price fields through workspace and transfer validation", async () => {
    const input = workspacePriceFixture(PROJECT_ID);
    const record = { ...priceVerificationFixture(PROJECT_ID), historicalEvidence: { reference: "legacy" },
      selectedComps: [{ ...priceVerificationFixture(PROJECT_ID).selectedComps[0], importedLabel: "retained" }] };
    input.priceVerifications.acquisition = record;
    const before = structuredClone(input), json = canonicalProjectWorkspaceJson(input);
    const hash = await hashProjectWorkspacePayload(input);
    const validated = validateProjectWorkspacePayload(input, PROJECT_ID);
    expect(validated).toEqual({ valid: true, errors: [], payload: before });
    expect(await hashProjectWorkspacePayload(validated.payload!)).toBe(hash);
    const bundle = createProjectTransferBundle({ projectId: PROJECT_ID,
      exportedAt: record.updatedAt, payload: { ...input, expertReviews: {} } });
    const parsed = parseProjectTransferBundle(serializeProjectTransferBundle(bundle), PROJECT_ID);
    expect(parsed.valid).toBe(true);
    const prepared = prepareProjectTransferWorkspace(parsed.bundle!, null);
    expect(prepared.valid).toBe(true);
    expect(prepared.payload!.priceVerifications).toEqual(before.priceVerifications);
    expect(prepared.payload!.financialSources).toEqual({});
    expect(input).toEqual(before);
    expect(canonicalProjectWorkspaceJson(input)).toBe(json);
    record.historicalEvidence.reference = "changed";
    expect(await hashProjectWorkspacePayload(input)).not.toBe(hash);
  });
});

describe("workspace revenue pricing draft boundary", () => {
  it("enforces current version, strict fields, IDs and ISO datetime without coercion", () => {
    const draft = revenuePricingFixture(PROJECT_ID);
    for (const patch of [{ version: "legacy" }, { projectId: "" }, { projectId: " owner " },
      { projectId: "p".repeat(301) }, { scenarioId: 1 }, { scenarioId: "" },
      { scenarioId: " FINANCE-S1" }, { scenarioId: "s".repeat(301) },
      { updatedAt: "not-a-date" }, { updatedAt: "2026-11-10" }, { approved: true }]) {
      rejectPricing({ ...draft, ...patch }, JSON.stringify(patch));
    }
  });

  it("rejects null prices/adjustments, unknown pools/dimensions and extra pool fields", () => {
    const draft = revenuePricingFixture(PROJECT_ID);
    for (const pools of [null, { unknown: {} }, { residentialLease: null },
      { residentialLease: { approved: true } }, { residentialLease: { baseUnitPriceWon: null } },
      { residentialLease: { baseUnitPriceWon: -1 } }, { residentialLease: { baseUnitPriceWon: "0" } },
      { residentialLease: { baseUnitPriceWon: Infinity } }, { residentialLease: { adjustments: null } },
      { residentialLease: { adjustments: { unknown: 1 } } }]) {
      rejectPricing({ ...draft, pools }, JSON.stringify(pools));
    }
    for (const factor of [0, -1, 10.01, null, "1", NaN, Infinity]) {
      rejectPricing({ ...draft, pools: { residentialLease: { adjustments: { floor: factor } } } },
        `factor=${String(factor)}`);
    }
  });

  it("rejects foreign ownership, non-finance scenarios and duplicate scenarios", () => {
    const input = workspacePriceFixture(PROJECT_ID), draft = input.revenuePricingDrafts[0];
    input.planningScenarios = [{ ...createBlankPlanningScenario({ projectId: PROJECT_ID }), id: "PLAN" }];
    expect(validateProjectWorkspacePayload(input, PROJECT_ID).valid).toBe(true);
    for (const patch of [{ projectId: "foreign" }, { scenarioId: "missing" }, { scenarioId: "PLAN" }]) {
      rejectWorkspace({ ...input, revenuePricingDrafts: [{ ...draft, ...patch }] }, JSON.stringify(patch));
    }
    rejectWorkspace({ ...input, revenuePricingDrafts: [draft, structuredClone(draft)] }, "duplicate scenario");
  });

  it("accepts 256 distinct finance drafts and rejects 257", () => {
    const input = workspacePriceFixture(PROJECT_ID);
    const scenario = input.projectData.scenarios[0];
    input.projectData.scenarios = Array.from({ length: 257 }, (_, index) => ({ ...scenario, id: `FINANCE-${index}` }));
    const drafts = input.projectData.scenarios.map(({ id }) => ({ ...revenuePricingFixture(PROJECT_ID), scenarioId: id }));
    input.revenuePricingDrafts = drafts.slice(0, 256);
    expect(validateProjectWorkspacePayload(input, PROJECT_ID).valid).toBe(true);
    rejectWorkspace({ ...input, revenuePricingDrafts: drafts }, "257 drafts");
  });

  it("preserves zero, omitted pool values and adjustment endpoints without defaults or adoption", async () => {
    const input = workspacePriceFixture(PROJECT_ID);
    for (const pools of [{}, { residentialLease: {} },
      { residentialLease: { baseUnitPriceWon: 0, adjustments: {} } },
      { residentialLease: { baseUnitPriceWon: 0, adjustments: { floor: 10, area: 0.01 } } }]) {
      const draft = { ...revenuePricingFixture(PROJECT_ID), pools };
      input.revenuePricingDrafts = [draft];
      const before = structuredClone(input), hash = await hashProjectWorkspacePayload(input);
      expect(revenuePricingDraftSchema.parse(draft)).toEqual(draft);
      const result = validateProjectWorkspacePayload(input, PROJECT_ID);
      expect(result).toEqual({ valid: true, errors: [], payload: before });
      expect(input).toEqual(before);
      expect(await hashProjectWorkspacePayload(result.payload!)).toBe(hash);
      expect(result.payload!.financialSources).toEqual({});
      expect(result.payload!.draftAssumptions).toEqual({});
    }
  });
});
