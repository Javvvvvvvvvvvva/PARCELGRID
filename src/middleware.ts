import { NextResponse, type NextRequest } from "next/server";
import {
  isLocalDevelopmentAccessOpen,
  isSiteAccessConfigured,
  siteAccessCookie,
  verifySiteAccessToken,
} from "@/lib/site-access";

const PUBLIC_PATHS = new Set([
  "/access",
  "/api/access/login",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
]);

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || pathname.startsWith("/_next/");
}

function accessUrl(request: NextRequest): URL {
  const url = request.nextUrl.clone();
  const requestedPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  url.pathname = "/access";
  url.search = "";
  if (requestedPath !== "/") url.searchParams.set("next", requestedPath);
  return url;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  if (isLocalDevelopmentAccessOpen()) return NextResponse.next();

  if (!isSiteAccessConfigured()) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Site access is not configured." },
        { status: 503 },
      );
    }
    const url = accessUrl(request);
    url.searchParams.set("configuration", "missing");
    return NextResponse.redirect(url);
  }

  const token = request.cookies.get(siteAccessCookie.name)?.value;
  if (await verifySiteAccessToken(token)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  return NextResponse.redirect(accessUrl(request));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
