"use client";

import { useRef, useState } from "react";
import {
  createProjectTransferBundle,
  detachTransferredSourceDocuments,
  parseProjectTransferBundle,
  serializeProjectTransferBundle,
} from "@/lib/handoff/project-transfer";
import { useProjectStore } from "@/lib/stores/project-store";
import { useReviewStore } from "@/lib/stores/review-store";

type TransferState =
  | { kind: "idle"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export function ProjectTransferPanel({ projectId }: { projectId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<TransferState>({
    kind: "idle",
    message: "",
  });

  const exportBundle = () => {
    const project = useProjectStore.getState();
    const review = useReviewStore.getState();
    const planningScenarios = project.planningScenarios.filter(
      (scenario) => scenario.projectId === projectId
    );
    const scenarioIds = new Set(planningScenarios.map((scenario) => scenario.id));
    const draftAssumptions = Object.fromEntries(
      Object.entries(project.draftAssumptions).filter(([scenarioId]) =>
        scenarioIds.has(scenarioId)
      )
    );
    const currentData =
      project.data?.parcel.id === projectId ? project.data : null;
    const representativeGeometry =
      project.representativeGeometrySnapshot?.projectId === projectId
        ? project.representativeGeometrySnapshot
        : null;
    const bundle = createProjectTransferBundle({
      projectId,
      payload: {
        projectData: currentData,
        envelopePlan: project.envelopePlan,
        planningScenarios,
        selectedScenarioId:
          project.selectedPlanningScenarioId &&
          scenarioIds.has(project.selectedPlanningScenarioId)
            ? project.selectedPlanningScenarioId
            : null,
        representativeScenarioId:
          project.representativePlanningScenarioId &&
          scenarioIds.has(project.representativePlanningScenarioId)
            ? project.representativePlanningScenarioId
            : null,
        representativeGeometry,
        draftAssumptions,
        draftAcquisitionPrice:
          project.draftAcquisitionPrices[projectId] ?? null,
        financialSources: project.financialSources[projectId] ?? {},
        stage3Snapshot: project.stage3FeasibilitySnapshots[projectId] ?? null,
        priceVerifications: review.priceVerifications[projectId] ?? {},
        expertReviews: review.expertReviews[projectId] ?? {},
      },
    });

    const blob = new Blob([serializeProjectTransferBundle(bundle)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `parcelgrid-${projectId}-handoff.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus({
      kind: "success",
      message: "현재 프로젝트의 인계 패키지를 저장했습니다.",
    });
  };

  const importBundle = async (file: File) => {
    const validation = parseProjectTransferBundle(
      await file.text(),
      projectId
    );
    if (!validation.valid || !validation.bundle) {
      setStatus({
        kind: "error",
        message: validation.errors.join(" "),
      });
      return;
    }
    if (
      !window.confirm(
        "현재 프로젝트의 계획·사업성 근거·전문가 검토 기록을 이 패키지 내용으로 교체할까요?"
      )
    ) {
      return;
    }

    const payload = validation.bundle.payload;
    const currentProject = useProjectStore.getState();
    const oldProjectScenarioIds = new Set(
      currentProject.planningScenarios
        .filter((scenario) => scenario.projectId === projectId)
        .map((scenario) => scenario.id)
    );
    for (const scenario of payload.planningScenarios) {
      oldProjectScenarioIds.add(scenario.id);
    }

    const nextDraftAssumptions = { ...currentProject.draftAssumptions };
    for (const scenarioId of oldProjectScenarioIds) {
      delete nextDraftAssumptions[scenarioId];
    }
    Object.assign(nextDraftAssumptions, payload.draftAssumptions);

    const nextDraftPrices = { ...currentProject.draftAcquisitionPrices };
    if (payload.draftAcquisitionPrice == null) {
      delete nextDraftPrices[projectId];
    } else {
      nextDraftPrices[projectId] = payload.draftAcquisitionPrice;
    }

    const nextFinancialSources = { ...currentProject.financialSources };
    nextFinancialSources[projectId] =
      detachTransferredSourceDocuments(payload.financialSources);

    const nextStage3Snapshots = {
      ...currentProject.stage3FeasibilitySnapshots,
    };
    if (payload.stage3Snapshot) {
      nextStage3Snapshots[projectId] = payload.stage3Snapshot;
    } else {
      delete nextStage3Snapshots[projectId];
    }

    useProjectStore.setState({
      data: payload.projectData ?? currentProject.data,
      envelopePlan: payload.envelopePlan,
      planningScenarios: [
        ...currentProject.planningScenarios.filter(
          (scenario) =>
            scenario.projectId !== projectId &&
            !oldProjectScenarioIds.has(scenario.id)
        ),
        ...payload.planningScenarios,
      ],
      selectedPlanningScenarioId: payload.selectedScenarioId,
      representativePlanningScenarioId: payload.representativeScenarioId,
      representativeGeometrySnapshot: payload.representativeGeometry,
      geometryValidationError: null,
      activeScenarioId: null,
      draftAssumptions: nextDraftAssumptions,
      draftAcquisitionPrices: nextDraftPrices,
      financialSources: nextFinancialSources,
      stage3FeasibilitySnapshots: nextStage3Snapshots,
    });

    const currentReview = useReviewStore.getState();
    useReviewStore.setState({
      priceVerifications: {
        ...currentReview.priceVerifications,
        [projectId]: payload.priceVerifications,
      },
      expertReviews: {
        ...currentReview.expertReviews,
        [projectId]: payload.expertReviews,
      },
    });

    setStatus({
      kind: "success",
      message:
        "패키지를 적용했습니다. 원문 파일은 다시 업로드해야 하며, 기존 승인은 자동으로 재검토 상태가 됩니다.",
    });
  };

  return (
    <section
      style={{
        marginBottom: 18,
        padding: 16,
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--bg-elev)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 18,
        }}
      >
        <div>
          <strong style={{ display: "block", fontSize: 13 }}>
            다른 컴퓨터로 프로젝트 인계
          </strong>
          <p
            style={{
              margin: "5px 0 0",
              maxWidth: 760,
              color: "var(--fg-muted)",
              fontSize: 10,
              lineHeight: 1.55,
            }}
          >
            계획안·검증 Geometry·사업성 저장본·가격 근거·전문가 승인을
            체크섬 JSON으로 옮깁니다. 같은 프로젝트 ID에만 적용됩니다. AI 이미지와
            원문 첨부 파일은 포함되지 않아, 가져온 뒤 원문을 다시 올리고 승인을
            갱신해야 합니다.
          </p>
        </div>
        <div style={{ display: "flex", flexShrink: 0, gap: 8 }}>
          <button type="button" onClick={exportBundle} style={buttonStyle}>
            인계 패키지 저장
          </button>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            style={buttonStyle}
          >
            패키지 가져오기
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importBundle(file);
              event.currentTarget.value = "";
            }}
          />
        </div>
      </div>
      {status.kind !== "idle" && (
        <div
          role={status.kind === "error" ? "alert" : "status"}
          style={{
            marginTop: 10,
            padding: "9px 10px",
            borderRadius: 7,
            background:
              status.kind === "error" ? "var(--neg-soft)" : "var(--pos-soft)",
            color:
              status.kind === "error" ? "var(--neg-fg)" : "var(--pos-fg)",
            fontSize: 9.5,
          }}
        >
          {status.message}
        </div>
      )}
    </section>
  );
}

const buttonStyle: React.CSSProperties = {
  minHeight: 34,
  padding: "0 11px",
  border: "1px solid var(--fg)",
  borderRadius: 7,
  background: "transparent",
  color: "var(--fg)",
  fontSize: 9.5,
  fontWeight: 700,
  cursor: "pointer",
};
