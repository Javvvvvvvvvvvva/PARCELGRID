/**
 * 공용 UI 프리미티브 — 전 페이지 일관성의 단일 소스.
 *
 * 원칙 (C 확정):
 *  - 거의 흑백. 색은 '의미'에만, 부정(손실·고위험)만 절제된 적색 1개.
 *  - 정보 밀도·타이포 위계·정렬 리듬으로 세련되게. 그림자·그라디언트 없음.
 *  - 스페이싱/타입/라운드는 globals.css 토큰(--s*, --t-*, --r*) 사용.
 *
 * 페이지에서 자체 Panel/KV/Button을 인라인으로 만들지 말 것 → 여기 것을 재사용.
 */

import type {
  ReactNode,
  CSSProperties,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
} from "react";

/* ─────────────────────────── Panel ─────────────────────────── */

interface PanelProps {
  title?: ReactNode;
  /** 우측 상단 출처 라벨 (문자열이면 .ui-src 스타일 자동 적용) */
  source?: ReactNode;
  /** 우측 상단 액션 (버튼 등) */
  actions?: ReactNode;
  children: ReactNode;
  /** 본문 패딩 여부 (기본 true) */
  bodyPad?: boolean;
  bodyStyle?: CSSProperties;
  style?: CSSProperties;
  className?: string;
}

export function Panel({
  title,
  source,
  actions,
  children,
  bodyPad = true,
  bodyStyle,
  style,
  className,
}: PanelProps) {
  const hasHeader = title != null || source != null || actions != null;
  return (
    <section
      className={className}
      style={{
        background: "var(--bg-elev)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-md)",
        overflow: "hidden",
        ...style,
      }}
    >
      {hasHeader && (
        <header
          className="ui-panel-header"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--s2)",
            minHeight: 38,
            padding: "0 var(--s4)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          {title != null && (
            <span
              className="ui-panel-header__title"
              style={{
                fontSize: "var(--t-xs)",
                fontWeight: 600,
                letterSpacing: "0.01em",
                color: "var(--fg)",
              }}
            >
              {title}
            </span>
          )}
          {(source != null || actions != null) && (
            <span
              className="ui-panel-header__meta"
              style={{
                marginLeft: "auto",
                display: "flex",
                alignItems: "center",
                gap: "var(--s3)",
              }}
            >
              {source != null &&
                (typeof source === "string" ? (
                  <span className="ui-src">{source}</span>
                ) : (
                  source
                ))}
              {actions}
            </span>
          )}
        </header>
      )}
      <div style={{ padding: bodyPad ? "var(--s4)" : 0, ...bodyStyle }}>
        {children}
      </div>
    </section>
  );
}

/* ─────────────────────────── SectionTitle ─────────────────────────── */

interface SectionTitleProps {
  /** STEP 배지 등 */
  badge?: ReactNode;
  title: ReactNode;
  desc?: ReactNode;
  right?: ReactNode;
  size?: "md" | "lg";
  style?: CSSProperties;
}

export function SectionTitle({
  badge,
  title,
  desc,
  right,
  size = "md",
  style,
}: SectionTitleProps) {
  return (
    <div style={{ marginBottom: "var(--s4)", ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--s2)" }}>
        {badge != null && (
          <span
            style={{
              fontSize: "var(--t-micro)",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--fg-subtle)",
              background: "var(--bg-sunken)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-sm)",
              padding: "2px 7px",
            }}
          >
            {badge}
          </span>
        )}
        <h2
          style={{
            fontSize: size === "lg" ? "var(--t-xl)" : "var(--t-lg)",
            fontWeight: 600,
            letterSpacing: 0,
            margin: 0,
          }}
        >
          {title}
        </h2>
        {right != null && <span style={{ marginLeft: "auto" }}>{right}</span>}
      </div>
      {desc != null && (
        <p
          style={{
            fontSize: "var(--t-sm)",
            color: "var(--fg-muted)",
            margin: "var(--s1) 0 0",
          }}
        >
          {desc}
        </p>
      )}
    </div>
  );
}

/* ─────────────────────────── DataRow (KV) ─────────────────────────── */

interface DataRowProps {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  /** 하단 점선 구분선 (기본 true) */
  divider?: boolean;
}

export function DataRow({ label, value, sub, divider = true }: DataRowProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        alignItems: "baseline",
        gap: "var(--s3)",
        padding: "var(--s2) 0",
        borderBottom: divider ? "1px dashed var(--border-faint)" : "none",
        fontSize: "var(--t-xs)",
      }}
    >
      <span style={{ color: "var(--fg-muted)" }}>{label}</span>
      <span style={{ textAlign: "right", minWidth: 0 }}>
        <span className="mono" style={{ color: "var(--fg)", fontWeight: 600 }}>
          {value}
        </span>
        {sub != null && (
          <span
            style={{
              display: "block",
              fontSize: "var(--t-micro)",
              color: "var(--fg-faint)",
              marginTop: 1,
            }}
          >
            {sub}
          </span>
        )}
      </span>
    </div>
  );
}

/* ─────────────────────────── Label / Field ─────────────────────────── */

export function Label({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        fontSize: "var(--t-micro)",
        fontWeight: 600,
        color: "var(--fg-subtle)",
        marginBottom: "var(--s2)",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
}

export function TextField({ label, hint, style, ...rest }: TextFieldProps) {
  return (
    <div>
      {label != null && <Label>{label}</Label>}
      <input
        {...rest}
        style={{
          width: "100%",
          height: 34,
          padding: "0 var(--s3)",
          background: "var(--bg-elev)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r)",
          fontSize: "var(--t-sm)",
          color: "var(--fg)",
          fontFamily: "inherit",
          ...style,
        }}
      />
      {hint != null && (
        <div
          style={{
            fontSize: "var(--t-micro)",
            color: "var(--fg-muted)",
            marginTop: "var(--s1)",
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

interface DateFieldProps {
  label?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
}

export function DateField({ label, value, onChange, hint }: DateFieldProps) {
  return (
    <div>
      {label != null && <Label>{label}</Label>}
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          height: 34,
          padding: "0 var(--s3)",
          background: "var(--bg-elev)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--t-sm)",
          color: "var(--fg)",
        }}
      />
      {hint != null && (
        <div
          style={{
            fontSize: "var(--t-micro)",
            color: "var(--fg-muted)",
            marginTop: "var(--s1)",
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Button ─────────────────────────── */

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "ghost";
  size?: "sm" | "md" | "lg";
  block?: boolean;
}

export function Button({
  variant = "default",
  size = "md",
  block,
  className,
  children,
  ...rest
}: ButtonProps) {
  const cls = [
    "ui-btn",
    variant === "primary" ? "ui-btn--primary" : variant === "ghost" ? "ui-btn--ghost" : "",
    size === "sm" ? "ui-btn--sm" : size === "lg" ? "ui-btn--lg" : "",
    block ? "ui-btn--block" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}
