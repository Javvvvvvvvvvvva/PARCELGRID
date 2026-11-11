import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientSession, type PublicAccessPrincipal } from "@/lib/auth/client-session";
import { principalSessionContext, SESSION_CONTEXT_HEADER } from "@/lib/auth/session-context";

const principal: PublicAccessPrincipal = {
  userId: "user-a", orgId: "org-a", name: "A", organization: "Org A",
  email: "a@example.com", role: "analyst", reviewerRoles: [],
  capabilities: ["project.read", "project.update"],
};

describe("document-bound customer session", () => {
  beforeEach(() => vi.stubGlobal("window", { location: { origin: "http://localhost" } }));
  afterEach(() => vi.unstubAllGlobals());

  it("cannot read storage or send a request before identity verification", async () => {
    const session = new ClientSession();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(session.storageKey("parcelgrid-envelope")).toBeNull();
    await expect(session.fetch("/api/projects")).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("isolates identical project keys across users, organizations and role changes", () => {
    const keys = [principal, { ...principal, userId: "user-b" },
      { ...principal, orgId: "org-b" }, { ...principal, role: "viewer" as const }].map(p => {
      const session = new ClientSession();
      session.activate(p);
      return session.storageKey("same-project-id");
    });
    expect(new Set(keys).size).toBe(4);
    expect(keys).not.toContain("same-project-id");
  });

  it("requires a new document after invalidation, including the same account", () => {
    const session = new ClientSession();
    session.activate(principal);
    const locked = vi.fn();
    session.subscribe(locked);
    session.invalidate();
    session.invalidate();
    expect(locked).toHaveBeenCalledTimes(1);
    expect(session.storageKey("draft")).toBeNull();
    expect(() => session.activate(principal)).toThrow();
    expect(() => session.activate({ ...principal, orgId: "org-b" })).toThrow();
  });

  it("binds protected requests to the verified principal and disables HTTP caching", async () => {
    const session = new ClientSession();
    session.activate(principal);
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    const response = await session.fetch("/api/projects/id/workspace", {
      method: "PUT", headers: { "Content-Type": "application/json", [SESSION_CONTEXT_HEADER]: "spoof" }, body: "{}",
    });
    expect(await response.json()).toEqual({ ok: true });
    const init = fetch.mock.calls[0][1];
    expect(init.headers.get(SESSION_CONTEXT_HEADER)).toBe(principalSessionContext(principal));
    expect(init.headers.get("Content-Type")).toBe("application/json");
    expect(init).toMatchObject({ cache: "no-store", credentials: "same-origin", method: "PUT" });
  });

  it("does not send the principal header to another origin", async () => {
    const session = new ClientSession();
    session.activate(principal);
    const fetch = vi.fn().mockResolvedValue(new Response("image"));
    vi.stubGlobal("fetch", fetch);
    await session.fetch("https://images.example.com/api/photo");
    expect(fetch.mock.calls[0][1].headers.has(SESSION_CONTEXT_HEADER)).toBe(false);
  });

  it("aborts in-flight requests and rejects a response arriving after logout", async () => {
    const session = new ClientSession();
    session.activate(principal);
    let deliver!: (value: Response) => void;
    const fetch = vi.fn().mockImplementation(() => new Promise<Response>(resolve => { deliver = resolve; }));
    vi.stubGlobal("fetch", fetch);
    const pending = session.fetch("/api/projects");
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    session.invalidate();
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    deliver(Response.json({ private: "old customer" }));
    await rejected;
  });

  it("does not release a delayed response body after invalidation", async () => {
    const session = new ClientSession();
    session.activate(principal);
    let finish!: () => void;
    const stream = new ReadableStream({ start(controller) {
      finish = () => { controller.enqueue(new TextEncoder().encode("secret")); controller.close(); };
    } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream)));
    const rejected = expect(session.fetch("/api/projects")).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    session.invalidate();
    finish();
    await rejected;
  });

  it.each([
    [401, "AUTH_REQUIRED"], [409, "SESSION_CONTEXT_CHANGED"],
    [409, "SESSION_CONTEXT_REQUIRED"], [503, "AUTHORIZATION_UNAVAILABLE"],
  ])("locks on authorization failure %s/%s", async (status, code) => {
    const session = new ClientSession();
    session.activate(principal);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code }, { status: Number(status) })));
    await expect(session.fetch("/api/projects")).rejects.toMatchObject({ name: "AbortError" });
    expect(session.active).toBe(false);
  });

  it("keeps an ordinary save revision conflict distinct from an account change", async () => {
    const session = new ClientSession();
    session.activate(principal);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code: "WORKSPACE_CONFLICT" }, { status: 409 })));
    expect((await session.fetch("/api/projects/id/workspace")).status).toBe(409);
    expect(session.active).toBe(true);
  });
});
