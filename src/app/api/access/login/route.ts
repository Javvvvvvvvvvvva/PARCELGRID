import { NextResponse } from "next/server";
import {
  createSiteAccessToken,
  isSiteAccessConfigured,
  matchesSitePassword,
  siteAccessCookie,
} from "@/lib/site-access";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSiteAccessConfigured()) {
    return NextResponse.json(
      { error: "사이트 접근 비밀번호가 설정되지 않았습니다." },
      { status: 503 },
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
