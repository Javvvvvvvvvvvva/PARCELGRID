import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  geocodeAddress: vi.fn(),
  lookupCadastral: vi.fn(),
  lookupZoningByPNU: vi.fn(),
  lookupBuildingByJibun: vi.fn(),
}));

vi.mock("@/lib/integrations/kakao", () => ({
  geocodeAddress: mocks.geocodeAddress,
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

function request(): NextRequest {
  return new NextRequest("http://localhost/api/parcels/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: GEOCODE.address }),
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
});
