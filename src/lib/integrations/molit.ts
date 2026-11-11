/**
 * 국토교통부 실거래가 공개시스템 API adapter.
 *
 * UPDATED: jimok (지목) is now a first-class field on MolitTransaction.
 * Previously it was buried as a fallback for buildingName; now it's
 * exposed separately so the acquisition-check engine can filter
 * comparables by land-use category (대지 vs 임야 vs 전 etc).
 *
 * Critical fixes from earlier versions (kept):
 *   1. Must include User-Agent header — default fetch UA gets blocked
 *      by the data.go.kr WAF.
 *   2. Must use XML response — `_type=json` returns "400 Bad Request".
 *   3. Land transactions use `dealArea`, not `excluUseAr` (officetel).
 */

import type { MolitIssue, MolitRangeEvidence } from "./molit-evidence";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { discardProviderBody, ProviderBodyError, readProviderText } from "@/lib/http/provider-body";
import { createProviderConcurrencyLimit, ProviderConcurrencyError } from "@/lib/http/provider-concurrency";
import { createProviderCache } from "@/lib/http/provider-cache";
import { createProviderDeadline } from "@/lib/http/provider-deadline";

class MolitRequestError extends Error {
  constructor(readonly issue: MolitIssue) { super(`MOLIT ${issue}`); }
}

function providerIssue(code: string): MolitIssue {
  if (["20", "29", "30", "31"].includes(code)) return "access-denied";
  if (["22", "23"].includes(code)) return "rate-limit";
  return "provider-error";
}

const SERVICE_KEY = process.env.MOLIT_SERVICE_KEY;

const ENDPOINTS = {
  officetel:
    "https://apis.data.go.kr/1613000/RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade",
  apartment:
    "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade",
  land:
    "https://apis.data.go.kr/1613000/RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade",
  commercial:
    "https://apis.data.go.kr/1613000/RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade",
  officeRent:
    "https://apis.data.go.kr/1613000/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent",
  aptRent:
    "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent",
  // 단독/다가구 매매 — 다가구 통매각 실거래 (연면적 totalFloorAr 기준 평당가)
  house:
    "https://apis.data.go.kr/1613000/RTMSDataSvcSHTrade/getRTMSDataSvcSHTrade",
  villa:
    "https://apis.data.go.kr/1613000/RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade",
} as const;

export type PropertyType = keyof typeof ENDPOINTS;

export interface MolitTransaction {
  externalId: string;
  date: string;
  buildingName: string;
  lawdCd: string;
  dongName: string;
  jibun: string;
  exclusiveArea: number;
  priceManwon: number;
  floor: number;
  buildYear?: number;
  type: string;
  dealingGbn?: string;
  /** 지목 (land transactions only): "대", "임야", "전", "답", "잡종지", etc */
  jimok?: string;
  /** 주택유형 (house only): "단독" | "다가구" */
  houseType?: string;
  /** 대지면적 m2 (house only) — exclusiveArea에는 연면적(totalFloorAr)이 들어감 */
  plottageAr?: number;
  areaBasis?: "exclusive" | "gross" | "land" | "unknown";
  cancellationStatus?: "not-reported" | "cancelled" | "unknown";
  cancellationDate?: string;
  registrationDate?: string;
  buyerType?: string;
  sellerType?: string;
}

export interface FetchOptions {
  lawdCd: string;
  dealYearMonth: string;
  page?: number;
  pageSize?: number;
  type?: PropertyType;
  signal?: AbortSignal;
}

export interface MolitPageResult {
  transactions: MolitTransaction[];
  totalCount: number;
  page: number;
  pageSize: number;
  retrievedAt: string;
}

/* ─────────────────────────── XML parsing ─────────────────────────── */

export const MOLIT_XML_MAX_BYTES = 8_000_000;
export const MOLIT_XML_MAX_ELEMENTS = 100_000;
export const MOLIT_XML_MAX_NESTED_TAGS = 32;
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const field = (value: Record<string, unknown>, tag: string): string =>
  typeof value[tag] === "string" ? value[tag].trim() : "";

/** Reject DTDs and malformed payloads before parsing; never retain provider text in errors. */
export function parseMolitResponse(xml: string, lawdCd: string, type: PropertyType, expectedPage?: { page: number; pageSize: number }) {
  if (xml.length > MOLIT_XML_MAX_BYTES || Buffer.byteLength(xml, "utf8") > MOLIT_XML_MAX_BYTES
    || /<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new MolitRequestError("invalid-response");
  }
  let root: Record<string, unknown>;
  // Count during construction, before a large object tree is allocated. Each parse owns its counter.
  let elements = 0;
  const xmlParser = new XMLParser({
    parseTagValue: false, trimValues: true, ignoreAttributes: true,
    maxNestedTags: MOLIT_XML_MAX_NESTED_TAGS, jPath: false,
    updateTag: (tagName, path) => {
      if (++elements > MOLIT_XML_MAX_ELEMENTS) throw new Error("XML element limit exceeded");
      if (typeof path === "string" || path.getDepth() > MOLIT_XML_MAX_NESTED_TAGS) throw new Error("XML depth limit exceeded");
      return tagName;
    },
  });
  try {
    root = record(xmlParser.parse(xml));
    // The validator has its own stack; only run it after the bounded parser accepts the structure.
    if (XMLValidator.validate(xml) !== true) throw new Error("Malformed XML");
  }
  catch { throw new MolitRequestError("invalid-response"); }
  const gateway = record(root.OpenAPI_ServiceResponse);
  const gatewayCode = field(gateway, "returnReasonCode") || field(record(gateway.cmmMsgHeader), "returnReasonCode");
  if (gatewayCode) throw new MolitRequestError(providerIssue(gatewayCode));
  const response = record(root.response);
  const resultCode = field(record(response.header), "resultCode");
  if (!resultCode) throw new MolitRequestError("invalid-response");
  if (!/^0{1,3}$/.test(resultCode)) throw new MolitRequestError(providerIssue(resultCode));
  const body = record(response.body);
  const totalText = field(body, "totalCount");
  const totalCount = Number(totalText);
  if (!/^\d+$/.test(totalText) || !Number.isSafeInteger(totalCount)) throw new MolitRequestError("invalid-response");
  if (typeof body.items === "string" && body.items.trim()) throw new MolitRequestError("invalid-response");
  const raw = record(body.items).item;
  const items = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
  if (items.some(item => !Object.keys(record(item)).length)) throw new MolitRequestError("invalid-response");
  if (expectedPage) {
    const page = field(body, "pageNo"), size = field(body, "numOfRows");
    const expectedCount = Math.max(0, Math.min(expectedPage.pageSize, totalCount - (expectedPage.page - 1) * expectedPage.pageSize));
    if (!/^\d+$/.test(page) || !/^\d+$/.test(size) || Number(page) !== expectedPage.page
      || Number(size) !== expectedPage.pageSize || items.length !== expectedCount) throw new MolitRequestError("invalid-response");
  }
  return { totalCount, transactions: items.map(item => parseTxn(record(item), lawdCd, type)) };
}

/* ───────── 동시성 제한 (전역 세마포어) ─────────
 * MOLIT 호출을 월별·타입별로 병렬로 던져도, 동시에 날아가는 in-flight 요청 수를
 * 이 값으로 제한한다 → rate-limit / WAF 차단 위험 회피. */
export const MOLIT_MAX_CONCURRENCY = 6;
export const MOLIT_MAX_QUEUED = 64;
export const MOLIT_MAX_PAGE_CONSUMERS = 64;
export const MOLIT_PAGE_TIMEOUT_MS = 15_000;
export const MOLIT_RANGE_TIMEOUT_MS = 30_000;
export const MOLIT_MAX_RANGE_MONTHS = 60;
export const MOLIT_CACHE_MAX_ENTRIES = 256;
export const MOLIT_CACHE_MAX_BYTES = 16 * 1024 * 1024;
export const MOLIT_RANGE_MAX_ROWS = 50_000;
export const MOLIT_RANGE_MAX_BYTES = 32 * 1024 * 1024;
const withMolitCapacity = createProviderConcurrencyLimit(MOLIT_MAX_CONCURRENCY, MOLIT_MAX_QUEUED);

/* ───────── 캐시 (type + lawdCd + 월 단위) ─────────
 * 과거 월도 취소·정정될 수 있어 24시간만 캐시하고 원본 수집시각을 보존한다.
 * in-flight Promise를 저장해 동시 중복 호출(estimate-price ↔ dynamic)도 1회로 합친다. */
const PAST_MONTH_TTL_MS = 24 * 60 * 60_000;
const CURRENT_MONTH_TTL_MS = 10 * 60_000; // 10m — 신규 거래 반영 여지
interface MolitPendingPage {
  controller: AbortController;
  subscribers: Set<MolitSubscriber>;
  settled: boolean;
}
interface MolitSubscriber {
  resolve: (value: MolitPageResult) => void;
  reject: (error: unknown) => void;
}
const molitCache = createProviderCache<MolitPageResult>(MOLIT_CACHE_MAX_ENTRIES, MOLIT_CACHE_MAX_BYTES);
const pendingPages = new Map<string, MolitPendingPage>();
const molitPageKey = (opts: FetchOptions) => `${opts.type ?? "officetel"}:${opts.lawdCd}:${opts.dealYearMonth}:${opts.page ?? 1}:${opts.pageSize ?? 100}`;

export function molitRuntimeUsage() {
  return { completedCache: molitCache.stats(), pendingPages: pendingPages.size };
}

function currentYearMonth(): string {
  return new Date(Date.now() + 9 * 60 * 60_000).toISOString().slice(0, 7).replace("-", "");
}

/* ─────────────────────────── Fetch ─────────────────────────── */

async function fetchMolitPage(
  opts: FetchOptions,
  callerSignal?: AbortSignal,
): Promise<MolitPageResult> {
  if (!SERVICE_KEY) {
    throw new MolitRequestError("not-configured");
  }

  const type = opts.type ?? "officetel";
  if (!Object.hasOwn(ENDPOINTS, type) || !/^\d{5}$/.test(opts.lawdCd) || !/^\d{4}(0[1-9]|1[0-2])$/.test(opts.dealYearMonth)
    || !Number.isSafeInteger(opts.page ?? 1) || (opts.page ?? 1) < 1 || (opts.page ?? 1) > 200
    || !Number.isSafeInteger(opts.pageSize ?? 100) || (opts.pageSize ?? 100) < 1 || (opts.pageSize ?? 100) > 1000) throw new MolitRequestError("invalid-response");
  if (callerSignal?.aborted) throw new MolitRequestError("timeout");
  const cacheKey = molitPageKey(opts);
  const cached = molitCache.get(cacheKey);
  if (cached) return structuredClone(cached);
  let pending = pendingPages.get(cacheKey);
  if (pending?.controller.signal.aborted) { pendingPages.delete(cacheKey); pending = undefined; }
  if (!pending) {
    if (pendingPages.size >= MOLIT_MAX_CONCURRENCY + MOLIT_MAX_QUEUED) throw new MolitRequestError("capacity-limit");
    const controller = new AbortController();
    const entry: MolitPendingPage = { controller, subscribers: new Set(), settled: false };
    const finish = (result: { value: MolitPageResult } | { error: unknown }) => {
      entry.settled = true;
      if (pendingPages.get(cacheKey) === entry) pendingPages.delete(cacheKey);
      for (const subscriber of entry.subscribers) {
        if ("value" in result) subscriber.resolve(result.value);
        else subscriber.reject(result.error);
      }
      entry.subscribers.clear();
    };
    // One shared handler; cancelled subscribers are removable rather than retained Promise callbacks.
    void Promise.resolve().then(() => fetchMolitUncached(opts, type, controller.signal)).then(value => {
      const ttl = opts.dealYearMonth === currentYearMonth() ? CURRENT_MONTH_TTL_MS : PAST_MONTH_TTL_MS;
      if (!controller.signal.aborted) molitCache.set(cacheKey, value, Buffer.byteLength(JSON.stringify(value)), Date.parse(value.retrievedAt) + ttl);
      return value;
    }).then(value => finish({ value }), error => finish({ error }));
    pendingPages.set(cacheKey, entry); pending = entry;
  }
  return consumeMolitPage(pending, callerSignal);
}

async function consumeMolitPage(entry: MolitPendingPage, signal?: AbortSignal): Promise<MolitPageResult> {
  if (entry.subscribers.size >= MOLIT_MAX_PAGE_CONSUMERS) throw new MolitRequestError("capacity-limit");
  let abort: (() => void) | undefined;
  let subscriber: MolitSubscriber | undefined;
  try {
    const value = await new Promise<MolitPageResult>((resolve, reject) => {
      subscriber = { resolve, reject };
      entry.subscribers.add(subscriber);
      abort = () => reject(new MolitRequestError("timeout"));
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
    if (signal?.aborted) throw new MolitRequestError("timeout");
    return structuredClone(value);
  } finally {
    if (abort) signal?.removeEventListener("abort", abort);
    if (subscriber) entry.subscribers.delete(subscriber);
    if (entry.subscribers.size === 0 && !entry.settled) entry.controller.abort();
  }
}

export async function fetchMolitTransactions(
  opts: FetchOptions
): Promise<MolitTransaction[]> {
  const budget = createProviderDeadline(MOLIT_PAGE_TIMEOUT_MS, opts.signal);
  try {
    const page = await fetchMolitPage(opts, budget.signal);
    budget.check();
    return page.transactions;
  } catch (error) {
    if (error instanceof ProviderBodyError) throw new MolitRequestError("timeout");
    throw error;
  }
}

/** 실제 MOLIT HTTP 호출 (캐시 미스 시). 전역 세마포어로 동시성 제한. */
async function fetchMolitUncached(
  opts: FetchOptions,
  type: PropertyType,
  callerSignal: AbortSignal,
): Promise<MolitPageResult> {
  const baseUrl = ENDPOINTS[type];

  const qs = new URLSearchParams({
    serviceKey: SERVICE_KEY as string,
    LAWD_CD: opts.lawdCd,
    DEAL_YMD: opts.dealYearMonth,
    pageNo: String(opts.page ?? 1),
    numOfRows: String(opts.pageSize ?? 100),
  });

  const budget = createProviderDeadline(MOLIT_PAGE_TIMEOUT_MS, callerSignal);
  try {
    return await withMolitCapacity(budget.signal, async () => {
      budget.check();
      const res = await fetch(`${baseUrl}?${qs.toString()}`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; PARCELGRID/2.4; +https://parcelgrid.app)",
          Accept: "application/xml",
        },
        signal: budget.signal,
      });
      budget.check(res);
      if (!res.ok) {
        discardProviderBody(res);
        throw new MolitRequestError(res.status === 401 || res.status === 403 ? "access-denied" : res.status === 429 ? "rate-limit" : "http-error");
      }
      let xml: string;
      try { xml = await readProviderText(res, { maxBytes: MOLIT_XML_MAX_BYTES, timeoutMs: budget.remainingMs(), signal: budget.signal }); }
      catch (error) {
        if (error instanceof ProviderBodyError) throw new MolitRequestError(error.name === "TimeoutError" ? "timeout" : "invalid-response");
        throw error;
      }
      const page = opts.page ?? 1;
      const pageSize = opts.pageSize ?? 100;
      const parsed = parseMolitResponse(xml, opts.lawdCd, type, { page, pageSize });
      budget.check();
      return {
        ...parsed,
        retrievedAt: new Date().toISOString(),
        page,
        pageSize,
      };
    });
  } catch (error) {
    if (error instanceof MolitRequestError) throw error;
    if (error instanceof ProviderConcurrencyError && error.code === "PROVIDER_BUSY") throw new MolitRequestError("capacity-limit");
    if (budget.signal.aborted || (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))) throw new MolitRequestError("timeout");
    if (error instanceof ProviderBodyError) throw new MolitRequestError("invalid-response");
    throw new MolitRequestError("network");
  }
}

/* ─────────────────────────── Field parsing ─────────────────────────── */

function parseTxn(
  item: Record<string, unknown>,
  lawdCd: string,
  type: PropertyType
): MolitTransaction {
  const str = (tag: string) => field(item, tag);
  const numFrom = (s: string) =>
    s ? Number(s.replace(/,/g, "").trim()) : NaN;

  const y = str("dealYear");
  const mRaw = str("dealMonth");
  const dRaw = str("dealDay");
  const m = mRaw.padStart(2, "0");
  const d = dRaw.padStart(2, "0");
  const date = y && mRaw && dRaw ? `${y}-${m}-${d}` : "";

  // For land transactions, jimok is its own field. Use it for building name display
  // since there's no building. For non-land, jimok is undefined.
  const jimok = type === "land" ? str("jimok") || undefined : undefined;

  const buildingName =
    str("mhouseNm") || str("offiNm") || str("aptNm") || str("bldgNm") || str("houseType") || jimok || "—";

  const jibun = str("jibun");
  const dongName = str("umdNm");

  const area = ([ ["excluUseAr", "exclusive"], ["totalFloorAr", "gross"], ["dealArea", "land"], ["lndAr", "land"] ] as const)
    .map(([tag, basis]) => ({ value: numFrom(str(tag)), basis }))
    .find(candidate => Number.isFinite(candidate.value) && candidate.value > 0);
  const exclusiveArea = area?.value ?? 0;
  const priceManwon = numFrom(str("dealAmount"));
  const floor = numFrom(str("floor")) || 0;
  const buildYear = numFrom(str("buildYear")) || undefined;
  const dealingGbn = str("dealingGbn") || undefined;
  const houseType = str("houseType") || undefined;
  const plottageArV = numFrom(str("plottageAr")) || undefined;

  const externalId = [
    type,
    lawdCd,
    dongName,
    y,
    m,
    d,
    jibun,
    buildingName,
    exclusiveArea,
    Math.round(priceManwon),
    Math.round(floor),
  ]
    .map((p) => encodeURIComponent(String(p)))
    .join("|");

  const typeLabel =
    type === "villa" ? "연립다세대" : type === "house"
      ? "단독다가구"
      : type === "officetel"
      ? "오피스텔"
      : type === "apartment"
        ? "아파트"
        : type === "land"
          ? "토지"
          : type === "commercial"
            ? "상업업무용"
            : type === "officeRent"
              ? "오피스텔(임대)"
              : type === "aptRent"
                ? "아파트(임대)"
                : type;

  return {
    externalId,
    date,
    buildingName,
    lawdCd: str("sggCd") || lawdCd,
    dongName,
    jibun,
    exclusiveArea: Number.isFinite(exclusiveArea) ? exclusiveArea : 0,
    priceManwon: Number.isFinite(priceManwon) ? priceManwon : 0,
    floor: Number.isFinite(floor) ? floor : 0,
    buildYear,
    type: typeLabel,
    dealingGbn,
    jimok,
    houseType,
    plottageAr: plottageArV,
    areaBasis: area?.basis ?? "unknown",
    cancellationStatus: str("cdealType") || str("cdealDay") ? "cancelled"
      : Object.hasOwn(item, "cdealType") && Object.hasOwn(item, "cdealDay") ? "not-reported" : "unknown",
    cancellationDate: str("cdealDay") || undefined,
    registrationDate: str("rgstDate") || undefined,
    buyerType: str("buyerGbn") || undefined,
    sellerType: str("slerGbn") || undefined,
  };
}

/* ─────────────────────────── Range fetch ─────────────────────────── */

const MOLIT_MAX_PAGES_PER_MONTH = 200;

export async function fetchMolitRangeWithEvidence(
  opts: Omit<FetchOptions, "dealYearMonth"> & {
    startYearMonth: string;
    endYearMonth: string;
  }
): Promise<{ transactions: MolitTransaction[]; evidence: MolitRangeEvidence }> {
  const months = monthsBetween(opts.startYearMonth, opts.endYearMonth);
  const pageSize = opts.pageSize ?? 100;
  const budget = createProviderDeadline(MOLIT_RANGE_TIMEOUT_MS, opts.signal);
  let retainedRows = 0, retainedBytes = 0;
  const fetchMonth = async (ym: string) => {
      let monthRows = 0, monthBytes = 0;
      const pages: MolitPageResult[] = [];
      try {
        budget.check();
        const first = await fetchMolitPage({
          ...opts,
          dealYearMonth: ym,
          page: 1,
          pageSize,
        }, budget.signal);
        budget.check();
        const totalPages = Math.max(
          1,
          Math.ceil(first.totalCount / pageSize),
        );
        if (totalPages > MOLIT_MAX_PAGES_PER_MONTH) {
          throw new MolitRequestError("page-limit");
        }

        const retain = (page: MolitPageResult) => {
          budget.check();
          const bytes = Buffer.byteLength(JSON.stringify(page));
          if (retainedRows + page.transactions.length > MOLIT_RANGE_MAX_ROWS || retainedBytes + bytes > MOLIT_RANGE_MAX_BYTES) throw new MolitRequestError("size-limit");
          retainedRows += page.transactions.length; monthRows += page.transactions.length;
          retainedBytes += bytes; monthBytes += bytes;
          pages.push(page);
        };
        retain(first);
        for (let page = 2; page <= totalPages; page++) {
          budget.check();
          retain(await fetchMolitPage({ ...opts, dealYearMonth: ym, page, pageSize }, budget.signal));
        }
        if (pages.some(page => page.totalCount !== first.totalCount) || pages.reduce((sum, page) => sum + page.transactions.length, 0) !== first.totalCount) throw new MolitRequestError("invalid-response");
        const deduplicated = new Map<string, MolitTransaction>();
        for (const transaction of pages.flatMap(page => page.transactions)) {
          const previous = deduplicated.get(transaction.externalId);
          // Public rows have no unit identifier. A matching cancellation must win in either order.
          if (previous?.cancellationStatus === "cancelled") continue;
          if (previous?.cancellationStatus === "unknown" && transaction.cancellationStatus !== "cancelled") continue;
          deduplicated.set(transaction.externalId, transaction);
        }
        budget.check();
        return { month: ym, transactions: [...deduplicated.values()], issue: null, oldestFetchedAt: pages.map(page => page.retrievedAt).sort()[0], newestFetchedAt: pages.map(page => page.retrievedAt).sort().at(-1) };
      } catch (err) {
        retainedRows -= monthRows; retainedBytes -= monthBytes;
        const issue: MolitIssue = err instanceof MolitRequestError ? err.issue : err instanceof Error && ["AbortError", "TimeoutError"].includes(err.name) ? "timeout" : "network";
        if (issue === "invalid-response") {
          // A changed/replayed page invalidates the month's assembled snapshot, not just its last page.
          for (const page of pages) molitCache.delete(molitPageKey({ ...opts, dealYearMonth: ym, page: page.page, pageSize }));
        }
        return { month: ym, transactions: [] as MolitTransaction[], issue };
      }
  };
  const monthResults: Awaited<ReturnType<typeof fetchMonth>>[] = new Array(months.length);
  let nextMonth = 0;
  await Promise.all(Array.from({ length: Math.min(3, months.length) }, async () => {
    while (nextMonth < months.length) {
      const index = nextMonth++;
      monthResults[index] = await fetchMonth(months[index]);
    }
  }));
  const transactions = monthResults.flatMap(item => item.transactions);
  const completedMonths = monthResults.filter(item => !item.issue).map(item => item.month);
  const failedMonths = monthResults.flatMap(item => item.issue ? [{ month: item.month, issue: item.issue }] : []);
  return { transactions, evidence: {
    source: "MOLIT", type: opts.type ?? "officetel", lawdCd: opts.lawdCd,
    startYearMonth: opts.startYearMonth, endYearMonth: opts.endYearMonth,
    retrievedAt: new Date().toISOString(), completedMonths, failedMonths,
    transactionCount: transactions.length,
    sourceRetrievals: monthResults.flatMap(item => item.oldestFetchedAt && item.newestFetchedAt ? [{ month: item.month, oldestFetchedAt: item.oldestFetchedAt, newestFetchedAt: item.newestFetchedAt }] : []),
    status: !failedMonths.length ? "complete" : completedMonths.length ? "partial" : "unavailable",
  } };
}

/** Legacy callers must not silently accept a failed or partial query as zero records. */
export async function fetchMolitRange(opts: Parameters<typeof fetchMolitRangeWithEvidence>[0]): Promise<MolitTransaction[]> {
  const result = await fetchMolitRangeWithEvidence(opts);
  if (result.evidence.status !== "complete") throw new MolitRequestError(result.evidence.failedMonths[0]?.issue ?? "invalid-response");
  return result.transactions;
}

function monthsBetween(startYM: string, endYM: string): string[] {
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(startYM) || !/^\d{4}(0[1-9]|1[0-2])$/.test(endYM) || startYM > endYM) throw new MolitRequestError("invalid-response");
  const [sy, sm] = [parseInt(startYM.slice(0, 4)), parseInt(startYM.slice(4, 6))];
  const [ey, em] = [parseInt(endYM.slice(0, 4)), parseInt(endYM.slice(4, 6))];
  if ((ey - sy) * 12 + em - sm + 1 > MOLIT_MAX_RANGE_MONTHS) throw new MolitRequestError("range-limit");
  const out: string[] = [];
  for (let y = sy, m = sm; y < ey || (y === ey && m <= em); ) {
    out.push(`${y}${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      y++;
      m = 1;
    }
  }
  return out;
}

/* ─────────────────────────── To-comp adapter ─────────────────────────── */

export function molitToComp(
  txn: MolitTransaction,
  targetCoords?: { lat: number; lng: number; lat0?: number; lng0?: number }
) {
  let dist = 0;
  if (targetCoords?.lat0 && targetCoords?.lng0) {
    dist = haversine(
      targetCoords.lat,
      targetCoords.lng,
      targetCoords.lat0,
      targetCoords.lng0
    );
  }

  const pricePerPyeong =
    txn.exclusiveArea > 0
      ? Math.round(txn.priceManwon / (txn.exclusiveArea * 0.3025))
      : 0;

  return {
    id: txn.externalId,
    date: txn.date,
    address: `${txn.dongName} ${txn.jibun}`,
    type: txn.type,
    area: 0,
    gfa: txn.exclusiveArea,
    price: txn.priceManwon,
    pricePerPyeong,
    far: 0,
    dist,
  };
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
