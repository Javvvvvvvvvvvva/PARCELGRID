"use client";

import { TransactionEvidence } from "@/components/ui/TransactionEvidence";
import { AcquisitionAccess } from "@/components/project/SiteProjectAccess";
import { use, useEffect, useRef, useState } from "react";
import { readWorkspaceDraft } from "@/lib/workspace/workspace-draft";
import { useDynamicProject } from "@/lib/hooks/use-dynamic-project";
import { useProjectStore } from "@/lib/stores/project-store";
import { recomputeFromEnvelope } from "@/lib/services/recompute-from-envelope";
import { recomputeFromPlanningScenarios } from "@/lib/services/recompute-from-planning-scenarios";
import { validateReviewSnapshotAlignment } from "@/lib/handoff/review-snapshot";
import { TopBar } from "@/components/ui/TopBar";
import { WorkRail } from "@/components/ui/WorkRail";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { SessionBadge } from "@/components/auth/SessionBadge";
import {
  applyProjectWorkspace,
  captureProjectWorkspace,
} from "@/lib/workspace/project-workspace-client";
import { hashProjectWorkspacePayload } from "@/lib/workspace/project-workspace";
import {
  useProjectWorkspaceSync,
  type ProjectWorkspaceSyncStatus,
} from "@/lib/hooks/use-project-workspace-sync";
import {
  Cloud,
  CloudOff,
  Download,
  LoaderCircle,
  RefreshCw,
  Save,
} from "lucide-react";

interface ProjectLayoutProps {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}

/**
 * Standalone sub-routes that bypass this layout's project hydration.
 * These pages handle their own data sources (sessionStorage, etc).
 */
const STANDALONE_SUBROUTES = ["/acquisition-check"];

export default function ProjectLayout({ children, params }: ProjectLayoutProps) {
  const pathname = usePathname();
  const { projectId } = use(params);

  if (STANDALONE_SUBROUTES.some((sub) => pathname.endsWith(sub))) {
    return <>{children}</>;
  }

  if (pathname.endsWith("/status")) return <ProjectShell params={params}>{children}</ProjectShell>;
  return <AcquisitionAccess key={projectId} projectId={projectId}><ProjectShell params={params}>{children}</ProjectShell></AcquisitionAccess>;
}

function ProjectShell({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const pathname = usePathname();
  const { projectId } = use(params);
  const {
    data: projectLoad,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useDynamicProject(projectId);
  const data = projectLoad?.data;
  const setData = useProjectStore((s) => s.setData);
  const envelopePlan = useProjectStore((s) => s.envelopePlan);
  const planningScenarios = useProjectStore((s) => s.planningScenarios);
  const representativePlanningScenarioId = useProjectStore(
    (s) => s.representativePlanningScenarioId
  );
  const representativeGeometrySnapshot = useProjectStore(
    (s) => s.representativeGeometrySnapshot
  );
  const projectFinancialSources = useProjectStore(
    (s) => s.financialSources[projectId]
  );
  const savedStage3Snapshot = useProjectStore(
    (s) => s.stage3FeasibilitySnapshots[projectId]
  );
  const lastKeyRef = useRef<string>("");
  const [hydratedWorkspaceKey, setHydratedWorkspaceKey] = useState("");
  const workspaceHydrationKey = projectLoad?.workspace
    ? `${projectLoad.workspace.projectId}:${projectLoad.workspace.revision}:${projectLoad.workspace.payloadHash}`
    : projectLoad?.localDraft ? `local:${projectId}:${projectLoad.localDraft.draftId}` : "";
  const workspaceNeedsHydration = Boolean(
    workspaceHydrationKey &&
      hydratedWorkspaceKey !== workspaceHydrationKey,
  );
  useEffect(() => {
    if (error || isFetching || !workspaceNeedsHydration) return;
    const payload = readWorkspaceDraft(projectId)?.payload ?? projectLoad?.workspace?.payload;
    if (!payload) return;
    setHydratedWorkspaceKey(workspaceHydrationKey);
    lastKeyRef.current = "";
    applyProjectWorkspace(payload);
  }, [projectId, projectLoad?.workspace, error, isFetching, workspaceHydrationKey, workspaceNeedsHydration]);

  const workspaceSync = useProjectWorkspaceSync({
    projectId,
    initialRecord: projectLoad?.workspace ?? null,
    enabled:
      projectLoad?.source !== "demo" &&
      Boolean(data) &&
      !error &&
      !isFetching &&
      !workspaceNeedsHydration,
  });

  useEffect(() => {
    if (error || !data || workspaceNeedsHydration || isFetching) return;

    const projectPlanningScenarios = planningScenarios.filter(
      (scenario) => scenario.projectId === projectId
    );
    const representativeScenario = projectPlanningScenarios.find(
      (scenario) => scenario.id === representativePlanningScenarioId
    );

    // 새 Stage 2 대표 계획안이 있으면 구형 EnvelopePlan보다 우선한다.
    if (representativeScenario && representativePlanningScenarioId) {
      const savedSnapshotMatches =
        savedStage3Snapshot?.projectId === projectId &&
        savedStage3Snapshot.data.meta.intakeRevision === data.meta.intakeRevision &&
        validateReviewSnapshotAlignment({
          snapshot: savedStage3Snapshot,
          geometry: representativeGeometrySnapshot,
          currentScenario: representativeScenario,
        }).valid;
      if (savedSnapshotMatches) {
        const snapshotKey = `stage3-snapshot|${savedStage3Snapshot.savedAt}`;
        if (lastKeyRef.current === snapshotKey) return;
        lastKeyRef.current = snapshotKey;
        setData(savedStage3Snapshot.data);
        return;
      }

      const planningVersionKey = projectPlanningScenarios
        .filter(
          (scenario) =>
            scenario.id === representativePlanningScenarioId ||
            scenario.status === "saved"
        )
        .map(
          (scenario) =>
            `${scenario.id}:${scenario.version}:${scenario.updatedAt}:${scenario.status}`
        )
        .sort()
        .join("|");
      const financialSourceKey = Object.values(projectFinancialSources ?? {})
        .filter((record) => record != null)
        .map(
          (record) =>
            `${record.field}:${record.value}:${record.asOf}:${record.recordedAt}`
        )
        .sort()
        .join("|");
      const key = `${data.meta?.lastSyncedAt ?? ""}|planning|${representativePlanningScenarioId}|${planningVersionKey}|sources|${financialSourceKey}`;
      if (lastKeyRef.current === key) return;
      lastKeyRef.current = key;

      const recomputed = recomputeFromPlanningScenarios(
        data.parcel,
        projectPlanningScenarios,
        representativePlanningScenarioId,
        data,
        {
          geometryHashes: {
            [representativePlanningScenarioId]:
              representativeGeometrySnapshot?.geometryHash,
          },
          financialSources: projectFinancialSources,
        }
      );
      setData(recomputed ?? data);
      return;
    }

    // 대표 PlanningScenario가 없을 때만 구형 envelope 계획을 호환 처리한다.
    const firstId = data.scenarios?.[0]?.id;
    if (firstId === "ENV-MAIN") {
      setData(data);
      return;
    }

    const key = `${data.meta?.lastSyncedAt ?? ""}|legacy-envelope|${envelopePlan?.scenarioType ?? ""}|${envelopePlan?.farPct ?? ""}|${envelopePlan?.floors ?? ""}|${envelopePlan?.units ?? ""}`;
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;

    if (envelopePlan && envelopePlan.scenarioType && data.parcel) {
      const recomputed = recomputeFromEnvelope(data.parcel, envelopePlan, data);
      setData(recomputed ?? data);
    } else {
      setData(data);
    }
  }, [
    data,
    envelopePlan,
    planningScenarios,
    projectFinancialSources,
    projectId,
    representativeGeometrySnapshot,
    representativePlanningScenarioId,
    savedStage3Snapshot,
    setData,
    workspaceNeedsHydration,
    isFetching,
    error,
  ]);

  if (isLoading || (!error && (isFetching || workspaceNeedsHydration))) {
    return (
      <div style={{ padding: 40, color: "var(--fg-muted)" }}>
        프로젝트 로딩 중...
      </div>
    );
  }
  if (error || !data) {
    return (
      <div style={{ maxWidth: 720, margin: "80px auto", padding: 24 }}>
        <div style={{ padding: 20, border: "1px solid var(--neg)", borderRadius: 10, background: "var(--neg-soft)" }}>
          <strong style={{ display: "block", color: "var(--neg-fg)", fontSize: 16 }}>
            프로젝트를 열지 못했습니다
          </strong>
          <p style={{ color: "var(--neg-fg)", fontSize: 12, lineHeight: 1.65 }}>
            {String(error instanceof Error ? error.message : error)}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={isFetching}
              className="ui-btn ui-btn--primary"
            >
              {isFetching ? "다시 연결 중…" : "다시 시도"}
            </button>
            <Link href="/projects/new" className="ui-btn">
              주소부터 다시 시작
            </Link>
            <Link href="/system/readiness" className="ui-btn">
              환경 점검
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const parcelLabel = data.parcel.address.split(" ").pop() ?? "";
  const crumb = makeCrumb(
    pathname,
    projectLoad?.source === "demo" ? `${parcelLabel} · 데모` : parcelLabel,
  );

  return (
    <div
      className="ui-shell app"
      style={{ height: "100vh", display: "flex", flexDirection: "column" }}
    >
      <TopBar
        crumb={crumb}
        right={
          <div className="project-topbar-tools" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {projectLoad?.source === "demo" && (
              <span
                style={{
                  padding: "3px 6px",
                  border: "1px solid var(--warn)",
                  borderRadius: 4,
                  background: "var(--warn-soft)",
                  color: "var(--warn-fg)",
                  fontSize: 10,
                  fontWeight: 650,
                }}
              >
                검증용 예시 데이터
              </span>
            )}
            <Link href="/system/readiness" style={{ color: "var(--fg-muted)", fontSize: 10 }}>
              환경 점검
            </Link>
            {projectLoad?.source !== "demo" && (
              <WorkspaceSyncBadge
                status={workspaceSync.status}
                revision={workspaceSync.record?.revision ?? 0}
                error={workspaceSync.error}
                onSave={workspaceSync.saveNow}
              />
            )}
            <SessionBadge />
          </div>
        }
      />
      {(workspaceSync.status === "conflict" ||
        workspaceSync.status === "error") && (
        <WorkspaceSyncAlert
          projectId={projectId}
          status={workspaceSync.status}
          error={workspaceSync.error}
          onRetry={workspaceSync.saveNow}
          onReload={() => {
            const confirmed = window.confirm(
              "이 탭의 저장되지 않은 변경 대신 서버 최신본을 여시겠습니까? 필요한 경우 먼저 로컬 사본을 내보내세요.",
            );
            if (confirmed) {
              workspaceSync.discardLocalDraft();
              setHydratedWorkspaceKey("");
              void refetch();
            }
          }}
        />
      )}
      <div style={{ display: "flex", minHeight: 0, flex: 1 }}>
        <WorkRail projectId={projectId} />
        <main className="scroll-host" style={{ flex: 1, minWidth: 0 }}>
          <TransactionEvidence evidence={data?.transactionEvidence} />
          {children}
        </main>
      </div>
    </div>
  );
}

async function downloadLocalWorkspace(projectId: string) {
  const payload = captureProjectWorkspace(projectId);
  if (!payload) return;
  const payloadHash = await hashProjectWorkspacePayload(payload);
  const blob = new Blob(
    [
      `${JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          payloadHash,
          payload,
        },
        null,
        2,
      )}\n`,
    ],
    { type: "application/json" },
  );
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `parcelgrid-${projectId.replace(/[^a-zA-Z0-9_-]/g, "-")}-local.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

function WorkspaceSyncAlert({
  projectId,
  status,
  error,
  onRetry,
  onReload,
}: {
  projectId: string;
  status: "conflict" | "error";
  error: string | null;
  onRetry: () => void;
  onReload: () => void;
}) {
  const conflict = status === "conflict";
  return (
    <div className="workspace-sync-alert" role="alert">
      <CloudOff size={16} aria-hidden="true" />
      <div className="workspace-sync-alert__message">
        <strong>{conflict ? "서버 저장 충돌" : "서버 저장 오류"}</strong>
        <span>
          {error ??
            (conflict
              ? "다른 사용자가 먼저 저장했습니다. 이 탭의 변경은 로컬에 유지됩니다."
              : "서버에 저장하지 못했습니다. 이 탭의 변경은 로컬에 유지됩니다.")}
        </span>
      </div>
      <div className="workspace-sync-alert__actions">
        <button
          type="button"
          className="ui-btn"
          onClick={() => void downloadLocalWorkspace(projectId)}
        >
          <Download size={14} aria-hidden="true" />
          로컬 사본
        </button>
        {conflict ? (
          <button type="button" className="ui-btn ui-btn--primary" onClick={onReload}>
            <RefreshCw size={14} aria-hidden="true" />
            서버 최신본 열기
          </button>
        ) : (
          <button type="button" className="ui-btn ui-btn--primary" onClick={onRetry}>
            <RefreshCw size={14} aria-hidden="true" />
            다시 저장
          </button>
        )}
      </div>
    </div>
  );
}

const WORKSPACE_STATUS_LABEL: Record<ProjectWorkspaceSyncStatus, string> = {
  idle: "서버 저장 대기",
  dirty: "저장할 변경 있음",
  saving: "서버 저장 중",
  saved: "서버 저장됨",
  conflict: "저장 충돌 · 로컬 유지",
  error: "저장 오류 · 로컬 유지",
  "read-only": "읽기 전용",
};

function WorkspaceSyncBadge({
  status,
  revision,
  error,
  onSave,
}: {
  status: ProjectWorkspaceSyncStatus;
  revision: number;
  error: string | null;
  onSave: () => void;
}) {
  const actionable = status === "dirty" || status === "error" || status === "idle";
  const Icon =
    status === "saving"
      ? LoaderCircle
      : status === "conflict" || status === "error"
        ? CloudOff
        : status === "saved"
          ? Cloud
          : Save;
  const label = `${WORKSPACE_STATUS_LABEL[status]}${revision > 0 ? ` · v${revision}` : ""}`;
  return (
    <div
      title={error ?? label}
      style={{ display: "flex", alignItems: "center", gap: 5 }}
    >
      <button
        type="button"
        aria-label={actionable ? "프로젝트를 지금 서버에 저장" : label}
        title={actionable ? "지금 저장" : label}
        disabled={!actionable}
        onClick={onSave}
        style={{
          width: 26,
          height: 26,
          display: "inline-grid",
          placeItems: "center",
          border: "1px solid var(--border)",
          borderRadius: 5,
          background: "var(--bg-elev)",
          color:
            status === "conflict" || status === "error"
              ? "var(--neg-fg)"
              : "var(--fg-muted)",
          cursor: actionable ? "pointer" : "default",
        }}
      >
        <Icon
          size={14}
          aria-hidden="true"
          className={status === "saving" ? "workspace-sync-spin" : undefined}
        />
      </button>
      <span
        style={{
          color:
            status === "conflict" || status === "error"
              ? "var(--neg-fg)"
              : "var(--fg-muted)",
          fontSize: 9,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </div>
  );
}

function makeCrumb(pathname: string, parcelLabel: string): string[] {
  const last = pathname.split("/").pop() ?? "";
  const map: Record<string, string> = {
    status: "현황 분석",
    envelope: "계획 스튜디오",
    comparison: "시나리오 비교",
    comps: "실거래 비교",
    overrides: "가정 편집",
    handoff: "전문가 검증·인계",
    report: "예비 보고서",
  };
  const tail = pathname.includes("/scenarios/")
    ? ["시나리오 상세"]
    : map[last]
      ? [map[last]]
      : ["사업성 검토"];
  return ["프로젝트", parcelLabel, ...tail];
}
