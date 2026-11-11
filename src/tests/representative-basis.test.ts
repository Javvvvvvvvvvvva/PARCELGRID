import { describe, expect, it } from "vitest";
import type { Parcel } from "@/lib/finance/types";
import {
  buildRepresentativeParcelBasisHash,
  representativeParcelBasisInvalidationReason,
} from "@/lib/planning/representative-basis";
import { createRegulatoryReferenceSet } from "@/lib/regulatory/constraints";

const parcel: Parcel = {
  id: "P-BASIS",
  address: "서울 테스트구 테스트동 1-1",
  addressRoad: "테스트로 1",
  lat: 37.5,
  lng: 127,
  lotArea: 120,
  boundary: [
    [127, 37.5],
    [127.001, 37.5],
    [127.001, 37.501],
    [127, 37.5],
  ],
  roads: [
    {
      name: "테스트로",
      points: [
        [127, 37.499],
        [127.001, 37.499],
      ],
    },
  ],
  zoning: "제2종일반주거지역",
  zoneCode: "UB20",
  maxFAR: 200,
  maxBCR: 60,
  heightLimit: 18,
  regulatoryConstraints: createRegulatoryReferenceSet({
    farPct: 200,
    bcrPct: 60,
    heightM: 18,
    retrievedAt: "2026-09-09T00:00:00.000Z",
  }),
  inputProvenance: {
    mode: "manual",
    parcelFacts: "user-entered",
    geometry: "user-geojson",
    zoning: "user-entered",
    recordedAt: "2026-09-09T00:00:00.000Z",
  },
  setback: { road: 1, side: 0.5, rear: 1.5 },
  currentBuilding: null,
  landPrice: 5_000_000,
  estMarketPrice: 8_000_000,
  acquired: "2026-01-01",
  acquiredPrice: 80_000,
  demolitionCost: 2_000,
};

describe("representative parcel basis", () => {
  it("does not invalidate the representative for finance-only changes", () => {
    const changed: Parcel = {
      ...parcel,
      acquiredPrice: 95_000,
      demolitionCost: 4_000,
      landPrice: 6_000_000,
      estMarketPrice: 9_000_000,
    };

    expect(buildRepresentativeParcelBasisHash(changed)).toBe(
      buildRepresentativeParcelBasisHash(parcel)
    );
  });

  it.each([
    ["boundary", { boundary: [...parcel.boundary!.slice(0, 1), [127.002, 37.5], ...parcel.boundary!.slice(2)] }],
    ["road", { roads: [{ name: "변경 도로", points: parcel.roads![0].points }] }],
    ["setback", { setback: { ...parcel.setback, rear: 2 } }],
    ["zoning", { zoning: "제3종일반주거지역", zoneCode: "UB30" }],
    ["FAR", { maxFAR: 250 }],
  ])("changes the hash when the %s basis changes", (_label, patch) => {
    expect(
      buildRepresentativeParcelBasisHash({ ...parcel, ...patch } as Parcel)
    ).not.toBe(buildRepresentativeParcelBasisHash(parcel));
  });

  it("binds the representative to regulatory evidence status and provenance", () => {
    const changed: Parcel = {
      ...parcel,
      regulatoryConstraints: {
        ...parcel.regulatoryConstraints!,
        retrievedAt: "2026-09-10T00:00:00.000Z",
        far: {
          ...parcel.regulatoryConstraints!.far,
          status: "source-backed",
          sourceName: "관할 조례 원문",
          sourceRef: "DOC-1",
          checkedBy: "검토자",
        },
      },
    };

    expect(buildRepresentativeParcelBasisHash(changed)).not.toBe(
      buildRepresentativeParcelBasisHash(parcel)
    );
  });

  it("keeps a representative across finance-only parcel updates", () => {
    expect(
      representativeParcelBasisInvalidationReason({
        snapshotProjectId: parcel.id,
        storedBasisHash: buildRepresentativeParcelBasisHash(parcel),
        nextParcel: { ...parcel, acquiredPrice: 90_000 },
      })
    ).toBeNull();
  });

  it("invalidates changed and legacy parcel bases", () => {
    expect(
      representativeParcelBasisInvalidationReason({
        snapshotProjectId: parcel.id,
        storedBasisHash: buildRepresentativeParcelBasisHash(parcel),
        nextParcel: { ...parcel, setback: { ...parcel.setback, rear: 2 } },
      })
    ).toContain("법규 근거가 변경");
    expect(
      representativeParcelBasisInvalidationReason({
        snapshotProjectId: parcel.id,
        storedBasisHash: null,
        nextParcel: parcel,
      })
    ).toContain("다시 확정");
  });

  it("invalidates a representative loaded for another project", () => {
    expect(
      representativeParcelBasisInvalidationReason({
        snapshotProjectId: "P-OTHER",
        storedBasisHash: buildRepresentativeParcelBasisHash(parcel),
        nextParcel: parcel,
      })
    ).toContain("부지가 변경");
  });
});
