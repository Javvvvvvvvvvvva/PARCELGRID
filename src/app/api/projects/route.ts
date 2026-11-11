import { NextResponse } from "next/server";
import { requireApiCapability } from "@/lib/auth/request";
import {
  PROJECT_WORKSPACE_INDEX_VERSION,
  projectWorkspaceSummary,
} from "@/lib/workspace/project-workspace";
import {
  listProjectWorkspaces,
  ProjectWorkspaceIntegrityError,
} from "@/lib/workspace/project-workspace-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requireApiCapability(request, "project.read");
  if (!authorization.ok) return authorization.response;

  try {
    const records = await listProjectWorkspaces({
      orgId: authorization.principal.orgId,
    });
    return NextResponse.json(
      {
        version: PROJECT_WORKSPACE_INDEX_VERSION,
        projects: records.map(projectWorkspaceSummary),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("project workspace index read failed", error);
    return NextResponse.json(
      {
        code: "PROJECT_WORKSPACE_INDEX_UNAVAILABLE",
        error:
          error instanceof ProjectWorkspaceIntegrityError
            ? error.message
            : "조직 프로젝트 목록을 읽지 못했습니다.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
