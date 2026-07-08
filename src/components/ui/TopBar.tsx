"use client";

import type { ReactNode } from "react";

interface TopBarProps {
  crumb: string[];
  right?: ReactNode;
}

export function TopBar({ crumb, right }: TopBarProps) {
  return (
    <div className="ui-topbar">
      <div className="ui-topbar__brand">
        <svg className="ui-topbar__logo-mark" width="26" height="26" viewBox="0 0 28 28" aria-hidden>
          <path d="M3.5 23 L14 4 L14 23 Z" fill="var(--accent)" />
          <path d="M24.5 23 L14 4 L14 23 Z" fill="var(--edge-gold)" />
        </svg>
        <span className="ui-topbar__name">
          <b>Double</b> Edge
        </span>
        <span className="ui-topbar__product">ParcelGrid</span>
      </div>
      <div className="ui-topbar__divider" />
      <div className="ui-crumb">
        {crumb.map((c, i) => (
          <span key={i} style={{ display: "contents" }}>
            <span className={i === crumb.length - 1 ? "ui-crumb__current" : ""}>{c}</span>
            {i < crumb.length - 1 && <span className="ui-crumb__sep">›</span>}
          </span>
        ))}
      </div>
      <div className="ui-topbar__right">{right}</div>
    </div>
  );
}
