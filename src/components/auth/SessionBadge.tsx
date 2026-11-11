"use client";

import { LogOut, ShieldCheck } from "lucide-react";
import { ORGANIZATION_ROLE_LABEL } from "@/lib/auth/roles";
import { useAccessSession } from "@/lib/hooks/use-access-session";
import { announceSessionChange } from "@/lib/auth/client-session";

export function SessionBadge() {
  const session = useAccessSession();

  const logout = async () => {
    announceSessionChange();
    try {
      const response = await fetch("/api/access/login", {
        method: "DELETE", credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Logout failed");
      announceSessionChange();
      window.location.replace("/access");
    } catch {
      window.location.replace("/access?logout=failed");
    }
  };

  if (!session.data) return null;
  const principal = session.data;
  return (
    <div className="session-badge" title={`${principal.organization} · ${principal.email}`}>
      <ShieldCheck size={14} aria-hidden="true" />
      <span className="session-badge__identity">
        <strong>{principal.name}</strong>
        <small>{ORGANIZATION_ROLE_LABEL[principal.role]}</small>
      </span>
      <button
        type="button"
        className="session-badge__logout"
        aria-label="로그아웃"
        title="로그아웃"
        onClick={() => void logout()}
      >
        <LogOut size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
