import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { orgs, users } from "@/lib/db/schema";
import {
  isExpertReviewerRole,
  isOrganizationRole,
  type AccessPrincipal,
} from "@/lib/auth/roles";

export async function resolveActiveDatabasePrincipal(
  signedPrincipal: AccessPrincipal,
): Promise<AccessPrincipal | null> {
  if (!process.env.DATABASE_URL?.trim()) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("The production membership database is not configured.");
    }
    return signedPrincipal;
  }
  const [membership] = await getDb()
    .select({
      userId: users.id,
      orgId: users.orgId,
      email: users.email,
      name: users.name,
      role: users.role,
      reviewerRoles: users.reviewerRolesJson,
      organization: orgs.name,
    })
    .from(users)
    .innerJoin(orgs, eq(orgs.id, users.orgId))
    .where(
      and(
        eq(users.id, signedPrincipal.userId),
        eq(users.orgId, signedPrincipal.orgId),
        isNull(users.disabledAt),
      ),
    )
    .limit(1);
  if (!membership || !isOrganizationRole(membership.role)) return null;
  return {
    userId: membership.userId,
    orgId: membership.orgId,
    email: membership.email,
    name: membership.name?.trim() || membership.email,
    organization: membership.organization,
    role: membership.role,
    reviewerRoles: Array.isArray(membership.reviewerRoles)
      ? membership.reviewerRoles.filter(isExpertReviewerRole)
      : [],
  };
}
