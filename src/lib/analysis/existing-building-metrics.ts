/**
 * 기존 건물 건폐율·용적률 — 대장값 + 대지면적 역산.
 */

import type { BuildingInfo } from "@/lib/integrations/molit-building";

export interface ExistingBuildingRatios {
  /** 건폐율 (%) — 대장 우선, 없으면 건축면적÷대지 */
  bcrPct: number;
  /** 용적률 (%) — 대장 우선, 없으면 연면적÷대지 */
  farPct: number;
  bcrSource: "건축물대장" | "면적 역산";
  farSource: "건축물대장" | "면적 역산";
  buildingAreaSqm: number;
  totalAreaSqm: number;
  unbuiltLotSqm: number;
  unbuiltLotPct: number;
}

export function computeExistingRatios(
  main: BuildingInfo,
  lotArea: number
): ExistingBuildingRatios {
  const bcrFromArea = lotArea > 0 ? (main.buildingArea / lotArea) * 100 : 0;
  const farFromArea = lotArea > 0 ? (main.totalArea / lotArea) * 100 : 0;

  const bcrPct =
    main.buildingCoverage > 0 ? main.buildingCoverage : Math.round(bcrFromArea * 10) / 10;
  const farPct =
    main.floorAreaRatio > 0 ? main.floorAreaRatio : Math.round(farFromArea * 10) / 10;

  const unbuiltLotSqm = Math.max(0, lotArea - main.buildingArea);
  const unbuiltLotPct = lotArea > 0 ? (unbuiltLotSqm / lotArea) * 100 : 0;

  return {
    bcrPct,
    farPct,
    bcrSource: main.buildingCoverage > 0 ? "건축물대장" : "면적 역산",
    farSource: main.floorAreaRatio > 0 ? "건축물대장" : "면적 역산",
    buildingAreaSqm: main.buildingArea,
    totalAreaSqm: main.totalArea,
    unbuiltLotSqm,
    unbuiltLotPct,
  };
}

/** `47.8% / 상한 60%` 형식 */
export function formatRatioVsLimit(current: number, limit: number): string {
  return `${current.toFixed(1)}% / 상한 ${limit}%`;
}

/** 상한 대비 여유 (%) */
export function headroomPct(current: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.max(0, limit - current);
}
