import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildingRegistryEvidenceSchema, registryRecordSchema } from "@/lib/building-registry/types";
import { buildIntegratedVerification } from "@/lib/handoff/integrated-verification";
import { takeoffPlanningQuantities } from "@/lib/planning/quantity-takeoff";
import { integratedVerificationFixture } from "./helpers/integrated-verification-fixture";

describe("Zod 4 security and model compatibility", () => {
  it.each(["max", "length"] as const)("rejects oversized arrays before reading invalid elements with %s", kind => {
    let accessed = 0;
    const element = { get value() { accessed++; return {}; } };
    const schema = z.array(z.object({ value: z.string() }))[kind](20);
    const parsed = schema.safeParse(Array(1_000).fill(element));
    expect(parsed.success).toBe(false);
    expect(accessed).toBe(0);
    if (!parsed.success) {
      expect(parsed.error.issues).toHaveLength(1);
      expect(parsed.error.issues[0]).toMatchObject({ code: "too_big", origin: "array" });
      expect(parsed.error.issues[0]).not.toHaveProperty("input");
    }
  });

  it("keeps provider record values typed and rejects oversized source rows before inspecting elements", () => {
    const record = { registryPk: null, rowNumber: null, generatedDate: null, fields: { area: "12.5", label: "건축물" } };
    expect(registryRecordSchema.parse(record)).toEqual(record);
    expect(registryRecordSchema.safeParse({ ...record, fields: { area: 12.5 } }).success).toBe(false);
    let accessed = 0;
    const row = { get fields() { accessed++; return null; } };
    buildingRegistryEvidenceSchema.safeParse({ version: "building-registry-2026.1", sourceUrl: "invalid", query: {},
      title: { rows: Array(1_001).fill(row) } });
    expect(accessed).toBe(0);
  });

  const baseline = integratedVerificationFixture();
  it.each([
    [undefined, "missing", "missing"], [null, "missing", "missing"],
    ["3", "conflict", "fail"], [0, "conflict", "fail"], [NaN, "conflict", "fail"], [Infinity, "conflict", "fail"],
  ])("keeps absent and invalid floor heights distinct: %s", (value, takeoffStatus, bindingStatus) => {
    const input = structuredClone(baseline);
    Object.assign(input.planningScenario!.floorPrograms[0], { floorHeightM: value });
    const quantity = takeoffPlanningQuantities(input.planningScenario!);
    expect(quantity.status).toBe(takeoffStatus);
    expect(quantity.items.every(item => item.quantity === null)).toBe(true);
    const report = buildIntegratedVerification(input);
    expect(report.checks.find(c => c.id === "binding.plan")?.status).toBe(bindingStatus);
    expect(report.approvalStatus).toBe("unverified");
  });

  it.each([
    [undefined, "missing", "missing"], [null, "missing", "missing"],
    ["not-a-use", "conflict", "fail"], ["", "conflict", "fail"], [0, "conflict", "fail"], [false, "conflict", "fail"],
  ])("keeps absent and invalid zone enums distinct: %s", (value, takeoffStatus, bindingStatus) => {
    const input = structuredClone(baseline);
    Object.assign(input.planningScenario!.floorPrograms[0].zones[0], { useType: value });
    const quantity = takeoffPlanningQuantities(input.planningScenario!);
    expect(quantity.status).toBe(takeoffStatus);
    expect(quantity.items.every(item => item.quantity === null)).toBe(true);
    const report = buildIntegratedVerification(input);
    expect(report.checks.find(c => c.id === "binding.plan")?.status).toBe(bindingStatus);
    expect(report.approvalStatus).toBe("unverified");
  });

  it("does not let a missing enum hide a supplied invalid value", () => {
    const input = structuredClone(baseline);
    const floor = input.planningScenario!.floorPrograms[0];
    Object.assign(floor.zones[0], { useType: undefined });
    floor.floorHeightM = 0;
    const quantity = takeoffPlanningQuantities(input.planningScenario!);
    expect(quantity.status).toBe("conflict");
    expect(quantity.items.every(item => item.quantity === null)).toBe(true);
    const report = buildIntegratedVerification(input);
    expect(report.checks.find(c => c.id === "binding.plan")?.status).toBe("fail");
    expect(report.approvalStatus).toBe("unverified");
  });
});
