"use client";

import { sessionFetch as fetch } from "@/lib/auth/client-session";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HandoffDiscipline } from "@/lib/handoff/evidence-gate";
import type {
  ExpertReviewAttestations,
  ExpertReviewMap,
  ExpertReviewerRole,
  ExpertReviewStatus,
} from "@/lib/handoff/review-workflow";
import { useReviewStore } from "@/lib/stores/review-store";

export interface ProjectReviewLedgerResponse {
  reviews: ExpertReviewMap;
  ledger: {
    backend: "postgresql" | "local-append-only";
    integrity: {
      valid: boolean;
      eventCount: number;
      lastHash: string;
      errors: string[];
    };
    reviewEventCount: number;
  };
}

export interface ProjectReviewTransitionRequest {
  discipline: HandoffDiscipline;
  status: Exclude<ExpertReviewStatus, "not-requested">;
  snapshotKey: string;
  reviewerRole?: ExpertReviewerRole;
  evidenceRef?: string;
  notes?: string;
  attestations?: Partial<ExpertReviewAttestations>;
}

async function readProjectReviews(
  projectId: string,
): Promise<ProjectReviewLedgerResponse> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/reviews`, {
    cache: "no-store",
    credentials: "same-origin",
  });
  const result = (await response.json().catch(() => null)) as
    | (Partial<ProjectReviewLedgerResponse> & { error?: string })
    | null;
  if (!response.ok || !result?.reviews || !result.ledger) {
    throw new Error(result?.error ?? "검토 감사 원장을 불러오지 못했습니다.");
  }
  return result as ProjectReviewLedgerResponse;
}

async function appendProjectReview(
  projectId: string,
  request: ProjectReviewTransitionRequest,
): Promise<ProjectReviewLedgerResponse> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/reviews`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const result = (await response.json().catch(() => null)) as
    | (Partial<ProjectReviewLedgerResponse> & { error?: string })
    | null;
  if (!response.ok || !result?.reviews || !result.ledger) {
    throw new Error(result?.error ?? "검토 이벤트를 기록하지 못했습니다.");
  }
  return result as ProjectReviewLedgerResponse;
}

export function useProjectReviewLedger(projectId: string) {
  const queryClient = useQueryClient();
  const replaceExpertReviews = useReviewStore(
    (state) => state.replaceExpertReviews,
  );
  const queryKey = ["project-review-ledger", projectId] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => readProjectReviews(projectId),
    enabled: Boolean(projectId),
  });
  useEffect(() => {
    if (query.data?.reviews) {
      replaceExpertReviews(projectId, query.data.reviews);
    }
  }, [projectId, query.data?.reviews, replaceExpertReviews]);

  const transition = useMutation({
    mutationFn: (request: ProjectReviewTransitionRequest) =>
      appendProjectReview(projectId, request),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKey, result);
      replaceExpertReviews(projectId, result.reviews);
    },
  });
  return { query, transition };
}
