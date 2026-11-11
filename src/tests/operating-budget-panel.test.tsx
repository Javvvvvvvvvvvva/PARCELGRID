import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OperatingBudgetPanel } from "@/components/finance/OperatingBudgetPanel";
import {
  buildOperatingBudgetDraftKey, createOperatingBudgetDraft, operatingBudgetDraftSchema,
  resetOperatingBudgetCalendar, type OperatingBudgetDraft,
} from "@/lib/finance/operating-budget-contract";
import { createLeaseRollDraft, type LeaseRollDraft } from "@/lib/finance/lease-roll-contract";
import type { OperatingBudgetEditorRecovery } from "@/lib/finance/operating-budget-editor-recovery";
import type { Scenario, ScenarioResult } from "@/lib/finance/types";
import { precisionFixture } from "./helpers/finance-precision-fixture";

type Props = React.ComponentProps<typeof OperatingBudgetPanel>;
type Effect = { deps?: React.DependencyList; cleanup?: () => void; pending?: React.EffectCallback };
type Store = {
  data: { parcel: { id: string }; scenarios: Array<{ _raw: Scenario; id: string; hold: ScenarioResult["hold"] }> };
  representativePlanningScenarioId: string | null;
  operatingBudgetDrafts: Record<string, OperatingBudgetDraft>;
  leaseRollDrafts: Record<string, LeaseRollDraft>;
  saveOperatingBudgetDraft: (draft: OperatingBudgetDraft) => void;
  removeOperatingBudgetDraft: (projectId: string, scenarioId: string) => void;
};
const harness = vi.hoisted(() => ({
  states: [] as unknown[], refs: [] as Array<{ current: unknown }>, effects: [] as Effect[],
  stateCursor: 0, refCursor: 0, effectCursor: 0, running: false, changed: false,
  store: {} as Store, active: true, context: "session-a", capabilities: [] as string[],
  listeners: new Set<() => void>(), recovery: new Map<string, OperatingBudgetEditorRecovery>(),
  save: vi.fn<(draft: OperatingBudgetDraft) => void>(),
  remove: vi.fn<(projectId: string, scenarioId: string) => void>(),
  read: vi.fn<(file: File, signal: AbortSignal) => Promise<OperatingBudgetDraft>>(),
}));

vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      if (!harness.running) return actual.useState(initial);
      const index = harness.stateCursor++;
      if (!(index in harness.states)) harness.states[index] = typeof initial === "function" ? initial() : initial;
      return [harness.states[index], (next: unknown) => {
        const value = typeof next === "function" ? next(harness.states[index]) : next;
        if (!Object.is(value, harness.states[index])) { harness.states[index] = value; harness.changed = true; }
      }];
    },
    useRef: (initial: unknown) => {
      if (!harness.running) return actual.useRef(initial);
      const index = harness.refCursor++;
      return harness.refs[index] ?? (harness.refs[index] = { current: initial });
    },
    useMemo: (factory: () => unknown, deps?: React.DependencyList) => harness.running ? factory() : actual.useMemo(factory, deps!),
    useEffect: (callback: React.EffectCallback, deps?: React.DependencyList) => {
      if (!harness.running) return actual.useEffect(callback, deps);
      const index = harness.effectCursor++, previous = harness.effects[index];
      if (!previous || !deps || !previous.deps || deps.length !== previous.deps.length ||
          deps.some((value, slot) => !Object.is(value, previous.deps![slot]))) {
        harness.effects[index] = { deps, cleanup: previous?.cleanup, pending: callback };
      }
    },
  };
});
vi.mock("@/lib/stores/project-store", () => ({
  useProjectStore: Object.assign((select: (state: Store) => unknown) => select(harness.store), { getState: () => harness.store }),
}));
vi.mock("@/lib/auth/client-session", () => ({ clientSession: {
  get active() { return harness.active; },
  get context() { return harness.context; },
  get principal() { return { capabilities: harness.capabilities }; },
  assertActive: () => { if (!harness.active) throw new Error("Session locked"); },
  subscribe: (listener: () => void) => { harness.listeners.add(listener); return () => { harness.listeners.delete(listener); }; },
} }));
vi.mock("@/lib/finance/operating-budget-import", () => ({ readOperatingBudgetFile: harness.read }));
vi.mock("@/lib/finance/operating-budget-editor-recovery", () => ({
  readOperatingBudgetEditorRecovery: (projectId: string, scenarioId: string) =>
    structuredClone(harness.recovery.get(JSON.stringify([projectId, scenarioId])) ?? null),
  writeOperatingBudgetEditorRecovery: (value: OperatingBudgetEditorRecovery) => {
    harness.recovery.set(JSON.stringify([value.draft.projectId, value.draft.scenarioId]), structuredClone(value));
  },
  clearOperatingBudgetEditorRecovery: (projectId: string, scenarioId: string) => {
    harness.recovery.delete(JSON.stringify([projectId, scenarioId]));
  },
}));

type Input = { value: string; valueAsNumber: number; validity: { valid: boolean }; checked: boolean; files: File[] };
type Node = React.ReactElement<{
  children?: React.ReactNode; "aria-label"?: string; "aria-invalid"?: boolean;
  "data-budget-status"?: string; "data-financial-applied"?: string; type?: string;
  value?: string | number; checked?: boolean; disabled?: boolean; role?: string;
  onClick?: () => void; onChange?: (event: { target: Input; currentTarget: Input }) => void;
}>;
function nodes(node: React.ReactNode): Node[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!React.isValidElement(node)) return [];
  const element = node as Node;
  return [element, ...nodes(element.props.children)];
}
function content(node: React.ReactNode): string {
  if (Array.isArray(node)) return node.map(content).join("");
  if (React.isValidElement(node)) return content((node.props as { children?: React.ReactNode }).children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}
function findButton(tree: React.ReactNode, label: string) {
  return nodes(tree).find(node => node.type === "button" && (node.props["aria-label"] === label || content(node) === label));
}
function button(tree: React.ReactNode, label: string) {
  const found = findButton(tree, label);
  expect(found, `button: ${label}`).toBeDefined();
  return found!;
}
function field(tree: React.ReactNode, label: string) {
  const found = nodes(tree).find(node => (node.type === "input" || node.type === "textarea") && node.props["aria-label"] === label);
  expect(found, `field: ${label}`).toBeDefined();
  return found!;
}
function scope(tree: React.ReactNode) { return nodes(tree).find(node => node.type === "input" && node.props.type === "checkbox")!; }
function change(node: Node, value: string, patch: Partial<Input> = {}) {
  expect(node.props.disabled).not.toBe(true);
  const input: Input = { value, valueAsNumber: value === "" ? NaN : Number(value), validity: { valid: true }, checked: false, files: [], ...patch };
  node.props.onChange!({ target: input, currentTarget: input });
}
function click(tree: React.ReactNode, label: string) {
  const node = button(tree, label);
  expect(node.props.disabled).not.toBe(true);
  node.props.onClick!();
}
function comparison(tree: React.ReactNode) { return nodes(tree).find(node => node.props["data-budget-status"]); }
function expectStatus(tree: React.ReactNode, status: string) {
  expect(comparison(tree)?.props["data-budget-status"]).toBe(status);
}
function unmount() {
  for (const effect of harness.effects) effect.cleanup?.();
  harness.states = []; harness.refs = []; harness.effects = [];
}
function render(props: Props): React.ReactElement {
  // Render the private editor through its public wrapper and flush dependency-aware effects.
  for (let pass = 0; pass < 12; pass++) {
    harness.stateCursor = 0; harness.refCursor = 0; harness.effectCursor = 0;
    harness.changed = false; harness.running = true;
    let tree: React.ReactElement;
    try {
      const wrapper = OperatingBudgetPanel(props);
      tree = (wrapper.type as (props: Props) => React.ReactElement)(wrapper.props as Props);
    } finally { harness.running = false; }
    for (const effect of harness.effects) {
      if (!effect.pending) continue;
      effect.cleanup?.();
      const callback = effect.pending; effect.pending = undefined;
      effect.cleanup = callback() || undefined;
    }
    if (!harness.changed) return tree;
  }
  throw new Error("Editor effects did not settle");
}

const SAVE = "운영비 초안 저장", COMPARE = "24개월 NOI 대사", APPLY = "운영비 초안으로 가져오기";
const REMOVE = "저장된 운영비 초안 삭제", MONTH = "운영비 기준 시작월";
const AMOUNT = "재산 관련 운영세금 2026-01 원", NOTE = "소유자 부담·공용비 배분 근거";

function setup() {
  const { parcel, scenario } = precisionFixture();
  scenario.program.areaContract!.rentableAreaSqm = 200;
  scenario.program.areaContract!.saleableAreaSqm = 0;
  scenario.program.areaContract!.revenueAreas.residentialSaleSqm = 0;
  scenario.program.areaContract!.revenueAreas.residentialLeaseSqm = 200;
  scenario.program.mix = { residentialSale: 0, residentialLease: 1, retail: 0 };
  const projectId = parcel.id, key = buildOperatingBudgetDraftKey(projectId, scenario.id);
  const leaseDraft: LeaseRollDraft = { ...createLeaseRollDraft(projectId, scenario), calendarStart: "2026-01-01", rows: [{
    id: "lease-1", unitId: "101", unitLabel: "101", use: "residential", areaSqm: 200,
    monthlyRentWon: 100_000, depositWon: 1_000_000, startDate: "2026-01-01", endDate: "2027-12-31",
    sourceName: "Lease", sourceRef: "lease/1", sourceAsOf: "2026-01-01",
  }] };
  const budget = resetOperatingBudgetCalendar(createOperatingBudgetDraft(projectId, scenario), "2026-01-01");
  budget.revision = 4; budget.baselineCalendarStart = "2026-01-01";
  budget.scopeConfirmed = true; budget.allocationNote = "All retained space and owner common costs";
  budget.categories = budget.categories.map(category => ({ ...category, sourceName: "Owner budget", sourceRef: "budget/1",
    sourceAsOf: "2026-01-01", amounts: category.amounts.map(row => ({ ...row, amountWon: 1_000 })) }));
  // These are the hold ledger fields read by the real NOI comparison.
  const baseline = { status: "modeled-unverified", holdMonths: 24, rows: Array.from({ length: 24 }, (_, index) => ({
    holdMonth: index + 1, month: index + 13, phase: "operations", effectiveGrossIncome: 10, operatingExpense: 1, noi: 9,
  })) } as ScenarioResult["hold"];
  const props: Props = { projectId, scenario, baseline, leaseDraft };
  harness.store = {
    data: { parcel, scenarios: [{ id: scenario.id, _raw: scenario, hold: baseline }] },
    representativePlanningScenarioId: scenario.id,
    operatingBudgetDrafts: { [key]: budget }, leaseRollDrafts: { [key]: structuredClone(leaseDraft) },
    saveOperatingBudgetDraft: harness.save, removeOperatingBudgetDraft: harness.remove,
  };
  harness.save.mockImplementation(next => { harness.store.operatingBudgetDrafts = { ...harness.store.operatingBudgetDrafts, [key]: structuredClone(next) }; });
  harness.remove.mockImplementation((owner, scenarioId) => {
    delete harness.store.operatingBudgetDrafts[buildOperatingBudgetDraftKey(owner, scenarioId)];
  });
  harness.read.mockResolvedValue(structuredClone(budget));
  const draw = () => render(props);
  const compare = () => { click(draw(), COMPARE); return draw(); };
  draw();
  return { props, budget, key, draw, compare };
}
function expectNoWrites() { expect(harness.save).not.toHaveBeenCalled(); expect(harness.remove).not.toHaveBeenCalled(); }
async function importPreview(fixture: ReturnType<typeof setup>, imported: OperatingBudgetDraft) {
  harness.read.mockResolvedValueOnce(imported);
  change(field(fixture.draw(), "운영비 JSON 파일"), "budget.json", { files: [new File(["{}"], "budget.json")] });
  await Promise.resolve();
  return fixture.draw();
}
function pendingImport(fixture: ReturnType<typeof setup>) {
  let finish!: (draft: OperatingBudgetDraft) => void;
  harness.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  change(field(fixture.draw(), "운영비 JSON 파일"), "budget.json", { files: [new File(["{}"], "budget.json")] });
  const signal = harness.read.mock.calls.at(-1)![1];
  expect(signal.aborted).toBe(false);
  expect(content(fixture.draw())).toContain("운영비 파일 확인 중");
  return { finish, signal };
}

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-11T00:00:00Z"));
  vi.stubGlobal("React", React);
  vi.stubGlobal("window", { confirm: vi.fn(() => true), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  harness.active = true; harness.context = "session-a"; harness.capabilities = ["project.update", "analysis.run"];
  harness.listeners.clear(); harness.recovery.clear(); harness.changed = false; harness.running = false;
  harness.states = []; harness.refs = []; harness.effects = [];
});
afterEach(() => { unmount(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("OperatingBudgetPanel explicit local workflow", () => {
  it("compares edited local inputs without writing and saves only on the explicit save action", () => {
    const f = setup(), before = structuredClone(harness.store.data);
    expect(comparison(f.draw())).toBeUndefined();
    change(field(f.draw(), AMOUNT), "2500");
    expectNoWrites(); expect(comparison(f.draw())).toBeUndefined();
    const tree = f.compare();
    expectStatus(tree, "ready");
    expect(nodes(tree).find(node => node.type === "tbody")!.props.children).toHaveLength(24);
    expect(nodes(tree).find(node => node.type === "section")!.props["data-financial-applied"]).toBe("false");
    expect(content(tree)).toContain("승인 아님"); expectNoWrites();
    click(tree, SAVE);
    expect(harness.save).toHaveBeenCalledOnce();
    const saved = harness.save.mock.calls[0][0];
    expect(operatingBudgetDraftSchema.safeParse(saved).success).toBe(true);
    expect(saved.revision).toBe(5); expect(saved.categories[0].amounts[0].amountWon).toBe(2500);
    expect(harness.store.data).toEqual(before); expect(harness.remove).not.toHaveBeenCalled();
    expect(comparison(f.draw())).toBeUndefined(); expect(harness.recovery.has(f.key)).toBe(false);
  });

  it.each(["budget", "lease", "baseline"] as const)("invalidates the visible comparison after a local %s change", kind => {
    const f = setup(); expectStatus(f.compare(), "ready");
    if (kind === "budget") change(field(f.draw(), AMOUNT), "2000");
    if (kind === "lease") f.props.leaseDraft = { ...f.props.leaseDraft!, rows: f.props.leaseDraft!.rows.map(row => ({ ...row, monthlyRentWon: 200_000 })) };
    if (kind === "baseline") f.props.baseline = { ...f.props.baseline, rows: f.props.baseline.rows.map(row => ({ ...row, effectiveGrossIncome: 20, noi: 19 })) };
    expect(comparison(f.draw())).toBeUndefined();
    expectStatus(f.compare(), "ready"); expectNoWrites();
  });

  it("requires the scope acknowledgement and allocation evidence before displaying a ready comparison", () => {
    const f = setup();
    change(scope(f.draw()), "", { checked: false });
    let tree = f.compare(); expectStatus(tree, "incomplete");
    expect(content(comparison(tree))).toContain("운영비 범위를 확인");
    change(scope(tree), "", { checked: true }); change(field(f.draw(), NOTE), "");
    tree = f.compare(); expectStatus(tree, "incomplete");
    expect(content(comparison(tree))).toContain("allocationNote");
    change(field(tree, NOTE), "Owner pays all retained space");
    expectStatus(f.compare(), "ready"); expectNoWrites();
  });

  it("shows a missing source date as incomplete and an invalid source date as a conflict", () => {
    const f = setup(), label = "재산 관련 운영세금 자료 기준일";
    change(field(f.draw(), label), "");
    let tree = f.compare(); expectStatus(tree, "incomplete");
    expect(content(comparison(tree))).toContain("기준일");
    change(field(tree, label), "1899-12-31");
    tree = f.compare(); expectStatus(tree, "conflict");
    expect(content(comparison(tree))).toContain("sourceAsOf");
    change(field(tree, label), "2026-01-01");
    expectStatus(f.compare(), "ready"); expectNoWrites();
  });

  it("keeps a blank monthly amount missing while accepting an explicit zero", () => {
    const f = setup(); change(field(f.draw(), AMOUNT), "");
    let tree = f.compare(); expectStatus(tree, "incomplete");
    expect(content(comparison(tree))).toContain("미입력은 0원이 아닙니다");
    expect(field(tree, AMOUNT).props.value).toBe("");
    change(field(tree, AMOUNT), "0"); tree = f.compare();
    expectStatus(tree, "ready"); expect(field(tree, AMOUNT).props.value).toBe(0); expectNoWrites();
  });

  it("withholds baseline NOI and deltas when the baseline calendar is missing", () => {
    const f = setup(); change(field(f.draw(), "기존 보유안 운영 1개월차 달력월"), "");
    const tree = f.compare(); expectStatus(tree, "ready");
    expect(content(comparison(tree))).toContain("baselineCalendarStart");
    const tbody = nodes(tree).find(node => node.type === "tbody")!;
    const firstRow = nodes(tbody).find(node => node.type === "tr")!;
    const cells = nodes(firstRow).filter(node => node.type === "td").map(content);
    expect(cells.slice(-2)).toEqual(["비교 불가", "비교 불가"]); expectNoWrites();
  });

  it("preserves the calendar on cancellation and clears every amount and acknowledgement on confirmation", () => {
    const f = setup(); expectStatus(f.compare(), "ready");
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    change(field(f.draw(), MONTH), "2026-02");
    let tree = f.draw(); expect(field(tree, MONTH).props.value).toBe("2026-01");
    expect(field(tree, AMOUNT).props.value).toBe(1000); expect(scope(tree).props.checked).toBe(true);
    expectStatus(tree, "ready");
    change(field(tree, MONTH), "2026-02"); tree = f.draw();
    expect(window.confirm).toHaveBeenCalledTimes(2); expect(field(tree, MONTH).props.value).toBe("2026-02");
    expect(scope(tree).props.checked).toBe(false); expect(comparison(tree)).toBeUndefined();
    const amounts = nodes(tree).filter(node => / \d{4}-\d{2} 원$/.test(node.props["aria-label"] ?? ""));
    expect(amounts).toHaveLength(144); expect(amounts.every(node => node.props.value === "")).toBe(true);
    expect(field(tree, "재산 관련 운영세금 자료명").props.value).toBe("Owner budget"); expectNoWrites();
  });

  it("recovers invalid local numeric input across remount and allows a calendar reset to repair it", () => {
    const f = setup(); expectStatus(f.compare(), "ready");
    change(field(f.draw(), AMOUNT), "-1", { validity: { valid: false } });
    let tree = f.draw(); expect(field(tree, AMOUNT).props["aria-invalid"]).toBe(true);
    for (const label of [SAVE, COMPARE, "운영비 초안 JSON 다운로드"]) expect(button(tree, label).props.disabled).toBe(true);
    expect(comparison(tree)).toBeUndefined();
    expect(harness.recovery.get(f.key)?.invalidNumbers["property-tax:2026-01"]).toBe(true);
    unmount(); tree = f.draw();
    expect(content(tree)).toContain("미저장 운영비 초안 복구"); expect(field(tree, AMOUNT).props.value).toBe(-1);
    expect(button(tree, SAVE).props.disabled).toBe(true);
    change(field(tree, MONTH), "2026-02"); tree = f.draw();
    expect(window.confirm).toHaveBeenCalledOnce(); expect(button(tree, SAVE).props.disabled).toBe(false);
    expect(field(tree, "재산 관련 운영세금 2026-02 원").props.value).toBe("");
    expect(harness.recovery.get(f.key)?.invalidNumbers).toEqual({}); expectNoWrites();
  });

  it("rejects an overwrite from a stale save callback and disables mutations after a foreign saved revision arrives", () => {
    const f = setup(); change(field(f.draw(), NOTE), "Local edit"); expectStatus(f.compare(), "ready");
    const staleSave = button(f.draw(), SAVE).props.onClick!;
    const remote = { ...structuredClone(f.budget), revision: 5, allocationNote: "Remote edit" };
    harness.store.operatingBudgetDrafts[f.key] = remote;
    staleSave(); expectNoWrites();
    const tree = f.draw(); expect(content(tree)).toContain("저장본이 변경됐습니다");
    expect(content(tree)).toContain("다른 운영비 저장본이 도착");
    for (const label of [SAVE, COMPARE, REMOVE, "운영비 JSON 가져오기"]) expect(button(tree, label).props.disabled).toBe(true);
    expect(field(tree, NOTE).props.value).toBe("Local edit"); expect(comparison(tree)).toBeUndefined();
    expect(harness.store.operatingBudgetDrafts[f.key]).toEqual(remote);
  });

  it("disables mutations without write capability and independently gates comparison on analysis capability", () => {
    harness.capabilities = []; const f = setup(); let tree = f.draw();
    for (const label of [SAVE, REMOVE, COMPARE, "운영비 JSON 가져오기"]) expect(button(tree, label).props.disabled).toBe(true);
    expect(nodes(tree).filter(node => node.type === "input" || node.type === "textarea").every(node => node.props.disabled)).toBe(true);
    expect(button(tree, "운영비 초안 JSON 다운로드").props.disabled).toBe(false);
    button(tree, SAVE).props.onClick!(); button(tree, COMPARE).props.onClick!(); expectNoWrites();
    harness.capabilities = ["analysis.run"]; tree = f.draw();
    expect(button(tree, SAVE).props.disabled).toBe(true); expectStatus(f.compare(), "ready");
    harness.capabilities = ["project.update"]; tree = f.draw();
    expect(button(tree, COMPARE).props.disabled).toBe(true); expect(button(tree, SAVE).props.disabled).toBe(false);
    expectNoWrites();
  });

  it.each(["logout", "session replacement"])("aborts a pending import on %s and ignores its late result", async kind => {
    const f = setup(), pending = pendingImport(f);
    if (kind === "logout") harness.active = false;
    else harness.context = "session-b";
    for (const listener of harness.listeners) listener();
    expect(pending.signal.aborted).toBe(true);
    pending.finish(structuredClone(f.budget)); await Promise.resolve();
    const tree = f.draw(); expect(content(tree)).toContain("로그인 세션이 만료");
    expect(findButton(tree, APPLY)).toBeUndefined(); expect(content(tree)).not.toContain("운영비 파일 확인 중");
    expectNoWrites();
  });

  it("previews an import, applies it only explicitly, and requires a separate save", async () => {
    const f = setup(), imported = { ...structuredClone(f.budget), allocationNote: "Imported costs" };
    let tree = await importPreview(f, imported);
    expect(button(tree, APPLY)).toBeDefined(); expect(field(tree, NOTE).props.value).toBe(f.budget.allocationNote); expectNoWrites();
    click(tree, APPLY); tree = f.draw();
    expect(field(tree, NOTE).props.value).toBe("Imported costs"); expect(findButton(tree, APPLY)).toBeUndefined();
    expect(comparison(tree)).toBeUndefined(); expectNoWrites();
    click(tree, SAVE); expect(harness.save).toHaveBeenCalledOnce();
    expect(harness.save.mock.calls[0][0].allocationNote).toBe("Imported costs");
  });

  it.each(["projectId", "scenarioId"] as const)("rejects an imported budget owned by a different %s", async owner => {
    const f = setup(), tree = await importPreview(f, { ...structuredClone(f.budget), [owner]: "foreign-owner" });
    expect(content(tree)).toContain("다른 프로젝트·계획안의 운영비 파일");
    expect(findButton(tree, APPLY)).toBeUndefined(); expect(field(tree, NOTE).props.value).toBe(f.budget.allocationNote); expectNoWrites();
  });

  it("deletes only the budget after confirmation, preserving lease drafts and base finance", () => {
    const f = setup(), finance = structuredClone(harness.store.data), leases = structuredClone(harness.store.leaseRollDrafts);
    change(field(f.draw(), NOTE), "Discard with saved budget");
    vi.mocked(window.confirm).mockReturnValueOnce(false); click(f.draw(), REMOVE); expectNoWrites();
    expect(harness.store.operatingBudgetDrafts[f.key]).toEqual(f.budget);
    click(f.draw(), REMOVE);
    expect(harness.remove).toHaveBeenCalledTimes(1);
    expect(harness.remove).toHaveBeenCalledWith(f.props.projectId, f.props.scenario.id);
    expect(harness.save).not.toHaveBeenCalled(); expect(harness.store.operatingBudgetDrafts[f.key]).toBeUndefined();
    expect(harness.store.data).toEqual(finance); expect(harness.store.leaseRollDrafts).toEqual(leases);
    expect(harness.recovery.has(f.key)).toBe(false); expect(field(f.draw(), MONTH).props.value).toBe("");
  });

  it("rechecks the live representative scenario after delete confirmation before writing", () => {
    const f = setup();
    vi.mocked(window.confirm).mockImplementationOnce(() => { harness.store.representativePlanningScenarioId = "other"; return true; });
    click(f.draw(), REMOVE);
    expectNoWrites(); expect(harness.store.operatingBudgetDrafts[f.key]).toEqual(f.budget);
    expect(content(f.draw())).toContain("현재 프로젝트·계획안이 변경");
  });

  it("rechecks the live saved revision after import replacement confirmation before changing the local draft", async () => {
    const f = setup(); change(field(f.draw(), NOTE), "Keep local edit");
    const tree = await importPreview(f, { ...structuredClone(f.budget), allocationNote: "Imported edit" });
    vi.mocked(window.confirm).mockImplementationOnce(() => {
      harness.store.operatingBudgetDrafts[f.key] = { ...structuredClone(f.budget), revision: 9 }; return true;
    });
    click(tree, APPLY);
    expect(window.confirm).toHaveBeenCalledOnce(); expectNoWrites();
    expect(field(f.draw(), NOTE).props.value).toBe("Keep local edit");
    expect(content(f.draw())).toContain("저장본이 변경됐습니다");
  });
});
