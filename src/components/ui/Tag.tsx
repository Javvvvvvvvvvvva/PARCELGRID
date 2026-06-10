/**
 * Atomic display primitives used across screens.
 * Match the .ui-tag, .ui-dot, .ui-src classes in tokens.css.
 */

import type { ReactNode, CSSProperties } from "react";

type TagKind = "default" | "pos" | "neg" | "warn" | "accent" | "solid";

interface TagProps {
  kind?: TagKind;
  children: ReactNode;
  mono?: boolean;
  style?: CSSProperties;
}

export function Tag({ kind = "default", children, mono = true, style }: TagProps) {
  const cls = kind === "default" ? "ui-tag" : `ui-tag ui-tag--${kind}`;
  const monoStyle: CSSProperties = mono
    ? {}
    : { fontFamily: "var(--font-sans)", textTransform: "none", letterSpacing: 0 };
  return <span className={cls} style={{ ...monoStyle, ...style }}>{children}</span>;
}

interface DotProps {
  kind?: "pos" | "neg" | "warn" | "accent";
}

export function Dot({ kind }: DotProps) {
  return <span className={"ui-dot" + (kind ? " ui-dot--" + kind : "")} />;
}

export function Source({ children }: { children: ReactNode }) {
  return <span className="ui-src">{children}</span>;
}

/** Visual mini-bar — used in the scenarios table for regulatory score. */
export function MiniBar({
  value,
  max,
  kind = "accent",
  width = 80,
}: {
  value: number;
  max: number;
  kind?: "accent" | "pos" | "neg" | "warn";
  width?: number;
}) {
  return (
    <div className="ui-bar" style={{ width }}>
      <div
        className={"ui-bar__fill ui-bar__fill--" + kind}
        style={{ right: `${100 - (value / max) * 100}%` }}
      />
    </div>
  );
}
