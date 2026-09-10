"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DEMO_PROJECT_ID } from "@/lib/seed/demo-project-meta";
import { useProjectOverview } from "./useProjectOverview";
import { WORKSPACE_ROLES, isWorkspaceRole, projectHref, type WorkspaceRole } from "./presentation";
import "./workspace.css";

const RoleContext = createContext<WorkspaceRole>("public");
export function useWorkspaceRole() { return useContext(RoleContext); }
const ROLE_KEY = "parcelgrid.ui.workspace-role.v1";
const ITEMS = [
  ["overview", "프로젝트 요약"], ["status", "부지·규제"], ["envelope", "계획 스튜디오"],
  ["comparison", "시나리오 비교"], ["", "사업성·자금"], ["handoff", "검토·인계"], ["report/brief", "보고서"],
] as const;

export function WorkspaceShell({ projectId, address, children }: { projectId: string; address: string; children: ReactNode }) {
  const pathname = usePathname();
  const model = useProjectOverview(projectId);
  const [role, setRole] = useState<WorkspaceRole>("public");
  const [menuOpen, setMenuOpen] = useState(false);
  const base = projectHref(projectId, "");
  const report = pathname.startsWith(`${base}/report`);
  useEffect(() => {
    try { const stored = localStorage.getItem(ROLE_KEY); if (stored && isWorkspaceRole(stored)) setRole(stored); }
    catch { /* Storage may be unavailable; the default view remains usable. */ }
  }, []);
  const changeRole = (value: string) => {
    if (!isWorkspaceRole(value)) return;
    setRole(value);
    try { localStorage.setItem(ROLE_KEY, value); } catch { /* UI preference only. */ }
  };
  const phase = (path: string) => {
    if (!model.data) return "불러오는 중";
    if (path === "status") return model.readiness.regulatoryVerified ? "근거 등록" : "확인 필요";
    if (path === "envelope") return model.geometry ? "형상 검증" : "검토 필요";
    if (path === "") return model.finance ? "저장 결과" : "저장 필요";
    if (path === "report/brief") return model.finance ? "예비 검토" : "결과 대기";
    return "";
  };
  return (
    <RoleContext.Provider value={role}>
      <div className={`pg-shell ui-shell app${report ? " pg-report-shell" : ""}`} data-role={role}>
        <a className="pg-skip" href="#pg-main">본문으로 이동</a>
        <header className="pg-appbar">
          <Link className="pg-brand" href={projectHref(projectId, "overview")} aria-label="프로젝트 요약">
            <svg viewBox="0 0 28 30" width="24" height="26" aria-hidden="true"><path d="M3 22V7l13-4 9 6v15l-13 4zM3 7l9 6 13-4M12 13v15M3 17l9-3 13 7" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
            PARCELGRID
          </Link>
          <span className="pg-crumb">{address}</span>
          <div className="pg-app-actions">
            {projectId === DEMO_PROJECT_ID && <span className="pg-demo">데모 · 현장 검증 전</span>}
            <label className="pg-role"><span>보기</span><select aria-label="역할별 보기" value={role} onChange={(e) => changeRole(e.target.value)}>
              {Object.entries(WORKSPACE_ROLES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <button type="button" className="pg-menu-button" aria-expanded={menuOpen} aria-controls="pg-navigation" onClick={() => setMenuOpen(!menuOpen)}>메뉴</button>
          </div>
        </header>
        <div className="pg-body">
          <aside className={`pg-rail${menuOpen ? " pg-rail-open" : ""}`}>
            <p className="pg-rail-label">프로젝트 검토</p>
            <nav id="pg-navigation" aria-label="프로젝트 화면">
              {ITEMS.map(([path, label], index) => {
                const href = projectHref(projectId, path);
                const active = path === "report/brief" ? report : pathname === href || Boolean(path && pathname.startsWith(`${href}/`));
                return <Link key={label} href={href} aria-current={active ? "page" : undefined} onClick={() => setMenuOpen(false)}>
                  <span className="pg-nav-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                  <span>{label}<small>{phase(path)}</small></span>
                </Link>;
              })}
            </nav>
            <div className="pg-rail-meta"><span>현재 대표안</span><strong>{model.plan?.name ?? "미선택"}</strong><small>{model.geometry ? `v${model.plan?.version} · 형상 검증 통과` : "검증 매스 없음"}</small></div>
            <div className="pg-rail-foot"><Link href={projectHref(projectId, "comps")}>실거래 근거</Link><Link href="/system/readiness">연결·환경 점검</Link><Link href="/projects/new">새 부지 분석</Link></div>
          </aside>
          <main id="pg-main" tabIndex={-1} className="scroll-host pg-main">
            {report && <nav className="pg-report-nav" aria-label="보고서 영역"><Link href={projectHref(projectId, "overview")}>← 작업 화면</Link><Link href={projectHref(projectId, "report/brief")} aria-current={pathname.endsWith("/brief") ? "page" : undefined}>경영진 요약</Link><Link href={projectHref(projectId, "report")} aria-current={pathname === `${base}/report` ? "page" : undefined}>상세 보고서·근거</Link></nav>}
            {children}
          </main>
        </div>
      </div>
    </RoleContext.Provider>
  );
}
