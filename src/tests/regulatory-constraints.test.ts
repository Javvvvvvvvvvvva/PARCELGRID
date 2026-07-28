import { describe, expect, it } from "vitest";
import {
  constraintStatusLabel,
  coreRegulatoryConstraintsVerified,
  createRegulatoryReferenceSet,
  regulatoryConstraintIsDecisionGrade,
  replaceConstraintEvidence,
  restoreReferenceConstraint,
} from "@/lib/regulatory/constraints";

function sourceBacked(
  evidence: ReturnType<typeof createRegulatoryReferenceSet>["far"],
  value: number
) {
  return replaceConstraintEvidence(evidence, {
    value,
    status: "source-backed",
    sourceName: "서울시 도시계획조례",
    sourceRef: "조문·고시 번호",
    asOf: "2026-07-28",
    checkedBy: "테스트 확인자",
    checkedRole: "건축사",
  });
}

describe("regulatory provenance ledger", () => {
  it("keeps national ceilings as references rather than decision-grade limits", () => {
    const set = createRegulatoryReferenceSet({
      farPct: 250,
      bcrPct: 60,
      zoningSourceName: "VWorld 토지이용",
    });

    expect(set.far.status).toBe("reference-only");
    expect(set.bcr.status).toBe("reference-only");
    expect(regulatoryConstraintIsDecisionGrade(set.far)).toBe(false);
    expect(coreRegulatoryConstraintsVerified(set)).toBe(false);
  });

  it("requires source-backed FAR, BCR and height for the core gate", () => {
    const reference = createRegulatoryReferenceSet({ farPct: 250, bcrPct: 60 });
    const verified = {
      ...reference,
      far: sourceBacked(reference.far, 200),
      bcr: sourceBacked(reference.bcr, 50),
      height: sourceBacked(reference.height, 18),
    };

    expect(coreRegulatoryConstraintsVerified(verified)).toBe(true);
    expect(constraintStatusLabel(verified.height.status)).toBe("원문 확인");
  });

  it("restores the original national reference without losing provenance", () => {
    const reference = createRegulatoryReferenceSet({ farPct: 250 });
    const edited = sourceBacked(reference.far, 180);
    const restored = restoreReferenceConstraint(edited);

    expect(restored.value).toBe(250);
    expect(restored.status).toBe("reference-only");
    expect(restored.referenceValue).toBe(250);
  });
});
