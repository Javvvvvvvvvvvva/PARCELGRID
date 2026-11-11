import type { BuildingProgram, BuildingType, Parcel } from "./types";
import {
  buildingTypeToParkingUse,
  calculateParkingRequirement,
  type ParkingExclusiveAreaStatus,
  type ParkingRuleContext,
  type ParkingRuleSnapshot,
  type ParkingUse,
  type ParkingUseInput,
} from "@/lib/regulatory/parking-rules";

export interface ParkingResult {
  /** 법정 최소 주차대수 */
  requiredCars: number;
  /** 산정 근거 설명 */
  basis: string;
  /** 부설주차장 면제 가능 (소규모 단독 등) — 조례 확인 필요 */
  exemptPossible: boolean;
  /** 전용면적 추정이 들어갔는지 (세대형) */
  estimated: boolean;
  /** 참조 법령 */
  reference: string;
  /** 관할·시행일·법령 버전 스냅샷 */
  rule: ParkingRuleSnapshot;
  /** 원문 또는 필수 입력이 없어 확정할 수 없는 이유 */
  warnings: string[];
  /** 관할 원문과 필수 입력이 모두 갖춰진 예비 법규 판정인지 여부 */
  decisionGrade: boolean;
}

export interface CalcParkingOptions {
  context?: ParkingRuleContext;
  residentialAreaSqm?: number;
  retailAreaSqm?: number;
  officeAreaSqm?: number;
  exclusiveResidentialAreaSqm?: number;
  exclusiveAreaStatus?: ParkingExclusiveAreaStatus;
}

function formatParkingReferences(rule: ParkingRuleSnapshot): string {
  return rule.sources
    .map(
      (source) =>
        `${source.sourceName} ${source.sourceRef} · ${source.promulgationNo} · 시행 ${source.effectiveFrom}`
    )
    .join(" · ");
}

/**
 * 법정 주차대수 계산.
 * @param type 건물 유형
 * @param gfaSqm 연면적 (㎡)
 * @param residentialUnits 주거 세대수
 * @param retailUnits 근생 호실수 (대략 50㎡/호 가정)
 */
export function calcParking(
  type: BuildingType,
  gfaSqm: number,
  residentialUnits: number,
  retailUnits: number,
  options: CalcParkingOptions = {}
): ParkingResult {
  const uses: ParkingUseInput[] = [];
  const explicitComponentAreas =
    options.residentialAreaSqm != null ||
    options.retailAreaSqm != null ||
    options.officeAreaSqm != null;

  if (explicitComponentAreas) {
    const residentialAreaSqm = Math.max(0, options.residentialAreaSqm ?? 0);
    if (residentialAreaSqm > 0) {
      const residentialUse: ParkingUse =
        type === "single-house" ||
        type === "multi-family" ||
        type === "urban-housing" ||
        type === "officetel" ||
        type === "coliving"
          ? type
          : residentialUnits <= 1
            ? "single-house"
            : "multi-family";
      uses.push({
        use: residentialUse,
        facilityAreaSqm: residentialAreaSqm,
        unitCount: residentialUnits,
        exclusiveAreaSqm: options.exclusiveResidentialAreaSqm,
        exclusiveAreaStatus: options.exclusiveAreaStatus,
      });
    }
    if ((options.retailAreaSqm ?? 0) > 0) {
      uses.push({ use: "retail", facilityAreaSqm: options.retailAreaSqm! });
    }
    if ((options.officeAreaSqm ?? 0) > 0) {
      uses.push({ use: "office", facilityAreaSqm: options.officeAreaSqm! });
    }
  } else {
    uses.push({
      use: buildingTypeToParkingUse(type),
      facilityAreaSqm: Math.max(0, gfaSqm),
      unitCount: residentialUnits,
    });
    if (
      retailUnits > 0 &&
      type !== "retail" &&
      type !== "office" &&
      type !== "mixed"
    ) {
      uses.push({ use: "retail", facilityAreaSqm: retailUnits * 50 });
    }
  }

  const result = calculateParkingRequirement({
    context: options.context,
    uses,
  });

  return {
    requiredCars: result.requiredCars,
    basis: result.basis.join(" + "),
    exemptPossible: result.exemptPossible,
    estimated: result.estimated,
    reference: result.references.join(" · "),
    rule: result.rule,
    warnings: result.warnings,
    decisionGrade: result.decisionGrade,
  };
}

/**
 * 금융 시나리오의 프로그램 전체를 동일한 주차 규칙 계약으로 계산한다.
 * Stage 2 스냅샷이 있으면 재추정하지 않고 그 결과를 우선 사용한다.
 */
export function calcProgramParking(
  parcel: Pick<Parcel, "address" | "lotArea">,
  program: BuildingProgram
): ParkingResult {
  const areaContract = program.areaContract;
  const contractedRequirement = areaContract?.parkingRequirement;

  if (areaContract && contractedRequirement) {
    return {
      requiredCars: areaContract.requiredParkingSpaces,
      basis: contractedRequirement.basis.join(" + "),
      exemptPossible:
        areaContract.requiredParkingSpaces === 0 &&
        !contractedRequirement.decisionGrade,
      estimated: contractedRequirement.estimated,
      reference: formatParkingReferences(contractedRequirement.rule),
      rule: contractedRequirement.rule,
      warnings: contractedRequirement.warnings,
      decisionGrade: contractedRequirement.decisionGrade,
    };
  }

  const grossFloorArea =
    areaContract?.farAreaSqm ?? parcel.lotArea * (program.far / 100);
  const residentialRatio =
    program.mix.residentialSale + program.mix.residentialLease;
  const retailAreaSqm =
    program.type === "retail"
      ? grossFloorArea
      : grossFloorArea * program.mix.retail;

  return calcParking(
    program.type,
    grossFloorArea,
    program.units.residential,
    program.units.retail,
    {
      context: { address: parcel.address },
      residentialAreaSqm:
        program.type === "single-house" || program.type === "multi-family"
          ? grossFloorArea
          : program.type === "retail" || program.type === "office"
            ? 0
            : grossFloorArea * residentialRatio,
      retailAreaSqm,
      officeAreaSqm:
        program.type === "office"
          ? Math.max(0, grossFloorArea - retailAreaSqm)
          : 0,
    }
  );
}
