"use client";

import Link from "next/link";
import {
  ArrowRight,
  Building2,
  FileCheck2,
  FlaskConical,
  MapPinned,
  Plus,
  RefreshCw,
} from "lucide-react";
import { SessionBadge } from "@/components/auth/SessionBadge";
import {
  principalHasCapability,
  useAccessSession,
} from "@/lib/hooks/use-access-session";
import { useProjectWorkspaceIndex } from "@/lib/hooks/use-project-workspace-index";
import { DEMO_PROJECT_ID } from "@/lib/seed/demo-project-meta";
import type { ProjectWorkspaceSummary } from "@/lib/workspace/project-workspace";
import styles from "./home.module.css";

export default function HomePage() {
  const session = useAccessSession();
  const workspaceIndex = useProjectWorkspaceIndex();
  const projects = workspaceIndex.data?.projects ?? [];
  const canCreate = principalHasCapability(session.data, "analysis.run");
  const representativeCount = projects.filter(
    (project) => project.representativeScenarioId,
  ).length;
  const stage3Count = projects.filter((project) => project.stage3SavedAt).length;

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="PARCELGRID 홈">
          <span className={styles.mark}>PG</span>
          <span>
            <strong>PARCELGRID</strong>
            <small>REDEVELOPMENT FEASIBILITY</small>
          </span>
        </Link>
        <nav className={styles.headerActions} aria-label="전역 작업">
          <Link href="/system/readiness" className="ui-btn">
            환경 점검
          </Link>
          {canCreate && (
            <Link href="/projects/new" className="ui-btn ui-btn--primary">
              <Plus size={15} aria-hidden="true" />
              새 부지
            </Link>
          )}
          <SessionBadge />
        </nav>
      </header>

      <main className={styles.main}>
        <section className={styles.titleRow}>
          <div>
            <p className={styles.eyebrow}>
              {session.data?.organization ?? "조직 Workspace"}
            </p>
            <h1>프로젝트</h1>
          </div>
          <button
            type="button"
            className={styles.refreshButton}
            onClick={() => void workspaceIndex.refetch()}
            disabled={workspaceIndex.isFetching}
            aria-label="프로젝트 목록 새로고침"
            title="프로젝트 목록 새로고침"
          >
            <RefreshCw
              size={16}
              aria-hidden="true"
              className={workspaceIndex.isFetching ? styles.spinning : undefined}
            />
          </button>
        </section>

        <section className={styles.summary} aria-label="프로젝트 진행 현황">
          <SummaryStat label="저장 프로젝트" value={projects.length} />
          <SummaryStat label="대표안 확정" value={representativeCount} />
          <SummaryStat label="Stage 3 저장" value={stage3Count} />
          <div className={styles.summaryNote}>
            <FileCheck2 size={15} aria-hidden="true" />
            <span>조직별 revision과 감사 해시로 저장</span>
          </div>
        </section>

        <section className={styles.workspaceSection}>
          <div className={styles.sectionHeading}>
            <div>
              <h2>최근 Workspace</h2>
              <p>마지막 저장 시각 순</p>
            </div>
          </div>

          {workspaceIndex.isLoading ? (
            <ProjectRowsSkeleton />
          ) : workspaceIndex.error ? (
            <div className={styles.errorState} role="alert">
              <strong>프로젝트 목록을 불러오지 못했습니다</strong>
              <span>
                {workspaceIndex.error instanceof Error
                  ? workspaceIndex.error.message
                  : "조직 저장소에 연결하지 못했습니다."}
              </span>
              <button
                type="button"
                className="ui-btn"
                onClick={() => void workspaceIndex.refetch()}
              >
                <RefreshCw size={14} aria-hidden="true" />
                다시 조회
              </button>
            </div>
          ) : projects.length === 0 ? (
            <div className={styles.emptyState}>
              <MapPinned size={22} aria-hidden="true" />
              <div>
                <strong>저장된 프로젝트가 없습니다</strong>
                <span>첫 부지를 분석하면 이곳에서 이어서 열 수 있습니다.</span>
              </div>
              {canCreate && (
                <Link href="/projects/new" className="ui-btn ui-btn--primary">
                  <Plus size={14} aria-hidden="true" />
                  새 부지 분석
                </Link>
              )}
            </div>
          ) : (
            <div className={styles.projectList}>
              {projects.map((project) => (
                <ProjectRow key={project.projectId} project={project} />
              ))}
            </div>
          )}
        </section>

        <section className={styles.demoSection}>
          <div>
            <span className={styles.demoIcon}>
              <FlaskConical size={16} aria-hidden="true" />
            </span>
            <div>
              <h2>검증용 회귀 프로젝트</h2>
              <p>쌍문동 고정 입력으로 계산 화면과 보고서를 확인합니다.</p>
            </div>
          </div>
          <Link href={`/projects/${DEMO_PROJECT_ID}/status`} className="ui-btn">
            데모 열기
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </section>
      </main>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.summaryStat}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function ProjectRow({ project }: { project: ProjectWorkspaceSummary }) {
  const stage = project.stage3SavedAt
    ? "Stage 3 저장"
    : project.representativeScenarioId
      ? "대표안 확정"
      : project.planningScenarioCount > 0
        ? "계획 중"
        : "현황 분석";
  return (
    <Link
      href={`/projects/${encodeURIComponent(project.projectId)}/status`}
      className={styles.projectRow}
    >
      <span className={styles.projectIcon}>
        <Building2 size={17} aria-hidden="true" />
      </span>
      <span className={styles.projectIdentity}>
        <strong>{project.address}</strong>
        <small className="mono">{project.projectId}</small>
      </span>
      <span className={styles.projectFact}>
        <small>용도지역</small>
        <strong>{project.zoning || "미확인"}</strong>
      </span>
      <span className={styles.projectFact}>
        <small>대지면적</small>
        <strong>{formatArea(project.lotAreaSqm)}</strong>
      </span>
      <span className={styles.projectFact}>
        <small>후보</small>
        <strong>{project.scenarioCount}개</strong>
      </span>
      <span
        className={styles.projectProgress}
        data-complete={Boolean(project.stage3SavedAt)}
      >
        {stage}
      </span>
      <span className={styles.projectSaved}>
        <strong>v{project.revision}</strong>
        <small>{formatSavedAt(project.savedAt)}</small>
      </span>
      <ArrowRight className={styles.projectArrow} size={16} aria-hidden="true" />
    </Link>
  );
}

function ProjectRowsSkeleton() {
  return (
    <div className={styles.projectList} aria-label="프로젝트 목록 로딩 중">
      {[0, 1, 2].map((row) => (
        <div key={row} className={`${styles.projectRow} ${styles.skeletonRow}`}>
          <span />
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

function formatArea(value: number): string {
  return `${new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 1,
  }).format(value)}㎡`;
}

function formatSavedAt(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
