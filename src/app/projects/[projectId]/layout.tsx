"use client";

import { useEffect, useRef } from "react";
import { useDynamicProject } from "@/lib/hooks/use-dynamic-project";
import { useProjectStore } from "@/lib/stores/project-store";
import { recomputeFromEnvelope } from "@/lib/services/recompute-from-envelope";
import { recomputeFromPlanningScenarios } from "@/lib/services/recompute-from-planning-scenarios";
import { TopBar } from "@/components/ui/TopBar";
import { WorkRail } from "@/components/ui/WorkRail";
import { usePathname } from "next/navigation";

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
  const { projectId } = useUnwrappedParams(params);
  const { data, isLoading, error } = useDynamicProject(projectId);
  const setData = useProjectStore((s) => s.setData);
  const envelopePlan = useProjectStore((s) => s.envelopePlan);
  const planningScenarios = useProjectStore((s) => s.planningScenarios);
  const representativePlanningScenarioId = useProjectStore(
    (s) => s.representativePlanningScenarioId
  );
  const pathname = usePathname();
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
    representativePlanningScenarioId,
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
      <div style={{ padding: 40, color: "var(--neg-fg)" }}>
        오류: {String(error instanceof Error ? error.message : error)}
      </div>
    );
  }

  const crumb = makeCrumb(pathname, data.parcel.address.split(" ").pop() ?? "");

  return (
    <div className="ui-shell app" style={{ height: "100vh" }}>
      <TopBar crumb={crumb} />
      <div style={{ display: "flex", minHeight: 0, flex: 1 }}>
        <WorkRail projectId={projectId} />
        <main className="scroll-host" style={{ flex: 1, minWidth: 0 }}>
          {children}
        </main>
      </div>
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

function useUnwrappedParams<T>(promise: Promise<T>): T {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const React = require("react") as typeof import("react");
  return React.use(promise);
}
