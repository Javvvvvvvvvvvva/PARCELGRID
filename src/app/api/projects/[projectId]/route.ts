import { NextResponse } from "next/server";
import { buildDemoProject } from "@/lib/seed/demo-project";
import { DEMO_PROJECT_ID } from "@/lib/seed/demo-project-meta";

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

export async function GET(_request: Request, context: ProjectRouteContext) {
  const { projectId } = await context.params;
  if (projectId !== DEMO_PROJECT_ID) {
    return NextResponse.json(
      { code: "PROJECT_NOT_FOUND", error: "프로젝트를 찾을 수 없습니다." },
      { status: 404 },
    );
  }

  return NextResponse.json(buildDemoProject(), {
    headers: { "Cache-Control": "no-store" },
  });
}
