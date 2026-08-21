import { NextResponse } from "next/server";
import {
  createSiteAccessToken,
  isSiteAccessConfigured,
  matchesSitePassword,
  siteAccessCookie,
} from "@/lib/site-access";
import {
  clearSiteAccessAttempts,
  reserveSiteAccessAttempt,
} from "@/lib/runtime/site-access-rate-limit";

export const dynamic = "force-dynamic";

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

  const identity = requestIdentity(request);
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

  const body = (await request.json().catch(() => null)) as
    | { password?: unknown }
    | null;
  const password = typeof body?.password === "string" ? body.password : "";

  if (!(await matchesSitePassword(password))) {
    return NextResponse.json(
      { error: "비밀번호가 올바르지 않습니다." },
      { status: 401 },
    );
  }

  clearSiteAccessAttempts(identity);
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: siteAccessCookie.name,
    value: await createSiteAccessToken(),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: siteAccessCookie.maxAge,
  });
  return response;
}
