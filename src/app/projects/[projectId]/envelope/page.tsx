"use client";

import "@/lib/three/guard-empty-paths";
import { use } from "react";
import { PlanningScenarioWorkspaceV4 } from "@/components/planning/PlanningScenarioWorkspaceV4";
import { PlanningGeometryContractPanel } from "@/components/planning/PlanningGeometryContractPanel";
import { SketchupExportPackagePanel } from "@/components/planning/SketchupExportPackagePanel";
import { CadastralRoadContextPanel } from "@/components/planning/CadastralRoadContextPanel";
import { ScenarioPlacementWorkspace } from "@/components/planning/ScenarioPlacementWorkspace";
import { ScenarioParkingWorkspace } from "@/components/planning/ScenarioParkingWorkspace";
import { ScenarioChangeWorkspace } from "@/components/planning/ScenarioChangeWorkspace";

export default function EnvelopePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  return (
    <>
      <PlanningScenarioWorkspaceV4 projectId={projectId} />
      <PlanningGeometryContractPanel projectId={projectId} />
      <SketchupExportPackagePanel projectId={projectId} />
      <CadastralRoadContextPanel projectId={projectId} />
      <ScenarioPlacementWorkspace projectId={projectId} />
      <ScenarioParkingWorkspace projectId={projectId} />
      <ScenarioChangeWorkspace projectId={projectId} />
    </>
  );
}
