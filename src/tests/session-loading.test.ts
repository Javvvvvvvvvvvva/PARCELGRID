import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientSession, SESSION_CHANGE_KEY, type PublicAccessPrincipal } from "@/lib/auth/client-session";
import { SessionBoundary } from "@/components/auth/SessionBoundary";

// Drive the component's effect with controlled network/storage completion; the
// companion Chrome harness covers real React StrictMode and native browser events.
const harness = vi.hoisted(() => {
  const store = () => ({
    setState: vi.fn(), getInitialState: () => ({}),
    persist: { rehydrate: vi.fn(), hasHydrated: vi.fn(() => true) },
  });
  return { states: [] as unknown[], cursor: 0, effect: null as (() => () => void) | null,
    session: null as unknown as import("@/lib/auth/client-session").ClientSession,
    query: null as unknown as import("@tanstack/react-query").QueryClient,
    project: store(), review: store() };
});
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (harness.states.length <= index) harness.states.push(initial);
    return [harness.states[index], (value: unknown) => { harness.states[index] = value; }];
  },
  useEffect: (effect: () => () => void) => { harness.effect = effect; },
}));
vi.mock("@tanstack/react-query", async importOriginal => ({
  ...await importOriginal<typeof import("@tanstack/react-query")>(), useQueryClient: () => harness.query,
}));
vi.mock("@/lib/auth/client-session", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/auth/client-session")>(), get clientSession() { return harness.session; },
}));
vi.mock("@/lib/stores/project-store", () => ({ useProjectStore: harness.project }));
vi.mock("@/lib/stores/review-store", () => ({ useReviewStore: harness.review }));

const principal: PublicAccessPrincipal = {
  userId: "probe-user", orgId: "probe-org", name: "Probe", organization: "Probe org",
  email: "probe@example.test", role: "analyst", reviewerRoles: [], capabilities: ["project.read"],
};
type Pending = { resolve: (response: Response) => void; signal: AbortSignal };
let requests: Pending[];
let win: EventTarget;
let doc: EventTarget & { hidden: boolean; hasFocus: () => boolean };
let focused: boolean;
let cleanup: (() => void) | undefined;

function render() {
  harness.cursor = 0;
  return renderToStaticMarkup(SessionBoundary({ children: React.createElement("b", null, "customer-content") }));
}
function mount() { render(); cleanup = harness.effect!(); }
const flush = () => vi.advanceTimersByTimeAsync(0);
async function respond(index: number, next = principal) {
  requests[index].resolve(Response.json({ principal: next }));
  await flush();
}
async function ready() { mount(); await respond(0); expect(render()).toContain('<div><b>customer-content'); }
function blur() { focused = false; win.dispatchEvent(new Event("blur")); }
function focus() { focused = true; win.dispatchEvent(new Event("focus")); }

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  harness.states = [];
  harness.session = new ClientSession();
  harness.query = new QueryClient();
  for (const store of [harness.project, harness.review]) {
    store.persist.rehydrate.mockReset().mockResolvedValue(undefined);
    store.persist.hasHydrated.mockReset().mockReturnValue(true);
  }
  requests = [];
  focused = true;
  win = Object.assign(new EventTarget(), { setInterval, clearInterval, location: { reload: vi.fn() } });
  doc = Object.assign(new EventTarget(), { hidden: false, hasFocus: () => focused });
  vi.stubGlobal("React", React);
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("fetch", vi.fn((_input: unknown, init: RequestInit) => new Promise<Response>((resolve, reject) => {
    const signal = init.signal!;
    requests.push({ resolve, signal });
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  })));
  vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
    return controller.signal;
  });
});
afterEach(async () => {
  cleanup?.(); cleanup = undefined;
  await flush();
  harness.query.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("session boundary loading and foreground checks", () => {
  it("waits for identity and both storage hydrations before mounting customers", async () => {
    let finish!: () => void;
    harness.review.persist.rehydrate.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    mount();
    expect(render()).not.toContain("customer-content");
    expect(harness.project.persist.rehydrate).not.toHaveBeenCalled();
    await respond(0);
    expect(harness.session.active).toBe(true);
    expect(render()).not.toContain("customer-content");
    finish(); await flush();
    expect(render()).toContain('<div><b>customer-content');
  });

  it("survives effect cleanup/replay without invalidating the replacement session check", async () => {
    mount(); cleanup!();
    cleanup = harness.effect!();
    expect(requests[0].signal.aborted).toBe(true);
    await respond(1);
    expect(harness.session.active).toBe(true);
    expect(render()).toContain('<div><b>customer-content');
    expect(harness.project.persist.rehydrate).toHaveBeenCalledTimes(1);
  });

  it("shares the pending initial check with pageshow in an already foreground document", async () => {
    mount(); win.dispatchEvent(new Event("pageshow"));
    await respond(0);
    expect(requests).toHaveLength(1);
    expect(render()).toContain('<div><b>customer-content');
  });

  it.each(["blur", "pagehide"])("does not reveal content when a pending check finishes after %s", async event => {
    await ready();
    focus();
    if (event === "blur") blur(); else win.dispatchEvent(new Event(event));
    await respond(1);
    expect(render()).toContain('<div hidden=""><b>customer-content');
  });

  it("keeps an unfocused initial document hidden until focus revalidation", async () => {
    focused = false;
    mount(); await respond(0);
    expect(render()).toContain('<div hidden=""><b>customer-content');
    focus(); await respond(1);
    expect(render()).toContain('<div><b>customer-content');
  });

  it("queues a fresh check for focus returning during a pending pre-blur check", async () => {
    await ready();
    focus(); blur(); focus();
    await respond(1);
    expect(render()).toContain('<div hidden=""><b>customer-content');
    expect(requests).toHaveLength(3);
    await respond(2);
    expect(render()).toContain('<div><b>customer-content');
    expect(harness.project.persist.rehydrate).toHaveBeenCalledTimes(1);
  });

  it("locks when the queued focus check discovers an organization change", async () => {
    await ready();
    focus(); blur(); focus(); await respond(1);
    expect(requests).toHaveLength(3);
    await respond(2, { ...principal, orgId: "other-org" });
    expect(harness.session.active).toBe(false);
    expect(render()).not.toContain("customer-content");
    expect(render()).toContain('role="alert"');
    expect(harness.query.getQueryCache().getAll()).toHaveLength(0);
  });

  it("keeps hidden-tab content hidden through polling and rechecks on return", async () => {
    await ready();
    doc.hidden = true; doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(60_000); await respond(1);
    expect(render()).toContain('<div hidden=""><b>customer-content');
    doc.hidden = false; doc.dispatchEvent(new Event("visibilitychange"));
    expect(render()).toContain('<div hidden=""><b>customer-content');
    await respond(2);
    expect(render()).toContain('<div><b>customer-content');
  });

  it("does not let polling undo a blur while visibilityState is still visible", async () => {
    await ready(); blur();
    await vi.advanceTimersByTimeAsync(60_000); await respond(1);
    expect(render()).toContain('<div hidden=""><b>customer-content');
  });

  it("does not release a successful in-flight response after a cross-tab session lock", async () => {
    await ready(); focus();
    win.dispatchEvent(Object.assign(new Event("storage"), { key: SESSION_CHANGE_KEY }));
    await respond(1);
    expect(render()).not.toContain("customer-content");
    expect(render()).toContain('role="alert"');
    expect(harness.session.active).toBe(false);
    expect(harness.query.getQueryCache().getAll()).toHaveLength(0);
    expect(harness.project.setState).toHaveBeenCalled();
    expect(harness.review.setState).toHaveBeenCalled();
  });

  it("fails closed on session timeout without hydrating customer storage", async () => {
    mount(); await vi.advanceTimersByTimeAsync(10_000);
    expect(render()).toContain('role="alert"');
    expect(render()).not.toContain("customer-content");
    expect(harness.project.persist.rehydrate).not.toHaveBeenCalled();
    expect(() => harness.session.activate(principal)).toThrow();
  });

  it("fails closed on storage hydration failure", async () => {
    harness.review.persist.hasHydrated.mockReturnValue(false);
    mount(); await respond(0);
    expect(render()).toContain('role="alert"');
    expect(render()).not.toContain("customer-content");
    expect(harness.session.active).toBe(false);
  });
});
