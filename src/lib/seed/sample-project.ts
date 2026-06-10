/**
 * Sample project seed: 역삼동 824-11.
 *
 * Mirrors the design's mock data so screens render the same numbers,
 * but every value here is engine-input — change a single assumption and
 * the entire dashboard updates downstream.
 *
 * Used by:
 *   - The demo page (no DB required)
 *   - The seed script (writes this to Postgres for dev)
 *   - Tests
 */

import type { Parcel, Scenario } from "@/lib/finance/types";
import {
  defaultAssumptions,
  defaultProgram,
} from "@/lib/finance/scenario";

export const SAMPLE_PARCEL: Parcel = {
  id: "PARCEL-2025-1118-073",
  address: "서울특별시 강남구 역삼동 824-11",
  addressRoad: "강남대로 372",
  lotArea: 645.3,
  zoning: "제3종일반주거지역",
  zoneCode: "UB30",
  maxFAR: 250,
  maxBCR: 60,
  heightLimit: 28,
  setback: { road: 3, side: 1.5, rear: 3 },
  landPrice: 12_400_000,
  estMarketPrice: 41_500_000,
  acquired: "2025-07-01", // → 2025-Q3 in cashflow phasing
  acquiredPrice: 268_000,
};

const baseA = defaultAssumptions();

export const SAMPLE_SCENARIOS: Scenario[] = [
  {
    id: "S1",
    name: "오피스텔 + 근생",
    shortName: "S1",
    tag: "고수익형",
    program: defaultProgram("officetel", 250, 60),
    assumptions: baseA,
  },
  {
    id: "S2",
    name: "도시형생활주택",
    shortName: "S2",
    tag: "안정형",
    program: defaultProgram("urban-housing", 250, 60),
    assumptions: { ...baseA, salePricePerSqM: 17_200_000, capRate: 4.6 },
  },
  {
    id: "S3",
    name: "근린생활시설 (중층)",
    shortName: "S3",
    tag: "보수형",
    program: defaultProgram("retail", 250, 60),
    assumptions: {
      ...baseA,
      rentPerSqMMonth: 52_000,
      salePricePerSqM: 0,
      vacancyRate: 7.0,
      capRate: 5.2,
    },
  },
  {
    id: "S4",
    name: "공유주거 (코리빙)",
    shortName: "S4",
    tag: "신규형",
    program: defaultProgram("coliving", 250, 60),
    assumptions: {
      ...baseA,
      rentPerSqMMonth: 89_000,
      salePricePerSqM: 0,
      vacancyRate: 6.2,
      capRate: 5.0,
      interestRate: 6.1,
    },
  },
];

/** Reference comps for the 실거래 비교 screen */
export const SAMPLE_COMPS = [
  { id: "C-2401", date: "2024-11-08", address: "역삼동 813-4", type: "오피스텔",
    area: 581, gfa: 1320, price: 612_400, pricePerPyeong: 1532, far: 215, dist: 0.18 },
  { id: "C-2387", date: "2024-09-22", address: "역삼동 791-22", type: "오피스텔",
    area: 712, gfa: 1654, price: 748_000, pricePerPyeong: 1496, far: 222, dist: 0.31 },
  { id: "C-2356", date: "2024-07-14", address: "삼성동 162-8", type: "오피스텔",
    area: 624, gfa: 1408, price: 658_500, pricePerPyeong: 1547, far: 218, dist: 0.86 },
  { id: "C-2334", date: "2024-05-30", address: "역삼동 837-11", type: "도시형생활",
    area: 558, gfa: 1142, price: 524_000, pricePerPyeong: 1373, far: 198, dist: 0.24 },
  { id: "C-2298", date: "2024-04-02", address: "논현동 245-7", type: "오피스텔",
    area: 678, gfa: 1502, price: 681_200, pricePerPyeong: 1473, far: 218, dist: 1.12 },
  { id: "C-2271", date: "2024-02-18", address: "역삼동 802-15", type: "근린생활",
    area: 612, gfa: 1058, price: 458_000, pricePerPyeong: 1098, far: 168, dist: 0.41 },
  { id: "C-2244", date: "2023-12-04", address: "삼성동 158-2", type: "오피스텔",
    area: 645, gfa: 1456, price: 638_800, pricePerPyeong: 1450, far: 220, dist: 0.92 },
  { id: "C-2218", date: "2023-10-21", address: "역삼동 776-3", type: "오피스텔",
    area: 591, gfa: 1342, price: 588_200, pricePerPyeong: 1457, far: 219, dist: 0.36 },
];

/** Default "edit history" entries for the override editor screen demo. */
export const SAMPLE_OVERRIDE_HISTORY = [
  {
    field: "salePricePerSqM",
    label: "분양가",
    fromValue: 17_800_000,
    toValue: 18_500_000,
    reason: "2025.02 강남구 역삼동·삼성동 8건 평균 +3.9% 반영",
    evidenceUrl: "CBRE_KR_1Q25.pdf",
    changedBy: "JK",
    changedAt: "2025-03-04T15:00:00+09:00",
  },
];
