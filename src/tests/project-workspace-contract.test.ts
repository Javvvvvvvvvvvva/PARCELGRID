import { describe, expect, it } from "vitest";
import { createBlankPlanningScenario } from "@/lib/planning/scenario-utils";
import {
  PROJECT_WORKSPACE_INDEX_VERSION,
  canonicalProjectWorkspaceJson,
  projectWorkspaceSummary,
  validateProjectWorkspaceIndex,
  validateProjectWorkspacePayload,
  type ProjectWorkspaceRecord,
} from "@/lib/workspace/project-workspace";
import { projectWorkspaceFixture } from "@/tests/helpers/project-workspace-fixture";

const PROJECT_ID = "workspace-contract-project";

describe("project workspace contract", () => {
  it("accepts a complete computed project and rejects incomplete project data", () => {
    const payload = projectWorkspaceFixture(PROJECT_ID);
    expect(validateProjectWorkspacePayload(payload, PROJECT_ID)).toMatchObject({
      valid: true,
      errors: [],
    });

    const incomplete = structuredClone(payload) as unknown as Record<
      string,
      unknown
    >;
    const projectData = incomplete.projectData as Record<string, unknown>;
    projectData.scenarios = [];
    delete projectData.pfSchedule;
    const validation = validateProjectWorkspacePayload(incomplete, PROJECT_ID);
    expect(validation.valid).toBe(false);
    expect(validation.errors.join(" ")).toContain("시나리오가 없습니다");
    expect(validation.errors.join(" ")).toContain("pfSchedule");
  });

  it("rejects cross-project plans, orphaned drafts and invalid representative basis", () => {
    const payload = projectWorkspaceFixture(PROJECT_ID);
    const scenario = createBlankPlanningScenario({
      projectId: "another-project",
      name: "다른 조직 계획",
    });
    payload.planningScenarios = [scenario];
    payload.draftAssumptions = {
      orphaned: { salePricePerSqM: Number.POSITIVE_INFINITY },
    };
    payload.representativeParcelBasisHash = "PG-BASIS-DEADBEEF";

    const validation = validateProjectWorkspacePayload(payload, PROJECT_ID);
    expect(validation.valid).toBe(false);
    expect(validation.errors.join(" ")).toContain("프로젝트 소유권");
    expect(validation.errors.join(" ")).toContain("가정 초안");
    expect(validation.errors.join(" ")).toContain("Geometry 없이");
  });

  it("accepts scoped pricing drafts and rejects invalid adjustment factors", () => {
    const payload = projectWorkspaceFixture(PROJECT_ID);
    payload.revenuePricingDrafts = [
      {
        version: "revenue-pricing-input-2026.1",
        projectId: PROJECT_ID,
        scenarioId: "FINANCE-S1",
        pools: {
          residentialSale: {
            baseUnitPriceWon: 8_000_000,
            adjustments: { use: 1.05, newBuild: 1.1 },
          },
        },
        updatedAt: "2026-09-09T12:00:00.000Z",
      },
    ];
    expect(validateProjectWorkspacePayload(payload, PROJECT_ID).valid).toBe(true);

    payload.revenuePricingDrafts[0].pools.residentialSale!.adjustments!.use = 0;
    expect(validateProjectWorkspacePayload(payload, PROJECT_ID)).toMatchObject({
      valid: false,
      errors: expect.arrayContaining([
        "수익 풀 단가 초안의 프로젝트·계획안 또는 값이 올바르지 않습니다.",
      ]),
    });
  });

  it("builds and validates a duplicate-free project index", () => {
    const payload = projectWorkspaceFixture(PROJECT_ID);
    const record: ProjectWorkspaceRecord = {
      version: payload.version,
      projectId: PROJECT_ID,
      revision: 3,
      payloadHash: "a".repeat(64),
      payload,
      savedAt: "2026-09-09T12:00:00.000Z",
      savedBy: "Workspace Analyst",
      auditHash: "b".repeat(64),
      backend: "local-versioned",
    };
    const summary = projectWorkspaceSummary(record);
    const index = {
      version: PROJECT_WORKSPACE_INDEX_VERSION,
      projects: [summary],
    };
    expect(validateProjectWorkspaceIndex(index)).toMatchObject({ valid: true });
    expect(
      validateProjectWorkspaceIndex({
        ...index,
        projects: [summary, summary],
      }),
    ).toMatchObject({ valid: false });
  });

  it("canonicalizes __proto__ as data without mutating object prototypes", () => {
    const malicious = JSON.parse('{"__proto__":{"polluted":true},"z":1}');
    const normalized = JSON.parse(canonicalProjectWorkspaceJson(malicious));
    expect(Object.prototype).not.toHaveProperty("polluted");
    expect(Object.prototype.hasOwnProperty.call(normalized, "__proto__")).toBe(
      true,
    );
    expect(normalized["__proto__"].polluted).toBe(true);
  });
});
