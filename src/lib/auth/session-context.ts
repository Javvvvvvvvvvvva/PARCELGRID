import type { AccessPrincipal } from "@/lib/auth/roles";

export const SESSION_CONTEXT_HEADER = "x-parcelgrid-session-context";

/** Binds requests to the displayed session; not a credential or CSRF substitute. */
export function principalSessionContext(
  principal: Pick<AccessPrincipal, "orgId" | "userId" | "role" | "reviewerRoles">,
): string {
  return encodeURIComponent(JSON.stringify([
    principal.orgId,
    principal.userId,
    principal.role,
    [...principal.reviewerRoles].sort(),
  ]));
}
