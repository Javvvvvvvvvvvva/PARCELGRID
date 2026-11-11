import type { MolitRangeEvidence } from "@/lib/integrations/molit-evidence";
export function molitEvidenceFixture(overrides: Partial<MolitRangeEvidence> = {}): MolitRangeEvidence {
  return { source: "MOLIT", type: "house", lawdCd: "11320", startYearMonth: "202601", endYearMonth: "202601",
    retrievedAt: "2026-10-17T00:00:00Z", status: "complete", completedMonths: ["202601"], failedMonths: [], transactionCount: 5, ...overrides };
}
