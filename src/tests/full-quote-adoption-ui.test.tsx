import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConstructionQuoteAdoptionReview, FullQuoteAdoptionStatus } from "@/components/planning/ConstructionQuoteAdoptionReview";
import { fullQuoteAdoptionFixture } from "./helpers/full-quote-adoption-fixture";

const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], running: false }));
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  return { ...actual, useState: (initial: unknown) => {
    if (!hooks.running) return actual.useState(initial);
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.slots[index], (value: unknown) => {
      hooks.slots[index] = typeof value === "function" ? value(hooks.slots[index]) : value;
    }];
  } };
});
type Element = React.ReactElement<{ children?: React.ReactNode; disabled?: boolean; onClick?: () => void }>;
function nodes(node: React.ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!React.isValidElement(node)) return [];
  const element = node as Element;
  return [element, ...nodes(element.props.children)];
}
function content(node: React.ReactNode): string {
  if (Array.isArray(node)) return node.map(content).join("");
  if (React.isValidElement(node)) return content((node.props as { children?: React.ReactNode }).children);
  return typeof node === "string" ? node : "";
}
function button(tree: React.ReactNode, label: string) {
  const found = nodes(tree).find(node => node.type === "button" && content(node.props.children) === label);
  expect(found).toBeDefined(); return found!;
}
function draw(run: () => React.ReactNode) {
  hooks.cursor = 0; hooks.running = true;
  try { return run(); } finally { hooks.running = false; }
}
beforeEach(() => {
  vi.stubGlobal("React", React); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-11T00:00:00Z"));
  hooks.slots = []; hooks.cursor = 0; vi.stubGlobal("window", { confirm: vi.fn(() => true) });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); hooks.running = false; });

describe("explicit quote adoption UI actions", () => {
  function setup() {
    const f = fullQuoteAdoptionFixture();
    const onChange = vi.fn(), read = vi.fn(() => f.scenario);
    const props = { scenario: f.scenario, inputs: f.inputs, geometry: f.geometry, context: f.context,
      readCurrent: read, readWritableCurrent: read, onChange };
    hooks.slots = [f.draft];
    const render = () => draw(() => ConstructionQuoteAdoptionReview(props));
    button(render(), "반영 조건 검토").props.onClick!();
    return { ...f, props, onChange, read, render };
  }
  it("checks without writing and adopts only after an explicit confirmation", () => {
    const f = setup(); expect(f.onChange).not.toHaveBeenCalled();
    button(f.render(), "전체 견적을 사업비로 채택").props.onClick!();
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(f.onChange).toHaveBeenCalledOnce();
    expect(f.onChange.mock.calls[0][0].fullQuoteAdoption.totalWon).toBe(f.quote.statedTotalWon);
    expect(f.onChange.mock.calls[0][0].economicsPreview.fullQuoteCostStatus).toBe("ready");
  });
  it("cancellation preserves the source plan and cost", () => {
    const f = setup(), before = structuredClone(f.scenario);
    vi.mocked(window.confirm).mockReturnValue(false);
    button(f.render(), "전체 견적을 사업비로 채택").props.onClick!();
    expect(f.onChange).not.toHaveBeenCalled(); expect(f.scenario).toEqual(before);
  });
  it("blocks evidence changes made after review", () => {
    const f = setup(); f.quote.reference += " changed";
    button(f.render(), "전체 견적을 사업비로 채택").props.onClick!();
    expect(f.onChange).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(f.render())).toContain("바뀌었습니다");
  });
  it("checks session/current inputs again after the confirm dialog", () => {
    const f = setup();
    vi.mocked(window.confirm).mockImplementation(() => {
      f.read.mockImplementation(() => { throw new Error("사용자 세션 변경"); }); return true;
    });
    button(f.render(), "전체 견적을 사업비로 채택").props.onClick!();
    expect(f.onChange).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(f.render())).toContain("사용자 세션 변경");
  });
  it("disables adoption without a saved writable source", () => {
    const f = setup();
    const tree = draw(() => ConstructionQuoteAdoptionReview({ ...f.props, readWritableCurrent: undefined }));
    expect(button(tree, "전체 견적을 사업비로 채택").props.disabled).toBe(true);
    expect(renderToStaticMarkup(tree)).toContain("저장한 뒤");
  });
  it("shows expired adopted costs as unconfirmed while retaining a removal action", () => {
    const f = fullQuoteAdoptionFixture(); vi.setSystemTime(new Date("2026-12-01T00:00:00Z"));
    const onChange = vi.fn(), props = { scenario: f.adopted, inputs: f.inputs, geometry: f.geometry,
      context: f.context, readWritableCurrent: () => f.adopted, onChange };
    const tree = draw(() => FullQuoteAdoptionStatus(props));
    expect(renderToStaticMarkup(tree)).toContain("현재 사업성 미확정");
    button(tree, "전체 견적 채택 해제").props.onClick!();
    expect(onChange.mock.calls[0][0].fullQuoteAdoption).toBeUndefined();
    expect(onChange.mock.calls[0][0].economicsPreview.constructionCostManwon).toBe(f.before.economicsPreview.constructionCostManwon);
  });
});
