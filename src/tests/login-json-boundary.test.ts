import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/access/login/route";
import { JSON_REQUEST_LIMITS } from "@/lib/http/json-request";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("SITE_ACCESS_PASSWORD", "synthetic-input-boundary-password");
  vi.stubEnv("SITE_ACCESS_ACCOUNTS_JSON", "");
  vi.stubEnv("SITE_ACCESS_SESSION_SECRET", "synthetic-input-boundary-secret-at-least-32-characters");
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
function request(body: string, headers?: Record<string, string>) {
  return new Request("http://localhost/api/access/login", { method: "POST", body, headers });
}

describe("bounded unauthenticated login", () => {
  it.each(["{", "null", "[]", '"synthetic-input-boundary-password"'])("rejects malformed input %s without secrets or a session", async body => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.text()).not.toContain("synthetic-input-boundary-password");
  });
  it("rejects actual oversized credential input without trusting the declared length", async () => {
    const response = await POST(request(JSON.stringify({ password: "x".repeat(JSON_REQUEST_LIMITS.login) }), { "content-length": "2" }));
    expect(response.status).toBe(413);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
  it("retains credential failure and valid sign-in behavior", async () => {
    expect((await POST(request('{"password":"incorrect"}'))).status).toBe(401);
    const response = await POST(request('{"password":"synthetic-input-boundary-password"}'));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(await response.text()).not.toContain("synthetic-input-boundary-password");
  });
  it("ends a stalled credential body at the absolute deadline", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const req = new Request("http://localhost/api/access/login", { method: "POST",
      body: new ReadableStream({ pull() { return new Promise<void>(() => {}); }, cancel }), duplex: "half" } as RequestInit);
    const response = POST(req);
    await vi.advanceTimersByTimeAsync(10_001);
    expect((await response).status).toBe(408);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
