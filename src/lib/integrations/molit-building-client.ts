/** Official JSON contract checked against data.go.kr 15134735 on 2026-09-28. */
import {
  REGISTRY_MAX_PAGES, REGISTRY_PAGE_SIZE, REGISTRY_MAX_DATASET_BYTES, registryNumber,
  type RegistryDataset, type RegistryOperation, type RegistryQuery, type RegistryRecord,
} from "@/lib/building-registry/types";

const BASE = "https://apis.data.go.kr/1613000/BldRgstHubService";
// Attribute data only. Owner/person information is not requested or retained.
const FIELDS = new Set((
  "mgmBldrgstPk rnum crtnDay sigunguCd bjdongCd platGbCd bun ji bldNm dongNm hoNm " +
  "regstrGbCd regstrGbCdNm regstrKindCd regstrKindCdNm mainAtchGbCd mainAtchGbCdNm " +
  "mainPurpsCd mainPurpsCdNm etcPurps strctCd strctCdNm etcStrct archArea totArea " +
  "bcRat vlRat vlRatEstmTotArea heit grndFlrCnt ugrndFlrCnt useAprDay hhldCnt fmlyCnt hoCnt " +
  "flrGbCd flrGbCdNm flrNo flrNoNm area areaExctYn exposPubuseGbCd exposPubuseGbCdNm " +
  "roofCd roofCdNm etcRoof rideUseElvtCnt emgenUseElvtCnt indrMechUtcnt oudrMechUtcnt indrAutoUtcnt oudrAutoUtcnt"
).split(" "));

function object(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function integer(value: unknown): number | null {
  const n = typeof value === "number" || typeof value === "string"
    ? registryNumber(String(value)) : null;
  return n != null && Number.isSafeInteger(n) ? n : null;
}

export function emptyRegistryDataset(operation: RegistryOperation, query: RegistryQuery): RegistryDataset {
  const params = new URLSearchParams({ ...query, _type: "json", numOfRows: String(REGISTRY_PAGE_SIZE) });
  return { operation, status: "not-requested", retrievedAt: new Date().toISOString(),
    requestUrl: `${BASE}/${operation}?${params}`, totalCount: null, fetchedCount: 0,
    pagesFetched: 0, rows: [], issues: [] };
}

function providerIssue(code: string): string {
  if (["20", "29", "30", "31"].includes(code)) return "access-denied";
  if (["22", "23"].includes(code)) return "rate-limit";
  return "provider-error";
}

function parseRecord(value: unknown, query: RegistryQuery): RegistryRecord | null {
  const obj = object(value);
  if (!obj) return null;
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!FIELDS.has(key) || value == null) continue;
    if (typeof value !== "string" && typeof value !== "number") return null;
    if (String(value).length > 500) return null;
    fields[key] = String(value).trim();
  }
  for (const key of Object.keys(query) as (keyof RegistryQuery)[]) {
    if (fields[key] && fields[key].padStart(query[key].length, "0") !== query[key]) return null;
  }
  // An empty item is not evidence of either a building or an empty parcel.
  if (!["mgmBldrgstPk", "totArea", "archArea", "area", "bldNm", "dongNm", "mainPurpsCdNm"].some((key) => fields[key])) return null;
  if ((fields.mgmBldrgstPk?.length ?? 0) > 200 || (fields.rnum?.length ?? 0) > 40 || (fields.crtnDay?.length ?? 0) > 40) return null;
  return { registryPk: fields.mgmBldrgstPk || null, rowNumber: fields.rnum || null,
    generatedDate: fields.crtnDay || null, fields };
}

export async function fetchRegistryDataset(
  operation: RegistryOperation, query: RegistryQuery, signal: AbortSignal,
): Promise<RegistryDataset> {
  const result = emptyRegistryDataset(operation, query);
  result.status = "unavailable";
  const serviceKey = process.env.MOLIT_SERVICE_KEY?.trim();
  if (!serviceKey) return { ...result, issues: ["not-configured"] };
  const seenPages = new Set<string>();
  const titleIds = new Set<string>();
  const recordIds = new Set<string>();
  let returnedPageSize: number | null = null;
  let retainedBytes = 0;
  const issue = (code: string) => { if (!result.issues.includes(code)) result.issues.push(code); };
  for (let page = 1; page <= REGISTRY_MAX_PAGES; page++) {
    try {
      if (signal.aborted) { issue("timeout"); break; }
      const url = new URL(result.requestUrl);
      // Accept the portal's encoded or decoded key without double encoding.
      let key = serviceKey;
      try { key = decodeURIComponent(serviceKey); } catch { /* use literal key */ }
      url.searchParams.set("serviceKey", key);
      url.searchParams.set("pageNo", String(page));
      const response = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]), cache: "no-store",
      });
      if (!response.ok) { issue([401, 403].includes(response.status) ? "access-denied" : response.status === 429 ? "rate-limit" : "http-error"); break; }
      const text = await response.text();
      if (text.length > 3_000_000) { issue("invalid-response"); break; }
      let json: unknown;
      try { json = JSON.parse(text); } catch {
        // Gateways may return XML even for _type=json. Extract error code only.
        const code = text.match(/<returnReasonCode>\s*(\d+)\s*<\/returnReasonCode>/)?.[1];
        issue(code ? providerIssue(code) : "invalid-response"); break;
      }
      const envelope = object(object(json)?.response);
      const header = object(envelope?.header);
      if (!header || header.resultCode == null) { issue("invalid-response"); break; }
      const code = String(header.resultCode).trim();
      if (!/^0{1,3}$/.test(code)) { issue(providerIssue(code)); break; }
      const body = object(envelope?.body);
      const total = integer(body?.totalCount), pageNo = integer(body?.pageNo), size = integer(body?.numOfRows);
      if (!body || total == null || pageNo !== page || size == null || size < 1 || size > REGISTRY_PAGE_SIZE) {
        issue("invalid-response"); break;
      }
      if (returnedPageSize != null && returnedPageSize !== size) { issue("invalid-response"); break; }
      returnedPageSize = size;
      if (result.totalCount != null && result.totalCount !== total) { issue("count-changed"); break; }
      result.totalCount = total;
      const items = object(body.items);
      const rawItem = items?.item;
      const rows = Array.isArray(rawItem) ? rawItem : object(rawItem) ? [rawItem] : [];
      const emptyItems = body.items == null || body.items === "" || (items != null && (rawItem == null || rawItem === "" || (Array.isArray(rawItem) && rawItem.length === 0)));
      if ((!rows.length && !emptyItems) || rows.length > size || (total === 0 && rows.length)) { issue("invalid-response"); break; }
      if (rows.length) {
        const signature = JSON.stringify(rows);
        if (seenPages.has(signature)) { issue("repeated-page"); break; }
        seenPages.add(signature);
      }
      result.pagesFetched++;
      result.fetchedCount += rows.length;
      for (const row of rows) {
        const parsed = parseRecord(row, query);
        if (!parsed) { issue("invalid-row"); continue; }
        if (!parsed.registryPk) issue("missing-id");
        if (!parsed.rowNumber) issue("missing-row-number");
        if (parsed.registryPk && parsed.rowNumber) {
          const recordId = JSON.stringify([parsed.registryPk, parsed.rowNumber]);
          if (recordIds.has(recordId)) { issue("duplicate-row"); continue; }
          recordIds.add(recordId);
        }
        if (operation === "getBrTitleInfo" && parsed.registryPk) {
          if (titleIds.has(parsed.registryPk)) { issue("duplicate-title-id"); continue; }
          titleIds.add(parsed.registryPk);
        }
        const bytes = new TextEncoder().encode(JSON.stringify(parsed)).length;
        if (retainedBytes + bytes > REGISTRY_MAX_DATASET_BYTES) { issue("size-limit"); break; }
        retainedBytes += bytes;
        result.rows.push(parsed);
      }
      if (result.issues.includes("size-limit")) break;
      if (result.fetchedCount >= total) {
        if (result.fetchedCount !== total) issue("count-mismatch");
        result.status = result.issues.length ? "partial" : "complete";
        break;
      }
      if (rows.length !== size) { issue("count-mismatch"); break; }
      if (page === REGISTRY_MAX_PAGES) issue("page-limit");
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      issue(signal.aborted || name === "TimeoutError" || name === "AbortError" ? "timeout" : "network");
      break;
    }
  }
  if (result.status !== "complete") result.status = result.rows.length || result.pagesFetched ? "partial" : "unavailable";
  result.retrievedAt = new Date().toISOString();
  return result;
}
