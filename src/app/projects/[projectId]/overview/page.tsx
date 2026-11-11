"use client";
import { use } from "react";
import { ProjectSummary } from "@/components/workspace/ProjectSummary";
export default function ProjectOverviewPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  return <ProjectSummary projectId={projectId} />;
}
