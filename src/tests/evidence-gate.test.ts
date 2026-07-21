import { describe, expect, it } from "vitest";
import { buildEvidenceGate, buildHandoffBrief } from "@/lib/handoff/evidence-gate";

const input = {
  projectId: "P-1",
  address: "서울 테스트구 테스트동 1",
  geometryHash: "PG-ABC123",
  roadReferenceCount: 2,
  saleCompCount: 5,
  saleEstimateVersion: "experimental-2026.1",
  acquisitionEstimateVersion: "land-v1",
  financeModelVersion: "pre-audit-2026.2",
  taxComplete: false,
};

describe("Stage 4 evidence gate", () => {
  it("blocks final handoff while critical external evidence is missing", () => {
    const gate = buildEvidenceGate(input);
    expect(gate.status).toBe("blocked");
    expect(gate.criticalBlockerCount).toBeGreaterThan(0);
  });

  it("keeps observed data in expert review", () => {
    const items = buildEvidenceGate(input).lanes.flatMap((lane) => lane.items);
    expect(items.find((item) => item.id === "geometry-snapshot")?.status).toBe("system-confirmed");
    expect(items.find((item) => item.id === "road-boundary")?.status).toBe("expert-review");
    expect(items.find((item) => item.id === "sale-comps")?.status).toBe("expert-review");
  });

  it("creates a discipline-specific request brief", () => {
    const brief = buildHandoffBrief(buildEvidenceGate(input));
    expect(brief).toContain("건축가");
    expect(brief).toContain("금융·회계·세무");
    expect(brief).toContain("Term Sheet");
  });
});
