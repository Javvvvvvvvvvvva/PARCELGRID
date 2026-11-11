import {
  EXPERT_REVIEWER_ROLE_META,
  type ExpertReviewerRole,
} from "@/lib/handoff/review-workflow";
import type { HandoffDiscipline } from "@/lib/handoff/evidence-gate";

export const ORGANIZATION_ROLES = [
  "owner",
  "admin",
  "analyst",
  "reviewer",
  "viewer",
] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export const ORGANIZATION_ROLE_LABEL: Record<OrganizationRole, string> = {
  owner: "조직 소유자",
  admin: "조직 관리자",
  analyst: "사업성 분석 담당",
  reviewer: "전문 검토자",
  viewer: "열람자",
};

export const ACCESS_CAPABILITIES = [
  "project.read",
  "analysis.run",
  "project.update",
  "scenario.override",
  "evidence.upload",
  "concept-render.create",
  "review.request",
  "review.perform",
  "audit.read",
  "report.finalize",
  "member.manage",
] as const;

export type AccessCapability = (typeof ACCESS_CAPABILITIES)[number];

export interface AccessPrincipal {
  userId: string;
  orgId: string;
  email: string;
  name: string;
  organization: string;
  role: OrganizationRole;
  reviewerRoles: ExpertReviewerRole[];
}

const ROLE_CAPABILITIES: Record<OrganizationRole, AccessCapability[]> = {
  owner: [...ACCESS_CAPABILITIES],
  admin: [...ACCESS_CAPABILITIES],
  analyst: [
    "project.read",
    "analysis.run",
    "project.update",
    "scenario.override",
    "evidence.upload",
    "concept-render.create",
    "review.request",
    "audit.read",
  ],
  reviewer: [
    "project.read",
    "evidence.upload",
    "review.perform",
    "audit.read",
  ],
  viewer: ["project.read"],
};

export function isOrganizationRole(value: unknown): value is OrganizationRole {
  return (
    typeof value === "string" &&
    (ORGANIZATION_ROLES as readonly string[]).includes(value)
  );
}

export function isExpertReviewerRole(
  value: unknown,
): value is ExpertReviewerRole {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(EXPERT_REVIEWER_ROLE_META, value)
  );
}

export function capabilitiesForRole(
  role: OrganizationRole,
): AccessCapability[] {
  return [...ROLE_CAPABILITIES[role]];
}

export function can(
  principal: AccessPrincipal,
  capability: AccessCapability,
): boolean {
  return ROLE_CAPABILITIES[principal.role].includes(capability);
}

export function reviewerRolesForPrincipalDiscipline(
  principal: AccessPrincipal,
  discipline: HandoffDiscipline,
): ExpertReviewerRole[] {
  return principal.reviewerRoles.filter((role) =>
    EXPERT_REVIEWER_ROLE_META[role].disciplines.includes(discipline),
  );
}

export function canReviewDiscipline(
  principal: AccessPrincipal,
  discipline: HandoffDiscipline,
): boolean {
  return (
    can(principal, "review.perform") &&
    reviewerRolesForPrincipalDiscipline(principal, discipline).length > 0
  );
}

/** Keeps local object-storage namespaces isolated even when project IDs collide. */
export function tenantScopedProjectId(
  principal: Pick<AccessPrincipal, "orgId">,
  projectId: string,
): string {
  return `${principal.orgId}:${projectId}`;
}
