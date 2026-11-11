import React, { type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KakaoMap } from "@/components/ui/KakaoMap";
import type { ParcelBoundaryInput, Wgs84ParcelPolygon } from "@/lib/geo/parcel-topology";

const hooks = vi.hoisted(() => ({
  refs: [] as Array<{ current: unknown }>, cursor: 0,
  effect: null as (() => (() => void) | void) | null, dependencies: [] as unknown[],
  setState: vi.fn(),
}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useRef: () => hooks.refs[hooks.cursor++],
    useState: (value: unknown) => [value === "loading" ? "ready" : value, hooks.setState],
    useMemo: (factory: () => unknown) => factory(),
    useEffect: (effect: typeof hooks.effect, dependencies: unknown[]) => {
      hooks.effect = effect;
      hooks.dependencies = dependencies;
    },
  };
});

class LatLng {
  constructor(readonly lat: number, readonly lng: number) {}
  getLat() { return this.lat; }
  getLng() { return this.lng; }
}
class Bounds {
  points: LatLng[] = [];
  extend(point: LatLng) { this.points.push(point); }
  contain(point: LatLng) {
    return point.lat >= Math.min(...this.points.map((p) => p.lat)) &&
      point.lat <= Math.max(...this.points.map((p) => p.lat)) &&
      point.lng >= Math.min(...this.points.map((p) => p.lng)) &&
      point.lng <= Math.max(...this.points.map((p) => p.lng));
  }
}
let fittedLevel: number;
class MapStub {
  level = 4;
  bounds = new Bounds();
  setBounds = vi.fn((bounds: Bounds) => { this.bounds = bounds; this.level = fittedLevel; });
  getLevel = () => this.level;
  setLevel = vi.fn((level: number) => { this.level = level; });
  setCenter = vi.fn();
  getBounds() {
    if (this.level >= fittedLevel) return this.bounds;
    const latitudes = this.bounds.points.map((p) => p.lat);
    const longitudes = this.bounds.points.map((p) => p.lng);
    const minLat = Math.min(...latitudes), maxLat = Math.max(...latitudes);
    const minLng = Math.min(...longitudes), maxLng = Math.max(...longitudes);
    const visible = new Bounds();
    const scale = 2 ** (this.level - fittedLevel);
    const lat = (minLat + maxLat) / 2, lng = (minLng + maxLng) / 2;
    visible.extend(new LatLng(lat - (maxLat - minLat) * scale / 2, lng - (maxLng - minLng) * scale / 2));
    visible.extend(new LatLng(lat + (maxLat - minLat) * scale / 2, lng + (maxLng - minLng) * scale / 2));
    return visible;
  }
}
let maps: MapStub[];
const polygon = vi.fn();
const fetch = vi.fn();
const createElement = vi.fn();
const legacy: [number, number][] = [[127, 37], [127.001, 37], [127.001, 37.001], [127, 37.001]];
const full: Wgs84ParcelPolygon[] = [
  { outer: legacy, holes: [[
    [127.0001, 37.0001], [127.0003, 37.0001], [127.0003, 37.0003], [127.0001, 37.0003],
  ], [
    [127.0006, 37.0006], [127.0008, 37.0006], [127.0008, 37.0008], [127.0006, 37.0008],
  ]] },
  { outer: [[127.02, 37], [127.021, 37], [127.021, 37.001], [127.02, 37.001]], holes: [] },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  fittedLevel = 3;
  maps = [];
  hooks.refs = [{ current: {} }, { current: null }];
  hooks.effect = null;
  vi.stubGlobal("window", { kakao: { maps: {
    LatLng, LatLngBounds: Bounds,
    Map: vi.fn(function () { const map = new MapStub(); maps.push(map); return map; }),
    Polygon: polygon,
    Marker: vi.fn(function () { return { setMap: vi.fn() }; }),
  } } });
  vi.stubGlobal("document", { createElement });
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  expect(createElement).not.toHaveBeenCalled();
  expect(hooks.setState).not.toHaveBeenCalledWith("error");
  vi.unstubAllGlobals();
});

async function mount(source: ParcelBoundaryInput, focusSubject = true) {
  hooks.cursor = 0;
  const tree = KakaoMap({ centerLat: 37, centerLng: 127, ...source, focusSubject });
  const cleanup = hooks.effect!();
  await Promise.resolve();
  await Promise.resolve();
  expect(maps).not.toHaveLength(0);
  return { tree, cleanup, map: maps.at(-1)! };
}
function recenter(node: ReactNode): ReactElement<{ onClick: () => void }> | undefined {
  if (Array.isArray(node)) return node.map(recenter).find(Boolean);
  if (!React.isValidElement(node)) return undefined;
  const props = node.props as { title?: string; children?: ReactNode };
  if (props.title === "대상지로") return node as ReactElement<{ onClick: () => void }>;
  return recenter(props.children);
}
function coordinates(path: LatLng[]) { return path.map((p) => [p.lng, p.lat]); }

describe("Kakao full parcel boundaries without a live SDK", () => {
  it("keeps the legacy single path and normal zoom behavior", async () => {
    const { tree, map } = await mount({ boundary: legacy });
    expect(polygon).toHaveBeenCalledTimes(1);
    expect(coordinates(polygon.mock.calls[0][0].path)).toEqual(legacy);
    expect(map.level).toBe(3);
    recenter(tree)!.props.onClick();
    expect(map.level).toBe(3);
  });

  it.each([
    { label: "missing", boundary: undefined }, { label: "empty", boundary: [] }, { label: "present", boundary: legacy },
  ])("uses Kakao's nested hole paths and separate polygons (legacy $label)", async ({ boundary }) => {
    await mount({ boundary, boundaryPolygons: full });
    expect(polygon).toHaveBeenCalledTimes(2);
    const first = polygon.mock.calls[0][0];
    expect(first.path.map(coordinates)).toEqual([full[0].outer, ...full[0].holes]);
    expect(coordinates(polygon.mock.calls[1][0].path)).toEqual(full[1].outer);
    expect(first.fillOpacity).toBe(0.15);
  });

  it.each([true, false])("keeps every part within initial and recentered bounds with focusSubject=%s", async (focusSubject) => {
    fittedLevel = 8;
    const { tree, map } = await mount({ boundaryPolygons: full }, focusSubject);
    const assertAllParts = () => {
      for (const part of full) for (const [lng, lat] of part.outer) {
        expect(map.bounds.points).toContainEqual(new LatLng(lat, lng));
        expect(map.getBounds().contain(new LatLng(lat, lng))).toBe(true);
      }
      expect(map.level).toBe(8);
    };
    assertAllParts();
    recenter(tree)!.props.onClick();
    assertAllParts();
    expect(map.setBounds).toHaveBeenCalledTimes(4);
  });

  it.each([
    { label: "empty full source", source: { boundary: legacy, boundaryPolygons: [] } },
    { label: "malformed hole", source: { boundary: legacy, boundaryPolygons: [{ outer: legacy, holes: [[[127, 37]]] }] } },
    { label: "self-intersection", source: { boundary: legacy, boundaryPolygons: [{ outer: [legacy[0], legacy[2], legacy[1], legacy[3]], holes: [] }] } },
    { label: "hole outside shell", source: { boundary: legacy, boundaryPolygons: [{ outer: legacy, holes: [full[1].outer] }] } },
    { label: "invalid second part", source: { boundary: legacy, boundaryPolygons: [full[0], { outer: [], holes: [] }] } },
    { label: "invalid legacy", source: { boundary: [legacy[0], legacy[2], legacy[1], legacy[3]] } },
  ])("draws no fallback for $label", async ({ source }) => {
    const { tree, map } = await mount(source as ParcelBoundaryInput);
    expect(polygon).not.toHaveBeenCalled();
    expect(map.bounds.points).toEqual([new LatLng(37, 127)]);
    recenter(tree)!.props.onClick();
    expect(map.bounds.points).toEqual([new LatLng(37, 127)]);
  });

  it("refreshes paths and bounds when only full topology changes", async () => {
    const first = await mount({ boundary: legacy, boundaryPolygons: full });
    const initialDependency = hooks.dependencies;
    first.cleanup?.();
    polygon.mockClear();
    const changed = [{ outer: full[1].outer, holes: [] }];
    const next = await mount({ boundary: legacy, boundaryPolygons: changed });
    expect(hooks.dependencies).not.toEqual(initialDependency);
    expect(polygon).toHaveBeenCalledTimes(1);
    expect(coordinates(polygon.mock.calls[0][0].path)).toEqual(changed[0].outer);
    expect(next.map.bounds.points).not.toContainEqual(new LatLng(legacy[2][1], legacy[2][0]));
  });
});
