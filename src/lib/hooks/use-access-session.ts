"use client";

import { useQuery } from "@tanstack/react-query";
import type { AccessCapability } from "@/lib/auth/roles";
import { clientSession, type PublicAccessPrincipal } from "@/lib/auth/client-session";
export type { PublicAccessPrincipal } from "@/lib/auth/client-session";

export function useAccessSession() {
  return useQuery({
    queryKey: ["access-session"],
    queryFn: async () => {
      clientSession.assertActive();
      return clientSession.principal!;
    },
    staleTime: Infinity,
  });
}

export function principalHasCapability(
  principal: PublicAccessPrincipal | undefined,
  capability: AccessCapability,
): boolean {
  return Boolean(principal?.capabilities.includes(capability));
}
