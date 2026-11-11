import { describe, expect, it } from "vitest";
import { boundaryContainsLocation } from "@/lib/parcels/selection";
import { createSiteIntake } from "@/lib/parcels/site-intake";
import { buildSiteProject, buildDynamicProjectRequest, hasAcquisitionPrice } from "@/lib/hooks/use-dynamic-project";
import type { ParcelLookupComplete } from "@/lib/parcels/lookup-contract";
import { createRegulatoryReferenceSet } from "@/lib/regulatory/constraints";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/projects/dynamic/route";
import { DEMO_PARCEL } from "@/lib/seed/demo-project";
import { matchesProjectIntake } from "@/lib/services/project-intake";

const boundary: [number, number][] = [[127,37],[127.001,37],[127.001,37.001],[127,37.001]];
const selection: ParcelLookupComplete = { mode: "vworld", pnu: "1132010500102810023", address: "서울 도봉구 쌍문동 281-23", addressRoad: null,
  lat: 37.650511, lng: 127.025749, bCode: "1132010500", lawdCd: "11320", sido: "서울", sigungu: "도봉구", dong: "쌍문동", jibun: "281-23", mainAddressNo: "281", subAddressNo: "23", mountainYn: "N",
  currentBuilding: null, existingUnitArea: null, lotArea: 118.02, boundary, jimok: "대", jimokCode: "08", jimokCategory: "buildable", landPrice: 1000000, landPriceYear: "2026", zoning: "제2종일반주거지역", zoneCode: "UB20", maxFAR: 250, maxBCR: 60, heightLimit: 0,
  regulatoryConstraints: createRegulatoryReferenceSet({ farPct: 250, bcrPct: 60, heightM: 0, retrievedAt: "2026-09-28T00:00:00Z" }), overlays: [],
  inputProvenance: { mode: "vworld", parcelFacts: "vworld-cadastral", geometry: "vworld-cadastral", zoning: "vworld-land-use", recordedAt: "2026-09-28T00:00:00Z" } };

describe("site selection and unpriced intake", () => {
  it("does not reuse another intake's saved calculations for the same PNU", () => {
    const site = buildSiteProject(createSiteIntake(selection, "new", "2026-09-28T00:00:00Z"));
    const current = { ...site, meta: { ...site.meta, mode: undefined } };
    const old = { ...current, meta: { ...current.meta, intakeRevision: "old" } };
    expect(matchesProjectIntake(old, current)).toBe(false);
    expect(matchesProjectIntake(current, current)).toBe(true);
    expect(matchesProjectIntake(current, site)).toBe(false);
    const legacy = { ...current, meta: { ...current.meta, intakeRevision: undefined } };
    expect(matchesProjectIntake(legacy, current)).toBe(false);
    expect(matchesProjectIntake(legacy, legacy)).toBe(true);
  });
  it("accepts an interior point and rejects a neighboring lot, shared boundary, and missing geometry", () => {
    expect(boundaryContainsLocation(boundary, { lat: 37.0005, lng: 127.0005 })).toBe(true);
    expect(boundaryContainsLocation(boundary, { lat: 37.0005, lng: 127.002 })).toBe(false);
    expect(boundaryContainsLocation(boundary, { lat: 37, lng: 127.0005 })).toBe(false);
    expect(boundaryContainsLocation(undefined, { lat: 37, lng: 127 })).toBe(false);
  });
  it("preserves selected facts and provenance without inventing a price or acquisition date", () => {
    const stored = createSiteIntake(selection, "da0b8b17-9c42-4eee-9644-bb81002e3c3a", "2026-09-28T00:00:00Z");
    expect(stored.acquiredPrice).toBeNull(); expect(stored.acquired).toBe("");
    expect(stored.acquisitionEstimate).toBeUndefined(); expect(stored.estMarketPrice).toBeUndefined();
    expect(stored.boundary).toEqual(boundary); expect(stored.regulatoryConstraints).toEqual(selection.regulatoryConstraints);
    const site = buildSiteProject(stored);
    expect(site.meta.mode).toBe("site-only"); expect(site.scenarios).toEqual([]); expect(site.pfSchedule).toEqual([]);
    expect(site.maxAcquisition).toEqual([]); expect(site.parcel.risk).toBe("미평가");
    expect(() => buildDynamicProjectRequest(stored)).toThrow(/취득대금/);
  });
  it("only enables a financial request after a positive finite price is supplied", () => {
    const stored = createSiteIntake(selection, "da0b8b17-9c42-4eee-9644-bb81002e3c3a", "2026-09-28T00:00:00Z");
    for (const price of [null, 0, -1, Infinity, NaN]) {
      expect(hasAcquisitionPrice({ ...stored, acquiredPrice: price })).toBe(false);
      expect(() => buildDynamicProjectRequest({ ...stored, acquiredPrice: price })).toThrow();
    }
    const body = buildDynamicProjectRequest({ ...stored, acquiredPrice: 206000, acquired: "2026-10-01" });
    expect(body.parcel.acquiredPrice).toBe(206000); expect(body.intakeRevision).toBe(stored.intakeRevision);
  });
  it("rejects null and zero acquisition prices at the server boundary as well", async () => {
    for (const acquiredPrice of [null, 0]) {
      const response = await POST(new NextRequest("http://localhost/api/projects/dynamic", { method: "POST", body: JSON.stringify({ parcel: { ...DEMO_PARCEL, acquiredPrice } }), headers: { "Content-Type": "application/json" } }));
      expect(response.status).toBe(422);
    }
  });
});
