"use client";

import { sessionFetch as fetch } from "@/lib/auth/client-session";

import { useQuery } from "@tanstack/react-query";
import {
  validateProjectWorkspaceIndex,
  type ProjectWorkspaceIndex,
} from "@/lib/workspace/project-workspace";

async function loadProjectWorkspaceIndex(): Promise<ProjectWorkspaceIndex> {
  const response = await fetch("/api/projects", {
    cache: "no-store",
    credentials: "same-origin",
  });
  const body = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;
  if (!response.ok) {
    throw new Error(body?.error ?? `프로젝트 목록 조회 실패 (${response.status})`);
  }
  const validation = validateProjectWorkspaceIndex(body);
  if (!validation.valid || !validation.index) {
    throw new Error(validation.errors.join(" "));
  }
  return validation.index;
}

export function useProjectWorkspaceIndex() {
  return useQuery({
    queryKey: ["project-workspace-index"],
    queryFn: loadProjectWorkspaceIndex,
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
