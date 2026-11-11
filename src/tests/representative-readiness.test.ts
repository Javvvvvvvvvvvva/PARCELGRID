import { describe, expect, it } from "vitest";
import {
  assessRepresentativeCheckReadiness,
} from "../lib/planning/representative-readiness";
import type { PlanningCheck } from "../lib/planning/types";

function check(
  code: string,
  status: PlanningCheck["status"] = "pass",
): PlanningCheck {
  return {
    code,
    status,
    label: code,
    message: `${code} ${status}`,
  };
}

const passing = [
  check("bcr"),
  check("far"),
  check("height"),
  check("parking"),
  check("floor-count", "unknown"),
];

describe("representative check readiness", () => {
  it("allows non-critical unknowns after all decision-grade checks pass", () => {
    const readiness = assessRepresentativeCheckReadiness(passing);

    expect(readiness.ready).toBe(true);
    expect(readiness.blockers).toEqual([]);
    expect(readiness.advisories).toEqual([
      expect.objectContaining({ code: "floor-count", status: "unknown" }),
    ]);
    expect(readiness.blockingFailureCount).toBe(0);
    expect(readiness.blockingVerificationCount).toBe(0);
    expect(readiness.advisoryCount).toBe(1);
  });

  it("blocks reference-only or unknown core legal checks", () => {
    const readiness = assessRepresentativeCheckReadiness([
      ...passing.filter((item) => item.code !== "far"),
      check("far", "review"),
    ]);

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toEqual([
      expect.objectContaining({ code: "far", status: "review" }),
    ]);
    expect(readiness.blockingFailureCount).toBe(0);
    expect(readiness.blockingVerificationCount).toBe(1);
  });

  it("blocks any failed planning check and missing core checks", () => {
    const readiness = assessRepresentativeCheckReadiness([
      check("bcr"),
      check("far"),
      check("parking"),
      check("floor-support", "fail"),
    ]);

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "floor-support", status: "fail" }),
        expect.objectContaining({ code: "height", status: "missing" }),
      ]),
    );
    expect(readiness.blockingFailureCount).toBe(1);
    expect(readiness.blockingVerificationCount).toBe(1);
  });

  it("keeps a failure when duplicate checks report weaker states later", () => {
    const readiness = assessRepresentativeCheckReadiness([
      ...passing,
      check("parking", "fail"),
      check("parking", "review"),
    ]);

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "parking", status: "fail" }),
      ]),
    );
    expect(readiness.blockingFailureCount).toBe(1);
  });
});
