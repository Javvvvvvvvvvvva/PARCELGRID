"use client";

import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import type {
  PriceVerificationRecord,
  PriceVerificationTarget,
} from "@/lib/finance/price-verification";
import type {
  ExpertReviewMap,
  ExpertReviewRecord,
} from "@/lib/handoff/review-workflow";

interface ReviewStore {
  priceVerifications: Record<
    string,
    Partial<Record<PriceVerificationTarget, PriceVerificationRecord>>
  >;
  setPriceVerification: (
    projectId: string,
    record: PriceVerificationRecord
  ) => void;
  removePriceVerification: (
    projectId: string,
    target: PriceVerificationTarget
  ) => void;

  expertReviews: Record<string, ExpertReviewMap>;
  setExpertReview: (projectId: string, record: ExpertReviewRecord) => void;
  removeExpertReview: (
    projectId: string,
    discipline: ExpertReviewRecord["discipline"]
  ) => void;
}

export const useReviewStore = create<ReviewStore>()(
  devtools(
    persist(
      (set) => ({
        priceVerifications: {},
        setPriceVerification: (projectId, record) =>
          set((state) => ({
            priceVerifications: {
              ...state.priceVerifications,
              [projectId]: {
                ...(state.priceVerifications[projectId] ?? {}),
                [record.target]: record,
              },
            },
          })),
        removePriceVerification: (projectId, target) =>
          set((state) => {
            const nextProject = {
              ...(state.priceVerifications[projectId] ?? {}),
            };
            delete nextProject[target];
            return {
              priceVerifications: {
                ...state.priceVerifications,
                [projectId]: nextProject,
              },
            };
          }),

        expertReviews: {},
        setExpertReview: (projectId, record) =>
          set((state) => ({
            expertReviews: {
              ...state.expertReviews,
              [projectId]: {
                ...(state.expertReviews[projectId] ?? {}),
                [record.discipline]: record,
              },
            },
          })),
        removeExpertReview: (projectId, discipline) =>
          set((state) => {
            const nextProject = {
              ...(state.expertReviews[projectId] ?? {}),
            };
            delete nextProject[discipline];
            return {
              expertReviews: {
                ...state.expertReviews,
                [projectId]: nextProject,
              },
            };
          }),
      }),
      { name: "parcelgrid-review-workflow" }
    )
  )
);
