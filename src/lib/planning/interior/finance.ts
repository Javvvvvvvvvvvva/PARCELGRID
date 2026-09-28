import type { FloorProgram, FloorZone } from "../types";
import type { LocalPlanPoint } from "../planning-massing";
import { clearSpaceArea, validateInteriorLayout } from "./geometry";
import type { InteriorLayout } from "./types";

export function interiorFinanceSignature(layout: InteriorLayout, zones: FloorZone[]): string {
  // Full signature, not a security hash: avoid collisions and ignore regenerated zone IDs on clone.
  return JSON.stringify({ layout, zones: zones.map(zone => ({
    useType: zone.useType, areaSqm: zone.areaSqm, unitCount: zone.unitCount,
    revenueModel: zone.revenueModel, saleableAreaSqm: zone.saleableAreaSqm,
    rentableAreaSqm: zone.rentableAreaSqm,
  })) });
}

export function isInteriorFinanceCurrent(floor: FloorProgram): boolean {
  return !!floor.interior && floor.interiorFinanceSignature === interiorFinanceSignature(floor.interior, floor.zones);
}

/** Explicit opt-in: preserve gross program area; use clear-face estimates only for revenue. */
export function applyInteriorToFloor(floor: FloorProgram, layout: InteriorLayout, outline: LocalPlanPoint[]): FloorProgram {
  const assessment = validateInteriorLayout(layout, outline);
  if (!assessment.valid) throw new Error("내부 구획 검증을 통과한 뒤 사업성 면적에 반영할 수 있습니다.");
  const oldGross = floor.zones.reduce((sum, z) => sum + z.areaSqm, 0);
  if (Math.abs(oldGross - assessment.floorAreaSqm) > Math.max(0.05, oldGross * 0.001)) throw new Error("층 프로그램 면적과 외곽 면적이 일치하지 않습니다. 외곽 정합성을 먼저 확인하세요.");
  const zones: FloorZone[] = layout.spaces.map(space => {
    const revenue = space.revenueModel;
    const clear = clearSpaceArea(space, layout.wallThicknessM);
    const common = space.kind === "corridor" || space.kind === "core";
    return { id: `interior-${space.id}`, label: space.label, useType: common ? "common" : space.kind === "retail" ? "retail" : space.kind === "storage" ? "storage" : "residential",
      areaSqm: space.widthM * space.depthM, unitCount: space.unitCount, revenueModel: revenue,
      saleableAreaSqm: revenue === "sale" ? clear : 0, rentableAreaSqm: revenue === "lease" ? clear : 0 };
  });
  let remainder = oldGross - zones.reduce((sum, z) => sum + z.areaSqm, 0);
  if (remainder < -0.00001) throw new Error("구획 면적 합계가 기존 층 면적을 초과합니다.");
  // Remove sub-tolerance floating-point overflow from a common zone, never from revenue area.
  if (remainder < 0) {
    const common = zones.find(z => z.useType === "common");
    if (!common) throw new Error("공용 면적의 수치 오차를 정리하지 못했습니다.");
    common.areaSqm += remainder;
    remainder = 0;
  }
  if (remainder > 0) zones.push({ id: "interior-unallocated", label: "미배치 잔여면적", useType: "common", areaSqm: remainder, unitCount: 0, revenueModel: "non-revenue" });
  return { ...floor, zones, interior: structuredClone(layout), interiorFinanceSignature: interiorFinanceSignature(layout, zones) };
}
