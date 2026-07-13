"use client";

import { use } from "react";
import { PlanningScenarioWorkspaceV3 } from "@/components/planning/PlanningScenarioWorkspaceV3";
import { ScenarioChangeWorkspace } from "@/components/planning/ScenarioChangeWorkspace";

export default function EnvelopePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  return (
    <>
      <PlanningScenarioWorkspaceV3 projectId={projectId} />
      <ScenarioChangeWorkspace projectId={projectId} />
    </>
  );
}
