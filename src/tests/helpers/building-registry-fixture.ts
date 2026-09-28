import type { BuildingLookupResult } from "@/lib/integrations/molit-building";
/** Synthetic contract fixtures, not captured official parcel records. */
import {
  BUILDING_REGISTRY_SOURCE, BUILDING_REGISTRY_VERSION,
  type BuildingRegistryEvidence, type RegistryDataset, type RegistryOperation, type RegistryRecord,
} from "@/lib/building-registry/types";
import { emptyRegistryDataset } from "@/lib/integrations/molit-building-client";

export const REGISTRY_QUERY = { sigunguCd: "11320", bjdongCd: "10500", platGbCd: "0", bun: "0281", ji: "0023" } as const;
export const SYNTHETIC_TITLE = {
  ...REGISTRY_QUERY, mgmBldrgstPk: "fixture-title-01", rnum: "1", crtnDay: "20260901",
  bldNm: "검증용 건물", dongNm: "A동", mainAtchGbCd: "0", mainPurpsCdNm: "공동주택",
  etcPurps: "다세대주택", totArea: "200.3", archArea: "100.2", bcRat: "40", vlRat: "80",
  grndFlrCnt: "2", ugrndFlrCnt: "0", heit: "6", useAprDay: "20000101", hhldCnt: "4",
  fmlyCnt: "0", hoCnt: "0", rideUseElvtCnt: "0", emgenUseElvtCnt: "0", roofCdNm: "평지붕",
  indrMechUtcnt: "0", oudrMechUtcnt: "0", indrAutoUtcnt: "0", oudrAutoUtcnt: "2",
};
export function registryResponse(items: unknown[] | unknown, total = 1, page = 1, size = 100) {
  return { response: { header: { resultCode: "00", resultMsg: "NORMAL SERVICE" },
    body: { items: { item: items }, totalCount: total, numOfRows: size, pageNo: page } } };
}
export function fixtureRecord(fields: Record<string, string>): RegistryRecord {
  return { registryPk: fields.mgmBldrgstPk || null, rowNumber: fields.rnum || null, generatedDate: fields.crtnDay || null, fields };
}
export function fixtureDataset(operation: RegistryOperation, rows: RegistryRecord[] = []): RegistryDataset {
  return { ...emptyRegistryDataset(operation, REGISTRY_QUERY), status: "complete", pagesFetched: 1,
    rows, fetchedCount: rows.length, totalCount: rows.length };
}
export function fixtureEvidence(): BuildingRegistryEvidence {
  return { version: BUILDING_REGISTRY_VERSION, sourceUrl: BUILDING_REGISTRY_SOURCE, query: REGISTRY_QUERY,
    title: fixtureDataset("getBrTitleInfo", [fixtureRecord(SYNTHETIC_TITLE)]),
    floors: fixtureDataset("getBrFlrOulnInfo", [
      fixtureRecord({ ...SYNTHETIC_TITLE, rnum: "1", flrGbCdNm: "지상", flrNoNm: "1층", area: "100.1", areaExctYn: "N" }),
      fixtureRecord({ ...SYNTHETIC_TITLE, rnum: "2", flrGbCdNm: "지상", flrNoNm: "2층", area: "100.2", areaExctYn: "N" }),
      fixtureRecord({ ...SYNTHETIC_TITLE, rnum: "3", flrGbCdNm: "옥탑", flrNoNm: "옥탑", area: "10", areaExctYn: "Y" }),
    ]), exclusiveCommon: fixtureDataset("getBrExposPubuseAreaInfo", [
      fixtureRecord({ ...SYNTHETIC_TITLE, mgmBldrgstPk: "fixture-unit-01", rnum: "1", hoNm: "101", area: "40.1", exposPubuseGbCd: "1", exposPubuseGbCdNm: "전유" }),
      fixtureRecord({ ...SYNTHETIC_TITLE, mgmBldrgstPk: "fixture-unit-01", rnum: "2", hoNm: "101", area: "5.2", exposPubuseGbCd: "2", exposPubuseGbCdNm: "공용" }),
    ]) };
}

export function fixtureBuildingLookup(): BuildingLookupResult {
  return { registry: fixtureEvidence(), source: "building-registry", hasBuilding: true,
    buildings: [{ registryId: SYNTHETIC_TITLE.mgmBldrgstPk, dongName: "A동", source: "building-registry",
      name: "검증용 건물", mainPurpose: "공동주택", detailPurpose: "다세대주택", groundFloors: 2,
      undergroundFloors: 0, totalArea: 200.3, buildingArea: 100.2, buildingCoverage: 40,
      floorAreaRatio: 80, structure: "철근콘크리트", height: 6, approvalDate: "2000-01-01",
      ageYears: 26, isMainBuilding: true, householdCount: 4, familyCount: 0, unitCount: 0 }],
    totalBuildingArea: 200.3, oldestApprovalDate: "2000-01-01", maxAgeYears: 26, averageAgeYears: 26,
    redevelopmentSignal: "renovate", signalLabel: "합성 테스트 건물", signalReasoning: "공식 관측값이 아닌 합성 테스트 자료" };
}
