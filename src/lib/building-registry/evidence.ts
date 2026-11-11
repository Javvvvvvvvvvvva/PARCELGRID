import Decimal from "decimal.js";
import type { BuildingLookupResult } from "@/lib/integrations/molit-building";
import {
  registryNumber, type BuildingRegistryEvidence, type RegistryDataset, type RegistryRecord,
} from "./types";

export type BuildingRegistryStatus = "present" | "no-records" | "unknown";

export function getBuildingRegistryStatus(info: BuildingLookupResult | null | undefined): BuildingRegistryStatus {
  if (info?.hasBuilding && info.buildings?.length) return "present";
  const title = info?.registry?.title;
  if (title?.status === "complete" && title.totalCount === 0 && title.fetchedCount === 0 &&
      title.pagesFetched > 0 && title.rows.length === 0 && info?.buildings?.length === 0) return "no-records";
  return "unknown";
}

export function buildingRegistryLabel(info: BuildingLookupResult | null | undefined): string {
  const status = getBuildingRegistryStatus(info);
  if (status === "no-records") return "조회 범위 내 표제부 0건 · 현장 미확인";
  if (status === "unknown") return "대장 조회 미확인 · 건물 유무 확인 필요";
  if (info?.source === "vworld-gis") return "GIS 건물 속성 있음 · 대장과 별도 확인";
  return info?.registry?.title.status === "partial" ? "일부 대장 확보 · 추가 확인" : "기존 건물 속성 확보";
}

export function registryDatasetLabel(dataset: RegistryDataset): string {
  if (dataset.status === "not-requested") return "미조회";
  if (dataset.status === "unavailable") return "조회 실패·미설정";
  return dataset.status === "complete" ? "조회 전건 확보" : "부분 조회·검토 필요";
}

export interface FloorAreaComparison {
  registryPk: string;
  name: string;
  titleAreaSqm: number | null;
  includedFloorAreaSqm: number | null;
  differenceSqm: number | null;
  rowCount: number;
  excludedRows: number;
  unresolvedRows: number;
  comparable: boolean;
}

export function areaUse(row: RegistryRecord): "exclusive" | "common" | "unknown" {
  // Do not invent a provider code table when only a raw code was supplied.
  const name = row.fields.exposPubuseGbCdNm;
  return name === "전유" ? "exclusive" : name === "공용" ? "common" : "unknown";
}

export function summarizeRegistryAreas(evidence: BuildingRegistryEvidence) {
  const titleIds = new Set(evidence.title.rows.map((row) => row.registryPk).filter(Boolean));
  const comparisons: FloorAreaComparison[] = evidence.title.rows.filter((row) => row.registryPk).map((title) => {
    const rows = evidence.floors.rows.filter((row) => row.registryPk === title.registryPk);
    let sum = new Decimal(0), excluded = 0, unresolved = 0;
    for (const row of rows) {
      if (row.fields.areaExctYn === "Y") { excluded++; continue; }
      const area = registryNumber(row.fields.area);
      if (row.fields.areaExctYn !== "N" || area == null) { unresolved++; continue; }
      sum = sum.plus(area);
    }
    const titleAreaSqm = registryNumber(title.fields.totArea);
    const comparable = evidence.title.status === "complete" && evidence.floors.status === "complete" &&
      rows.length > 0 && unresolved === 0 && titleAreaSqm != null;
    return {
      registryPk: title.registryPk!, name: [title.fields.bldNm, title.fields.dongNm].filter(Boolean).join(" · ") || "동명 미제공",
      titleAreaSqm, includedFloorAreaSqm: rows.length && !unresolved ? sum.toNumber() : null,
      differenceSqm: comparable ? sum.minus(titleAreaSqm!).toDecimalPlaces(4).toNumber() : null,
      rowCount: rows.length, excludedRows: excluded, unresolvedRows: unresolved, comparable,
    };
  });
  const sumArea = (kind: "exclusive" | "common") => {
    const rows = evidence.exclusiveCommon.rows.filter((row) => areaUse(row) === kind);
    const values = rows.map((row) => registryNumber(row.fields.area));
    return rows.length && values.every((value) => value != null)
      ? values.reduce<Decimal>((sum, value) => sum.plus(value!), new Decimal(0)).toNumber() : null;
  };
  return {
    comparisons,
    unmatchedFloorRows: evidence.floors.rows.filter((row) => !row.registryPk || !titleIds.has(row.registryPk)).length,
    exclusiveObservedSqm: sumArea("exclusive"), commonObservedSqm: sumArea("common"),
    unclassifiedAreaRows: evidence.exclusiveCommon.rows.filter((row) => areaUse(row) === "unknown").length,
    missingAreaRows: evidence.exclusiveCommon.rows.filter((row) => registryNumber(row.fields.area) == null).length,
  };
}

export function registryEvidenceDownload(info: BuildingLookupResult): string | null {
  if (!info.registry) return null;
  return JSON.stringify({
    format: "parcelgrid-building-evidence-v1", registry: info.registry,
    reconciliation: summarizeRegistryAreas(info.registry),
    limitations: ["API 관측 속성 스냅샷이며 발급 대장·도면·현장조사를 대체하지 않음",
      "표제부 0건은 실제 나대지 확정이 아님", "전유/공용 수신 행 합계는 동 연면적·분양면적·신축 계획 면적이 아님",
      "crtnDay는 자료 생성일이며 법적 효력일이나 현장 확인일이 아님"],
  }, null, 2);
}
