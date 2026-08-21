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
    expect(assessRepresentativeCheckReadiness(passing)).toEqual({
      ready: true,
      blockers: [],
    });
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
  });
});
