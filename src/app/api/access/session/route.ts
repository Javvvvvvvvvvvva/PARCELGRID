import { NextResponse } from "next/server";
import {
  AuthorizationBackendUnavailableError,
  authorizationUnavailableResponse,
  publicPrincipal,
  requestPrincipal,
} from "@/lib/auth/request";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let principal;
  try {
    principal = await requestPrincipal(request);
  } catch (error) {
    if (error instanceof AuthorizationBackendUnavailableError) {
      return authorizationUnavailableResponse();
    }
    throw error;
  }
  if (!principal) {
    return NextResponse.json(
      { code: "AUTH_REQUIRED", error: "로그인이 필요합니다." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    { principal: publicPrincipal(principal) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
