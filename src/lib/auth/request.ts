import { NextResponse } from "next/server";
import {
  can,
  capabilitiesForRole,
  type AccessCapability,
  type AccessPrincipal,
} from "@/lib/auth/roles";
import {
  isLocalDevelopmentAccessOpen,
  localDevelopmentPrincipal,
  readSiteAccessToken,
  siteAccessCookie,
} from "@/lib/site-access";
import { resolveActiveDatabasePrincipal } from "@/lib/auth/database-membership";
import {
  principalSessionContext,
  SESSION_CONTEXT_HEADER,
} from "@/lib/auth/session-context";

export type RequestAuthorization =
  | { ok: true; principal: AccessPrincipal }
  | { ok: false; response: NextResponse };

export class AuthorizationBackendUnavailableError extends Error {
  constructor() {
    super("The authorization membership store is unavailable.");
    this.name = "AuthorizationBackendUnavailableError";
  }
}

export function authorizationUnavailableResponse(): NextResponse {
  return NextResponse.json(
    {
      code: "AUTHORIZATION_UNAVAILABLE",
      error: "조직 권한 정보를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

export async function resolveCurrentPrincipal(
  signedPrincipal: AccessPrincipal,
): Promise<AccessPrincipal | null> {
  try {
    return await resolveActiveDatabasePrincipal(signedPrincipal);
  } catch {
    // Driver errors can include connection details; expose only the stable category.
    console.error("authorization membership lookup failed");
    throw new AuthorizationBackendUnavailableError();
  }
}

function cookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export async function requestPrincipal(
  request: Request,
): Promise<AccessPrincipal | null> {
  const token = cookieValue(request, siteAccessCookie.name);
  const session = await readSiteAccessToken(token);
  const signedPrincipal: AccessPrincipal | null = session
    ? {
      userId: session.userId,
      orgId: session.orgId,
      email: session.email,
      name: session.name,
      organization: session.organization,
      role: session.role,
      reviewerRoles: session.reviewerRoles,
    }
    : isLocalDevelopmentAccessOpen()
      ? localDevelopmentPrincipal()
      : null;
  return signedPrincipal ? resolveCurrentPrincipal(signedPrincipal) : null;
}

export async function requireApiCapability(
  request: Request,
  capability: AccessCapability,
): Promise<RequestAuthorization> {
  let principal: AccessPrincipal | null;
  try {
    principal = await requestPrincipal(request);
  } catch (error) {
    if (error instanceof AuthorizationBackendUnavailableError) {
      return { ok: false, response: authorizationUnavailableResponse() };
    }
    throw error;
  }
  if (!principal) {
    return {
      ok: false,
      response: NextResponse.json(
        { code: "AUTH_REQUIRED", error: "로그인이 필요합니다." },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }
  const sessionContext = request.headers.get(SESSION_CONTEXT_HEADER);
  if (sessionContext !== null && sessionContext !== principalSessionContext(principal)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          code: "SESSION_CONTEXT_CHANGED",
          error: "로그인 정보가 변경되었습니다. 페이지를 새로고침해 주세요.",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }
  if (sessionContext === null && request.headers.has("sec-fetch-site")) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          code: "SESSION_CONTEXT_REQUIRED",
          error: "로그인 정보 확인이 필요합니다. 페이지를 새로고침해 주세요.",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }
  if (!can(principal, capability)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          code: "FORBIDDEN",
          error: "이 작업을 수행할 권한이 없습니다.",
          requiredCapability: capability,
        },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }
  return { ok: true, principal };
}

export function publicPrincipal(principal: AccessPrincipal) {
  return {
    ...principal,
    capabilities: capabilitiesForRole(principal.role),
  };
}
