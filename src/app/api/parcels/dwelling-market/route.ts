import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiCapability } from "@/lib/auth/request";
import { JSON_REQUEST_LIMITS, readJsonObject } from "@/lib/http/json-request";
import { toCompVMs } from "@/lib/adapters/view-model";
import { fetchMolitRangeWithEvidence } from "@/lib/integrations/molit";
import { dwellingMarketWindow, koreaDate } from "@/lib/finance/dwelling-market";

export const runtime = "nodejs";
const schema = z.object({ lawdCd: z.string().regex(/^\d{5}$/), dongName: z.string().trim().min(1).max(40) }).strict();

export async function POST(request: Request) {
  const authorization = await requireApiCapability(request, "analysis.run");
  if (!authorization.ok) return authorization.response;
  const input = await readJsonObject(request, { maxBytes: JSON_REQUEST_LIMITS.lookup });
  if (!input.ok) return input.response;
  const parsed = schema.safeParse(input.value);
  if (!parsed.success) return NextResponse.json({ error: "시군구 코드와 법정동을 확인하세요." }, { status: 422 });
  try {
    const asOf = koreaDate();
    const { startYearMonth, endYearMonth } = dwellingMarketWindow(asOf);
    const result = await fetchMolitRangeWithEvidence({ type: "villa", lawdCd: parsed.data.lawdCd, startYearMonth, endYearMonth, signal: request.signal });
    return NextResponse.json({ asOf, comps: toCompVMs(result.transactions, parsed.data.dongName), evidence: result.evidence },
      { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "실거래 자료 수집을 완료하지 못했습니다. 거래 0건으로 간주하지 않습니다." },
      { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
