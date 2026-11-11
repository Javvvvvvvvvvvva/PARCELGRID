import { NextResponse } from "next/server";
import { buildDemoProject } from "@/lib/seed/demo-project";
import { DEMO_PROJECT_ID } from "@/lib/seed/demo-project-meta";
import { requireApiCapability } from "@/lib/auth/request";

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

export async function GET(request: Request, context: ProjectRouteContext) {
  const authorization = await requireApiCapability(request, "project.read");
  if (!authorization.ok) return authorization.response;
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
