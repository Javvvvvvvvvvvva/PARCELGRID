import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React, { type CSSProperties, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { toScenarioVM, type ScenarioVM } from "@/lib/adapters/view-model";
import {
  buildAfterTaxDecisionSupport,
  type AfterTaxDecisionCandidate,
  type AfterTaxDecisionSupport,
} from "@/lib/finance/after-tax-decision-support";
import { calculateScenario } from "@/lib/finance/scenario";
import { buildScenarioDecisionSupport, type ScenarioDecisionSupport } from "@/lib/finance/scenario-decision-support";
import { calculateTaxes } from "@/lib/finance/tax";
import { won } from "@/lib/utils/format";
import { precisionFixture } from "./helpers/finance-precision-fixture";

interface TableProps {
  scenarios: ScenarioVM[];
  representativeId: string;
  decisionSupport?: ScenarioDecisionSupport;
  afterTaxDecisionSupport?: AfterTaxDecisionSupport;
  onOpen: (id: string) => void;
}

// Render the page's actual local component without mounting the project workspace.
const pagePath = resolve(process.cwd(), "src/app/projects/[projectId]/page.tsx");
const page = ts.createSourceFile(pagePath, readFileSync(pagePath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const componentFunctions = [
  "ScenarioTable", "decisionObjectiveLabel", "afterTaxObjectiveLabel",
  "formatDecisionValue", "formatAfterTaxDecisionValue",
].map(name => {
  const declaration = page.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  if (!declaration) throw new Error(`Missing comparison component function: ${name}`);
  return declaration.getText(page);
}).join("\n");
const compiled = ts.transpileModule(componentFunctions, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;
const ScenarioTable = new Function("React", "won", `${compiled}\nreturn ScenarioTable;`)(React, won) as (props: TableProps) => ReactElement;

const input = precisionFixture();
const result = calculateScenario(input);
const taxes = calculateTaxes({ ...input, result, residentialSaleShare: input.scenario.program.mix.residentialSale });

function scenarioVM(rawProfit: number | undefined = 100): ScenarioVM {
  return toScenarioVM(input.scenario, {
    ...result, profit: 0, profitUnroundedManwon: rawProfit,
    npv: 0, npvUnroundedManwon: -0.3, irr: 10, irrUnroundedPct: 9.95,
  }, taxes, 90);
}

function tableProps(
  vm: ScenarioVM,
  patch: Partial<AfterTaxDecisionCandidate["ledger"]> = {},
): TableProps {
  const decisionSupport = buildScenarioDecisionSupport([{
    id: vm.id, viable: true, profit: vm.profitUnroundedManwon ?? NaN,
    npv: 60, irr: 18, downsideProfit: 70, requiredEquity: 80,
    maxExposure: 130, durationMonths: 24, regulatoryScore: 90, fundingStatus: "funded",
  }]);
  const afterTaxDecisionSupport = buildAfterTaxDecisionSupport({
    strategy: "stabilized-sale", preTaxDecisionSupport: decisionSupport,
    candidates: [{
      scenarioId: vm.id,
      ledger: {
        status: "expert-confirmed", strategy: "stabilized-sale", decisionGrade: true,
        afterTaxProfitManwon: 0, npvManwon: 0, irrPct: 10,
        afterTaxProfitUnroundedManwon: 0.1, npvUnroundedManwon: 0.2, irrUnroundedPct: 9.95,
        irrStatus: "calculated", errors: [], ...patch,
      },
      requiredEquityManwon: 80, maxExposureManwon: 130, durationMonths: 24, regulatoryScore: 90,
    }],
  });
  return { scenarios: [vm], representativeId: vm.id, decisionSupport, afterTaxDecisionSupport, onOpen: () => {} };
}

function renderCells(props: TableProps) {
  const element = ScenarioTable(props);
  expect(renderToStaticMarkup(element)).toContain("<table");
  const cells: ReactElement<{ style: CSSProperties; children: ReactNode }>[] = [];
  const visit = (node: ReactNode) => React.Children.forEach(node, child => {
    if (!React.isValidElement<{ style: CSSProperties; children: ReactNode }>(child)) return;
    if (child.type === "td") cells.push(child);
    else visit(child.props.children);
  });
  visit(element);
  expect(cells).toHaveLength(8);
  return { profit: cells[3], irr: cells[4], npv: cells[5], afterTaxProfit: cells[6] };
}

describe("scenario view model precision propagation", () => {
  it("preserves raw profit, NPV and IRR separately from display metrics", () => {
    expect(scenarioVM(-0.4)).toMatchObject({
      profit: 0, profitUnroundedManwon: -0.4,
      npv: 0, npvUnroundedManwon: -0.3, irr: 10, irrUnroundedPct: 9.95,
    });
    const vm = toScenarioVM(input.scenario, result, taxes, 90);
    expect(vm.profitUnroundedManwon).toBe(result.profitUnroundedManwon);
    expect(vm.npvUnroundedManwon).toBe(result.npvUnroundedManwon);
    expect(vm.irrUnroundedPct).toBe(result.irrUnroundedPct);
  });

  it("does not fabricate raw metrics for display-only legacy results", () => {
    const legacy = { ...result };
    delete legacy.profitUnroundedManwon;
    delete legacy.npvUnroundedManwon;
    delete legacy.irrUnroundedPct;
    const vm = toScenarioVM(input.scenario, legacy, taxes, 90);
    expect(vm.profitUnroundedManwon).toBeUndefined();
    expect(vm.npvUnroundedManwon).toBeUndefined();
    expect(vm.irrUnroundedPct).toBeUndefined();
    expect(vm.profit).toBe(result.profit);
    expect(vm.npv).toBe(result.npv);
    expect(vm.irr).toBe(result.irr);
  });
});

describe("comparison table raw profit colors", () => {
  it("renders a pretax sub-unit loss as negative without changing display rounding", () => {
    const cells = renderCells(tableProps(scenarioVM(-0.4)));
    expect(cells.profit.props.style.color).toBe("var(--neg-fg)");
    expect(cells.profit.props.children).toBe(won(0));
    expect(cells.npv.props.children).toBe(won(0));
    expect(cells.irr.props.children).toBe("10.0%");
  });

  it.each([undefined, NaN, Infinity, -Infinity])("renders missing/nonfinite pretax precision neutrally: %s", raw => {
    const vm = scenarioVM();
    vm.profitUnroundedManwon = raw;
    const cells = renderCells(tableProps(vm));
    expect(cells.profit.props.style.color).toBe("var(--fg-muted)");
    expect(cells.profit.props.children).toBe(won(0));
  });

  it.each([0, 0.4])("retains positive styling for known nonnegative raw values: %s", raw => {
    const cells = renderCells(tableProps(scenarioVM(raw), { afterTaxProfitUnroundedManwon: raw }));
    expect(cells.profit.props.style.color).toBe("var(--pos-fg)");
    expect(cells.afterTaxProfit.props.style.color).toBe("var(--pos-fg)");
  });

  describe.each(["expert-confirmed", "draft"] as const)("after-tax tier %s", status => {
    it("renders the excluded -0.4 raw loss as negative while displaying zero", () => {
      const props = tableProps(scenarioVM(), { status, afterTaxProfitUnroundedManwon: -0.4 });
      expect(props.afterTaxDecisionSupport!.entries[0].status).toBe("ineligible");
      const cells = renderCells(props);
      expect(cells.afterTaxProfit.props.style.color).toBe("var(--neg-fg)");
      expect(cells.afterTaxProfit.props.children).toBe(won(0));
    });

    it.each([undefined, null, NaN, Infinity, -Infinity])("never treats absent/nonfinite precision as zero: %s", raw => {
      const cells = renderCells(tableProps(scenarioVM(), { status, afterTaxProfitUnroundedManwon: raw }));
      expect(cells.afterTaxProfit.props.style.color).toBe("var(--fg-muted)");
      expect(cells.afterTaxProfit.props.children).toBe(won(0));
    });

    it("renders null profit as neutral N/A", () => {
      const cells = renderCells(tableProps(scenarioVM(), {
        status, afterTaxProfitManwon: null, afterTaxProfitUnroundedManwon: null,
      }));
      expect(cells.afterTaxProfit.props.style.color).toBe("var(--fg-muted)");
      expect(cells.afterTaxProfit.props.children).toBe("N/A");
    });
  });

  it("keeps unavailable tax tiers neutral even if stale raw values remain", () => {
    const cells = renderCells(tableProps(scenarioVM(), { status: "stale", afterTaxProfitUnroundedManwon: 100 }));
    expect(cells.afterTaxProfit.props.style.color).toBe("var(--fg-muted)");
    expect(cells.afterTaxProfit.props.children).toBe("N/A");
  });
});
