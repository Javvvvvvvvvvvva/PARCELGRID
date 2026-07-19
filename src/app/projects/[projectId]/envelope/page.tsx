"use client";

import "@/lib/three/guard-empty-paths";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useProjectStore } from "@/lib/stores/project-store";
import { PlanningRecommendationPanelV2 } from "@/components/planning/PlanningRecommendationPanelV2";
import { PlanningScenarioWorkspaceV4 } from "@/components/planning/PlanningScenarioWorkspaceV4";
import { PlanningGeometryContractPanel } from "@/components/planning/PlanningGeometryContractPanel";
import { PlanningSiteContextPanel } from "@/components/planning/PlanningSiteContextPanel";
import { SketchupSiteExportPanel } from "@/components/planning/SketchupSiteExportPanel";
import { CadastralRoadContextPanel } from "@/components/planning/CadastralRoadContextPanel";
import { ScenarioPlacementWorkspace } from "@/components/planning/ScenarioPlacementWorkspace";
import { ScenarioParkingWorkspace } from "@/components/planning/ScenarioParkingWorkspace";
import { ScenarioChangeWorkspace } from "@/components/planning/ScenarioChangeWorkspace";

type StudioSection = "plan" | "design" | "verify" | "context" | "export";

const STUDIO_SECTIONS: Array<{
  id: StudioSection;
  step: number;
  label: string;
  description: string;
}> = [
  {
    id: "plan",
    step: 1,
    label: "계획안",
    description: "추천안·층별 프로그램·개략 사업성",
  },
  {
    id: "design",
    step: 2,
    label: "배치·주차",
    description: "매스 위치·회전·주차·대안 비교",
  },
  {
    id: "verify",
    step: 3,
    label: "법규·도로",
    description: "기하 계약·지적 경계·도로폭 검증",
  },
  {
    id: "context",
    step: 4,
    label: "3D 컨텍스트",
    description: "주변 건물·필지·계획도로 정합 확인",
  },
  {
    id: "export",
    step: 5,
    label: "내보내기",
    description: "검증된 계획안·SketchUp 패키지",
  },
];

export default function EnvelopePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const router = useRouter();
  const representativeScenarioId = useProjectStore(
    (state) => state.representativePlanningScenarioId
  );
  const representativeGeometry = useProjectStore(
    (state) => state.representativeGeometrySnapshot
  );
  const planningScenarios = useProjectStore((state) => state.planningScenarios);
  const financeScenarios = useProjectStore((state) => state.data?.scenarios ?? []);
  const representativeScenario = planningScenarios.find(
    (scenario) =>
      scenario.id === representativeScenarioId &&
      (!scenario.projectId || scenario.projectId === projectId)
  );
  const geometryReady = Boolean(
    representativeScenarioId &&
      representativeScenario &&
      representativeGeometry &&
      representativeGeometry.projectId === projectId &&
      representativeGeometry.scenarioId === representativeScenarioId &&
      representativeGeometry.scenarioVersion === representativeScenario.version &&
      representativeGeometry.validation.status !== "fail" &&
      representativeGeometry.validation.representativeEligible
  );
  const handoffReady = Boolean(
    geometryReady &&
      financeScenarios.some((scenario) => scenario.id === representativeScenarioId)
  );
  const handoffMessage = !representativeScenarioId
    ? "대표 계획안을 먼저 확정하세요"
    : !geometryReady
      ? "대표안 Geometry 검증을 다시 확인하세요"
      : !handoffReady
        ? "대표안 사업성을 재계산하고 있습니다"
        : "대표 계획안 사업성 검토로 이동";

  const [activeSection, setActiveSection] = useState<StudioSection>("plan");
  const [visitedSections, setVisitedSections] = useState<StudioSection[]>([
    "plan",
  ]);
  const activeIndex = STUDIO_SECTIONS.findIndex(
    (section) => section.id === activeSection
  );

  const selectSection = (section: StudioSection) => {
    setActiveSection(section);
    setVisitedSections((current) =>
      current.includes(section) ? current : [...current, section]
    );
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".scroll-host")?.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    });
  };

  return (
    <div className="planning-studio-shell">
      <header className="studio-flow-header">
        <div className="studio-flow-title">
          <div>
            <span className="studio-eyebrow">STAGE 2 · PLANNING STUDIO</span>
            <h1>계획안을 만들고 검증합니다</h1>
            <p>
              계획안을 먼저 편집한 뒤 배치·법규·도로를 확인하고, 검증된 결과만
              내보내기로 전달합니다.
            </p>
          </div>
          <div className="studio-flow-actions">
            <button
              type="button"
              className="stage3-handoff"
              disabled={!handoffReady}
              title={handoffMessage}
              onClick={() => router.push(`/projects/${projectId}`)}
            >
              사업성 검토 →
            </button>
            <div className="studio-progress" aria-label="계획 스튜디오 진행 단계">
              <strong>{activeIndex + 1}</strong>
              <span>/ {STUDIO_SECTIONS.length}</span>
            </div>
          </div>
        </div>

        <nav className="studio-tabs" aria-label="계획 스튜디오 작업 단계">
          {STUDIO_SECTIONS.map((section) => {
            const active = section.id === activeSection;
            const visited = visitedSections.includes(section.id) && !active;
            return (
              <button
                key={section.id}
                type="button"
                className={active ? "active" : ""}
                aria-current={active ? "step" : undefined}
                onClick={() => selectSection(section.id)}
              >
                <span className={visited ? "step-index visited" : "step-index"}>
                  {section.step}
                </span>
                <span className="step-copy">
                  <strong>{section.label}</strong>
                  <small>{section.description}</small>
                </span>
              </button>
            );
          })}
        </nav>
      </header>

      {visitedSections.includes("plan") && (
        <section hidden={activeSection !== "plan"} className="studio-section studio-plan">
          <PlanningRecommendationPanelV2 projectId={projectId} />
          <PlanningScenarioWorkspaceV4 projectId={projectId} embedded />
          <StudioStepFooter
            nextLabel="배치·주차 검토"
            onNext={() => selectSection("design")}
          />
        </section>
      )}

      {visitedSections.includes("design") && (
        <section hidden={activeSection !== "design"} className="studio-section">
          <div className="section-intro">
            <span>STEP 2</span>
            <div>
              <h2>배치와 주차를 실제 형상에 맞춥니다</h2>
              <p>계획 매스의 위치·회전·주차 가능 대수를 조정하고 대안 간 차이를 확인합니다.</p>
            </div>
          </div>
          <ScenarioPlacementWorkspace projectId={projectId} />
          <ScenarioParkingWorkspace projectId={projectId} />
          <ScenarioChangeWorkspace projectId={projectId} />
          <StudioStepFooter
            previousLabel="계획안"
            onPrevious={() => selectSection("plan")}
            nextLabel="법규·도로 검증"
            onNext={() => selectSection("verify")}
          />
        </section>
      )}

      {visitedSections.includes("verify") && (
        <section hidden={activeSection !== "verify"} className="studio-section">
          <div className="section-intro">
            <span>STEP 3</span>
            <div>
              <h2>법규 외곽선과 도로 데이터를 검증합니다</h2>
              <p>정북일조·면적 계약·지적 도로와 계획도로의 출처를 구분해 확인합니다.</p>
            </div>
          </div>
          <div className="studio-panel-stack">
            <PlanningGeometryContractPanel projectId={projectId} />
            <CadastralRoadContextPanel projectId={projectId} />
          </div>
          <StudioStepFooter
            previousLabel="배치·주차"
            onPrevious={() => selectSection("design")}
            nextLabel="3D 컨텍스트 확인"
            onNext={() => selectSection("context")}
          />
        </section>
      )}

      {visitedSections.includes("context") && (
        <section hidden={activeSection !== "context"} className="studio-section">
          <div className="section-intro">
            <span>STEP 4</span>
            <div>
              <h2>주변 필지와 도로 관계를 3D로 확인합니다</h2>
              <p>대상 매스·인접 건물·계획도로의 위치와 최소 이격을 한 화면에서 검토합니다.</p>
            </div>
          </div>
          <div className="studio-panel-stack">
            <PlanningSiteContextPanel projectId={projectId} />
          </div>
          <StudioStepFooter
            previousLabel="법규·도로"
            onPrevious={() => selectSection("verify")}
            nextLabel="내보내기"
            onNext={() => selectSection("export")}
          />
        </section>
      )}

      {visitedSections.includes("export") && (
        <section hidden={activeSection !== "export"} className="studio-section">
          <div className="section-intro">
            <span>STEP 5</span>
            <div>
              <h2>검증된 계획안을 설계 전달용으로 내보냅니다</h2>
              <p>대표 계획안과 좌표·도로·주변 건물 데이터를 하나의 패키지로 전달합니다.</p>
            </div>
          </div>
          <div className="studio-panel-stack">
            <SketchupSiteExportPanel projectId={projectId} />
          </div>
          <StudioStepFooter
            previousLabel="3D 컨텍스트"
            onPrevious={() => selectSection("context")}
            nextLabel="사업성 검토"
            onNext={() => router.push(`/projects/${projectId}`)}
            nextDisabled={!handoffReady}
            nextTitle={handoffMessage}
          />
        </section>
      )}

      <style jsx>{`
        .planning-studio-shell {
          min-height: 100%;
          background: var(--bg);
        }
        .studio-flow-header {
          position: sticky;
          top: 0;
          z-index: 20;
          border-bottom: 1px solid var(--border);
          background: color-mix(in srgb, var(--bg) 94%, transparent);
          backdrop-filter: blur(14px);
          padding: 18px max(var(--s5), calc((100% - 1380px) / 2 + var(--s5))) 12px;
        }
        .studio-flow-title {
          display: flex;
          justify-content: space-between;
          gap: 24px;
          align-items: flex-end;
          margin-bottom: 14px;
        }
        .studio-eyebrow {
          display: block;
          margin-bottom: 5px;
          font-size: 9.5px;
          font-weight: 800;
          letter-spacing: 0.12em;
          color: var(--accent-fg);
        }
        .studio-flow-title h1 {
          margin: 0;
          font-size: clamp(19px, 2vw, 27px);
          letter-spacing: -0.035em;
        }
        .studio-flow-title p {
          margin: 6px 0 0;
          font-size: 11px;
          line-height: 1.5;
          color: var(--fg-muted);
        }
        .studio-flow-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .stage3-handoff {
          min-height: 36px;
          border: 1px solid var(--fg);
          border-radius: 9px;
          padding: 0 13px;
          background: var(--fg);
          color: var(--bg-elev);
          font-family: inherit;
          font-size: 11px;
          font-weight: 800;
          cursor: pointer;
          white-space: nowrap;
        }
        .stage3-handoff:disabled {
          border-color: var(--border);
          background: var(--bg-sunken);
          color: var(--fg-faint);
          cursor: not-allowed;
        }
        .studio-progress {
          display: flex;
          align-items: baseline;
          gap: 3px;
          color: var(--fg-faint);
          white-space: nowrap;
        }
        .studio-progress strong {
          font-size: 24px;
          color: var(--fg);
        }
        .studio-tabs {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 7px;
        }
        .studio-tabs button {
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 9px;
          border: 1px solid transparent;
          border-radius: 10px;
          padding: 8px 10px;
          background: transparent;
          color: var(--fg-muted);
          text-align: left;
          cursor: pointer;
          font-family: inherit;
        }
        .studio-tabs button:hover {
          background: var(--bg-sunken);
          color: var(--fg);
        }
        .studio-tabs button.active {
          border-color: var(--border);
          background: var(--bg-elev);
          color: var(--fg);
          box-shadow: 0 4px 16px rgba(15, 23, 42, 0.06);
        }
        .step-index {
          flex: 0 0 25px;
          width: 25px;
          height: 25px;
          display: grid;
          place-items: center;
          border-radius: 999px;
          background: var(--bg-sunken);
          font-size: 10px;
          font-weight: 800;
        }
        .active .step-index {
          background: var(--fg);
          color: var(--bg-elev);
        }
        .step-index.visited {
          background: var(--accent-soft);
          color: var(--accent-fg);
        }
        .step-copy {
          min-width: 0;
          display: grid;
          gap: 2px;
        }
        .step-copy strong {
          font-size: 11.5px;
        }
        .step-copy small {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 9px;
          color: var(--fg-faint);
        }
        .section-intro {
          max-width: 1380px;
          margin: 0 auto;
          padding: var(--s6) var(--s5) var(--s4);
          display: flex;
          gap: 12px;
          align-items: flex-start;
        }
        .section-intro > span {
          margin-top: 2px;
          border-radius: 999px;
          padding: 4px 8px;
          background: var(--accent-soft);
          color: var(--accent-fg);
          font-size: 9.5px;
          font-weight: 800;
          white-space: nowrap;
        }
        .section-intro h2 {
          margin: 0;
          font-size: 19px;
          letter-spacing: -0.025em;
        }
        .section-intro p {
          margin: 5px 0 0;
          font-size: 11px;
          line-height: 1.5;
          color: var(--fg-muted);
        }
        .studio-panel-stack {
          max-width: 1380px;
          margin: 0 auto;
          padding: 0 var(--s5);
          display: grid;
          gap: var(--s5);
        }
        @media (max-width: 980px) {
          .studio-flow-header {
            position: static;
          }
          .studio-tabs {
            grid-template-columns: repeat(5, minmax(118px, 1fr));
            overflow-x: auto;
            padding-bottom: 4px;
          }
          .step-copy small {
            display: none;
          }
        }
        @media (max-width: 620px) {
          .studio-flow-title p,
          .studio-progress {
            display: none;
          }
          .studio-flow-header {
            padding: 14px var(--s4) 10px;
          }
          .studio-tabs button {
            justify-content: center;
            padding: 8px;
          }
          .step-copy strong {
            font-size: 10.5px;
          }
          .section-intro {
            padding: var(--s5) var(--s4) var(--s3);
          }
          .studio-panel-stack {
            padding: 0 var(--s4);
          }
        }
      `}</style>
    </div>
  );
}

function StudioStepFooter({
  previousLabel,
  onPrevious,
  nextLabel,
  onNext,
  nextDisabled = false,
  nextTitle,
}: {
  previousLabel?: string;
  onPrevious?: () => void;
  nextLabel?: string;
  onNext?: () => void;
  nextDisabled?: boolean;
  nextTitle?: string;
}) {
  return (
    <div
      style={{
        maxWidth: 1380,
        margin: "0 auto",
        padding: "var(--s5) var(--s5) 80px",
        display: "flex",
        justifyContent: onPrevious ? "space-between" : "flex-end",
        gap: 10,
      }}
    >
      {onPrevious && (
        <button type="button" className="studio-flow-button secondary" onClick={onPrevious}>
          ← {previousLabel}
        </button>
      )}
      {onNext && (
        <button
          type="button"
          className="studio-flow-button"
          onClick={onNext}
          disabled={nextDisabled}
          title={nextTitle}
        >
          {nextLabel} →
        </button>
      )}
      <style jsx>{`
        .studio-flow-button {
          border: 1px solid var(--fg);
          border-radius: 9px;
          padding: 10px 14px;
          background: var(--fg);
          color: var(--bg-elev);
          font-family: inherit;
          font-size: 11.5px;
          font-weight: 700;
          cursor: pointer;
        }
        .studio-flow-button:disabled {
          border-color: var(--border);
          background: var(--bg-sunken);
          color: var(--fg-faint);
          cursor: not-allowed;
        }
        .studio-flow-button.secondary {
          border-color: var(--border);
          background: var(--bg-elev);
          color: var(--fg-muted);
        }
      `}</style>
    </div>
  );
}
