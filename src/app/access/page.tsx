"use client";

import { FormEvent, useEffect, useState } from "react";
import styles from "./access.module.css";
import { announceSessionChange } from "@/lib/auth/client-session";

function requestedDestination(): string {
  if (typeof window === "undefined") return "/";
  const requested = new URLSearchParams(window.location.search).get("next");
  return requested?.startsWith("/") && !requested.startsWith("//")
    ? requested
    : "/";
}

export default function AccessPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [requiresEmail, setRequiresEmail] = useState(false);
  const [sessionHours, setSessionHours] = useState(12);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("logout") === "failed") {
      setError("이 기기의 작업 공간은 잠겼지만 서버 로그아웃을 확인하지 못했습니다. 다시 로그인하거나 로그아웃을 재시도해 주세요.");
    }
    void fetch("/api/access/login", { cache: "no-store" })
      .then((response) => response.json())
      .then((result: { requiresEmail?: boolean; sessionHours?: number }) => {
        setRequiresEmail(Boolean(result.requiresEmail));
        if (Number.isFinite(result.sessionHours)) {
          setSessionHours(Number(result.sessionHours));
        }
      })
      .catch(() => undefined);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    announceSessionChange();

    try {
      const response = await fetch("/api/access/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        setError(result?.error ?? "접근을 확인하지 못했습니다.");
        return;
      }

      announceSessionChange();
      window.location.replace(requestedDestination());
    } catch {
      setError("서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="access-title">
        <div className={styles.brandRow}>
          <span className={styles.mark} aria-hidden="true">
            <span />
            <span />
          </span>
          <span className={styles.brand}>PARCELGRID</span>
          <span className={styles.product}>PRIVATE REVIEW</span>
        </div>

        <div className={styles.heading}>
          <p className={styles.eyebrow}>AUTHORIZED ACCESS ONLY</p>
          <h1 id="access-title">프로젝트 검토 공간</h1>
          <p>
            현재 서비스는 초대된 검토자만 이용할 수 있습니다.
            본인 계정으로 접속하면 역할에 따라 수정과 승인이 분리됩니다.
          </p>
        </div>

        <form className={styles.form} onSubmit={submit}>
          {requiresEmail ? (
            <>
              <label htmlFor="site-email">이메일</label>
              <input
                id="site-email"
                name="email"
                type="email"
                autoComplete="username"
                autoFocus
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@company.com"
                required
              />
            </>
          ) : null}
          <label htmlFor="site-password">접근 비밀번호</label>
          <input
            id="site-password"
            name="password"
            type="password"
            autoComplete="current-password"
            autoFocus={!requiresEmail}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "access-error" : undefined}
            placeholder="비밀번호 입력"
          />
          {error ? (
            <p id="access-error" className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={submitting || !password || (requiresEmail && !email)}
          >
            {submitting ? "확인 중…" : "PARCELGRID 열기"}
          </button>
        </form>

        <p className={styles.notice}>
          비밀번호는 브라우저에 저장되지 않으며, 서명된 인증 세션은 최대 {sessionHours}시간
          유지됩니다.
        </p>
      </section>
    </main>
  );
}
