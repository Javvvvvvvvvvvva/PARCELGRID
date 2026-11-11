import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_PROJECT_ID } from "@/lib/seed/demo-project-meta";
import { projectWorkspaceFixture } from "./helpers/project-workspace-fixture";
import { hashProjectWorkspacePayload, PROJECT_WORKSPACE_VERSION, validateProjectWorkspacePayload } from "@/lib/workspace/project-workspace";
import type { DynamicProjectLoadResult, StoredParcel } from "@/lib/hooks/use-dynamic-project";

let useDynamicProject: typeof import("@/lib/hooks/use-dynamic-project").useDynamicProject;
beforeEach(async () => {
  vi.resetModules();
  const { clientSession } = await import("@/lib/auth/client-session");
  clientSession.activate({ userId: "test-user", orgId: "test-org", role: "owner", reviewerRoles: [],
    email: "test@example.com", name: "Test", organization: "Test", capabilities: ["project.read"] });
  ({ useDynamicProject } = await import("@/lib/hooks/use-dynamic-project"));
});

vi.mock("@tanstack/react-query", () => ({ useQuery: (options: unknown) => options }));
function query() {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- useQuery is mocked to capture options; no React hooks execute.
  return useDynamicProject(DEMO_PROJECT_ID) as unknown as { queryFn: () => Promise<DynamicProjectLoadResult>; queryKey: string[] };
}
function draft(value: Partial<StoredParcel> | null) {
  vi.stubGlobal("window", { location: { origin: "http://localhost" },
    sessionStorage: {
      getItem: (key: string) => key.endsWith(":parcelgrid:draft-parcel") && value ? JSON.stringify(value) : null,
      setItem: vi.fn(), removeItem: vi.fn(),
    } });
}
afterEach(() => vi.unstubAllGlobals());

describe("real project takes precedence over demo PNU", () => {
  it("stores an explicitly unpriced site without inventing financial candidates", async () => {
    const { buildSiteProject } = await import("@/lib/hooks/use-dynamic-project");
    const intake = { id: DEMO_PROJECT_ID, address: "합성 현황 부지", lotArea: 100, zoning: "일반상업지역",
      acquiredPrice: null, selectedAt: "2026-11-10T00:00:00Z", intakeRevision: "unpriced" } as StoredParcel;
    const payload = projectWorkspaceFixture(DEMO_PROJECT_ID);
    payload.projectData = buildSiteProject(intake);
    expect(validateProjectWorkspacePayload(payload).valid).toBe(true);
    expect(payload.projectData.scenarios).toEqual([]);
    payload.projectData.parcel.acquiredPrice = 100;
    expect(validateProjectWorkspacePayload(payload).valid).toBe(false);
  });

  it("reopens a hash-validated unpriced site with its price gate input intact", async () => {
    const { buildSiteProject } = await import("@/lib/hooks/use-dynamic-project");
    draft(null);
    const payload = projectWorkspaceFixture(DEMO_PROJECT_ID);
    payload.projectData = buildSiteProject({ id: DEMO_PROJECT_ID, address: "합성 현황 부지", lotArea: 100,
      zoning: "일반상업지역", acquiredPrice: null, intakeRevision: "unpriced" } as StoredParcel);
    const record = { version: PROJECT_WORKSPACE_VERSION, projectId: DEMO_PROJECT_ID, revision: 1, payload,
      payloadHash: await hashProjectWorkspacePayload(payload), savedAt: "2026-11-10T00:00:00Z", savedBy: "test-user", auditHash: "a".repeat(64), backend: "local-versioned" };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(record)); vi.stubGlobal("fetch", fetchMock);
    expect(await query().queryFn()).toMatchObject({ source: "server-workspace", data: {
      meta: { mode: "site-only" }, siteIntake: { acquiredPrice: null, intakeRevision: "unpriced" }, scenarios: [],
    } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("recomputes an explicitly revised intake while retaining the server revision for conflict detection", async () => {
    draft({ id: DEMO_PROJECT_ID, address: "합성 변경 부지", lotArea: 100, acquiredPrice: 20000, intakeRevision: "new-intake" });
    const payload = projectWorkspaceFixture(DEMO_PROJECT_ID);
    payload.projectData.meta.intakeRevision = "old-intake";
    const record = { version: PROJECT_WORKSPACE_VERSION, projectId: DEMO_PROJECT_ID, revision: 3, payload,
      payloadHash: await hashProjectWorkspacePayload(payload), savedAt: "2026-11-10T00:00:00Z", savedBy: "test-user", auditHash: "a".repeat(64), backend: "local-versioned" };
    const computed = { ...payload.projectData, meta: { ...payload.projectData.meta, intakeRevision: "new-intake" } };
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(record)).mockResolvedValueOnce(Response.json(computed));
    vi.stubGlobal("fetch", fetchMock);
    expect(await query().queryFn()).toMatchObject({ workspace: { revision: 3 }, data: computed,
      localDraft: { baseRevision: 3, payload: { representativeScenarioId: null, representativeGeometry: null, stage3Snapshot: null } } });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/projects/dynamic");
  });
  it("retains every uploaded component and hole through intake storage and the dynamic request", async () => {
    const boundaryPolygons = [{ outer: [[127, 37], [127.001, 37], [127.001, 37.001], [127, 37.001]],
      holes: [[[127.0001, 37.0001], [127.0002, 37.0001], [127.0002, 37.0002], [127.0001, 37.0002]]] },
    { outer: [[127.002, 37], [127.003, 37], [127.003, 37.001], [127.002, 37.001]], holes: [] }] as NonNullable<StoredParcel["boundaryPolygons"]>;
    draft({ id: DEMO_PROJECT_ID, address: "합성 입력동 1", lotArea: 100, acquiredPrice: 100000, boundary: [], boundaryPolygons });
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 404 })).mockResolvedValueOnce(Response.json({ parcel: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await query().queryFn();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).parcel).toMatchObject({ boundary: [], boundaryPolygons });
  });
  it("computes a newly entered parcel with the demo PNU instead of replacing it with seed data", async () => {
    draft({ id: DEMO_PROJECT_ID, address: "실제 입력동 1", lotArea: 987, acquiredPrice: 123456 });
    const computed = { parcel: { lotArea: 987 } };
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 404 })).mockResolvedValueOnce(Response.json(computed));
    vi.stubGlobal("fetch", fetchMock);
    const result = await query().queryFn();
    expect(result).toMatchObject({ source: "computed-local-intake", data: computed });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/projects/dynamic");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).parcel.lotArea).toBe(987);
  });
  it("loads a hash-validated server Workspace before the seed endpoint", async () => {
    draft(null);
    const payload = projectWorkspaceFixture(DEMO_PROJECT_ID);
    const record = { version: PROJECT_WORKSPACE_VERSION, projectId: DEMO_PROJECT_ID, revision: 1, payload, payloadHash: await hashProjectWorkspacePayload(payload), savedAt: "2026-10-17T00:00:00Z", savedBy: "test-user", auditHash: "a".repeat(64), backend: "local-versioned" };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(record)); vi.stubGlobal("fetch", fetchMock);
    expect(await query().queryFn()).toMatchObject({ source: "server-workspace", data: payload.projectData });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("uses demo only with no saved server project and no matching draft", async () => {
    draft(null);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("{}", { status: 404 })).mockResolvedValueOnce(Response.json({ seed: true })));
    expect(await query().queryFn()).toMatchObject({ source: "demo" });
  });
  it("keeps unsaved local changes and their original revision when the server has advanced", async () => {
    draft(null);
    const { writeWorkspaceDraft } = await import("@/lib/workspace/workspace-draft");
    const local = projectWorkspaceFixture(DEMO_PROJECT_ID, "local-edits");
    local.draftAcquisitionPrice = 456789;
    writeWorkspaceDraft(local, 1);
    const server = projectWorkspaceFixture(DEMO_PROJECT_ID, "server-revision-2");
    const record = { version: PROJECT_WORKSPACE_VERSION, projectId: DEMO_PROJECT_ID, revision: 2,
      payload: server, payloadHash: await hashProjectWorkspacePayload(server), savedAt: "2026-10-26T00:00:00Z",
      savedBy: "other-editor", auditHash: "a".repeat(64), backend: "local-versioned" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(record)));
    expect(await query().queryFn()).toMatchObject({ source: "server-workspace", data: local.projectData,
      workspace: { revision: 2 }, localDraft: { baseRevision: 1, payload: { draftAcquisitionPrice: 456789 } } });
  });
  it("recovers a first unsaved workspace without falling back to seed or recomputing intake", async () => {
    draft(null);
    const { writeWorkspaceDraft } = await import("@/lib/workspace/workspace-draft");
    const local = projectWorkspaceFixture(DEMO_PROJECT_ID, "first-unsaved-project");
    writeWorkspaceDraft(local, 0);
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await query().queryFn()).toMatchObject({ source: "computed-local-intake", data: local.projectData,
      workspace: null, localDraft: { baseRevision: 0 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 503])("does not bypass Workspace HTTP %s with a seed or local calculation", async status => {
    draft({ id: DEMO_PROJECT_ID });
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status })); vi.stubGlobal("fetch", fetchMock);
    if (status === 401) await expect(query().queryFn()).rejects.toMatchObject({ name: "AbortError" });
    else await expect(query().queryFn()).rejects.toThrow(String(status));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("uses a new query cache entry when a real draft replaces the seed selection", () => {
    draft(null); const seedKey = query().queryKey;
    draft({ id: DEMO_PROJECT_ID, address: "합성 입력동 1", lotArea: 100 }); expect(query().queryKey).not.toEqual(seedKey);
  });
});
