import type { StoredParcel } from "@/lib/hooks/use-dynamic-project";
import type { ParcelLookupComplete } from "./lookup-contract";
import { calculateDemolitionCost } from "@/lib/finance/demolition-cost";

export function createSiteIntake(parcel: ParcelLookupComplete, revision: string, selectedAt: string): StoredParcel {
  const demolition = parcel.currentBuilding ? calculateDemolitionCost(parcel.currentBuilding.buildings, parcel.currentBuilding.redevelopmentSignal) : null;
  return {
    id: parcel.pnu, address: parcel.address, addressRoad: parcel.addressRoad, lat: parcel.lat, lng: parcel.lng,
    lawdCd: parcel.lawdCd, pnu: parcel.pnu, lotArea: parcel.lotArea, boundary: parcel.boundary, roads: parcel.roads,
    zoning: parcel.zoning, zoneCode: parcel.zoneCode, maxFAR: parcel.maxFAR, maxBCR: parcel.maxBCR,
    heightLimit: parcel.heightLimit, regulatoryConstraints: parcel.regulatoryConstraints, overlays: parcel.overlays,
    inputProvenance: parcel.inputProvenance, landPrice: parcel.landPrice, landPriceYear: parcel.landPriceYear,
    setback: { road: 0, side: 0, rear: 0 }, acquired: "", acquiredPrice: null,
    demolitionCost: demolition?.totalManwon, currentBuilding: parcel.currentBuilding,
    intakeRevision: revision, selectedAt, jimokCategory: parcel.jimokCategory,
  };
}
