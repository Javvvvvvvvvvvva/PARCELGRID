import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { requireApiCapability } from "@/lib/auth/request";
import { createSiteAccessToken, siteAccessCookie } from "@/lib/site-access";
import { resolveActiveDatabasePrincipal } from "@/lib/auth/database-membership";
import { GET as sourceDownload } from "@/app/api/projects/[projectId]/source-documents/route";
import { GET as renderDownload } from "@/app/api/projects/[projectId]/concept-render/route";
import { loadSourceDocument } from "@/lib/runtime/source-document-storage";
import { loadConceptRender } from "@/lib/runtime/concept-render-storage";
import { sourceDocumentProjectPrefix } from "@/lib/finance/source-document";
import { buildConceptRenderPath } from "@/lib/ai/concept-render";
import { tenantScopedProjectId, type AccessPrincipal } from "@/lib/auth/roles";

vi.mock("@/lib/runtime/source-document-storage", () => ({ loadSourceDocument: vi.fn(), saveSourceDocument: vi.fn() }));
vi.mock("@/lib/runtime/concept-render-storage", () => ({ loadConceptRender: vi.fn(), saveConceptRender: vi.fn() }));
const owner: AccessPrincipal = {
  userId: "11111111-1111-4111-8111-111111111111", orgId: "22222222-2222-4222-8222-222222222222",
  email: "synthetic-owner@example.invalid", name: "Synthetic owner", organization: "Synthetic org", role: "owner", reviewerRoles: [],
};
const projectId = "synthetic-failure-test";
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("SITE_ACCESS_PASSWORD", "synthetic-preview-password");
  vi.stubEnv("SITE_ACCESS_SESSION_SECRET", "synthetic-session-secret-only-for-isolated-tests");
  vi.stubEnv("SITE_ACCESS_ACCOUNTS_JSON", JSON.stringify([{ ...owner, password: "synthetic-owner-password" }]));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.clearAllMocks(); });

async function request(kind: "source" | "render", principal = owner, authenticated = true) {
  const scoped = tenantScopedProjectId(principal, projectId);
  const pathname = kind === "source" ? `${sourceDocumentProjectPrefix(scoped)}interest/test.pdf`
    : buildConceptRenderPath(scoped, "a".repeat(64));
  return new NextRequest(`http://localhost/api/projects/${projectId}/${kind}?${new URLSearchParams({ pathname, fileName: "test.pdf" })}`, {
    headers: authenticated ? { cookie: `${siteAccessCookie.name}=${await createSiteAccessToken(owner)}` } : {},
  });
}

it("fails closed in production when the membership database is missing", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const result = await requireApiCapability(await request("source"), "project.read");
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.response.status).toBe(503);
    expect(await result.response.json()).toMatchObject({ code: "AUTHORIZATION_UNAVAILABLE" });
  }
});
it("preserves explicit local/test signed-principal use without a database", async () => {
  expect(await resolveActiveDatabasePrincipal(owner)).toEqual(owner);
});

it.each(["source", "render"] as const)("distinguishes missing %s files from storage failure", async (kind) => {
  const loader = vi.mocked(kind === "source" ? loadSourceDocument : loadConceptRender);
  const route = kind === "source" ? sourceDownload : renderDownload;
  const context = { params: Promise.resolve({ projectId }) };
  loader.mockRejectedValueOnce(Object.assign(new Error("synthetic missing"), { code: "ENOENT" }));
  expect((await route(await request(kind), context)).status).toBe(404);
  loader.mockRejectedValueOnce(Object.assign(new Error("secret-token-must-not-be-returned"), { code: "EACCES" }));
  const failure = await route(await request(kind), context);
  expect(failure.status).toBe(503);
  expect(failure.headers.get("Cache-Control")).toContain("no-store");
  expect(await failure.text()).not.toContain("secret-token");
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret-token");
});

it.each(["source", "render"] as const)("checks authentication and organization before reading %s bytes", async (kind) => {
  const loader = vi.mocked(kind === "source" ? loadSourceDocument : loadConceptRender);
  const route = kind === "source" ? sourceDownload : renderDownload;
  const context = { params: Promise.resolve({ projectId }) };
  expect((await route(await request(kind, owner, false), context)).status).toBe(401);
  const otherOrg = { ...owner, orgId: "33333333-3333-4333-8333-333333333333" };
  expect((await route(await request(kind, otherOrg), context)).status).toBe(400);
  expect(loader).not.toHaveBeenCalled();
  loader.mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
  const success = await route(await request(kind), context);
  expect(success.status).toBe(200);
  expect(success.headers.get("Cache-Control")).toBe("private, no-store");
});
