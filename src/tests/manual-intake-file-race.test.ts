import React, { type ReactNode, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ManualParcelIntake from "@/components/project/ManualParcelIntake";
import type { ParcelLookupManualRequired } from "@/lib/parcels/lookup-contract";

const harness = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0, children: null as ReactNode }));
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  return { ...actual, useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.states)) harness.states[index] = initial;
    return [harness.states[index], (next: unknown) => { harness.states[index] = typeof next === "function" ? next(harness.states[index]) : next; }];
  } };
});
vi.mock("@/components/ui/primitives", () => ({
  Panel: ({ children }: { children: ReactNode }) => { harness.children = children; return React.createElement("div", null, children); },
  Button: ({ children }: { children: ReactNode }) => React.createElement("button", null, children),
}));
beforeEach(() => { vi.stubGlobal("React", React); harness.states = []; harness.cursor = 0; });
afterEach(() => { vi.unstubAllGlobals(); });
function render() {
  harness.cursor = 0;
  renderToStaticMarkup(React.createElement(ManualParcelIntake, {
    lookup: { lat: 37, lng: 127, reason: { code: "VWORLD_DISABLED", message: "Unconfirmed" } } as ParcelLookupManualRequired,
    onApply: vi.fn(),
  }));
}
type Input = ReactElement<{ type?: string; onChange: (event: unknown) => void; children?: ReactNode }>;
function inputs(node: ReactNode): Input[] {
  if (Array.isArray(node)) return node.flatMap(inputs);
  if (!React.isValidElement(node)) return [];
  return node.type === "input" ? [node as Input] : inputs((node.props as { children?: ReactNode }).children);
}
const polygon = JSON.stringify({ type: "Polygon", coordinates: [[[127, 37], [127.0001, 37], [127.0001, 37.0001], [127, 37.0001], [127, 37]]] });

it("does not overwrite an area typed while a boundary file was being read", async () => {
  render();
  let finish!: (value: string) => void;
  const file = { name: "synthetic.geojson", size: polygon.length, text: () => new Promise<string>(resolve => { finish = resolve; }) };
  const fields = inputs(harness.children);
  fields.find(field => field.props.type === "file")!.props.onChange({ target: { files: [file] } });
  fields.find(field => field.props.type === "number")!.props.onChange({ target: { value: "123.45" } });
  finish(polygon); await Promise.resolve(); await Promise.resolve();
  expect(harness.states[0]).toBe("123.45");
});

it("ignores a slow earlier file after a newer selection", async () => {
  render();
  const finishes: Array<(value: string) => void> = [];
  const upload = inputs(harness.children).find(field => field.props.type === "file")!;
  for (const name of ["older.geojson", "newer.geojson"]) {
    upload.props.onChange({ target: { files: [{ name, size: polygon.length, text: () => new Promise<string>(resolve => finishes.push(resolve)) }] } });
  }
  finishes[1](polygon); await Promise.resolve(); await Promise.resolve();
  const newer = structuredClone(harness.states);
  finishes[0]("invalid"); await Promise.resolve(); await Promise.resolve();
  expect(harness.states).toEqual(newer);
  expect(harness.states).toContain("newer.geojson");
});
