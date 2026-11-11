import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "@/middleware";

const root = resolve(process.cwd(), "src/app/api");
const routes = readdirSync(root, { recursive: true })
  .map(String).filter((path) => path === "route.ts" || path.endsWith("/route.ts")).sort();
const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

beforeEach(() => {
  vi.stubEnv("SITE_ACCESS_PASSWORD", "synthetic-inventory-password");
  vi.stubEnv("SITE_ACCESS_SESSION_SECRET", "synthetic-inventory-secret-at-least-32");
  vi.stubEnv("SITE_ACCESS_ACCOUNTS_JSON", "");
  vi.stubEnv("DATABASE_URL", "");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("API authorization without buffering middleware", () => {
  it.each(routes.filter((path) => path !== "access/login/route.ts"))(
    "rejects every unauthenticated handler in %s before consuming a body",
    async (path) => {
      const handlers = await import(/* @vite-ignore */ `../app/api/${path}`);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected external request"));
      const exportedMethods = Object.keys(handlers).filter((name) => methods.has(name));
      expect(exportedMethods.length).toBeGreaterThan(0);
      for (const method of exportedMethods) {
        const url = "http://localhost/api/" + path.replace(/(^|\/)route\.ts$/, "")
          .replace("[projectId]", "1132010500102810023").replace("[scenarioId]", "scenario-test");
        const request = new NextRequest(url, {
          method,
          ...(method === "GET" || method === "HEAD" ? {} : { body: "not-json", headers: { "content-length": "999999999" } }),
        });
        const response: Response = await handlers[method](request, {
          params: Promise.resolve({ projectId: "1132010500102810023", scenarioId: "scenario-test" }),
        });
        expect(response.status, `${path} ${method}`).toBe(401);
        expect(request.bodyUsed).toBe(false);
        expect(response.headers.get("cache-control")).toBe("no-store");
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it.each(["/api", "/api/", "/api/access/login", "/api/projects/a/workspace", "/api/system/readiness", "/_next/static/a.js", "/_next/image", "/asset.png"])(
    "does not buffer %s through middleware", (url) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
    },
  );
  it.each(["/", "/projects/a", "/system/readiness", "/apiary", "/apiculture", "/access"])(
    "retains page middleware for %s", (url) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
    },
  );
});
