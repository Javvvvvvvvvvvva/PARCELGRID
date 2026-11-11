import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ScenarioDetailPage from "@/app/projects/[projectId]/scenarios/[scenarioId]/page";

const harness = vi.hoisted(() => ({ data: {} as Record<string, unknown>, massing: vi.fn() }));
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, use: () => ({ projectId: "synthetic", scenarioId: "legacy" }),
    useState: (initial: unknown) => actual.useState(initial === "pf" ? "massing" : initial) };
});
vi.mock("next/dynamic", () => ({ default: () => harness.massing }));
vi.mock("@/lib/stores/project-store", () => ({
  useProjectStore: (selector: (state: { data: Record<string, unknown> }) => unknown) => selector({ data: harness.data }),
}));
const boundary = [[127, 37], [127.001, 37], [127.001, 37.001], [127, 37.001]];
const full = [{ outer: boundary, holes: [
  [[127.0004, 37.0004], [127.0006, 37.0004], [127.0006, 37.0006], [127.0004, 37.0006]],
] }];

beforeEach(() => {
  vi.stubGlobal("React", React);
  harness.massing.mockReset().mockReturnValue(null);
  // This route's existing styled-jsx attribute is compiled by Next in the browser.
  vi.spyOn(console, "error").mockImplementation(() => {});
  harness.data = { parcel: { boundary, boundaryPolygons: full, zoning: "상업", roads: [],
    setback: { road: 0, side: 0.5, rear: 0.5 } }, pfSchedule: [], scenarios: [{
    id: "legacy", name: "Synthetic scenario", recommended: false, profit: 1234, irr: 1,
    irrStatus: "calculated", equityMultiple: 1.2, equity: 100, dscrStatus: "not-applicable",
    timeline: 12, far: 200, bcr: 50, gfa: 800, floors: { above: 3, below: 0 },
    units: { residential: 17, retail: 0 }, assumptions: { rent: 100, sale: 100, capRate: 3, intRate: 5 },
  }] };
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([undefined, [], boundary])("forwards full topology with legacy %j and leaves financial values untouched", legacy => {
  const parcel = harness.data.parcel as Record<string, unknown>;
  parcel.boundary = legacy;
  const before = structuredClone(harness.data);
  const html = renderToStaticMarkup(React.createElement(ScenarioDetailPage, {
    params: Promise.resolve({ projectId: "synthetic", scenarioId: "legacy" }),
  }));
  expect(harness.massing).toHaveBeenCalledTimes(1);
  expect(harness.massing.mock.calls[0][0]).toMatchObject({ boundary: legacy,
    boundaryPolygons: full, units: 17, floors: 3 });
  expect(harness.massing.mock.calls[0][0].boundaryPolygons).toBe(full);
  expect(html).toContain("재무값 변경 없음");
  expect(harness.data).toEqual(before);
});

it("forwards an explicitly empty authoritative region without substituting the legacy ring", () => {
  const parcel = harness.data.parcel as Record<string, unknown>;
  const empty: unknown[] = []; parcel.boundaryPolygons = empty;
  renderToStaticMarkup(React.createElement(ScenarioDetailPage, {
    params: Promise.resolve({ projectId: "synthetic", scenarioId: "legacy" }),
  }));
  expect(harness.massing.mock.calls[0][0].boundaryPolygons).toBe(empty);
});
