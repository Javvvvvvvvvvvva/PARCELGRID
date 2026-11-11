import { NextResponse } from "next/server";
import { requireApiCapability } from "@/lib/auth/request";
import { buildRuntimeReadiness } from "@/lib/runtime/readiness";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requireApiCapability(request, "project.read");
  if (!authorization.ok) return authorization.response;
  const readiness = buildRuntimeReadiness();
  return NextResponse.json(readiness, {
    status: readiness.deploymentGate.status === "blocked" ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
