import type { CompVM } from "@/lib/adapters/view-model";
import type { MolitRangeEvidence } from "@/lib/integrations/molit-evidence";
import type { PlanningDwellingSaleBand, PlanningScenario } from "@/lib/planning/types";

export const DWELLING_MARKET_VERSION = "dwelling-market-2026.1";
export const DWELLING_MARKET_SOURCE = "https://www.data.go.kr/data/15126467/openapi.do";
export const MARKET_EXCLUSION_LABELS = {
  type: "유형·면적 기준 불명 또는 대상 외", location: "다른 법정동·주소 미확인",
  cancelled: "취소 신고", cancellationUnknown: "취소 필드 미확인",
  trade: "직거래·거래구분 미확인", buyer: "개인 외 매수·매수자 미확인",
  seller: "개인·법인 외 매도·매도자 미확인",
  date: "기간 밖·계약일 오류", registration: "등기일 미확인·오류",
  age: "거래연도 기준 준공 5년 초과·연식 미확인", floor: "2~5층 외·층 미확인",
  area: "비교 전용면적 밖", price: "가격·면적 오류", duplicate: "동일 공개 식별값 중복",
} as const;
type Exclusion = keyof typeof MARKET_EXCLUSION_LABELS;

export interface DwellingMarketTarget { exclusiveSqm: number; saleableSqm: number; floor: number; exclusiveAreaKnown: boolean }
export interface DwellingMarketObservation {
  methodVersion: typeof DWELLING_MARKET_VERSION;
  sourceUrl: typeof DWELLING_MARKET_SOURCE;
  asOf: string;
  projectId: string;
  lawdCd: string;
  dongName: string;
  targetExclusiveSqm: number;
  unitPriceWon: number;
  addressCount: number;
  sampleMinWon: number;
  sampleMaxWon: number;
  comparables: CompVM[];
  collection: MolitRangeEvidence;
}

/** Twelve calendar months including the as-of month, without end-of-month rollover. */
export function dwellingMarketWindow(asOf: string) {
  const end = new Date(`${asOf}T00:00:00Z`);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1));
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1));
    return date.toISOString().slice(0, 7).replace("-", "");
  });
  return { months, startDate: start.toISOString().slice(0, 10), startYearMonth: months[0], endYearMonth: months[11] };
}

export function koreaDate(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60_000).toISOString().slice(0, 10);
}

function validDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}

export function molitRegistrationDate(raw?: string): string | null {
  if (!raw) return null;
  const value = raw.trim();
  const date = /^\d{2}\.\d{2}\.\d{2}$/.test(value) ? `20${value.replaceAll(".", "-")}`
    : /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`
    : value.replaceAll(".", "-");
  return validDate(date) ? date : null;
}

export function dwellingMarketTargets(scenario: PlanningScenario): DwellingMarketTarget[] {
  return scenario.floorPrograms.flatMap(floor => floor.zones.filter(zone =>
    zone.useType === "residential" && (zone.revenueModel ?? "sale") === "sale" && zone.unitCount > 0,
  ).map(zone => ({
    exclusiveSqm: (zone.parkingExclusiveAreaSqm ?? zone.saleableAreaSqm ?? zone.areaSqm) / zone.unitCount,
    saleableSqm: (zone.saleableAreaSqm ?? zone.areaSqm) / zone.unitCount,
    floor: floor.level,
    exclusiveAreaKnown: zone.parkingExclusiveAreaSqm != null,
  })));
}

export function dwellingMarketLocation(parcel: { id: string; address: string }) {
  // Only PNU projects with an explicit lot-address dong/ri are eligible. Road addresses are not guessed.
  const dongName = parcel.address.match(/(?:^|\s)([^\s]+(?:동|리|가))\s+\d+(?:-\d+)?(?:\s|$)/)?.[1] ?? "";
  return { lawdCd: /^\d{19}$/.test(parcel.id) ? parcel.id.slice(0, 5) : "", dongName };
}

function collectionProblem(evidence: MolitRangeEvidence | undefined, asOf: string, lawdCd: string): string | null {
  if (!evidence) return "연립·다세대 조회 근거 미확보";
  const { months } = dwellingMarketWindow(asOf);
  if (evidence.source !== "MOLIT" || evidence.type !== "villa" || evidence.lawdCd !== lawdCd ||
      evidence.status !== "complete" || evidence.failedMonths.length ||
      evidence.startYearMonth !== months[0] || evidence.endYearMonth !== months[11] ||
      [...evidence.completedMonths].sort().join() !== months.join()) return "최근 12개월 수집 불완전·범위 불일치";
  if (!evidence.sourceRetrievals || evidence.sourceRetrievals.map(item => item.month).sort().join() !== months.join()) return "원본 수집시각 미확인";
  const endOfDay = Date.parse(`${asOf}T23:59:59.999+09:00`);
  const fetched = evidence.sourceRetrievals.flatMap(item => [Date.parse(item.oldestFetchedAt), Date.parse(item.newestFetchedAt)]);
  if (fetched.some(time => !Number.isFinite(time) || time > endOfDay || endOfDay - time > 7 * 86400_000)) return "원본 수집 후 7일 경과·수집시각 오류";
  return null;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length ? (sorted[mid] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2 : null;
};

export function analyzeDwellingMarket(input: {
  comps: CompVM[]; evidence?: MolitRangeEvidence[]; targets: DwellingMarketTarget[];
  lawdCd: string; dongName: string; asOf: string;
  projectId: string;
}) {
  const { comps, targets, lawdCd, dongName, asOf } = input;
  if (!validDate(asOf)) throw new Error("실거래 기준일을 확인하세요.");
  const collection = input.evidence?.find(item => item.type === "villa" && item.lawdCd === lawdCd);
  const problem = !/^\d{5}$/.test(lawdCd) || !dongName ? "법정동·시군구 미확인" : collectionProblem(collection, asOf, lawdCd);
  const { startDate } = dwellingMarketWindow(asOf);
  const sourceRows = comps.filter(comp => comp.type === "연립다세대");
  const groups = new Map<number, DwellingMarketTarget[]>();
  for (const target of targets) {
    if (!Number.isFinite(target.exclusiveSqm) || target.exclusiveSqm <= 0) continue;
    const key = Number(target.exclusiveSqm.toFixed(6));
    groups.set(key, [...(groups.get(key) ?? []), target]);
  }
  const rows = [...groups].sort(([a], [b]) => a - b).map(([targetExclusiveSqm, targetGroup]) => {
    const tolerance = Math.min(5, Math.max(2, targetExclusiveSqm * 0.1));
    const excluded: { comp: CompVM; reason: Exclusion }[] = [];
    const included: CompVM[] = [];
    const seen = new Set<string>();
    // Handle imported/legacy duplicates defensively, even when the adapter already collapsed them.
    const cancelledIds = new Set(sourceRows.filter(comp => comp.cancellationStatus === "cancelled").map(comp => comp.id));
    const unknownCancellationIds = new Set(sourceRows.filter(comp => comp.cancellationStatus !== "not-reported").map(comp => comp.id));
    for (const comp of sourceRows) {
      let reason: Exclusion | undefined;
      const registrationDate = molitRegistrationDate(comp.registrationDate);
      if (cancelledIds.has(comp.id)) reason = "cancelled";
      else if (unknownCancellationIds.has(comp.id)) reason = "cancellationUnknown";
      else if (comp.areaBasis !== "exclusive" || !["다세대", "연립", "연립다세대"].includes(comp.houseType ?? "")) reason = "type";
      else if (comp.lawdCd !== lawdCd || comp.dongName !== dongName || !/^\d+(?:-\d+)?$/.test(comp.jibun ?? "")) reason = "location";
      else if (!validDate(comp.date) || comp.date < startDate || comp.date > asOf) reason = "date";
      else if (comp.dealingGbn !== "중개거래") reason = "trade";
      else if (comp.buyerType !== "개인") reason = "buyer";
      else if (!["개인", "법인"].includes(comp.sellerType ?? "")) reason = "seller";
      else if (!registrationDate || registrationDate < comp.date || registrationDate > asOf) reason = "registration";
      else if (!Number.isInteger(comp.buildYear) || comp.buildYear! > Number(comp.date.slice(0, 4)) || Number(comp.date.slice(0, 4)) - comp.buildYear! > 5) reason = "age";
      else if (!Number.isInteger(comp.floor) || comp.floor! < 2 || comp.floor! > 5) reason = "floor";
      else if (!Number.isFinite(comp.priceWon) || comp.priceWon <= 0 || !Number.isFinite(comp.lotArea) || comp.lotArea <= 0) reason = "price";
      else if (Math.abs(comp.lotArea - targetExclusiveSqm) > tolerance + 1e-6) reason = "area";
      else if (seen.has(comp.id)) reason = "duplicate";
      if (reason) excluded.push({ comp, reason });
      else { seen.add(comp.id); included.push(comp); }
    }
    const addresses = new Map<string, number[]>();
    for (const comp of included) {
      const key = `${comp.lawdCd}:${comp.dongName}:${comp.jibun}`;
      addresses.set(key, [...(addresses.get(key) ?? []), comp.priceWon / comp.lotArea]);
    }
    const unitPrices = included.map(comp => comp.priceWon / comp.lotArea);
    const medianWon = median([...addresses.values()].map(values => median(values)!));
    const blockers = [
      ...(problem ? [problem] : []),
      ...(addresses.size < 3 || included.length < 3 ? ["근거 부족 · 서로 다른 주소 3곳 이상 필요"] : []),
      ...(targetGroup.some(target => !Number.isInteger(target.floor) || target.floor < 2 || target.floor > 5) ? ["계획 층수와 비교 범위(2~5층) 불일치"] : []),
      ...(targetGroup.some(target => !Number.isFinite(target.saleableSqm) || Math.abs(target.saleableSqm - target.exclusiveSqm) > 1e-5) ? ["계획 매각 면적과 전용면적 불일치"] : []),
      ...(targetGroup.some(target => !target.exclusiveAreaKnown) ? ["계획 전용면적 입력 미확인"] : []),
    ];
    return { targetExclusiveSqm, tolerance, included, excluded, addressCount: addresses.size, medianWon,
      minWon: unitPrices.length ? Math.min(...unitPrices) : null, maxWon: unitPrices.length ? Math.max(...unitPrices) : null,
      blockers, applicable: blockers.length === 0 && medianWon !== null };
  });
  return { methodVersion: DWELLING_MARKET_VERSION, asOf, projectId: input.projectId, lawdCd, dongName, collection, problem, rows };
}

/** Exact-target bands prevent a 29 m2 observation being reused as a blanket under-30 m2 premium. */
export function dwellingMarketBands(report: ReturnType<typeof analyzeDwellingMarket>): PlanningDwellingSaleBand[] {
  return report.rows.filter(row => row.applicable && row.medianWon && report.collection).map(row => {
    const unitPriceWon = Math.round(row.medianWon!);
    return {
      minExclusiveSqm: (Math.round(row.targetExclusiveSqm * 1e6) - 0.5) / 1e6,
      maxExclusiveSqm: (Math.round(row.targetExclusiveSqm * 1e6) + 0.5) / 1e6,
      unitPriceWon,
      source: `MOLIT ${report.dongName} · ${report.asOf} 관측 · ${row.included.length}건/${row.addressCount}주소 · 사용자 채택 가정`,
      marketObservation: {
        methodVersion: DWELLING_MARKET_VERSION, sourceUrl: DWELLING_MARKET_SOURCE, asOf: report.asOf, projectId: report.projectId,
        lawdCd: report.lawdCd, dongName: report.dongName, targetExclusiveSqm: row.targetExclusiveSqm,
        unitPriceWon, addressCount: row.addressCount, sampleMinWon: row.minWon!, sampleMaxWon: row.maxWon!,
        comparables: row.included.map(comp => ({ ...comp })), collection: structuredClone(report.collection!),
      },
    };
  });
}
