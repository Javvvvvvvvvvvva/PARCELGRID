import { describe, expect, it } from "vitest";
import {
  can,
  canReviewDiscipline,
  reviewerRolesForPrincipalDiscipline,
  tenantScopedProjectId,
  type AccessPrincipal,
} from "@/lib/auth/roles";

function principal(
  role: AccessPrincipal["role"],
  reviewerRoles: AccessPrincipal["reviewerRoles"] = [],
): AccessPrincipal {
  return {
    userId: "11111111-1111-4111-8111-111111111111",
    orgId: "22222222-2222-4222-8222-222222222222",
    email: "user@example.com",
    name: "User",
    organization: "Example",
    role,
    reviewerRoles,
  };
}

describe("organization RBAC", () => {
  it("separates analysis changes from final approval and member management", () => {
    const analyst = principal("analyst");
    expect(can(analyst, "analysis.run")).toBe(true);
    expect(can(analyst, "scenario.override")).toBe(true);
    expect(can(analyst, "review.request")).toBe(true);
    expect(can(analyst, "review.perform")).toBe(false);
    expect(can(analyst, "report.finalize")).toBe(false);
    expect(can(analyst, "member.manage")).toBe(false);
  });

  it("requires both a reviewer organization role and the matching discipline", () => {
    const architect = principal("reviewer", ["architect"]);
    expect(canReviewDiscipline(architect, "architect")).toBe(true);
    expect(canReviewDiscipline(architect, "finance-tax")).toBe(false);
    expect(
      reviewerRolesForPrincipalDiscipline(architect, "architect"),
    ).toEqual(["architect"]);

    const analystWithCredential = principal("analyst", ["architect"]);
    expect(canReviewDiscipline(analystWithCredential, "architect")).toBe(false);
  });

  it("keeps local object paths distinct for organizations with the same project id", () => {
    const first = tenantScopedProjectId(principal("viewer"), "project-1");
    const second = tenantScopedProjectId(
      {
        orgId: "33333333-3333-4333-8333-333333333333",
      },
      "project-1",
    );
    expect(first).not.toBe(second);
  });
});
