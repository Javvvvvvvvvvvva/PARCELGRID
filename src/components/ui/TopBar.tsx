"use client";

import { Icons } from "./Icons";
import type { ReactNode } from "react";

interface TopBarProps {
  crumb: string[];
  right?: ReactNode;
}

export function TopBar({ crumb, right }: TopBarProps) {
  return (
    <div className="ui-topbar">
      <div className="ui-topbar__brand">
        <div className="ui-topbar__logo">PG</div>
        <div className="ui-topbar__name">
          PARCELGRID<span>v2.4 · 한국</span>
        </div>
      </div>
      <div className="ui-crumb">
        {crumb.map((c, i) => (
          <span key={i} style={{ display: "contents" }}>
            <span className={i === crumb.length - 1 ? "ui-crumb__current" : ""}>{c}</span>
            {i < crumb.length - 1 && <span className="ui-crumb__sep">/</span>}
          </span>
        ))}
      </div>
      <div className="ui-topbar__right">
        <button className="ui-btn ui-btn--ghost ui-btn--sm">
          {Icons.search()}
          <span style={{ color: "var(--fg-subtle)" }}>검색</span>
          <span className="ui-kbd">⌘K</span>
        </button>
        {right}
        <button className="ui-btn ui-btn--ghost ui-btn--icon">{Icons.bell()}</button>
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            background: "var(--accent)",
            color: "#fff",
            display: "grid",
            placeItems: "center",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          JK
        </div>
      </div>
    </div>
  );
}
