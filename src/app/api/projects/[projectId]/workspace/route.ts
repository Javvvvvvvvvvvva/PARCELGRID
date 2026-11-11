import { NextRequest, NextResponse } from "next/server";
import { requireApiCapability } from "@/lib/auth/request";
import { readJsonObject } from "@/lib/http/json-request";
import { MAX_PROJECT_WORKSPACE_BYTES } from "@/lib/workspace/project-workspace";
import {
  ProjectWorkspaceConflictError,
  ProjectWorkspaceIntegrityError,
  readProjectWorkspace,
  saveProjectWorkspace,
} from "@/lib/workspace/project-workspace-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

function workspaceResponse(
  record: NonNullable<Awaited<ReturnType<typeof readProjectWorkspace>>>,
  status = 200,
) {
  return NextResponse.json(record, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      ETag: `"${record.payloadHash}"`,
      "X-Workspace-Revision": String(record.revision),
    },
  });
}

export async function GET(request: NextRequest, context: RouteContext) {
  const authorization = await requireApiCapability(request, "project.read");
  if (!authorization.ok) return authorization.response;
  const { projectId } = await context.params;
  try {
    const record = await readProjectWorkspace({
      orgId: authorization.principal.orgId,
      projectId,
    });
    if (!record) {
      return NextResponse.json(
        {
          code: "PROJECT_WORKSPACE_NOT_FOUND",
          error: "이 조직에 저장된 프로젝트 Workspace가 없습니다.",
        },
        { status: 404, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return workspaceResponse(record);
  } catch (error) {
    console.error("project workspace read failed", error);
    return NextResponse.json(
      {
        code: "PROJECT_WORKSPACE_UNAVAILABLE",
        error:
          error instanceof ProjectWorkspaceIntegrityError
            ? error.message
            : "프로젝트 Workspace를 읽지 못했습니다.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const authorization = await requireApiCapability(request, "project.update");
  if (!authorization.ok) return authorization.response;
  const { projectId } = await context.params;
  const input = await readJsonObject(request, { maxBytes: MAX_PROJECT_WORKSPACE_BYTES + 100_000,
    maxNodes: 500_000, tooLargeCode: "PROJECT_WORKSPACE_TOO_LARGE" });
  if (!input.ok) return input.response;
  const body = input.value;
  if (
    !body ||
    !Number.isSafeInteger(body.baseRevision) ||
    Number(body.baseRevision) < 0
  ) {
    return NextResponse.json(
      {
        code: "INVALID_WORKSPACE_REVISION",
        error: "0 이상의 현재 Workspace revision이 필요합니다.",
      },
      { status: 422 },
    );
  }

  try {
    const record = await saveProjectWorkspace({
      principal: authorization.principal,
      projectId,
      baseRevision: Number(body.baseRevision),
      payload: body.payload,
    });
    return workspaceResponse(record, record.revision === 1 ? 201 : 200);
  } catch (error) {
    if (error instanceof ProjectWorkspaceConflictError) {
      return NextResponse.json(
        {
          code: "PROJECT_WORKSPACE_CONFLICT",
          error: error.message,
          currentRevision: error.currentRevision,
          currentPayloadHash: error.currentPayloadHash,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    console.error("project workspace save failed", error);
    return NextResponse.json(
      {
        code:
          error instanceof ProjectWorkspaceIntegrityError
            ? "INVALID_PROJECT_WORKSPACE"
            : "PROJECT_WORKSPACE_SAVE_FAILED",
        error:
          error instanceof ProjectWorkspaceIntegrityError
            ? error.message
            : "프로젝트 Workspace와 감사 이벤트를 저장하지 못했습니다.",
      },
      {
        status: error instanceof ProjectWorkspaceIntegrityError ? 422 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
