/** Presentation only. Never calculates money, geometry, compliance or a ranking. */
export type WorkspaceRole = "public" | "architect" | "developer" | "insurer";
export const WORKSPACE_ROLES: Record<WorkspaceRole, string> = {
  public: "일반인", architect: "건축사", developer: "시행사", insurer: "보험사",
};
export function isWorkspaceRole(value: string): value is WorkspaceRole {
  return Object.prototype.hasOwnProperty.call(WORKSPACE_ROLES, value);
}
export interface OverviewReadiness {
  projectMatches: boolean;
  geometryReady: boolean;
  snapshotPresent: boolean;
  snapshotAligned: boolean;
  financeReady: boolean;
  inputsChanged: boolean;
  regulatoryVerified: boolean;
  sourceBacked: boolean;
}
export function canShowSavedFinance(state: OverviewReadiness): boolean {
  return state.projectMatches && state.geometryReady && state.snapshotPresent &&
    state.snapshotAligned && state.financeReady && !state.inputsChanged;
}
export function describeNextAction(state: OverviewReadiness) {
  if (!state.projectMatches) return { title: "프로젝트를 불러오는 중입니다", label: "부지 확인", path: "status", state: "불러오는 중" };
  if (!state.regulatoryVerified) return { title: "부지 조건의 적용 근거를 확인하세요", label: "부지·규제 확인", path: "status", state: "근거 검토" };
  if (!state.geometryReady) return { title: "검증된 대표 계획안을 선택하세요", label: "계획 스튜디오 열기", path: "envelope", state: "계획 검토" };
  if (!canShowSavedFinance(state)) return { title: state.inputsChanged ? "바뀐 입력으로 사업성을 다시 저장하세요" : "대표안의 사업성 결과를 저장하세요", label: "사업성 검토·저장", path: "", state: "결과 갱신 필요" };
  if (!state.sourceBacked) return { title: "계산 가정의 원문 근거를 보완하세요", label: "금융·가격 근거 확인", path: "#source-data-room", state: "근거 검토" };
  return { title: "저장된 계획과 검토 조건을 확인하세요", label: "전문가 검토·인계", path: "handoff", state: "전문가 검토 전" };
}
/** Exact equality against saved inputs, not a new financial calculation. Sources
 * take precedence over draft values, as on the existing Stage 3 input screen.
 * Invalid/new source records also require review rather than a claim of freshness. */
export function haveInputsChanged(
  saved: Readonly<Record<string, number | undefined>>,
  drafts: Readonly<Record<string, number | undefined>>,
  sources: Readonly<Record<string, { value: number } | undefined>>,
): boolean {
  const fields = new Set([...Object.keys(drafts), ...Object.keys(sources)]);
  for (const field of fields) {
    const value = sources[field]?.value ?? drafts[field];
    if (value !== undefined && (!Number.isFinite(value) || !Object.is(value, saved[field]))) return true;
  }
  return false;
}
export function projectHref(projectId: string, path: string): string {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  return path ? `${base}${path.startsWith("#") ? "" : "/"}${path}` : base;
}
export function safeEvidenceUrl(value?: string): string | null {
  if (!value) return null;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}
export function displayNumber(value: number | null | undefined, digits = 1): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("ko-KR", { maximumFractionDigits: digits }) : "—";
}
