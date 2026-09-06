import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/parcels/nearby-stations/route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("nearby stations route", () => {
  it("requires both coordinates", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/parcels/nearby-stations?lng=127&radius=1000",
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_STATION_SEARCH",
    });
  });

  it("rejects invalid coordinates before calling the provider", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/parcels/nearby-stations?lat=999&lng=127&radius=1000",
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_STATION_SEARCH",
    });
  });

  it("distinguishes missing provider configuration from no results", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "");
    const response = await GET(
      new NextRequest(
        "http://localhost/api/parcels/nearby-stations?lat=37.650511&lng=127.025749&radius=1000",
      ),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "KAKAO_NOT_CONFIGURED",
    });
  });
});
