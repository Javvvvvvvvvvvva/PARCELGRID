"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { clientSession, SESSION_CHANGE_KEY, type PublicAccessPrincipal } from "@/lib/auth/client-session";
import { principalSessionContext } from "@/lib/auth/session-context";
import { useProjectStore } from "@/lib/stores/project-store";
import { useReviewStore } from "@/lib/stores/review-store";

function clearCustomerMemory() {
  useProjectStore.setState(useProjectStore.getInitialState(), true);
  useReviewStore.setState(useReviewStore.getInitialState(), true);
}

export function SessionBoundary({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let hydrated = false;
    let checking = false;
    let recheck = false;
    let foreground = !document.hidden && document.hasFocus();
    const controller = new AbortController();
    const lock = () => {
      if (disposed) return;
      setReady(false);
      setVisible(false);
      setError("세션을 확인할 수 없거나 계정이 변경되어 작업 공간을 잠갔습니다.");
      queryClient.clear();
      clearCustomerMemory();
    };
    const unsubscribe = clientSession.subscribe(lock);
    const check = async () => {
      if (checking || disposed) return;
      checking = true;
      try {
        const response = await fetch("/api/access/session", {
          cache: "no-store", credentials: "same-origin",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        });
        const body = await response.json() as { principal?: PublicAccessPrincipal };
        if (disposed) return;
        if (!response.ok || !body.principal) throw new Error("Session unavailable");
        if (clientSession.context && clientSession.context !== principalSessionContext(body.principal)) {
          throw new Error("Session changed");
        }
        if (!hydrated) {
          if (!clientSession.active) clearCustomerMemory();
          clientSession.activate(body.principal);
          // Legacy unscoped keys are deliberately preserved, never claimed by a login.
          await useProjectStore.persist.rehydrate();
          await useReviewStore.persist.rehydrate();
          if (!useProjectStore.persist.hasHydrated() || !useReviewStore.persist.hasHydrated()) {
            throw new Error("Customer storage hydration failed");
          }
          clientSession.assertActive();
          if (disposed) return;
          hydrated = true;
        }
        clientSession.assertActive();
        // A focus return during this request needs its own identity check.
        if (recheck) return;
        queryClient.setQueryData(["access-session"], body.principal);
        setReady(true);
        setVisible(foreground && !document.hidden && document.hasFocus());
      } catch {
        if (!disposed) { clientSession.invalidate(); lock(); }
      } finally {
        checking = false;
        if (recheck && !disposed && clientSession.active) {
          recheck = false;
          void check();
        }
      }
    };
    const changed = () => clientSession.invalidate();
    const onStorage = (event: StorageEvent) => {
      if (event.key === SESSION_CHANGE_KEY) changed();
    };
    const hide = () => { foreground = false; setVisible(false); };
    const focus = () => {
      const returning = !foreground;
      foreground = !document.hidden && document.hasFocus();
      setVisible(false);
      if (checking) {
        if (returning && foreground) recheck = true;
      } else void check();
    };
    const visibility = () => { if (document.hidden) hide(); else focus(); };
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(SESSION_CHANGE_KEY) : null;
    if (channel) channel.onmessage = changed;
    window.addEventListener("storage", onStorage);
    window.addEventListener("blur", hide);
    window.addEventListener("focus", focus);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", focus);
    document.addEventListener("visibilitychange", visibility);
    const timer = window.setInterval(() => { void check(); }, 60_000);
    void check();
    return () => {
      disposed = true;
      controller.abort();
      unsubscribe();
      channel?.close();
      window.clearInterval(timer);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("blur", hide);
      window.removeEventListener("focus", focus);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", focus);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [queryClient]);

  return (
    <>
      {!ready || !visible ? (
        <main style={{ padding: "48px 24px", maxWidth: 640, margin: "auto" }}>
          <h1 style={{ fontSize: 24 }}>PARCELGRID</h1>
          <p role={error ? "alert" : "status"}>{error ?? "로그인과 조직 정보를 확인하고 있습니다."}</p>
          {error ? (
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <button type="button" className="ui-btn" onClick={() => window.location.reload()}>
                <RefreshCw size={14} aria-hidden="true" /> 다시 확인
              </button>
              <a href="/access">로그인으로 이동</a>
            </div>
          ) : null}
        </main>
      ) : null}
      {ready ? <div hidden={!visible}>{children}</div> : null}
    </>
  );
}
