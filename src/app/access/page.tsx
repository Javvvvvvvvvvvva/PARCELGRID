"use client";

import { FormEvent, useState } from "react";
import styles from "./access.module.css";

function requestedDestination(): string {
  if (typeof window === "undefined") return "/";
  const requested = new URLSearchParams(window.location.search).get("next");
  return requested?.startsWith("/") && !requested.startsWith("//")
    ? requested
    : "/";
}

export default function AccessPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/access/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        setError(result?.error ?? "접근을 확인하지 못했습니다.");
        return;
      }

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
            공유받은 비밀번호를 입력해 주세요.
          </p>
        </div>

        <form className={styles.form} onSubmit={submit}>
          <label htmlFor="site-password">접근 비밀번호</label>
          <input
            id="site-password"
            name="password"
            type="password"
            autoComplete="current-password"
            autoFocus
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
          <button type="submit" disabled={submitting || !password}>
            {submitting ? "확인 중…" : "PARCELGRID 열기"}
          </button>
        </form>

        <p className={styles.notice}>
          입력한 비밀번호는 브라우저에 저장되지 않으며, 인증 세션은 14일간
          유지됩니다.
        </p>
      </section>
    </main>
  );
}
