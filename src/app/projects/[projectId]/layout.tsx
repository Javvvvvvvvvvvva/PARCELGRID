"use client";

import { use, useEffect, useRef } from "react";
import { useDynamicProject } from "@/lib/hooks/use-dynamic-project";
import { useProjectStore } from "@/lib/stores/project-store";
import { recomputeFromEnvelope } from "@/lib/services/recompute-from-envelope";
import { recomputeFromPlanningScenarios } from "@/lib/services/recompute-from-planning-scenarios";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { usePathname } from "next/navigation";
import Link from "next/link";

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

  if (STANDALONE_SUBROUTES.some((sub) => pathname.endsWith(sub))) {
    return <>{children}</>;
  }

  return <ProjectShell params={params}>{children}</ProjectShell>;
}

function ProjectShell({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const { data, isLoading, error, refetch, isFetching } = useDynamicProject(projectId);
  const setData = useProjectStore((s) => s.setData);
  const envelopePlan = useProjectStore((s) => s.envelopePlan);
  const planningScenarios = useProjectStore((s) => s.planningScenarios);
  const representativePlanningScenarioId = useProjectStore(
    (s) => s.representativePlanningScenarioId
  );
  const representativeGeometrySnapshot = useProjectStore(
    (s) => s.representativeGeometrySnapshot
  );
  const savedStage3Snapshot = useProjectStore(
    (s) => s.stage3FeasibilitySnapshots[projectId]
  );
  const lastKeyRef = useRef<string>("");
  useEffect(() => {
    if (!data) return;

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
        savedStage3Snapshot.representativeScenarioId ===
          representativePlanningScenarioId &&
        savedStage3Snapshot.representativeScenarioVersion ===
          representativeScenario.version &&
        savedStage3Snapshot.geometryHash ===
          representativeGeometrySnapshot?.geometryHash;
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
      const key = `${data.meta?.lastSyncedAt ?? ""}|planning|${representativePlanningScenarioId}|${planningVersionKey}`;
      if (lastKeyRef.current === key) return;
      lastKeyRef.current = key;

      const recomputed = recomputeFromPlanningScenarios(
        data.parcel,
        projectPlanningScenarios,
        representativePlanningScenarioId,
        data
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
    projectId,
    representativeGeometrySnapshot,
    representativePlanningScenarioId,
    savedStage3Snapshot,
    setData,
  ]);

  if (isLoading) {
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

  return (
    <WorkspaceShell projectId={projectId} address={data.parcel.address}>
      {children}
    </WorkspaceShell>
  );
}
