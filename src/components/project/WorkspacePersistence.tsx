"use client";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { workspaceManager, useWorkspaceStatus } from "@/lib/workspace/manager";
import type { WorkspaceRecord } from "@/lib/workspace/document";
import "./workspace-storage.css";

export function downloadWorkspaceFile(content: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function WorkspacePersistence({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const enabled = pathname === "/" || pathname.startsWith("/projects/");
  const match = pathname.match(/^\/projects\/([^/]+)/);
  const projectId = match && match[1] !== "new" && !pathname.endsWith("/acquisition-check") ? match[1] : null;
  const state = useWorkspaceStatus();
  useEffect(() => { if (enabled) void workspaceManager.open(projectId); }, [enabled, projectId]);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if (workspaceManager.hasUnsavedChanges()) { event.preventDefault(); event.returnValue = ""; void workspaceManager.flush().catch(() => undefined); } };
    const focus = () => void workspaceManager.checkForUpdates();
    window.addEventListener("beforeunload", leave); window.addEventListener("focus", focus);
    return () => { window.removeEventListener("beforeunload", leave); window.removeEventListener("focus", focus); };
  }, []);
  if (!enabled) return <>{children}</>;
  const blocked = projectId && state.projectId !== projectId;
  return <>
    {(state.projectId || state.status === "error" || state.status === "conflict") && <PersistenceBar />}
    {blocked ? <div className="workspace-opening" role={state.status === "error" ? "alert" : "status"}>
      <strong>{state.status === "error" ? "저장된 프로젝트를 열지 못했어요" : "저장된 프로젝트를 확인하고 있어요…"}</strong>
      {state.status === "error" && <><p>{state.message}</p><button onClick={() => void workspaceManager.open(projectId)}>다시 연결</button><Link href="/projects/new">저장한 프로젝트로 돌아가기</Link></>}
    </div> : children}
  </>;
}

function PersistenceBar() {
  const state = useWorkspaceStatus();
  const [history, setHistory] = useState<WorkspaceRecord[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { setHistory(null); setError(""); }, [state.projectId]);
  const run = async (action: () => Promise<unknown>) => { try { setError(""); await action(); } catch (e) { setError(e instanceof Error ? e.message : "작업을 완료하지 못했습니다."); } };
  const failed = state.status === "error" || state.status === "conflict";
  return <section className="workspace-persistence" aria-label="프로젝트 저장 상태">
    <div className="workspace-storage-row">
      <span role="status" className={failed ? "workspace-storage-error" : ""}>{({ idle: "", loading: "저장소 연결 중…", saving: "변경사항 저장 중…", saved: "이 브라우저에 저장됨", error: "저장하지 못함", conflict: "다른 탭과 충돌" })[state.status]}</span>
      {state.status === "saved" && state.savedAt && <time dateTime={state.savedAt}>{new Date(state.savedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</time>}
      {state.projectId && <>
        <button type="button" disabled={!state.canUndo || failed} onClick={() => workspaceManager.editHistory("undo")}>계획 변경 취소</button>
        <button type="button" disabled={!state.canRedo || failed} onClick={() => workspaceManager.editHistory("redo")}>다시 적용</button>
        <button type="button" onClick={() => void run(async () => downloadWorkspaceFile(await workspaceManager.backup(), `parcelgrid-${state.projectId}-backup.json`))}>현재 탭 백업</button>
        <button type="button" disabled={failed} onClick={() => void run(async () => { await workspaceManager.flush(); setHistory(history ? null : await workspaceManager.history()); })}>저장 기록</button>
        <Link href="/projects/new">프로젝트 목록</Link>
      </>}
      {state.status === "error" && state.projectId && <button type="button" onClick={() => void run(() => workspaceManager.retry())}>저장 다시 시도</button>}
      {state.status === "conflict" && <button type="button" onClick={() => { if (window.confirm("현재 탭의 미저장 변경은 적용하지 않고 최신 저장본을 엽니다. 필요한 내용은 먼저 ‘현재 탭 백업’으로 내려받으세요.")) void run(() => workspaceManager.reload()); }}>최신 저장본 열기</button>}
    </div>
    {failed && <p role="alert">{state.message} 현재 화면은 자동으로 덮어쓰지 않습니다.</p>}
    {error && <p role="alert" className="workspace-storage-error">{error}</p>}
    {history && <div className="workspace-history"><p>이전 저장본 최대 20개 · 복구 후 대표안과 검토 승인은 다시 확인합니다.</p>
      {history.length ? history.map(row => <div key={row.revision}><time>{new Date(row.savedAt).toLocaleString("ko-KR")}</time><span>{row.reason}</span>
        <button type="button" onClick={() => { if (window.confirm("이 저장본을 복구할까요? 현재 저장본도 기록에 남습니다.")) void run(async () => { await workspaceManager.restoreVersion(row.revision); setHistory(null); }); }}>이 저장본 복구</button></div>) : <p>이전 저장본이 아직 없습니다.</p>}
    </div>}
  </section>;
}
