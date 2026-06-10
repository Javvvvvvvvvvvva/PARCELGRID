"use client";

import { useEffect } from "react";
import { useDynamicProject } from "@/lib/hooks/use-dynamic-project";
import { useProjectStore } from "@/lib/stores/project-store";
import { TopBar } from "@/components/ui/TopBar";
import { WorkRail } from "@/components/ui/WorkRail";
import { ParcelRail } from "@/components/ui/ParcelRail";
import { usePathname } from "next/navigation";

interface ProjectLayoutProps {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}

/**
 * Standalone sub-routes that bypass this layout's project hydration.
 * These pages handle their own data sources (sessionStorage, etc).
 */
const STANDALONE_SUBROUTES = ["/acquisition-check"];

export default function ProjectLayout({ children, params }: ProjectLayoutProps) {
  const pathname = usePathname();

  if (STANDALONE_SUBROUTES.some((sub) => pathname.endsWith(sub))) {
    return <>{children}</>;
  }

  return <ProjectShell params={params}>{children}</ProjectShell>;
}

function ProjectShell({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = useUnwrappedParams(params);
  const { data, isLoading, error } = useDynamicProject(projectId);
  const setData = useProjectStore((s) => s.setData);
  const pathname = usePathname();

  useEffect(() => {
    if (data) setData(data);
  }, [data, setData]);

  if (isLoading) {
    return (
      <div style={{ padding: 40, color: "var(--fg-muted)" }}>
        프로젝트 로딩 중...
      </div>
    );
  }
  if (error || !data) {
    return (
      <div style={{ padding: 40, color: "var(--neg-fg)" }}>
        오류: {String(error instanceof Error ? error.message : error)}
      </div>
    );
  }

  const crumb = makeCrumb(pathname, data.parcel.address.split(" ").pop() ?? "");

  return (
    <div className="ui-shell app" style={{ height: "100vh" }}>
      <TopBar crumb={crumb} />
      <div style={{ display: "flex", minHeight: 0, flex: 1 }}>
        <WorkRail projectId={projectId} />
        <ParcelRail parcel={data.parcel} compact={pathname.includes("/scenarios/")} />
        <main className="scroll-host" style={{ flex: 1, minWidth: 0 }}>
          {children}
        </main>
      </div>
    </div>
  );
}

function makeCrumb(pathname: string, parcelLabel: string): string[] {
  const last = pathname.split("/").pop() ?? "";
  const map: Record<string, string> = {
    comparison: "시나리오 비교",
    comps: "실거래 비교",
    overrides: "가정 편집",
    report: "투자 보고서",
  };
  const tail = pathname.includes("/scenarios/")
    ? ["시나리오 상세"]
    : map[last]
      ? [map[last]]
      : ["대시보드"];
  return ["프로젝트", parcelLabel, ...tail];
}

function useUnwrappedParams<T>(promise: Promise<T>): T {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const React = require("react") as typeof import("react");
  return React.use(promise);
}
