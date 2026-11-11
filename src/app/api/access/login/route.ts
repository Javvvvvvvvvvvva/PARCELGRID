import { NextResponse } from "next/server";
import { JSON_REQUEST_LIMITS, readJsonObject } from "@/lib/http/json-request";
import {
  authenticateSiteAccess,
  createSiteAccessToken,
  isSiteAccessConfigured,
  siteAccessConfiguration,
  siteAccessCookie,
  siteAccessSessionMaxAge,
} from "@/lib/site-access";
import {
  AuthorizationBackendUnavailableError,
  authorizationUnavailableResponse,
  publicPrincipal,
  resolveCurrentPrincipal,
} from "@/lib/auth/request";
import {
  clearSiteAccessAttempts,
  reserveSiteAccessAttempt,
} from "@/lib/runtime/site-access-rate-limit";

export const dynamic = "force-dynamic";

export async function GET() {
  const configuration = siteAccessConfiguration();
  return NextResponse.json(
    {
      configured: configuration.configured,
      requiresEmail: configuration.requiresEmail,
      sessionHours: siteAccessSessionMaxAge() / 60 / 60,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function requestIdentity(request: Request): string {
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  return (
    forwarded ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown-client"
  );
}

export async function POST(request: Request) {
  if (!isSiteAccessConfigured()) {
    return NextResponse.json(
      { error: "사이트 접근 비밀번호가 설정되지 않았습니다." },
      { status: 503 },
    );
  }

  const input = await readJsonObject(request, { maxBytes: JSON_REQUEST_LIMITS.login, maxDepth: 4, maxNodes: 32 });
  if (!input.ok) return input.response;
  const body = input.value;
  const email = typeof body?.email === "string" ? body.email : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const identity = `${requestIdentity(request)}:${email.trim().toLowerCase()}`;
  const attempt = reserveSiteAccessAttempt({ identity });
  if (!attempt.allowed) {
    const retryAfter = Math.max(
      1,
      Math.ceil((new Date(attempt.resetAt).getTime() - Date.now()) / 1_000)
    );
    return NextResponse.json(
      {
        error: "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.",
      },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfter) },
      }
    );
  }

  const authenticatedPrincipal = await authenticateSiteAccess({ email, password });
  if (!authenticatedPrincipal) {
    return NextResponse.json(
      { error: "비밀번호가 올바르지 않습니다." },
      { status: 401 },
    );
  }

  let principal;
  try {
    principal = await resolveCurrentPrincipal(authenticatedPrincipal);
  } catch (error) {
    if (error instanceof AuthorizationBackendUnavailableError) {
      return authorizationUnavailableResponse();
    }
    throw error;
  }
  if (!principal) {
    return NextResponse.json(
      {
        code: "MEMBERSHIP_FORBIDDEN",
        error: "활성 조직 멤버십을 확인할 수 없습니다.",
      },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  clearSiteAccessAttempts(identity);
  const response = NextResponse.json({
    ok: true,
    principal: publicPrincipal(principal),
  });
  response.cookies.set({
    name: siteAccessCookie.name,
    value: await createSiteAccessToken(authenticatedPrincipal),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: siteAccessSessionMaxAge(),
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: siteAccessCookie.name,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
