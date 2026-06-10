/**
 * 부지 인수가 검증 엔진.
 *
 * UPDATED: jimok 기반 필터링 추가. 부지 지목과 같은 카테고리의 거래만
 * 비교 — "대지인데 임야 거래랑 비교해서 +719% 나오는" 문제 해결.
 */

import type { MolitTransaction } from "@/lib/integrations/molit";
import { jimokToCategory, type JimokCategory } from "@/lib/integrations/vworld";

export interface AcquisitionCheckInput {
  parcel: {
    lotAreaSqm: number;
    landPriceWonPerSqm: number;
    lat: number;
    lng: number;
    jimokCategory?: JimokCategory;
  };
  acquisitionPriceManwon: number;
  acquisitionDate: string;
  landTransactions: MolitTransaction[];
  scope: "dong" | "sigungu" | "radius";
  radiusKm?: number;
  targetDong?: string;
  jimokFilter?: "match-parcel" | "buildable-only" | "all";
}

export type AxisStatus = "ok" | "caution" | "overpaid" | "insufficient";

export interface AxisResult {
  status: AxisStatus;
  label: string;
  value: number;
  details: Record<string, number | string | undefined>;
}

export interface AcquisitionCheckResult {
  inputs: {
    acquisitionPriceManwon: number;
    acquisitionPricePerPyeong: number;
    landPriceTotal: number;
    landPriceRatio: number;
  };

  comparablesUsed: number;
  comparableStats: {
    count: number;
    medianPricePerPyeong: number;
    p25: number;
    p75: number;
    minPricePerPyeong: number;
    maxPricePerPyeong: number;
    monthsSpanned: number;
  };

  jimokBreakdown: {
    buildable: number;
    farmland: number;
    forest: number;
    other: number;
    unknown: number;
  };

  filteredOut: {
    byJimok: number;
    byZeroPrice: number;
  };

  axisLandPriceRatio: AxisResult;
  axisMarketPriceComparison: AxisResult;
  axisTransactionPattern: AxisResult;

  verdict: {
    status: "fair" | "caution" | "overpaid" | "insufficient";
    label: string;
    reasoning: string;
  };

  transactionsForDisplay: Array<
    MolitTransaction & {
      pricePerPyeong: number;
      distKm: number;
      monthsAgo: number;
      jimokCategory: JimokCategory;
    }
  >;
}

const SQM_PER_PYEONG = 3.305785;

function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * (p / 100);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function checkAcquisition(
  input: AcquisitionCheckInput
): AcquisitionCheckResult {
  const {
    parcel,
    acquisitionPriceManwon,
    acquisitionDate,
    landTransactions,
    scope,
    targetDong,
    jimokFilter = "match-parcel",
  } = input;

  const asOf = new Date(acquisitionDate);

  const annotated = landTransactions.map((t) => {
    const area = t.exclusiveArea;
    const pricePerPyeong =
      area > 0 ? Math.round(t.priceManwon / (area / SQM_PER_PYEONG)) : 0;
    const txDate = t.date ? new Date(t.date) : asOf;
    const monthsAgo = Math.max(0, monthsBetween(txDate, asOf));
    const jimokCategory = jimokToCategory(t.jimok ?? "");
    return { ...t, pricePerPyeong, distKm: 0, monthsAgo, jimokCategory };
  });

  const jimokBreakdown = {
    buildable: 0,
    farmland: 0,
    forest: 0,
    other: 0,
    unknown: 0,
  };
  for (const t of annotated) {
    if (!t.jimok) {
      jimokBreakdown.unknown++;
    } else {
      jimokBreakdown[t.jimokCategory]++;
    }
  }

  let filtered = annotated.filter((t) => t.pricePerPyeong > 0);
  const filteredOutZeroPrice = annotated.length - filtered.length;

  if (scope === "dong" && targetDong) {
    filtered = filtered.filter((t) => t.dongName === targetDong);
  }

  const beforeJimokFilter = filtered.length;
  if (jimokFilter === "match-parcel" && parcel.jimokCategory) {
    filtered = filtered.filter((t) => t.jimokCategory === parcel.jimokCategory);
  } else if (jimokFilter === "buildable-only") {
    filtered = filtered.filter((t) => t.jimokCategory === "buildable");
  }
  const filteredOutByJimok = beforeJimokFilter - filtered.length;

  const acquisitionPricePerPyeong =
    parcel.lotAreaSqm > 0
      ? Math.round(acquisitionPriceManwon / (parcel.lotAreaSqm / SQM_PER_PYEONG))
      : 0;

  const landPriceTotal = Math.round(
    (parcel.landPriceWonPerSqm * parcel.lotAreaSqm) / 10000
  );
  const landPriceRatio =
    landPriceTotal > 0
      ? Math.round((acquisitionPriceManwon / landPriceTotal) * 100) / 100
      : 0;

  const prices = filtered.map((t) => t.pricePerPyeong).sort((a, b) => a - b);

  const comparableStats = {
    count: filtered.length,
    medianPricePerPyeong: percentile(prices, 50),
    p25: percentile(prices, 25),
    p75: percentile(prices, 75),
    minPricePerPyeong: prices[0] ?? 0,
    maxPricePerPyeong: prices[prices.length - 1] ?? 0,
    monthsSpanned:
      filtered.length > 0
        ? Math.max(...filtered.map((t) => t.monthsAgo)) -
          Math.min(...filtered.map((t) => t.monthsAgo))
        : 0,
  };

  const axisLandPriceRatio: AxisResult = (() => {
    if (landPriceTotal === 0) {
      return {
        status: "insufficient",
        label: "공시지가 데이터 없음",
        value: 0,
        details: {},
      };
    }
    const base = {
      "공시지가 총액": `${(landPriceTotal / 10000).toFixed(1)}억`,
      배율: `${landPriceRatio.toFixed(2)}×`,
      "정상 범위": "1.5-3.5×",
    };
    if (landPriceRatio <= 3.5) {
      return {
        status: "ok",
        label: `공시지가 대비 ${landPriceRatio.toFixed(2)}× — 정상 범위`,
        value: landPriceRatio,
        details: base,
      };
    }
    if (landPriceRatio <= 5.0) {
      return {
        status: "caution",
        label: `공시지가 대비 ${landPriceRatio.toFixed(2)}× — 상회`,
        value: landPriceRatio,
        details: base,
      };
    }
    return {
      status: "overpaid",
      label: `공시지가 대비 ${landPriceRatio.toFixed(2)}× — 과도`,
      value: landPriceRatio,
      details: base,
    };
  })();

  const axisMarketPriceComparison: AxisResult = (() => {
    if (filtered.length < 3) {
      return {
        status: "insufficient",
        label: `같은 지목 거래 ${filtered.length}건 — 데이터 부족`,
        value: 0,
        details: {
          "비교 거래": filtered.length,
          "최소 필요": 3,
        },
      };
    }

    const median = comparableStats.medianPricePerPyeong;
    const deltaPct =
      median > 0
        ? Math.round(((acquisitionPricePerPyeong - median) / median) * 1000) / 10
        : 0;

    const base = {
      "비교 거래": filtered.length,
      "중앙값 평당": `${median.toLocaleString("ko-KR")}만`,
      "인수가 평당": `${acquisitionPricePerPyeong.toLocaleString("ko-KR")}만`,
      편차: `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%`,
    };

    if (Math.abs(deltaPct) <= 15) {
      return {
        status: "ok",
        label: `인근 중앙값 대비 ${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}% — 정상`,
        value: deltaPct,
        details: base,
      };
    }
    if (deltaPct <= 30) {
      return {
        status: "caution",
        label: `인근 중앙값 대비 +${deltaPct.toFixed(1)}% — 상회`,
        value: deltaPct,
        details: base,
      };
    }
    if (deltaPct > 30) {
      return {
        status: "overpaid",
        label: `인근 중앙값 대비 +${deltaPct.toFixed(1)}% — 과도`,
        value: deltaPct,
        details: base,
      };
    }
    return {
      status: "ok",
      label: `인근 중앙값 대비 ${deltaPct.toFixed(1)}% — 시세 이하`,
      value: deltaPct,
      details: base,
    };
  })();

  const axisTransactionPattern: AxisResult = (() => {
    if (filtered.length === 0) {
      return {
        status: "insufficient",
        label: "거래 데이터 없음",
        value: 0,
        details: { "거래 건수": 0 },
      };
    }

    const recent = filtered.filter((t) => t.monthsAgo <= 3).length;
    const prior = filtered.filter(
      (t) => t.monthsAgo > 3 && t.monthsAgo <= 6
    ).length;

    const trend =
      prior === 0
        ? recent > 0
          ? "신규 활성화"
          : "비활성"
        : recent > prior
          ? "활성화 추세"
          : recent < prior
            ? "둔화 추세"
            : "보합";

    if (filtered.length < 5) {
      return {
        status: "insufficient",
        label: `최근 거래 ${filtered.length}건 — 표본 부족`,
        value: filtered.length,
        details: {
          "최근 3개월": recent,
          "이전 3개월": prior,
          추세: trend,
        },
      };
    }

    return {
      status: "ok",
      label: `최근 ${filtered.length}건 · ${trend}`,
      value: filtered.length,
      details: {
        "최근 3개월": recent,
        "이전 3개월": prior,
        추세: trend,
        "기간 (개월)": comparableStats.monthsSpanned,
      },
    };
  })();

  const verdict = computeVerdict(
    axisLandPriceRatio,
    axisMarketPriceComparison,
    axisTransactionPattern
  );

  return {
    inputs: {
      acquisitionPriceManwon,
      acquisitionPricePerPyeong,
      landPriceTotal,
      landPriceRatio,
    },
    comparablesUsed: filtered.length,
    comparableStats,
    jimokBreakdown,
    filteredOut: {
      byJimok: filteredOutByJimok,
      byZeroPrice: filteredOutZeroPrice,
    },
    axisLandPriceRatio,
    axisMarketPriceComparison,
    axisTransactionPattern,
    verdict,
    transactionsForDisplay: filtered.sort((a, b) => a.monthsAgo - b.monthsAgo),
  };
}

function computeVerdict(
  ratio: AxisResult,
  market: AxisResult,
  pattern: AxisResult
): AcquisitionCheckResult["verdict"] {
  if (ratio.status === "insufficient" && market.status === "insufficient") {
    return {
      status: "insufficient",
      label: "데이터 부족",
      reasoning:
        "공시지가 또는 인근 비교거래 데이터가 부족하여 판정을 보류합니다. 직접 검토가 필요합니다.",
    };
  }

  const statuses = [ratio.status, market.status];

  if (statuses.includes("overpaid")) {
    const drivers: string[] = [];
    if (ratio.status === "overpaid") drivers.push(ratio.label);
    if (market.status === "overpaid") drivers.push(market.label);
    return {
      status: "overpaid",
      label: "과도",
      reasoning: drivers.join(" · "),
    };
  }

  if (statuses.includes("caution")) {
    const drivers: string[] = [];
    if (ratio.status === "caution") drivers.push(ratio.label);
    if (market.status === "caution") drivers.push(market.label);
    return {
      status: "caution",
      label: "주의",
      reasoning: drivers.join(" · "),
    };
  }

  const drivers: string[] = [];
  if (ratio.status === "ok") drivers.push(ratio.label);
  if (market.status === "ok") drivers.push(market.label);
  return {
    status: "fair",
    label: "적정",
    reasoning:
      drivers.length > 0
        ? drivers.join(" · ")
        : "주요 비교 지표가 정상 범위 내에 있습니다.",
  };
}
