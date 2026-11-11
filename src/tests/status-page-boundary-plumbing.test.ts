import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StatusPage from "@/app/projects/[projectId]/status/page";
import type { ParcelBoundaryInput } from "@/lib/geo/parcel-topology";
import { projectWorkspaceFixture } from "./helpers/project-workspace-fixture";

const harness = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  map: vi.fn<(props: ParcelBoundaryInput) => null>(() => null),
  mass: vi.fn<(props: ParcelBoundaryInput) => null>(() => null), fetch: vi.fn(),
}));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(), use: () => ({ projectId: "status-boundary" }),
  useState: (initial: unknown) => [initial === false ? true : initial, vi.fn()],
}));
vi.mock("next/dynamic", () => ({ default: () => harness.mass }));
vi.mock("@/lib/stores/project-store", () => ({
  useProjectStore: (selector: (state: Record<string, unknown>) => unknown) => selector(harness.state),
}));
vi.mock("@/lib/auth/client-session", () => ({ sessionFetch: harness.fetch }));
vi.mock("@/lib/hooks/use-nearby-stations", () => ({ useNearbyStations: () => ({ stations: [], status: "idle" }) }));
vi.mock("@/components/ui/KakaoMap", () => ({ KakaoMap: harness.map }));
vi.mock("@/components/ui/BuildingRegistryEvidence", () => ({ BuildingRegistryEvidencePanel: () => null }));
vi.mock("@/components/ui/StatusInsightPanels", () => ({
  DataReadinessPanel: () => null, ExistingReviewPanel: () => null,
  MarketSnapshotPanel: () => null, RoadOrientationPanel: () => null,
}));

const legacy: [number, number][] = [[127, 37], [127.001, 37], [127.001, 37.001], [127, 37.001]];
const full = [{ outer: legacy, holes: [[
  [127.0001, 37.0001], [127.0002, 37.0001], [127.0002, 37.0002], [127.0001, 37.0002],
] as [number, number][]] }];
let data: ReturnType<typeof projectWorkspaceFixture>["projectData"];
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.clearAllMocks();
  data = projectWorkspaceFixture("status-boundary").projectData;
  Object.assign(data.parcel, {
    lat: 37, lng: 127, boundary: legacy, maxFAR: 250, maxBCR: 60, heightLimit: 30,
    acquiredPrice: 20000, landPrice: 5000000, roads: [],
    inputProvenance: { geometry: "vworld-cadastral" },
  });
  harness.state = { data };
});
afterEach(() => { expect(harness.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
function render() {
  return renderToStaticMarkup(React.createElement(StatusPage, {
    params: Promise.resolve({ projectId: "status-boundary" }),
  }));
}

describe("status page boundary availability and forwarding", () => {
  it.each([
    { label: "missing", boundary: undefined }, { label: "empty", boundary: [] }, { label: "present", boundary: legacy },
  ])("forwards full boundaries to both views (legacy $label)", ({ boundary }) => {
    Object.assign(data.parcel, { boundary, boundaryPolygons: full });
    expect(render()).toContain("VWorld 필지 경계");
    for (const view of [harness.map, harness.mass]) {
      expect(view).toHaveBeenCalledWith(expect.objectContaining({ boundary, boundaryPolygons: full }), undefined);
      const props = view.mock.calls[0][0];
      expect(props.boundaryPolygons).toBe(full);
    }
  });

  it("preserves legacy source labeling and forwarding", () => {
    expect(render()).toContain("VWorld 필지 경계");
    expect(harness.map).toHaveBeenCalledWith(expect.objectContaining({ boundary: legacy, boundaryPolygons: undefined }), undefined);
  });

  it.each(["vworld-cadastral", "user-geojson"])("does not label an empty legacy array as %s evidence", (geometry) => {
    Object.assign(data.parcel, { boundary: [], inputProvenance: { geometry } });
    const html = render();
    expect(html).toContain("필지 경계 없음");
    expect(html).not.toContain("VWorld 필지 경계");
    expect(html).not.toContain("사용자 GeoJSON 경계");
  });

  it.each([
    { label: "empty", boundaryPolygons: [] },
    { label: "malformed", boundaryPolygons: [{ outer: [], holes: [] }] },
  ])("does not fall back to a legacy source label for $label full input", ({ boundaryPolygons }) => {
    data.parcel.boundaryPolygons = boundaryPolygons;
    const html = render();
    expect(html).toContain("필지 경계 없음");
    expect(html).not.toContain("VWorld 필지 경계");
    for (const view of [harness.map, harness.mass]) {
      expect(view).toHaveBeenCalledWith(expect.objectContaining({ boundary: legacy, boundaryPolygons }), undefined);
    }
  });
});
