import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ConstructionQuoteSummary } from "@/components/handoff/ConstructionQuoteSummary";
import { ConstructionScopeLedgerSummary } from "@/components/handoff/ConstructionScopeLedgerSummary";
import { PlanningConstructionQuotePanel } from "@/components/planning/PlanningConstructionQuotePanel";
import { buildReviewSnapshotPayload } from "@/lib/handoff/review-snapshot";
import { MAX_QUOTE_ALLOCATIONS, QUOTE_SCOPE_IDS, QUOTE_SCOPE_LABELS, type ConstructionQuote } from "@/lib/planning/construction-quote";
import { constructionQuoteFixture } from "./helpers/construction-quote-fixture";

const editor = vi.hoisted(() => ({ running: false, slots: [] as unknown[], cursor: 0, sessionActive: true }));
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
    useMemo: (compute: () => unknown, deps: React.DependencyList) => editor.running ? compute() : actual.useMemo(compute, deps),
    useEffect: (effect: React.EffectCallback, deps?: React.DependencyList) => {
      if (!editor.running) actual.useEffect(effect, deps);
    },
  };
});
vi.mock("@/lib/auth/client-session", () => ({ clientSession: {
  context: "quote-test-session", get active() { return editor.sessionActive; }, subscribe: () => () => {},
  assertActive: () => { if (!editor.sessionActive) throw new Error("Session ended"); },
} }));

function packet() {
  const f = constructionQuoteFixture();
  return buildReviewSnapshotPayload({ snapshot: { projectId: f.projectId, representativeScenarioId: f.representativeScenarioId,
    representativeScenarioVersion: f.representativeScenarioVersion, geometryHash: f.geometryHash, savedAt: "2026-11-04T00:00:00Z", data: f.data },
  financialSources: {}, priceVerifications: {}, planningScenario: f.scenario, geometry: f.geometry });
}
const original = packet();
const render = (value: typeof original | null) => renderToStaticMarkup(React.createElement(ConstructionQuoteSummary, { packet: value }));
const ledgerHtml = (quote: ConstructionQuote) => renderToStaticMarkup(React.createElement(ConstructionScopeLedgerSummary, { quote }));
function scopeQuote(): ConstructionQuote {
  const quote = structuredClone(original.planningScenario!.constructionQuote!);
  quote.lines = [{ ...quote.lines[0], amountWon: 1000, allocations: [
    { scopeId: "groundworks", amountWon: 400, source: "Allocation schedule A-1" },
    { scopeId: "structure", amountWon: 600, source: "Allocation schedule A-2" },
  ] }];
  quote.statedTotalWon = 1000;
  quote.coverage.forEach(scope => {
    scope.status = scope.id === "groundworks" || scope.id === "structure" ? "included" : "not-applicable";
    scope.lineIds = scope.status === "included" ? [quote.lines[0].id] : [];
  });
  return quote;
}
const tableBody = (html: string, label: string) => html.split(`<table aria-label="${label}">`)[1]?.split("<tbody>")[1]?.split("</tbody>")[0] ?? "";

describe("construction quote report disclosure", () => {
  beforeAll(() => vi.stubGlobal("React", React));
  afterAll(() => vi.unstubAllGlobals());

  it("prints source dates, raw line prices and every declared scope outside closed details", () => {
    const html = render(original), quote = original.planningScenario!.constructionQuote!;
    for (const value of [quote.reference, quote.issuer, quote.projectReference, quote.issuedOn, quote.validUntil, quote.reviewDate, quote.sourceBasis,
      ...quote.lines.map(line => line.sourceLocator), ...Object.values(QUOTE_SCOPE_LABELS)]) expect(html).toContain(value);
    expect(html).toContain("사업비 미반영");
    expect(html).toContain("전문가 승인 미확정");
    expect(html).toContain("입력 대사 확인");
    expect(html).not.toContain("<details");
  });

  it("prints the complete maximum-length source basis with the wrapping key style without changing numeric rows", () => {
    const p = structuredClone(original), basis = "SOURCE-" + "a".repeat(193);
    p.planningScenario!.constructionQuote!.sourceBasis = basis;
    const before = structuredClone(p), html = render(p);
    expect(html).toContain(`class="iv-key" aria-label="견적 기준 원문 참조">견적 기준 원문 참조 (sourceBasis): ${basis}</p>`);
    expect(html).not.toContain("<details");
    const rows = (markup: string) => markup.split('<table aria-label="견적 행 원문 내역">')[1]?.split("</table>")[0];
    expect(rows(html)).toBe(rows(render(original)));
    expect(p).toEqual(before);
  });

  it("does not call an unchecked or altered packet checked", () => {
    const p = structuredClone(original);
    p.verification.checks.find(check => check.id === "binding.construction-quote")!.status = "fail";
    expect(render(p)).toContain("입력 대사 미완료");
  });

  it("does not invent absent quotes or render malformed source numbers", () => {
    expect(render(null)).toBe("");
    const p = structuredClone(original); delete p.planningScenario!.constructionQuote;
    expect(render(p)).toBe("");
    Object.assign(p.planningScenario!, { constructionQuote: { statedTotalWon: Infinity } });
    expect(render(p)).toContain('role="alert"');
    expect(render(p)).not.toContain("Infinity");
  });

  it("escapes source text and keeps excluded scope separate from zero cost", () => {
    const p = structuredClone(original), q = p.planningScenario!.constructionQuote!;
    q.reference = '<script>alert("quote")</script>';
    q.sourceBasis = '<script>alert("basis")</script>';
    q.lines[0].amountWon = null;
    q.coverage[0].status = "excluded";
    const html = render(p);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;script&gt;alert(&quot;basis&quot;)&lt;/script&gt;");
    expect(html).toContain("제외·별도 원가 필요");
    expect(html).toContain("미입력");
  });

  it("reuses the complete ledger in the saved report and prints all allocation evidence", () => {
    const p = structuredClone(original), quote = scopeQuote();
    p.planningScenario!.constructionQuote = quote;
    const html = render(p), ledger = ledgerHtml(quote);
    expect(html).toContain(ledger);
    expect(ledger).toContain('data-status="reconciled"');
    expect(ledger).toContain("<dt>공종 대사 완료 합계</dt><dd>1,000원</dd>");
    expect(ledger).toContain("<dt>배분 확인 금액</dt><dd>1,000원</dd>");
    for (const part of quote.lines[0].allocations!) expect(html).toContain(part.source);
    expect(html).not.toContain("<details");
    expect(ledger).toContain('data-status="not-applicable"><th scope="row">외벽·창호</th><td data-label="배분 상태">해당 없음 입력</td><td data-label="금액">미확정</td>');
  });

  it("discloses raw partial amounts and missing rows without claiming a complete total", () => {
    const quote = scopeQuote();
    quote.lines.push({ ...quote.lines[0], id: "missing-row", sourceLocator: "p3 missing", amountWon: null, allocations: undefined });
    quote.coverage[0].lineIds.push("missing-row");
    const html = ledgerHtml(quote);
    expect(html).toContain('data-status="incomplete"');
    expect(html).toContain("<dt>입력된 행 부분합</dt><dd>1,000원</dd>");
    expect(html).not.toContain("확인된 행 부분합");
    expect(html).toContain("<dt>공종 대사 완료 합계</dt><dd>미확정</dd>");
    expect(html).toContain("금액 미입력 1행 · 배분 미확정·불일치 1행");
    expect(html).toContain("금액 미입력</li>");
    expect(html).toContain('data-status="missing"><th scope="row">가설·토공·기초</th><td data-label="배분 상태">미확정</td><td data-label="금액">미확정</td>');
  });

  it("keeps conflicting entered amounts separate from verified allocations and prints the issue", () => {
    const quote = scopeQuote();
    quote.lines[0].allocations![1].amountWon = 500;
    const html = ledgerHtml(quote);
    expect(html).toContain('data-status="conflict"');
    expect(html).toContain("<dt>입력된 행 부분합</dt><dd>1,000원</dd>");
    expect(html).toContain("<dt>배분 확인 금액</dt><dd>0원</dd>");
    expect(html).toContain("<dt>미배분 금액</dt><dd>1,000원</dd>");
    expect(html).toContain("<dt>공종 대사 완료 합계</dt><dd>미확정</dd>");
    expect(html).toContain("공종별 배분 합계가 원문 행 금액과 정확히 일치하지 않습니다.");
    expect(html).not.toContain("<details");
  });

  it("preserves explicit zero and maximum money while leaving mixed VAT totals unconfirmed", () => {
    const quote = scopeQuote();
    quote.lines[0].amountWon = quote.statedTotalWon = 1e13;
    quote.lines[0].allocations![0].amountWon = 1e13;
    quote.lines[0].allocations![1].amountWon = 0;
    const html = ledgerHtml(quote);
    expect(html).toContain("<dt>공종 대사 완료 합계</dt><dd>10,000,000,000,000원</dd>");
    expect(html).toContain('data-status="allocated"><th scope="row">구조체</th><td data-label="배분 상태">배분 확인</td><td data-label="금액">0원</td>');
    quote.lines[0].vatBasis = "excluded";
    const mixed = ledgerHtml(quote);
    for (const label of ["입력된 행 부분합", "배분 확인 금액", "미배분 금액", "공종 대사 완료 합계"]) {
      expect(mixed).toContain(`<dt>${label}</dt><dd>미확정</dd>`);
    }
  });

  it("prints the maximum 256 allocations with null amounts and untruncated escaped 300-character sources", () => {
    const p = structuredClone(original), quote = scopeQuote();
    let count = 0;
    quote.lines = Array.from({ length: 16 }, (_, index) => ({ ...quote.lines[0], id: `row-${index}`,
      sourceLocator: `p${index + 1}`, amountWon: null,
      allocations: QUOTE_SCOPE_IDS.slice(0, index === 15 ? 1 : 17).map(scopeId => ({ scopeId, amountWon: null,
        source: `<script>source-${count++}</script>`.padEnd(300, "x") })),
    }));
    quote.coverage.forEach(scope => { scope.status = "included"; scope.lineIds = quote.lines
      .filter(line => line.allocations!.some(part => part.scopeId === scope.id)).map(line => line.id); });
    quote.statedTotalWon = null;
    p.planningScenario!.constructionQuote = quote;
    const before = structuredClone(p), html = render(p), body = tableBody(html, "공종 배분 입력 근거");
    expect(count).toBe(MAX_QUOTE_ALLOCATIONS);
    expect(body.match(/<tr>/g)).toHaveLength(MAX_QUOTE_ALLOCATIONS);
    expect(body.match(/data-label="입력 금액">미확정/g)).toHaveLength(MAX_QUOTE_ALLOCATIONS);
    for (const line of quote.lines) for (const part of line.allocations!) {
      expect(html).toContain(part.source.replaceAll("<", "&lt;").replaceAll(">", "&gt;"));
    }
    expect(html).toContain("금액 미입력 16행");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<details");
    expect(p).toEqual(before);
  });
});

type EditorProps = React.ComponentProps<typeof PlanningConstructionQuotePanel>;
type TestElement = React.ReactElement<{ children?: React.ReactNode; "aria-label"?: string; label?: string;
  value?: unknown; disabled?: boolean; onClick?: (event: { preventDefault: () => void }) => void;
  onChange?: (value: unknown, state?: { raw: string; invalid: boolean }) => void }>;
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

describe("quote allocation editor callbacks", () => {
  let props: EditorProps, current: EditorProps["scenario"], tree: React.ReactNode;
  const confirm = vi.fn(() => true);
  function draw() {
    editor.running = true; editor.cursor = 0;
    try {
      const component = PlanningConstructionQuotePanel(props);
      tree = (component.type as (value: EditorProps) => React.ReactNode)(component.props);
    } finally { editor.running = false; }
    return renderToStaticMarkup(tree);
  }
  function field(label: string) {
    const found = elements(tree).find(element => element.props["aria-label"] === label || element.props.label === label);
    expect(found, label).toBeDefined(); return found!;
  }
  function click(label: string) {
    const found = elements(tree).find(element => element.type === "button" &&
      (element.props["aria-label"] === label || textContent(element.props.children) === label));
    expect(found, label).toBeDefined(); found!.props.onClick!({ preventDefault() {} }); draw();
  }
  function openRow() {
    elements(tree).find(element => element.type === "summary")!.props.onClick!({ preventDefault() {} }); draw();
  }
  function numeric(label: string, value: number | null, raw = value === null ? "" : String(value), invalid = false) {
    field(label).props.onChange!(value, { raw, invalid }); draw();
  }
  function source(label: string, value: string) {
    field(label).props.onChange!({ target: { value } }); draw();
  }
  function disconnectStructure() {
    const summary = elements(tree).find(element => element.type === "summary" && textContent(element.props.children).startsWith("구조체"))!;
    summary.props.onClick!({ preventDefault() {} }); draw();
    field("구조체 1행 연결").props.onChange!({ target: { checked: false } }); draw();
  }
  const groundAmount = "1행 가설·토공·기초 배분 금액 (원)";
  const structureAmount = "1행 구조체 배분 금액 (원)";
  beforeEach(() => {
    editor.running = false; editor.slots = []; editor.sessionActive = true;
    confirm.mockReset().mockReturnValue(true);
    vi.stubGlobal("React", React); vi.stubGlobal("window", { confirm });
    const f = constructionQuoteFixture();
    f.scenario.constructionQuote = scopeQuote();
    current = f.scenario;
    props = { scenario: f.scenario, inputs: f.inputs, locked: false,
      getCurrentScenario: () => current, onChange: vi.fn() };
    draw(); openRow();
  });
  afterEach(() => { editor.running = false; vi.unstubAllGlobals(); });

  it("initializes linked scopes with missing amounts and blank sources, then preserves entered zero on refresh", () => {
    click("1행 공종 배분 전체 삭제");
    expect(confirm).toHaveBeenCalledOnce();
    click("1행 연결 공종으로 배분 갱신");
    expect(field(groundAmount).props.value).toBeNull();
    expect(field(structureAmount).props.value).toBeNull();
    expect(field("1행 구조체 배분 원문 근거").props.value).toBe("");
    numeric(groundAmount, 0); source("1행 가설·토공·기초 배분 원문 근거", "Explicit zero allocation");
    click("1행 연결 공종으로 배분 갱신");
    expect(field(groundAmount).props.value).toBe(0);
    expect(field("1행 가설·토공·기초 배분 원문 근거").props.value).toBe("Explicit zero allocation");
    expect(field(structureAmount).props.value).toBeNull();
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("requires confirmation for disconnected entered allocations and clears only removed numeric errors", () => {
    numeric(structureAmount, null, "", true);
    numeric(groundAmount, 400, "400.00");
    disconnectStructure();
    confirm.mockReturnValueOnce(false);
    click("1행 연결 공종으로 배분 갱신");
    expect(field(structureAmount).props.value).toBeNull();
    expect(draw()).toContain('aria-invalid="true"');
    click("1행 연결 공종으로 배분 갱신");
    expect(elements(tree).some(element => element.props.label === structureAmount)).toBe(false);
    expect(field(groundAmount).props.value).toBe(400);
    expect(draw()).toContain('value="400.00"');
    expect(draw()).not.toContain('aria-invalid="true"');
    field("구조체 1행 연결").props.onChange!({ target: { checked: true } }); draw();
    click("1행 연결 공종으로 배분 갱신");
    expect(field(structureAmount).props.value).toBeNull();
    expect(field("1행 구조체 배분 원문 근거").props.value).toBe("");
  });

  it.each(["1행 구조체 배분 삭제", "1행 공종 배분 전체 삭제", "1행 삭제"])("clears invalid allocation numeric state after confirmed %s", action => {
    numeric(structureAmount, -1, "-1", true);
    confirm.mockReturnValueOnce(false);
    click(action);
    expect(draw()).toContain('aria-invalid="true"');
    click(action);
    expect(draw()).not.toContain('aria-invalid="true"');
    expect(draw()).not.toContain("허용 범위를 벗어나거나 완성되지 않은 숫자가 있습니다.");
  });

  it("shows the ledger only for the current explicit review and invalidates it on source edits", () => {
    expect(draw()).not.toContain('class="cq-ledger"');
    click("대사 실행");
    expect(draw()).toContain('class="cq-ledger"');
    source("1행 구조체 배분 원문 근거", "Updated source");
    expect(draw()).not.toContain('class="cq-ledger"');
    expect(draw()).toContain("입력 변경 · 기존 대사 결과 무효");
    click("대사 실행");
    expect(draw()).toContain('class="cq-ledger"');
    click("견적 증빙 저장");
    expect(props.onChange).toHaveBeenCalledWith(expect.objectContaining({ checks: [], constructionQuote: expect.any(Object) }));
    expect(Object.keys(vi.mocked(props.onChange).mock.calls[0][0]).sort()).toEqual(["checks", "constructionQuote"]);
    expect(draw()).not.toContain('class="cq-ledger"');
  });

  it("rejects refresh above 256 allocations without losing entries", () => {
    const quote = scopeQuote(), base = quote.lines[0];
    quote.lines = Array.from({ length: 16 }, (_, index) => ({ ...base, id: `max-${index}`, sourceLocator: `p${index}`,
      allocations: QUOTE_SCOPE_IDS.slice(0, index === 0 ? 1 : 17).map(scopeId => ({ scopeId, amountWon: null, source: "" })),
    }));
    quote.coverage.forEach(scope => { scope.status = "included"; scope.lineIds = quote.lines.map(line => line.id); });
    current = { ...current, constructionQuote: quote }; props.scenario = current; editor.slots = [];
    draw(); openRow(); click("1행 연결 공종으로 배분 갱신");
    expect(draw()).toContain("공종 배분은 견적 전체에서 256개까지 입력할 수 있습니다.");
    expect(elements(tree).filter(element => element.props.label?.includes("배분 금액"))).toHaveLength(1);
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it.each(["locked", "stale", "concurrent", "session"])("retains allocation edit guards for %s state", state => {
    if (state === "locked") props.locked = true;
    if (state === "stale") props.inputs = { ...props.inputs, constructionCostPerSqmWon: props.inputs.constructionCostPerSqmWon + 1 };
    if (state === "concurrent") current = { ...current, constructionQuote: { ...current.constructionQuote!, issuer: "External change" } };
    if (state === "session") editor.sessionActive = false;
    if (state !== "session") draw();
    field("1행 구조체 배분 원문 근거").props.onChange!({ target: { value: "Must not apply" } });
    if (state === "session") editor.sessionActive = true;
    draw();
    expect(field("1행 구조체 배분 원문 근거").props.value).toBe("Allocation schedule A-2");
    expect(props.onChange).not.toHaveBeenCalled();
  });
});
