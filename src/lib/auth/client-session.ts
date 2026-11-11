"use client";

import type { AccessCapability, AccessPrincipal } from "@/lib/auth/roles";
import { principalSessionContext, SESSION_CONTEXT_HEADER } from "@/lib/auth/session-context";

export interface PublicAccessPrincipal extends AccessPrincipal {
  capabilities: AccessCapability[];
}

export const SESSION_CHANGE_KEY = "parcelgrid:session-change";

export class ClientSession {
  private controller = new AbortController();
  private stopped = false;
  private listeners = new Set<() => void>();
  principal: PublicAccessPrincipal | null = null;

  get context(): string | null {
    return this.principal ? principalSessionContext(this.principal) : null;
  }

  get active(): boolean {
    return Boolean(this.principal && !this.stopped);
  }

  // A document can own only one identity. Switching requires a full navigation,
  // so old async callbacks can never acquire a new customer's storage namespace.
  activate(principal: PublicAccessPrincipal): void {
    if (this.stopped || (this.context && this.context !== principalSessionContext(principal))) {
      this.invalidate();
      throw new Error("계정 또는 조직이 변경되었습니다. 다시 로그인해 주세요.");
    }
    this.principal = principal;
  }

  assertActive(): void {
    if (!this.active) throw new DOMException("사용자 세션이 잠겼습니다.", "AbortError");
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  invalidate(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.controller.abort();
    for (const listener of this.listeners) listener();
  }

  storageKey(key: string): string | null {
    return this.active ? `parcelgrid:scoped:v1:${this.context}:${key}` : null;
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    this.assertActive();
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
    const protectedApi = url.origin === window.location.origin && url.pathname.startsWith("/api/");
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (protectedApi) headers.set(SESSION_CONTEXT_HEADER, this.context!);
    const suppliedSignal = init?.signal ?? (input instanceof Request ? input.signal : null);
    const signal = suppliedSignal
      ? AbortSignal.any([this.controller.signal, suppliedSignal])
      : this.controller.signal;
    const response = await globalThis.fetch(input, {
      ...init,
      headers,
      signal,
      ...(protectedApi ? { cache: "no-store", credentials: "same-origin" } as const : {}),
    });
    // Finish consuming the response before releasing it to callers. A logout
    // during a delayed body must not deliver old data to a store callback.
    const bytes = await response.arrayBuffer();
    this.assertActive();
    const result = new Response(bytes.byteLength ? bytes : null, {
      status: response.status, statusText: response.statusText, headers: response.headers,
    });
    if (protectedApi && [401, 409, 503].includes(result.status)) {
      const body = await result.clone().json().catch(() => null) as { code?: string } | null;
      if (result.status === 401 || ["SESSION_CONTEXT_CHANGED", "SESSION_CONTEXT_REQUIRED", "AUTHORIZATION_UNAVAILABLE"].includes(body?.code ?? "")) {
        this.invalidate();
        this.assertActive();
      }
    }
    this.assertActive();
    return result;
  }
}

export const clientSession = new ClientSession();
export const sessionFetch: typeof fetch = (input, init) => clientSession.fetch(input, init);

function scopedStorage(kind: "localStorage" | "sessionStorage") {
  return {
    getItem(key: string): string | null {
      const scoped = clientSession.storageKey(key);
      return scoped && typeof window !== "undefined" ? window[kind].getItem(scoped) : null;
    },
    setItem(key: string, value: string): void {
      const scoped = clientSession.storageKey(key);
      if (scoped && typeof window !== "undefined") window[kind].setItem(scoped, value);
    },
    removeItem(key: string): void {
      const scoped = clientSession.storageKey(key);
      if (scoped && typeof window !== "undefined") window[kind].removeItem(scoped);
    },
  };
}

export const sessionLocalStorage = scopedStorage("localStorage");
export const sessionDraftStorage = scopedStorage("sessionStorage");

export function announceSessionChange(): void {
  clientSession.invalidate();
  try { window.localStorage.setItem(SESSION_CHANGE_KEY, crypto.randomUUID()); } catch { /* BroadcastChannel is the fallback. */ }
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(SESSION_CHANGE_KEY);
    channel.postMessage("changed");
    channel.close();
  }
}
