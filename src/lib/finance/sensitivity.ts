/**
 * Sensitivity analysis.
 *
 * Re-runs calculateScenario across a grid of two assumption parameters
 * to expose how robust the recommendation is. Standard outputs:
 *   - profit at each (x, y) point
 *   - DSCR at each point (binding constraint flag if < 1.20)
 *   - IRR at each point
 *
 * Used in: 시나리오 비교 화면의 "민감도 분석" 탭.
 *
 * Cost note: a 7×7 grid = 49 full scenario recalculations. Each one is
 * fast (sub-ms) but on a hot path we memoize by input hash.
 */

import { calculateScenario } from "./scenario";
import type {
  Parcel,
  Scenario,
  AssumptionSet,
  SensitivityGrid,
  SensitivityCell,
} from "./types";

export interface SensitivityInput {
  parcel: Parcel;
  scenario: Scenario;
  paramX: keyof AssumptionSet;
  paramY: keyof AssumptionSet;
  /** Values to test for x. If omitted, defaults to ±20% in 5 steps around base. */
  xValues?: number[];
  yValues?: number[];
}

export function runSensitivity(input: SensitivityInput): SensitivityGrid {
  const { parcel, scenario, paramX, paramY } = input;
  const baseAssumptions = scenario.assumptions;

  const xValues = input.xValues ?? defaultRange(baseAssumptions[paramX] as number);
  const yValues = input.yValues ?? defaultRange(baseAssumptions[paramY] as number);

  const cells: SensitivityCell[][] = [];
  for (let yi = 0; yi < yValues.length; yi++) {
    const row: SensitivityCell[] = [];
    for (let xi = 0; xi < xValues.length; xi++) {
      const perturbed: AssumptionSet = {
        ...baseAssumptions,
        [paramX]: xValues[xi],
        [paramY]: yValues[yi],
      } as AssumptionSet;

      const r = calculateScenario({
        parcel,
        scenario: { ...scenario, assumptions: perturbed },
      });

      row.push({
        paramX,
        paramY,
        valueX: xValues[xi],
        valueY: yValues[yi],
        profit: r.profit,
        dscr: r.dscr,
        irr: r.irr,
      });
    }
    cells.push(row);
  }

  return { paramX, paramY, xValues, yValues, cells };
}

function defaultRange(center: number, steps = 5): number[] {
  // ±20% range, symmetric around the center
  const min = center * 0.8;
  const max = center * 1.2;
  const out: number[] = [];
  for (let i = 0; i < steps; i++) {
    out.push(min + ((max - min) * i) / (steps - 1));
  }
  return out;
}
