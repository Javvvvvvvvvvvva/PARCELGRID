import { NextRequest, NextResponse } from "next/server";
import { requireApiCapability } from "@/lib/auth/request";
import {
  AuditLedgerIntegrityError,
  readAuditLedger,
} from "@/lib/audit/audit-ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const authorization = await requireApiCapability(request, "audit.read");
  if (!authorization.ok) return authorization.response;
  const { projectId } = await context.params;
  try {
    const ledger = await readAuditLedger({ orgId: authorization.principal.orgId });
    if (!ledger.integrity.valid) {
      throw new AuditLedgerIntegrityError(ledger.integrity.errors.join(" "));
    }
    const events = ledger.events.filter(
      (event) =>
        event.resourceId === projectId ||
        (event.payload &&
          typeof event.payload === "object" &&
          (event.payload as Record<string, unknown>).projectId === projectId),
    );
    return NextResponse.json(
      {
        backend: ledger.backend,
        integrity: ledger.integrity,
        events,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        code: "AUDIT_LEDGER_UNAVAILABLE",
        error:
          error instanceof Error
            ? error.message
            : "감사 원장을 읽지 못했습니다.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
