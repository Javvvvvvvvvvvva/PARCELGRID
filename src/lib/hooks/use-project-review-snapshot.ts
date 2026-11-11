"use client";

import { sessionFetch as fetch } from "@/lib/auth/client-session";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReviewSnapshotPayload } from "@/lib/handoff/review-snapshot";
import type { ReviewVerificationResult } from "@/lib/handoff/review-verification-task";

export interface ProjectReviewSnapshotMetadata {
  sealed: true;
  snapshotKey: string;
  byteLength: number;
  snapshotVersion: string;
  projectId: string;
  representativeScenarioId: string;
  representativeScenarioVersion: number;
  geometryHash: string;
  calculationModelVersion: string;
  sealedAt: string;
  sealedBy: string;
  auditHash: string;
  ledger: {
    backend: "postgresql" | "local-append-only";
    integrity: {
      valid: boolean;
      eventCount: number;
      lastHash: string;
      errors: string[];
    };
  };
}

interface UnsealedReviewSnapshot {
  sealed: false;
  snapshotKey: string;
}

type ReviewSnapshotStatus =
  | ProjectReviewSnapshotMetadata
  | UnsealedReviewSnapshot;

async function readSnapshotStatus(
  projectId: string,
  snapshotKey: string,
): Promise<ReviewSnapshotStatus> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/review-snapshots?snapshotKey=${encodeURIComponent(snapshotKey)}`,
    { cache: "no-store", credentials: "same-origin" },
  );
  const result = (await response.json().catch(() => null)) as
    | (Partial<ProjectReviewSnapshotMetadata> & {
        sealed?: boolean;
        error?: string;
      })
    | null;
  if (response.status === 404) return { sealed: false, snapshotKey };
  if (!response.ok || result?.sealed !== true || !result.snapshotKey) {
    throw new Error(result?.error ?? "서버 검토 Snapshot 상태를 확인하지 못했습니다.");
  }
  return result as ProjectReviewSnapshotMetadata;
}

async function sealSnapshot(
  projectId: string,
  snapshot: ReviewSnapshotPayload,
): Promise<ProjectReviewSnapshotMetadata> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/review-snapshots`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot }),
    },
  );
  const result = (await response.json().catch(() => null)) as
    | (Partial<ProjectReviewSnapshotMetadata> & { error?: string })
    | null;
  if (!response.ok || result?.sealed !== true || !result.snapshotKey) {
    throw new Error(result?.error ?? "현재 검토 Snapshot을 서버에 봉인하지 못했습니다.");
  }
  return result as ProjectReviewSnapshotMetadata;
}

export function useProjectReviewSnapshot(
  projectId: string,
  verification: ReviewVerificationResult | null,
) {
  const queryClient = useQueryClient();
  const prepared = verification?.kind === "saved" && verification.payload.projectId === projectId ? verification : null;
  const payload = prepared?.payload ?? null;
  const currentKey = prepared?.snapshotKey ?? null;

  const queryKey = ["project-review-snapshot", projectId, currentKey] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => readSnapshotStatus(projectId, currentKey!),
    enabled: Boolean(projectId && currentKey),
  });
  const seal = useMutation({
    mutationFn: async () => {
      if (!payload || !currentKey) {
        throw new Error("현재 대표안과 일치하는 검토 Snapshot이 없습니다.");
      }
      const result = await sealSnapshot(projectId, payload);
      if (result.snapshotKey !== currentKey) {
        throw new Error("서버 봉인 키가 현재 계산의 SHA-256과 일치하지 않습니다.");
      }
      return result;
    },
    onSuccess: (result) => {
      queryClient.setQueryData(["project-review-snapshot", result.projectId, result.snapshotKey], result);
      void queryClient.invalidateQueries({
        queryKey: ["project-review-ledger", projectId],
      });
    },
  });
  const metadata: ProjectReviewSnapshotMetadata | null =
    query.data?.sealed === true &&
    query.data.snapshotKey === currentKey &&
    query.data.ledger.integrity.valid
      ? query.data
      : null;
  const sealed = metadata !== null;

  return {
    currentKey,
    sealed,
    metadata,
    query,
    seal,
  };
}
