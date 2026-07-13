"use client";

import { use } from "react";
import { PlanningScenarioWorkspaceV2 } from "@/components/planning/PlanningScenarioWorkspaceV2";

export default function EnvelopePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  return <PlanningScenarioWorkspaceV2 projectId={projectId} />;
}
