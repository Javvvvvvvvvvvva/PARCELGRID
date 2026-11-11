import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST as source } from "@/app/api/projects/[projectId]/source-documents/route";
import { POST as render } from "@/app/api/projects/[projectId]/concept-render/route";
import { MAX_SOURCE_DOCUMENT_BYTES } from "@/lib/finance/source-document";
import { MAX_CONCEPT_REFERENCE_BYTES } from "@/lib/ai/concept-render";

const state = vi.hoisted(() => ({ authorized: true, save: vi.fn(), append: vi.fn(), quota: vi.fn() }));
vi.mock("@/lib/auth/request", () => ({ requireApiCapability: vi.fn(async () => state.authorized
  ? { ok: true, principal: { orgId: "synthetic", userId: "synthetic" } }
  : { ok: false, response: NextResponse.json({ code: "FORBIDDEN" }, { status: 403 }) }) }));
vi.mock("@/lib/runtime/source-document-storage", () => ({ saveSourceDocument: state.save, loadSourceDocument: vi.fn() }));
vi.mock("@/lib/runtime/concept-render-storage", () => ({ saveConceptRender: state.save, loadConceptRender: vi.fn() }));
vi.mock("@/lib/runtime/concept-render-quota", () => ({ reserveConceptRenderQuota: state.quota }));
vi.mock("@/lib/audit/audit-ledger", () => ({ appendAuditEvent: state.append }));
beforeEach(() => { state.authorized = true; vi.clearAllMocks(); vi.stubEnv("OPENAI_API_KEY", "synthetic-never-call-provider"); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const context = { params: Promise.resolve({ projectId: "synthetic" }) };
async function wireForm(form: FormData) {
  const encoded = new Request("http://localhost/upload", { method: "POST", body: form });
  return new NextRequest(encoded.url, { method: "POST", body: await encoded.arrayBuffer(), headers: encoded.headers });
}
const routes = [{ name: "source", run: source, field: "file", limit: MAX_SOURCE_DOCUMENT_BYTES },
  { name: "render", run: render, field: "referenceImage", limit: MAX_CONCEPT_REFERENCE_BYTES }];
function expectNoEffects() {
  expect(state.save).not.toHaveBeenCalled(); expect(state.append).not.toHaveBeenCalled();
  expect(state.quota).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
}
describe.each(routes)("$name upload boundary", ({ run, field, limit }) => {
  it("authorizes before parsing or checking credentials", async () => {
    state.authorized = false;
    const request = new NextRequest("http://localhost/upload", { method: "POST", body: "secret", headers: { "content-length": "999999999" } });
    expect((await run(request, context)).status).toBe(403); expect(request.bodyUsed).toBe(false); expectNoEffects();
  });
  it("rejects actual file overflow before quota, providers or persistence", async () => {
    const form = new FormData(); form.set(field, new File([new Uint8Array(limit + 1)], "synthetic.png", { type: "image/png" }));
    const request = await wireForm(form);
    request.headers.set("content-length", "1");
    const response = await run(request, context);
    expect(response.status).toBe(413); expect(response.headers.get("cache-control")).toBe("no-store"); expectNoEffects();
  });
  it("rejects a huge declaration without reading even a small body", async () => {
    const form = new FormData(); form.set(field, new File(["x"], "a.pdf"));
    const request = await wireForm(form);
    request.headers.set("content-length", String(limit + 65_537));
    expect((await run(request, context)).status).toBe(413); expectNoEffects();
  });
  it("rejects duplicate or incorrectly typed fields without side effects", async () => {
    const form = new FormData(); form.set(field, "not-a-file");
    expect((await run(await wireForm(form), context)).status).toBe(400);
    expectNoEffects();
  });
  it("times out an unfinished multipart stream before effects", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}), cancel });
    const request = new NextRequest("http://localhost/upload", { method: "POST", body, headers: { "content-type": "multipart/form-data; boundary=bounded" }, duplex: "half" } as ConstructorParameters<typeof NextRequest>[1]);
    const pending = run(request, context);
    await vi.advanceTimersByTimeAsync(30_001);
    expect((await pending).status).toBe(408); expect(cancel).toHaveBeenCalledOnce(); expectNoEffects();
  });
});

it("stores one valid document only after full form and signature validation", async () => {
  const form = new FormData(); form.set("field", "acquisitionPrice");
  form.set("file", new File(["%PDF-synthetic"], "견적.pdf", { type: "application/pdf" }));
  const response = await source(new NextRequest("http://localhost/upload", { method: "POST", body: form }), context);
  expect(response.status).toBe(201); expect(state.save).toHaveBeenCalledOnce(); expect(state.append).toHaveBeenCalledOnce();
  expect(state.quota).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
