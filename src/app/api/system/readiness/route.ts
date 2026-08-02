import { NextResponse } from "next/server";
import { buildRuntimeReadiness } from "@/lib/runtime/readiness";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(buildRuntimeReadiness(), {
    headers: { "Cache-Control": "no-store" },
  });
}
