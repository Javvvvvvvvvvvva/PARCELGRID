"use client";

import { Icons } from "./Icons";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface WorkRailProps {
  projectId: string;
}

const ITEMS = [
  { id: "status",     icon: Icons.map,    label: "현황 분석",       path: "status" },
  { id: "envelope",   icon: Icons.layers, label: "계획 스튜디오",   path: "envelope" },
  { id: "dashboard",  icon: Icons.bar,    label: "사업성 검토",       path: "" },
  { id: "comps",      icon: Icons.table,  label: "실거래 비교",     path: "comps" },
  { id: "handoff",    icon: Icons.share,  label: "전문가 검증·인계", path: "handoff" },
  { id: "pdf",        icon: Icons.doc,    label: "예비 보고서",     path: "report" },
];

export function WorkRail({ projectId }: WorkRailProps) {
  const pathname = usePathname();
  return (
    <div
      className="ui-workrail"
      style={{
        width: 48,
        borderRight: "1px solid var(--border)",
        background: "var(--bg-elev)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "10px 0",
        gap: 4,
        flexShrink: 0,
      }}
    >
      {ITEMS.map((it) => {
        const href = `/projects/${projectId}${it.path ? "/" + it.path : ""}`;
        const active = pathname === href || (it.path && pathname.startsWith(href));
        return (
          <Link
            key={it.id}
            href={href}
            title={it.label}
            style={{
              width: 34,
              height: 34,
              borderRadius: 6,
              cursor: "pointer",
              background: active ? "var(--fg)" : "transparent",
              color: active ? "var(--bg)" : "var(--fg-muted)",
              display: "grid",
              placeItems: "center",
              textDecoration: "none",
            }}
          >
            {it.icon()}
          </Link>
        );
      })}
      <div style={{ flex: 1 }} />
      <button
        title="히스토리"
        style={{
          width: 34,
          height: 34,
          borderRadius: 6,
          border: 0,
          cursor: "pointer",
          background: "transparent",
          color: "var(--fg-muted)",
          display: "grid",
          placeItems: "center",
        }}
      >
        {Icons.history()}
      </button>
    </div>
  );
}
