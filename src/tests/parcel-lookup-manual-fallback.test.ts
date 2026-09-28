import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  geocodeAddress: vi.fn(),
  reverseGeocodeLocation: vi.fn(),
  lookupCadastral: vi.fn(),
  lookupZoningByPNU: vi.fn(),
  lookupBuildingByJibun: vi.fn(),
}));

vi.mock("@/lib/integrations/kakao", () => ({
  geocodeAddress: mocks.geocodeAddress,
  reverseGeocodeLocation: mocks.reverseGeocodeLocation,
}));

vi.mock("@/lib/integrations/vworld", () => ({
  lookupCadastral: mocks.lookupCadastral,
  lookupZoningByPNU: mocks.lookupZoningByPNU,
}));

vi.mock("@/lib/integrations/molit-building", () => ({
  lookupBuildingByJibun: mocks.lookupBuildingByJibun,
  estimateUnitAreaSqm: vi.fn(() => null),
}));

vi.mock("@/lib/integrations/vworld-buildings", () => ({
  attachExistingBuildingGeometry: vi.fn((building) => building),
}));

vi.mock("@/lib/integrations/vworld-buildings-client", () => ({
  fetchExistingBuildingGeometry: vi.fn(),
}));

vi.mock("@/lib/integrations/vworld-cadastral-context", () => ({
  fetchCadastralContextParcels: vi.fn(),
}));

import { POST } from "@/app/api/parcels/lookup/route";

const GEOCODE = {
  address: "서울 도봉구 쌍문동 281-23",
  roadAddress: null,
  lat: 37.648,
  lng: 127.034,
  bCode: "1132010500",
  lawdCd: "11320",
  sido: "서울",
  sigungu: "도봉구",
  dong: "쌍문동",
  jibun: "281-23",
  mainAddressNo: "281",
  subAddressNo: "23",
  mountainYn: "N" as const,
};

function request(body: unknown = { address: GEOCODE.address }): NextRequest {
  return new NextRequest("http://localhost/api/parcels/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("parcel lookup VWorld-free fallback", () => {
  const originalEnabled = process.env.VWORLD_ENABLED;
  const originalKey = process.env.VWORLD_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.geocodeAddress.mockResolvedValue(GEOCODE);
    mocks.lookupBuildingByJibun.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalEnabled == null) delete process.env.VWORLD_ENABLED;
    else process.env.VWORLD_ENABLED = originalEnabled;
    if (originalKey == null) delete process.env.VWORLD_API_KEY;
    else process.env.VWORLD_API_KEY = originalKey;
  });

  it("does not call VWorld when it is explicitly disabled", async () => {
    process.env.VWORLD_ENABLED = "false";
    process.env.VWORLD_API_KEY = "configured-key";

    const response = await POST(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.mode).toBe("manual-required");
    expect(payload.reason.code).toBe("VWORLD_DISABLED");
    expect(payload.pnu).toBe("1132010500102810023");
    expect(mocks.lookupCadastral).not.toHaveBeenCalled();
    expect(mocks.lookupBuildingByJibun).toHaveBeenCalledOnce();
  });

  it("keeps the manual path when a configured VWorld endpoint is unreachable", async () => {
    process.env.VWORLD_ENABLED = "true";
    process.env.VWORLD_API_KEY = "configured-key";
    mocks.lookupCadastral.mockRejectedValue(new Error("network blocked"));

    const response = await POST(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.reason.code).toBe("VWORLD_UNREACHABLE");
    expect(payload.currentBuilding).toBeNull();
    expect(mocks.lookupCadastral).toHaveBeenCalledOnce();
  });

  it("does not retrieve building records while exploring the map or selecting an address", async () => {
    process.env.VWORLD_ENABLED = "false";
    const response = await POST(request({ address: GEOCODE.address, phase: "selection" }));
    expect(response.status).toBe(200);
    expect((await response.json()).currentBuilding).toBeNull();
    expect(mocks.lookupBuildingByJibun).not.toHaveBeenCalled();
  });

  it("lets a neighborhood search move the map without treating the region as a parcel", async () => {
    mocks.geocodeAddress.mockResolvedValue({ ...GEOCODE, address: "서울 도봉구 쌍문동", mainAddressNo: "", subAddressNo: "" });
    const result = await POST(request({ address: "서울 도봉구 쌍문동", phase: "selection" }));
    expect(await result.json()).toMatchObject({ mode: "area", lat: GEOCODE.lat, lng: GEOCODE.lng });
    expect(mocks.lookupCadastral).not.toHaveBeenCalled(); expect(mocks.lookupBuildingByJibun).not.toHaveBeenCalled();
  });

  it("rejects invalid inputs before contacting any provider", async () => {
    for (const body of [null, { address: 123 }, { location: { lat: 100, lng: 127 } }, { address: GEOCODE.address, location: { lat: 37.6, lng: 127 } }]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect(mocks.geocodeAddress).not.toHaveBeenCalled();
  });

  it("does not confirm a parcel whose identity changed between selection and confirmation", async () => {
    expect((await POST(request({ address: GEOCODE.address, expectedPnu: "1132010500102810024" }))).status).toBe(409);
    expect(mocks.lookupBuildingByJibun).not.toHaveBeenCalled();
  });

  it("rejects a nearby cadastral parcel with a different legal lot ID", async () => {
    process.env.VWORLD_ENABLED = "true"; process.env.VWORLD_API_KEY = "configured-key";
    mocks.lookupCadastral.mockResolvedValue({ pnu: "1132010500102810024", boundary: [[127.03,37.64],[127.04,37.64],[127.04,37.65],[127.03,37.65]] });
    const result = await POST(request({ address: GEOCODE.address, phase: "selection" }));
    expect(result.status).toBe(409);
    expect(mocks.lookupZoningByPNU).not.toHaveBeenCalled();
  });

  it("checks the clicked coordinate, not the address provider's centroid", async () => {
    process.env.VWORLD_ENABLED = "true"; process.env.VWORLD_API_KEY = "configured-key";
    mocks.reverseGeocodeLocation.mockResolvedValue(GEOCODE);
    mocks.lookupCadastral.mockResolvedValue({ pnu: "1132010500102810023", boundary: [[127.03,37.64],[127.04,37.64],[127.04,37.65],[127.03,37.65]] });
    const location = { lat: 37.66, lng: 127.04 };
    expect((await POST(request({ location, phase: "selection" }))).status).toBe(409);
    expect(mocks.lookupCadastral).toHaveBeenCalledWith(location.lat, location.lng, expect.any(Object), { includeRoads: false });
  });

  it("accepts a matching address and inside point without fetching building details", async () => {
    process.env.VWORLD_ENABLED = "true"; process.env.VWORLD_API_KEY = "configured-key";
    mocks.reverseGeocodeLocation.mockResolvedValue(GEOCODE);
    mocks.lookupCadastral.mockResolvedValue({ pnu: "1132010500102810023", boundary: [[127.03,37.64],[127.04,37.64],[127.04,37.65],[127.03,37.65]], centroid: { lat: 37.645, lng: 127.035 }, roads: [], lotAreaSqm: 100 });
    mocks.lookupZoningByPNU.mockResolvedValue({ zoning: "제2종일반주거지역", maxFAR: 200, maxBCR: 60, overlays: [] });
    const result = await POST(request({ location: { lat: 37.645, lng: 127.035 }, phase: "selection" }));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ pnu: "1132010500102810023", mode: "vworld", currentBuilding: null });
    expect(mocks.lookupBuildingByJibun).not.toHaveBeenCalled();
  });
});
