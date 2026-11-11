import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestPrincipal, requireApiCapability } from "@/lib/auth/request";
import * as databaseMembership from "@/lib/auth/database-membership";
import {
  principalSessionContext,
  SESSION_CONTEXT_HEADER,
} from "@/lib/auth/session-context";
import { createSiteAccessToken, siteAccessCookie } from "@/lib/site-access";
import type { AccessPrincipal } from "@/lib/auth/roles";

const viewer: AccessPrincipal = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  email: "viewer@example.com",
  name: "Viewer",
  organization: "Example",
  role: "viewer",
  reviewerRoles: [],
};

describe("request authorization", () => {
  const originalPassword = process.env.SITE_ACCESS_PASSWORD;
  const originalSecret = process.env.SITE_ACCESS_SESSION_SECRET;
  const originalAccounts = process.env.SITE_ACCESS_ACCOUNTS_JSON;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    process.env.SITE_ACCESS_PASSWORD = "test-password-0000";
    process.env.SITE_ACCESS_SESSION_SECRET = "request-test-session-secret-at-least-32";
    delete process.env.SITE_ACCESS_ACCOUNTS_JSON;
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalPassword == null) delete process.env.SITE_ACCESS_PASSWORD;
    else process.env.SITE_ACCESS_PASSWORD = originalPassword;
    if (originalSecret == null) delete process.env.SITE_ACCESS_SESSION_SECRET;
    else process.env.SITE_ACCESS_SESSION_SECRET = originalSecret;
    if (originalAccounts == null) delete process.env.SITE_ACCESS_ACCOUNTS_JSON;
    else process.env.SITE_ACCESS_ACCOUNTS_JSON = originalAccounts;
    if (originalDatabaseUrl == null) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  async function request(
    headers: Record<string, string> = {},
    principal: AccessPrincipal = viewer,
    method = "GET",
  ) {
    const token = await createSiteAccessToken(principal);
    return new Request("http://localhost/api/example", {
      method,
      headers: { cookie: `${siteAccessCookie.name}=${token}`, ...headers },
    });
  }

  it("encodes a stable context without mutating reviewer roles", () => {
    const principal: AccessPrincipal = {
      ...viewer,
      reviewerRoles: ["developer", "architect"],
    };
    expect(SESSION_CONTEXT_HEADER).toBe("x-parcelgrid-session-context");
    expect(principalSessionContext(principal)).toBe(encodeURIComponent(JSON.stringify([
      viewer.orgId,
      viewer.userId,
      viewer.role,
      ["architect", "developer"],
    ])));
    expect(principalSessionContext({
      ...principal,
      reviewerRoles: ["architect", "developer"],
    })).toBe(principalSessionContext(principal));
    expect(principal.reviewerRoles).toEqual(["developer", "architect"]);
  });

  it("allows the signed viewer to read but not execute analysis", async () => {
    await expect(
      requireApiCapability(await request(), "project.read"),
    ).resolves.toMatchObject({ ok: true, principal: { role: "viewer" } });
    const denied = await requireApiCapability(await request(), "analysis.run");
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.response.status).toBe(403);
  });

  it.each(["GET", "POST"])("accepts a matching browser context on %s", async (method) => {
    const principal: AccessPrincipal = {
      ...viewer,
      role: "analyst",
      reviewerRoles: ["developer", "architect"],
    };
    const context = principalSessionContext({
      ...principal,
      reviewerRoles: ["architect", "developer"],
    });
    await expect(requireApiCapability(await request({
      "sec-fetch-site": "same-origin",
      [SESSION_CONTEXT_HEADER]: context,
    }, principal, method), method === "GET" ? "project.read" : "project.update"))
      .resolves.toMatchObject({ ok: true, principal });
  });

  it("still checks capabilities when the context matches", async () => {
    const denied = await requireApiCapability(await request({
      "sec-fetch-site": "same-origin",
      [SESSION_CONTEXT_HEADER]: principalSessionContext(viewer),
    }), "analysis.run");
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.response.status).toBe(403);
      expect(await denied.response.json()).toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it.each([
    ["organization", { orgId: "33333333-3333-4333-8333-333333333333" }],
    ["user", { userId: "44444444-4444-4444-8444-444444444444" }],
    ["role", { role: "analyst" }],
    ["reviewer roles", { reviewerRoles: ["architect"] }],
  ] satisfies [string, Partial<AccessPrincipal>][])(
    "rejects a context from a different %s before checking capability",
    async (_field, changed) => {
      const denied = await requireApiCapability(await request({
        "sec-fetch-site": "same-origin",
        [SESSION_CONTEXT_HEADER]: principalSessionContext({ ...viewer, ...changed }),
      }), "analysis.run");
      expect(denied.ok).toBe(false);
      if (!denied.ok) {
        expect(denied.response.status).toBe(409);
        expect(denied.response.headers.get("cache-control")).toBe("no-store");
        expect(await denied.response.json()).toMatchObject({ code: "SESSION_CONTEXT_CHANGED" });
      }
    },
  );

  it.each([
    ["role", { role: "analyst" }],
    ["reviewer roles", { reviewerRoles: ["architect"] }],
  ] satisfies [string, Partial<AccessPrincipal>][])(
    "compares context against the resolved membership's %s",
    async (_field, changed) => {
      const currentPrincipal = { ...viewer, ...changed };
      const resolve = vi.spyOn(databaseMembership, "resolveActiveDatabasePrincipal")
        .mockResolvedValue(currentPrincipal);
      const denied = await requireApiCapability(await request({
        "sec-fetch-site": "same-origin",
        [SESSION_CONTEXT_HEADER]: principalSessionContext(viewer),
      }), "project.read");
      expect(resolve).toHaveBeenCalledWith(viewer);
      expect(denied.ok).toBe(false);
      if (!denied.ok) {
        expect(denied.response.status).toBe(409);
        expect(denied.response.headers.get("cache-control")).toBe("no-store");
        expect(await denied.response.json()).toMatchObject({ code: "SESSION_CONTEXT_CHANGED" });
      }
      await expect(requireApiCapability(await request({
        "sec-fetch-site": "same-origin",
        [SESSION_CONTEXT_HEADER]: principalSessionContext(currentPrincipal),
      }), "project.read")).resolves.toEqual({ ok: true, principal: currentPrincipal });
    },
  );

  it.each(["same-origin", "same-site", "cross-site", "none", ""])(
    "requires context whenever sec-fetch-site is present (%s)",
    async (fetchSite) => {
      const denied = await requireApiCapability(await request({
        "sec-fetch-site": fetchSite,
      }), "analysis.run");
      expect(denied.ok).toBe(false);
      if (!denied.ok) {
        expect(denied.response.status).toBe(409);
        expect(denied.response.headers.get("cache-control")).toBe("no-store");
        expect(await denied.response.json()).toMatchObject({ code: "SESSION_CONTEXT_REQUIRED" });
      }
    },
  );

  it.each(["", "stale-context"])(
    "rejects a supplied invalid context even without sec-fetch-site (%s)",
    async (context) => {
      const denied = await requireApiCapability(await request({
        [SESSION_CONTEXT_HEADER]: context,
      }), "project.read");
      expect(denied.ok).toBe(false);
      if (!denied.ok) {
        expect(denied.response.status).toBe(409);
        expect(denied.response.headers.get("cache-control")).toBe("no-store");
        expect(await denied.response.json()).toMatchObject({ code: "SESSION_CONTEXT_CHANGED" });
      }
    },
  );

  it.each([undefined, "stale-context"])(
    "keeps raw principal resolution exempt from context checks (%s)",
    async (context) => {
      const headers: Record<string, string> = { "sec-fetch-site": "same-origin" };
      if (context !== undefined) headers[SESSION_CONTEXT_HEADER] = context;
      await expect(requestPrincipal(await request(headers))).resolves.toEqual(viewer);
    },
  );

  it.each([
    ["programmatic request", {}],
    ["browser without context", { "sec-fetch-site": "same-origin" }],
    ["browser with matching context", {
      "sec-fetch-site": "same-origin",
      [SESSION_CONTEXT_HEADER]: principalSessionContext(viewer),
    }],
    ["browser with stale context", {
      "sec-fetch-site": "same-origin",
      [SESSION_CONTEXT_HEADER]: "stale-context",
    }],
    ["context without cookie", { [SESSION_CONTEXT_HEADER]: principalSessionContext(viewer) }],
    ["invalid cookie with context", {
      cookie: `${siteAccessCookie.name}=invalid`,
      [SESSION_CONTEXT_HEADER]: principalSessionContext(viewer),
    }],
  ] satisfies [string, Record<string, string>][])(
    "returns 401 without a signed session: %s",
    async (_name, headers) => {
      const denied = await requireApiCapability(
        new Request("http://localhost/api/example", { headers }),
        "project.read",
      );
      expect(denied.ok).toBe(false);
      if (!denied.ok) {
        expect(denied.response.status).toBe(401);
        expect(denied.response.headers.get("cache-control")).toBe("no-store");
        expect(await denied.response.json()).toMatchObject({ code: "AUTH_REQUIRED" });
      }
    },
  );

  it("returns 401 when membership is inactive even with a stale context", async () => {
    vi.spyOn(databaseMembership, "resolveActiveDatabasePrincipal").mockResolvedValue(null);
    const denied = await requireApiCapability(
      await request({
        "sec-fetch-site": "same-origin",
        [SESSION_CONTEXT_HEADER]: "stale-context",
      }),
      "project.read",
    );
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.response.status).toBe(401);
      expect(await denied.response.json()).toMatchObject({ code: "AUTH_REQUIRED" });
    }
  });
});
