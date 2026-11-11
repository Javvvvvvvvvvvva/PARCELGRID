import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RiskMatrix } from "@/components/ui/RiskMatrix";
import { toRiskVMs, type RiskVM } from "@/lib/adapters/view-model";
import type { RiskCheck } from "@/lib/finance/compliance";

const check: RiskCheck = { code: "TEST", label: "Synthetic scope", level: "low", finding: "Scope needs review.", reference: "synthetic" };
const levels = ["ok", "low", "med", "high"] as const;

describe("risk severity never substitutes for evidence certainty", () => {
  beforeAll(() => vi.stubGlobal("React", React));
  afterAll(() => vi.unstubAllGlobals());

  it.each(levels)("preserves %s severity and marks absent or preliminary evidence", level => {
    for (const evidenceStatus of [undefined, "preliminary"] as const) {
      const risk = toRiskVMs([{ ...check, level, evidenceStatus }])[0];
      expect(risk.level).toBe(level);
      expect(risk.evidenceStatus).toBe("preliminary");
      expect(risk.levelLabel).toContain("미확정");
    }
  });

  it.each(levels)("preserves confirmed model evidence at %s without inventing official approval", level => {
    const risk = toRiskVMs([{ ...check, level, evidenceStatus: "confirmed" }])[0];
    expect(risk.evidenceStatus).toBe("confirmed");
    expect(risk.levelLabel).not.toContain("미확정");
    const html = renderToStaticMarkup(React.createElement(RiskMatrix, { risks: [risk] }));
    expect(html).not.toMatch(/허가|승인|정상/);
    if (level === "ok" || level === "low") expect(html).toContain("모델 확인");
  });

  it.each([false, true])("shows unverified status in compact=%s, including legacy view models", compact => {
    const risks: RiskVM[] = levels.map(level => ({ code: level, label: level, level, levelLabel: "legacy", note: "synthetic" }));
    const html = renderToStaticMarkup(React.createElement(RiskMatrix, { risks, compact }));
    expect(html).not.toContain("var(--pos-soft)");
    expect(html).not.toMatch(/>정상<|>확인<|>모델 확인</);
    expect(html).toContain("협의 · 미확정");
    expect(html).toContain("주의 · 미확정");
    if (!compact) expect(html).toContain("4 미확정");
  });
});
