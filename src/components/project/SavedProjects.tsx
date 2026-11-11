"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { workspaceManager, useWorkspaceStatus } from "@/lib/workspace/manager";
import { MAX_BACKUP_BYTES, importWorkspace, type WorkspaceRecord } from "@/lib/workspace/document";
import { DEMO_PROJECT_ID } from "@/lib/seed/demo-project-meta";
import { downloadWorkspaceFile } from "./WorkspacePersistence";

export default function SavedProjects({ disabled = false }: { disabled?: boolean }) {
  const [rows, setRows] = useState<WorkspaceRecord[]>([]), [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const input = useRef<HTMLInputElement>(null), router = useRouter();
  const issues = useWorkspaceStatus(s => s.legacyIssues);
  useEffect(() => { let cancelled = false;
    workspaceManager.initialize().then(db => db.projects.orderBy("savedAt").reverse().toArray()).then(values => { if (!cancelled) setRows(values); })
      .catch(e => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  const run = async (action: () => Promise<unknown>) => { try { setError(""); await action(); } catch (e) { setError(e instanceof Error ? e.message : "저장 자료를 읽지 못했습니다."); } };
  return <details className="saved-projects" open={rows.length > 0 || undefined}><summary>저장한 프로젝트 {rows.length > 0 && <span>{rows.length}</span>}</summary>
    <p>이 브라우저에서 이어서 작업할 수 있어요. 다른 PC에는 백업 파일을 가져오세요.</p>
    {loading && <p role="status">저장 목록을 확인하고 있어요…</p>}
    {!loading && !rows.length && !error && <p>아직 저장한 프로젝트가 없어요.</p>}
    <ul>{rows.map(row => <li key={row.projectId}><div><strong>{typeof row.intake?.address === "string" ? row.intake.address : row.projectId === DEMO_PROJECT_ID ? "예시 부지" : row.projectId}</strong><small>{new Date(row.savedAt).toLocaleDateString("ko-KR")}</small></div>
      <div>{row.intake || row.projectId === DEMO_PROJECT_ID ? <Link aria-disabled={disabled} onClick={event => { if (disabled) event.preventDefault(); }} href={`/projects/${row.projectId}/status`}>열기</Link> : <span>부지 입력 재확인 필요</span>}
        <button type="button" disabled={disabled} onClick={() => void run(async () => downloadWorkspaceFile(await workspaceManager.backup(row.projectId), `parcelgrid-${row.projectId}-backup.json`))}>백업</button></div></li>)}</ul>
    <button type="button" disabled={disabled} onClick={() => input.current?.click()}>백업 파일 가져오기</button>
    <input hidden type="file" accept=".json,application/json" ref={input} aria-label="프로젝트 백업 파일" onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
      void run(async () => {
        if (file.size > MAX_BACKUP_BYTES) throw new Error("백업 파일은 20MB 이하여야 합니다.");
        const content = await file.text(), document = await importWorkspace(content);
        if (!window.confirm(`${document.intake?.address ?? document.projectId} 프로젝트를 복구할까요? 같은 부지의 현재 저장본은 기록에 보존하고 대표안과 승인을 다시 확인합니다.`)) return;
        const id = await workspaceManager.restore(content); router.push(`/projects/${id}/status`);
      });
    }} />
    {issues.length > 0 && <p className="workspace-storage-error">{issues.join(" ")}</p>}
    <button type="button" onClick={() => void run(async () => { const backups = await (await workspaceManager.initialize()).legacyBackups.toArray(); downloadWorkspaceFile(JSON.stringify({ format: "parcelgrid-legacy-originals", backups }, null, 2), "parcelgrid-legacy-originals.json"); })}>이전 저장 원본 받기</button>
    {error && <p role="alert" className="workspace-storage-error">{error}</p>}
  </details>;
}
