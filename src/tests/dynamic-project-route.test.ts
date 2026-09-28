import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/projects/dynamic/route";
import { DEMO_PARCEL } from "@/lib/seed/demo-project";
import { fixtureBuildingLookup } from "./helpers/building-registry-fixture";

describe("dynamic project route", () => {
  it("keeps complete source snapshots through computation and rejects key-bearing provenance", async () => {
    const currentBuilding = fixtureBuildingLookup();
    const registry = currentBuilding.registry!;
    const request = () => new NextRequest("http://localhost/api/projects/dynamic", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parcel: { ...DEMO_PARCEL, currentBuilding } }),
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).parcel.currentBuilding.registry).toEqual(registry);
    registry.title.requestUrl += "&serviceKey=should-not-be-saved";
    expect((await POST(request())).status).toBe(422);
  });
  it("rejects malformed JSON", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/projects/dynamic", {
        method: "POST",
        body: "{",
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_JSON" });
  });

  it("rejects invalid parcel values before running the engine", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/projects/dynamic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parcel: {
            id: "invalid",
            address: "서울 테스트",
            addressRoad: "",
            lotArea: -1,
            zoning: "제2종일반주거지역",
            zoneCode: "UB20",
            maxFAR: 250,
            maxBCR: 60,
            heightLimit: 0,
            setback: { road: 0, side: 0, rear: 0 },
            landPrice: 1,
            estMarketPrice: 1,
            acquired: "2026-09-06",
            acquiredPrice: 1,
          },
        }),
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_PROJECT_INPUT",
    });
  });
});
