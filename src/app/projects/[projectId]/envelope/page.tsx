"use client";

import { use } from "react";
import { PlanningScenarioWorkspace } from "@/components/planning/PlanningScenarioWorkspace";

export default function EnvelopePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  return <PlanningScenarioWorkspace projectId={projectId} />;
}
