import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { ConstructionQuoteCostComparison } from "@/components/planning/ConstructionQuoteCostComparison";
import { PlanningConstructionQuotePanel } from "@/components/planning/PlanningConstructionQuotePanel";
import { ConstructionQuoteAdoptionReview } from "@/components/planning/ConstructionQuoteAdoptionReview";
import { constructionQuoteBasis } from "@/lib/planning/construction-quote";
import * as comparisonModule from "@/lib/planning/construction-quote-cost-comparison";
import { DEFAULT_DWELLING_PROGRAM } from "@/lib/planning/dwelling-program";
import { createDefaultPlanningMaterials } from "@/lib/planning/materials";
import { createQuantityCostDraft } from "@/lib/planning/quantity-cost";
import { constructionQuoteFixture } from "./helpers/construction-quote-fixture";

const editor = vi.hoisted(() => ({ running: false, cursor: 0, slots: [] as unknown[],
  active: true, context: "comparison-session" }));
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  return { ...actual,
    useState: (initial: unknown) => {
      if (!editor.running) return actual.useState(initial);
      const index = editor.cursor++;
      if (!(index in editor.slots)) editor.slots[index] = typeof initial === "function" ? initial() : initial;
      return [editor.slots[index], (next: unknown) => {
        editor.slots[index] = typeof next === "function" ? next(editor.slots[index]) : next;
      }];
    },
    useRef: (initial: unknown) => {
      if (!editor.running) return actual.useRef(initial);
      const index = editor.cursor++;
      if (!(index in editor.slots)) editor.slots[index] = { current: initial };
      return editor.slots[index];
    },
    useMemo: (compute: () => unknown, deps: React.DependencyList) => {
      if (!editor.running) return actual.useMemo(compute, deps);
      const index = editor.cursor++;
      const previous = editor.slots[index] as { deps: React.DependencyList; value: unknown } | undefined;
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
        editor.slots[index] = { deps, value: compute() };
      }
      return (editor.slots[index] as { value: unknown }).value;
    },
    useEffect: (effect: React.EffectCallback, deps?: React.DependencyList) => {
      if (!editor.running) actual.useEffect(effect, deps);
    },
  };
});
vi.mock("@/lib/auth/client-session", () => ({ clientSession: {
  get active() { return editor.active; }, get context() { return editor.context; },
  subscribe: () => () => {}, assertActive: () => { if (!editor.active) throw new Error("Session ended"); },
} }));

type Comparison = ReturnType<typeof comparisonModule.evaluateConstructionQuoteCostComparison>;
function comparisonResult(overrides: Partial<Comparison> = {}): Comparison {
  const f = constructionQuoteFixture();
  return { ...comparisonModule.evaluateConstructionQuoteCostComparison(f.scenario, f.inputs), status: "ready",
    financialApplied: false, approvalStatus: "unverified", baseConstructionCostWon: 100_000_000,
    materialAdjustmentWon: -2_000_000, additionalDwellingCostWon: 5_000_000, quantityAdjustmentWon: -1_000_000,
    currentConstructionCostWon: 102_000_000, quoteConstructionCostWon: 101_000_000, differenceWon: -1_000_000,
    issues: [], scopeNotes: [], ...overrides };
}
const band = 'aria-label="전체 공사비 비교"';
const metrics = [
  ["baseConstructionCostWon", "기본 공사비 (BASE)"], ["materialAdjustmentWon", "재료비 증감"],
  ["additionalDwellingCostWon", "추가 세대 가산비"], ["quantityAdjustmentWon", "상세 수량 원가 증감"],
  ["currentConstructionCostWon", "현재 공사비 합계"], ["quoteConstructionCostWon", "견적 공사비 합계"],
  ["differenceWon", "차액 (견적 − 현재)"],
] as const;
const render = (comparison: Comparison) => renderToStaticMarkup(<ConstructionQuoteCostComparison comparison={comparison} />);

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => { editor.running = false; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("read-only complete construction cost summary", () => {
  it("renders a real balanced quote against the complete material and dwelling baseline", () => {
    const f = constructionQuoteFixture();
    f.scenario.materials = { ...createDefaultPlanningMaterials(), primaryFacadeMaterial: "brick-veneer",
      facadeAreaOverrideSqm: 20, baselineFacadeUnitCostPerSqmWon: 100_000, selectedFacadeUnitCostPerSqmWon: 90_000 };
    f.scenario.dwellingProgram = { ...DEFAULT_DWELLING_PROGRAM, baselineDwellingCount: 0, additionalDwellingCostWon: 300_000 };
    f.quote.sourceBasis = constructionQuoteBasis(f.scenario, f.inputs);
    const currentCost = comparisonModule.evaluateConstructionQuoteCostComparison(f.scenario, f.inputs).currentConstructionCostWon!;
    const packageLine = f.quote.lines[0];
    packageLine.amountWon = currentCost;
    packageLine.allocations = f.quote.coverage.filter(scope => scope.lineIds.includes(packageLine.id)).map((scope, index) => ({
      scopeId: scope.id, amountWon: index === 0 ? currentCost : 0, source: "Synthetic explicit package allocation" }));
    for (const line of f.quote.lines.slice(1)) { line.unitRateWon = 0; line.amountWon = 0; }
    f.quote.statedTotalWon = currentCost;
    const before = structuredClone(f.scenario), result = comparisonModule.evaluateConstructionQuoteCostComparison(f.scenario, f.inputs);
    expect(result.status).toBe("ready");
    expect(result.materialAdjustmentWon).toBe(-200_000);
    expect(result.additionalDwellingCostWon).toBeGreaterThan(0);
    expect(result.currentConstructionCostWon).toBe(result.baseConstructionCostWon! + result.materialAdjustmentWon! + result.additionalDwellingCostWon!);
    expect(result.differenceWon).toBe(0);
    const html = render(result);
    expect(html).toContain('data-status="ready"');
    expect(html).toContain("<dt>재료비 증감</dt><dd>-200,000 원</dd>");
    expect(html).toContain("<dt>차액 (견적 − 현재)</dt><dd>0 원</dd>");
    expect(f.scenario).toEqual(before);
  });

  it("renders every baseline component and both totals in won without an adoption or approval action", () => {
    const comparison = comparisonResult(), before = structuredClone(comparison), html = render(comparison);
    expect(html).toContain(band);
    expect(html).toContain('data-status="ready"');
    for (const [, label] of metrics) expect(html).toContain(`<dt>${label}</dt>`);
    expect(html).toContain("100,000,000 원");
    expect(html).toContain("102,000,000 원");
    expect(html).toContain("101,000,000 원");
    expect(html).toContain("사업비 미반영 · 전문가 승인 미확정");
    expect(html).not.toMatch(/<button|<input|채택|승인 완료|절감/);
    expect(comparison).toEqual(before);
  });

  it.each(metrics)("keeps missing %s distinct from zero", (field, label) => {
    const html = render(comparisonResult({ [field]: null }));
    expect(html).toContain(`<dt>${label}</dt><dd>미확정</dd>`);
    expect(html).not.toContain("미확정 원");
  });

  it("preserves negative credits, signs positive differences, and prints explicit zero", () => {
    const html = render(comparisonResult());
    expect(html).toContain("<dt>재료비 증감</dt><dd>-2,000,000 원</dd>");
    expect(html).toContain("<dt>상세 수량 원가 증감</dt><dd>-1,000,000 원</dd>");
    expect(html).toContain("<dt>차액 (견적 − 현재)</dt><dd>-1,000,000 원</dd>");
    expect(render(comparisonResult({ differenceWon: 1234.5 }))).toContain("<dd>+1,234.5 원</dd>");
    expect(render(comparisonResult({ quantityAdjustmentWon: 0, differenceWon: 0 })))
      .toContain("<dt>차액 (견적 − 현재)</dt><dd>0 원</dd>");
  });

  it.each(["absent", "missing", "stale", "conflict"] as const)("renders %s status without a readiness claim", status => {
    const html = render(comparisonResult({ status, differenceWon: null, quoteConstructionCostWon: null }));
    expect(html).toContain(`data-status="${status}"`);
    expect(html).not.toContain("공사비 비교 입력 확인");
    expect(html).toContain("사업비 미반영 · 전문가 승인 미확정");
    expect(html).toContain("<dt>차액 (견적 − 현재)</dt><dd>미확정</dd>");
  });

  it("escapes issues and scope notes and does not conceal them in closed details", () => {
    const html = render(comparisonResult({ issues: ["<script>Unverified source</script>"], scopeNotes: ["Scope <external>"] }));
    expect(html).toContain("&lt;script&gt;Unverified source&lt;/script&gt;");
    expect(html).toContain("Scope &lt;external&gt;");
    expect(html).not.toMatch(/<script|<details/);
  });
});

type Props = React.ComponentProps<typeof PlanningConstructionQuotePanel>;
type TestElement = React.ReactElement<{ children?: React.ReactNode; "aria-label"?: string; label?: string;
  disabled?: boolean; onClick?: () => void; onChange?: (value: unknown, state?: { raw: string; invalid: boolean }) => void }>;
function elements(node: React.ReactNode): TestElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement(node)) return [];
  const element = node as TestElement;
  return [element, ...elements(element.props.children)];
}
function textContent(node: React.ReactNode): string {
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (React.isValidElement(node)) return textContent((node.props as { children?: React.ReactNode }).children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}

describe("explicit current review comparison", () => {
  let props: Props, current: Props["scenario"], tree: React.ReactNode;
  let evaluate: MockInstance<typeof comparisonModule.evaluateConstructionQuoteCostComparison>;
  function draw() {
    editor.running = true; editor.cursor = 0;
    try {
      const component = PlanningConstructionQuotePanel(props);
      tree = (component.type as (value: Props) => React.ReactNode)(component.props);
    } finally { editor.running = false; }
    return renderToStaticMarkup(tree);
  }
  function button(label: string) {
    const found = elements(tree).find(element => element.type === "button" && textContent(element.props.children) === label);
    expect(found, label).toBeDefined();
    return found!;
  }
  function click(label: string) { button(label).props.onClick!(); return draw(); }
  function field(label: string) {
    const found = elements(tree).find(element => element.props["aria-label"] === label || element.props.label === label);
    expect(found, label).toBeDefined();
    return found!;
  }
  function source(value: string) { field("견적 문서 참조").props.onChange!({ target: { value } }); return draw(); }
  function adoption() {
    const node = elements(tree).find(element => element.type === ConstructionQuoteAdoptionReview);
    expect(node).toBeDefined();
    return node!.props as React.ComponentProps<typeof ConstructionQuoteAdoptionReview>;
  }
  function reordered<T>(value: T): T {
    if (Array.isArray(value)) return value.map(reordered) as T;
    if (value && typeof value === "object") return Object.fromEntries(
      Object.entries(value).reverse().map(([key, item]) => [key, reordered(item)]),
    ) as T;
    return value;
  }
  function changeCost(kind: "materials" | "dwelling" | "quantity") {
    if (kind === "materials") current = { ...current, materials: { ...createDefaultPlanningMaterials(),
      primaryFacadeMaterial: "brick-veneer", baselineFacadeUnitCostPerSqmWon: 100_000, selectedFacadeUnitCostPerSqmWon: 90_000 } };
    if (kind === "dwelling") current = { ...current, dwellingProgram: { ...DEFAULT_DWELLING_PROGRAM, baselineDwellingCount: 0 } };
    if (kind === "quantity") current = { ...current, quantityCost: createQuantityCostDraft(current, props.inputs) };
  }

  beforeEach(() => {
    editor.running = false; editor.cursor = 0; editor.slots = []; editor.active = true; editor.context = "comparison-session";
    vi.stubGlobal("window", { confirm: vi.fn(() => true) });
    const f = constructionQuoteFixture(), result = comparisonResult();
    current = f.scenario;
    props = { scenario: current, inputs: f.inputs, locked: false, getCurrentScenario: () => current, onChange: vi.fn() };
    evaluate = vi.spyOn(comparisonModule, "evaluateConstructionQuoteCostComparison").mockReturnValue(result);
    draw();
  });

  it("evaluates the unsaved draft only on explicit review, caches the result, and hides it after source edits", () => {
    const before = structuredClone(current);
    expect(draw()).not.toContain(band);
    source("Unsaved source A"); source("Unsaved source AB");
    expect(evaluate).not.toHaveBeenCalled();
    const html = click("대사 실행");
    expect(html).toContain(band);
    expect(html).toContain("기본단가만 비교한 차액");
    expect(html).toContain("절감액·사업비 반영액을 뜻하지 않습니다");
    expect(evaluate).toHaveBeenCalledOnce();
    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ constructionQuote: expect.objectContaining({ reference: "Unsaved source AB" }) }), props.inputs, undefined);
    draw(); draw();
    expect(evaluate).toHaveBeenCalledOnce();
    expect(source("Changed source")).not.toContain(band);
    expect(draw()).toContain("입력 변경 · 기존 대사 결과 무효");
    expect(evaluate).toHaveBeenCalledOnce();
    expect(props.onChange).not.toHaveBeenCalled();
    expect(current).toEqual(before);
  });

  it("accepts a JSONB-reordered saved quote after schema parsing without another save", () => {
    current = { ...current, constructionQuote: reordered(current.constructionQuote) };
    props.scenario = current; editor.slots = [];
    draw(); click("대사 실행");
    expect(adoption().readWritableCurrent).toBeDefined();
    expect(adoption().readWritableCurrent!()).toBe(current);
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("keeps the reviewed quote writable when only persisted object key order changes", () => {
    click("대사 실행");
    const read = adoption().readWritableCurrent!;
    current = { ...current, constructionQuote: reordered(current.constructionQuote) };
    expect(read()).toBe(current);
    props.scenario = current;
    expect(draw()).toContain(band);
    expect(button("견적 증빙 저장").props.disabled).toBe(true);
  });

  it.each(["amount", "source", "row-order"])("still rejects a concurrent quote %s change before adoption", change => {
    click("대사 실행");
    const read = adoption().readWritableCurrent!;
    current = structuredClone(current);
    if (change === "amount") current.constructionQuote!.statedTotalWon! += 1;
    if (change === "source") current.constructionQuote!.lines[0].sourceLocator += " changed";
    if (change === "row-order") current.constructionQuote!.lines.reverse();
    expect(read).toThrow(/저장한 뒤 다시 대사/);
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it.each(["materials", "dwelling", "quantity"] as const)("invalidates a comparison after %s costs change", kind => {
    click("대사 실행");
    changeCost(kind); props.scenario = current;
    expect(draw()).not.toContain(band);
    expect(draw()).toMatch(/입력 변경 · 기존 대사 결과 무효|계획·단가 기준 변경 · 재검토 필요/);
    expect(evaluate).toHaveBeenCalledOnce();
    if (button("대사 실행").props.disabled) click("현재 기준으로 갱신");
    expect(click("대사 실행")).toContain(band);
    expect(evaluate).toHaveBeenCalledTimes(2);
    const reviewed = evaluate.mock.lastCall![0];
    expect(reviewed.materials).toEqual(current.materials);
    expect(reviewed.dwellingProgram).toEqual(current.dwellingProgram);
    expect(reviewed.quantityCost).toEqual(current.quantityCost);
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it.each(["materials", "dwelling", "quantity"] as const)("rejects a concurrent %s cost change before the parent rerenders", kind => {
    click("대사 실행"); changeCost(kind);
    expect(click("대사 실행")).not.toContain(band);
    expect(draw()).toContain("현재 계획·공사비 기준이 변경됐습니다");
    expect(evaluate).toHaveBeenCalledOnce();
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it.each(["geometry", "lock"])("rejects a concurrent %s change before the parent rerenders", kind => {
    click("대사 실행");
    current = kind === "geometry" ? { ...current, floorPrograms: current.floorPrograms.map((floor, index) => index === 0
      ? { ...floor, floorHeightM: floor.floorHeightM + 0.1 } : floor) }
      : { ...current, geometrySource: { mode: "engine-generated", exactGeometryAvailable: true, locked: true } };
    expect(click("대사 실행")).not.toContain(band);
    expect(draw()).toContain("현재 계획·공사비 기준이 변경됐습니다");
    expect(evaluate).toHaveBeenCalledOnce();
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("invalidates successive edits within cached material, dwelling and quantity cost inputs", () => {
    changeCost("materials"); changeCost("dwelling"); changeCost("quantity"); props.scenario = current;
    draw(); click("현재 기준으로 갱신"); click("대사 실행");
    const changes: Array<() => void> = [
      () => { current = { ...current, materials: { ...current.materials!, selectedFacadeUnitCostPerSqmWon: 80_000 } }; },
      () => { current = { ...current, materials: { ...current.materials!, baselineFacadeUnitCostPerSqmWon: 120_000 } }; },
      () => { current = { ...current, materials: { ...current.materials!, facadeAreaOverrideSqm: 50 } }; },
      () => { current = { ...current, dwellingProgram: { ...current.dwellingProgram!, baselineDwellingCount: 1 } }; },
      () => { current = { ...current, dwellingProgram: { ...current.dwellingProgram!, additionalDwellingCostWon: 400_000 } }; },
      ...[{ unitRateWon: 1000 }, { includedAllowanceWon: 5000 }, { source: "Updated quantity source" }].map(patch => () => {
        current = { ...current, quantityCost: { ...current.quantityCost!, lines: current.quantityCost!.lines
          .map((line, index) => index === 0 ? { ...line, ...patch } : line) } };
      }),
    ];
    changes.forEach((change, index) => {
      change(); props.scenario = current;
      expect(draw()).not.toContain(band);
      expect(evaluate).toHaveBeenCalledTimes(index + 1);
      if (button("대사 실행").props.disabled) click("현재 기준으로 갱신");
      expect(click("대사 실행")).toContain(band);
      expect(evaluate).toHaveBeenCalledTimes(index + 2);
    });
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it.each(["constructionCostPerSqmWon", "basementCostMultiplier"] as const)("hides a comparison when %s changes", key => {
    click("대사 실행"); props.inputs = { ...props.inputs, [key]: props.inputs[key] + 1 };
    expect(draw()).not.toContain(band);
    expect(button("대사 실행").props.disabled).toBe(true);
    expect(evaluate).toHaveBeenCalledOnce();
  });

  it("hides results for invalid numeric input without recomputing", () => {
    click("대사 실행");
    field("문서 기재 합계 (원)").props.onChange!(null, { raw: "", invalid: true });
    expect(draw()).not.toContain(band);
    expect(button("대사 실행").props.disabled).toBe(true);
    expect(evaluate).toHaveBeenCalledOnce();
  });

  it("invalidates on lock changes but still allows read-only review of a locked scenario", () => {
    click("대사 실행"); props.locked = true;
    expect(draw()).not.toContain(band);
    expect(click("대사 실행")).toContain(band);
    expect(button("견적 증빙 저장").props.disabled).toBe(true);
    expect(source("Blocked source edit")).toContain(band);
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("rejects a concurrently saved quote while preserving the unsaved draft", () => {
    source("My unsaved draft"); click("대사 실행");
    current = { ...current, constructionQuote: { ...current.constructionQuote!, issuer: "Concurrent issuer" } };
    expect(click("대사 실행")).not.toContain(band);
    props.scenario = current;
    expect(draw()).toContain('value="My unsaved draft"');
    expect(button("견적 증빙 저장").props.disabled).toBe(true);
    expect(evaluate).toHaveBeenCalledOnce();
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it.each(["ended", "changed"])("hides results and rejects an old review callback after the session %s", state => {
    click("대사 실행");
    const run = button("대사 실행").props.onClick!;
    if (state === "ended") editor.active = false;
    else editor.context = "another-session";
    run();
    expect(draw()).not.toContain(band);
    expect(draw()).toContain("사용자 세션이 종료되거나 변경됐습니다");
    expect(evaluate).toHaveBeenCalledOnce();
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("clears the comparison on evidence save without persisting it or changing financial fields", () => {
    source("Updated reference"); click("대사 실행");
    expect(click("견적 증빙 저장")).not.toContain(band);
    expect(props.onChange).toHaveBeenCalledOnce();
    expect(Object.keys(vi.mocked(props.onChange).mock.calls[0][0]).sort()).toEqual(["checks", "constructionQuote"]);
    expect(evaluate).toHaveBeenCalledOnce();
  });
});
