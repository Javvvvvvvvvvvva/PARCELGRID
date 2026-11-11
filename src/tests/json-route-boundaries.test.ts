import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { JSON_REQUEST_LIMITS, readJsonObject } from "@/lib/http/json-request";
import { MAX_PROJECT_WORKSPACE_BYTES } from "@/lib/workspace/project-workspace";
import { MAX_REVIEW_SNAPSHOT_BYTES } from "@/lib/handoff/server-review-snapshot";

const state = vi.hoisted(() => ({ allowed: true, effects: { geocode: vi.fn(), molit: vi.fn(), save: vi.fn(), append: vi.fn(), generate: vi.fn() } }));
vi.mock("@/lib/auth/request", () => ({ requireApiCapability: vi.fn(async () => state.allowed
  ? { ok: true, principal: { orgId: "synthetic-org", userId: "synthetic-user" } }
  : { ok: false, response: NextResponse.json({ code: "FORBIDDEN" }, { status: 403 }) }) }));
vi.mock("@/lib/integrations/kakao", () => ({ geocodeAddress: state.effects.geocode }));
vi.mock("@/lib/integrations/molit", () => ({ fetchMolitRangeWithEvidence: state.effects.molit }));
vi.mock("@/lib/services/generate-scenarios", () => ({ generateScenariosForParcel: state.effects.generate }));
vi.mock("@/lib/workspace/project-workspace-storage", async original => ({ ...await original<object>(), saveProjectWorkspace: state.effects.save }));
vi.mock("@/lib/audit/audit-ledger", async original => ({ ...await original<object>(), appendAuditEvent: state.effects.append }));

import { PUT as workspace } from "@/app/api/projects/[projectId]/workspace/route";
import { POST as snapshot } from "@/app/api/projects/[projectId]/review-snapshots/route";
import { POST as review } from "@/app/api/projects/[projectId]/reviews/route";
import { POST as override } from "@/app/api/scenarios/[scenarioId]/overrides/route";
import { POST as dynamic } from "@/app/api/projects/dynamic/route";
import { POST as lookup } from "@/app/api/parcels/lookup/route";
import { POST as cadastral } from "@/app/api/parcels/cadastral-context/route";
import { POST as dwelling } from "@/app/api/parcels/dwelling-market/route";
import { POST as estimate } from "@/app/api/parcels/estimate-price/route";
import { POST as acquisition } from "@/app/api/parcels/acquisition-check/route";
import { POST as geocode } from "@/app/api/parcels/comps-geocode/route";

const context = { params: Promise.resolve({ projectId: "synthetic", scenarioId: "synthetic" }) };
const routes = [
  { name: "workspace", run: workspace, max: MAX_PROJECT_WORKSPACE_BYTES + 100_000 },
  { name: "snapshot", run: snapshot, max: MAX_REVIEW_SNAPSHOT_BYTES + 100_000 },
  { name: "review", run: review, max: JSON_REQUEST_LIMITS.reviewEvent },
  { name: "override", run: override, max: JSON_REQUEST_LIMITS.override },
  { name: "dynamic", run: dynamic, max: JSON_REQUEST_LIMITS.dynamicProject },
  { name: "lookup", run: lookup, max: JSON_REQUEST_LIMITS.lookup },
  { name: "cadastral", run: cadastral, max: JSON_REQUEST_LIMITS.lookup },
  { name: "dwelling", run: dwelling, max: JSON_REQUEST_LIMITS.lookup },
  { name: "estimate", run: estimate, max: JSON_REQUEST_LIMITS.calculation },
  { name: "acquisition", run: acquisition, max: JSON_REQUEST_LIMITS.calculation },
  { name: "geocode", run: geocode, max: JSON_REQUEST_LIMITS.compGeocode },
];
function request(body: string, headers?: Record<string, string>) {
  return new NextRequest("http://localhost/synthetic", { method: "POST", body, headers });
}
beforeEach(() => { state.allowed = true; vi.clearAllMocks(); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External calls forbidden"); })); });
afterEach(() => {
  for (const effect of Object.values(state.effects)) expect(effect).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});

describe.each(routes)("$name JSON boundary", ({ run, max }) => {
  it("authorizes before reading an oversized body", async () => {
    state.allowed = false;
    const req = request("{}", { "Content-Length": String(max + 1) });
    expect((await run(req, context)).status).toBe(403);
    expect(req.bodyUsed).toBe(false);
  });
  it("rejects declared oversized input before external calls or mutations", async () => {
    const response = await run(request("{}", { "Content-Length": String(max + 1) }), context);
    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it.each(["null", "[]", "42", "{", '"password=synthetic-secret"'])("rejects invalid object %s without echoing source", async body => {
    const response = await run(request(body), context);
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("synthetic-secret");
  });
  it("rejects deep JSON before recursive validation", async () => {
    const response = await run(request('{"nested":'.repeat(50) + "0" + "}".repeat(50)), context);
    expect(response.status).toBe(413);
  });
});

describe("actual body and scalar types", () => {
  it.each(routes.filter(r => ["lookup", "workspace", "snapshot"].includes(r.name)))("bounds actual $name bytes with a false small length", async ({ run, max }) => {
    const response = await run(request(JSON.stringify({ padding: "x".repeat(max) }), { "Content-Length": "2" }), context);
    expect(response.status).toBe(413);
  });
  it("counts object shape before parsing a schema", async () => {
    const input = await readJsonObject(request('{"a":[1,2,3]}'), { maxBytes: 100, maxNodes: 3 });
    expect(input.ok).toBe(false);
    if (!input.ok) expect(input.response.status).toBe(413);
  });
  it.each([null, 127, true, [], {}])("does not call address geocoding for non-string %s", async address => {
    expect((await lookup(request(JSON.stringify({ address })))).status).toBe(400);
  });
  it.each([null, "37", true, 91])("does not turn invalid latitude %s into a valid coordinate", async lat => {
    expect((await cadastral(request(JSON.stringify({ targetPnu: "1132010500102810023", lat, lng: 127 })))).status).toBe(400);
  });
  it.each([null, "10000", -1, 0])("rejects invalid purchase price %s before market lookup", async acquisitionPriceManwon => {
    expect((await acquisition(request(JSON.stringify({ parcel: { lotAreaSqm: 100, landPriceWonPerSqm: 1, lat: 37, lng: 127 },
      acquisitionPriceManwon, acquisitionDate: "2026-10-26", lawdCd: "11320" })))).status).toBe(422);
  });
});
