/**
 * Applies assumption overrides with authenticated identity, organization scope,
 * optimistic concurrency and an append-only audit event.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  assumptionOverrides,
  orgs,
  projects,
  scenarios,
  users,
} from "@/lib/db/schema";
import { ASSUMPTION_META } from "@/lib/finance/scenario";
import { requireApiCapability } from "@/lib/auth/request";
import { JSON_REQUEST_LIMITS, readJsonObject } from "@/lib/http/json-request";
import {
  can,
  isExpertReviewerRole,
  isOrganizationRole,
  type AccessPrincipal,
} from "@/lib/auth/roles";
import {
  appendAuditEvent,
  appendAuditEventInTransaction,
} from "@/lib/audit/audit-ledger";

export const runtime = "nodejs";

const overridesPayload = z.object({
  overrides: z
    .array(
      z.object({
        field: z.string().trim().min(1).max(100),
        baseValue: z.number().finite(),
        overrideValue: z.number().finite(),
        reason: z.string().trim().min(3).max(2_000),
        evidenceUrl: z.string().url().max(2_000).optional(),
      }),
    )
    .min(1)
    .max(100),
});

interface RouteContext {
  params: Promise<{ scenarioId: string }>;
}

class ScenarioNotFoundError extends Error {}
class MembershipDeniedError extends Error {}
class OverrideConflictError extends Error {}

function isKnownAssumptionField(field: string): boolean {
  return Object.prototype.hasOwnProperty.call(ASSUMPTION_META, field);
}

function sameNumericValue(left: unknown, right: number): boolean {
  return (
    typeof left === "number" &&
    Number.isFinite(left) &&
    Math.abs(left - right) <= Math.max(1, Math.abs(right)) * 1e-10
  );
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const authorization = await requireApiCapability(req, "scenario.override");
  if (!authorization.ok) return authorization.response;
  const { scenarioId } = await ctx.params;

  const input = await readJsonObject(req, { maxBytes: JSON_REQUEST_LIMITS.override });
  if (!input.ok) return input.response;
  const parsed = overridesPayload.safeParse(input.value);
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: "INVALID_OVERRIDE_INPUT",
        error: "가정 변경값과 변경 사유를 확인하세요.",
        details: parsed.error.flatten(),
      },
      { status: 422 },
    );
  }
  const unknownFields = parsed.data.overrides
    .map((override) => override.field)
    .filter((field) => !isKnownAssumptionField(field));
  if (unknownFields.length > 0) {
    return NextResponse.json(
      {
        code: "UNKNOWN_ASSUMPTION_FIELD",
        error: `지원하지 않는 가정 항목입니다: ${[...new Set(unknownFields)].join(", ")}`,
      },
      { status: 422 },
    );
  }

  const { overrides } = parsed.data;
  if (!process.env.DATABASE_URL?.trim()) {
    const event = await appendAuditEvent({
      principal: authorization.principal,
      action: "scenario.overrides_recorded_local",
      resourceType: "scenario",
      resourceId: scenarioId,
      payload: {
        scenarioId,
        persistence: "client-state-only",
        overrides,
      },
    });
    return NextResponse.json({
      ok: true,
      scenarioId,
      saved: overrides.length,
      persistence: "client-state-only",
      auditHash: event.entryHash,
      warning:
        "DATABASE_URL이 없어 서버 시나리오는 변경하지 않고 로컬 감사 원장에 변경 의도만 기록했습니다.",
    });
  }

  const db = getDb();
  try {
    const result = await db.transaction(async (tx) => {
      const [membership] = await tx
        .select({
          userId: users.id,
          orgId: users.orgId,
          email: users.email,
          name: users.name,
          role: users.role,
          reviewerRoles: users.reviewerRolesJson,
          organization: orgs.name,
        })
        .from(users)
        .innerJoin(orgs, eq(orgs.id, users.orgId))
        .where(
          and(
            eq(users.id, authorization.principal.userId),
            eq(users.orgId, authorization.principal.orgId),
            isNull(users.disabledAt),
          ),
        )
        .limit(1);
      if (!membership || !isOrganizationRole(membership.role)) {
        throw new MembershipDeniedError();
      }
      const livePrincipal: AccessPrincipal = {
        userId: membership.userId,
        orgId: membership.orgId,
        email: membership.email,
        name: membership.name?.trim() || membership.email,
        organization: membership.organization,
        role: membership.role,
        reviewerRoles: Array.isArray(membership.reviewerRoles)
          ? membership.reviewerRoles.filter(isExpertReviewerRole)
          : [],
      };
      if (!can(livePrincipal, "scenario.override")) {
        throw new MembershipDeniedError();
      }

      const [current] = await tx
        .select({
          projectId: projects.id,
          assumptionsJson: scenarios.assumptionsJson,
        })
        .from(scenarios)
        .innerJoin(projects, eq(projects.id, scenarios.projectId))
        .where(
          and(
            eq(scenarios.id, scenarioId),
            eq(projects.orgId, livePrincipal.orgId),
            isNull(projects.deletedAt),
          ),
        )
        .limit(1);
      if (!current) throw new ScenarioNotFoundError();

      const assumptions = current.assumptionsJson as Record<string, unknown>;
      for (const override of overrides) {
        if (!sameNumericValue(assumptions[override.field], override.baseValue)) {
          throw new OverrideConflictError();
        }
      }
      const merged = {
        ...assumptions,
        ...Object.fromEntries(
          overrides.map((override) => [override.field, override.overrideValue]),
        ),
      };

      for (const override of overrides) {
        await tx.insert(assumptionOverrides).values({
          scenarioId,
          field: override.field,
          baseValue: override.baseValue.toString(),
          overrideValue: override.overrideValue.toString(),
          reason: override.reason,
          evidenceUrl: override.evidenceUrl ?? null,
          changedBy: livePrincipal.userId,
        });
      }
      await tx
        .update(scenarios)
        .set({ assumptionsJson: merged, updatedAt: new Date() })
        .where(eq(scenarios.id, scenarioId));
      const event = await appendAuditEventInTransaction(tx, {
        principal: livePrincipal,
        action: "scenario.overrides_applied",
        resourceType: "scenario",
        resourceId: scenarioId,
        payload: {
          projectId: current.projectId,
          scenarioId,
          overrides,
        },
      });
      return { event, principal: livePrincipal };
    });

    return NextResponse.json({
      ok: true,
      scenarioId,
      saved: overrides.length,
      persistence: "postgresql",
      auditHash: result.event.entryHash,
    });
  } catch (error) {
    if (error instanceof MembershipDeniedError) {
      return NextResponse.json(
        {
          code: "MEMBERSHIP_FORBIDDEN",
          error: "활성 조직 멤버십과 수정 권한을 확인할 수 없습니다.",
        },
        { status: 403 },
      );
    }
    if (error instanceof ScenarioNotFoundError) {
      return NextResponse.json(
        {
          code: "SCENARIO_NOT_FOUND",
          error: "이 조직에서 접근 가능한 시나리오를 찾을 수 없습니다.",
        },
        { status: 404 },
      );
    }
    if (error instanceof OverrideConflictError) {
      return NextResponse.json(
        {
          code: "OVERRIDE_CONFLICT",
          error: "기준 가정이 이미 변경됐습니다. 최신 시나리오를 다시 불러오세요.",
        },
        { status: 409 },
      );
    }
    console.error("scenario override transaction failed", error);
    return NextResponse.json(
      {
        code: "OVERRIDE_SAVE_FAILED",
        error: "가정 변경과 감사 이벤트를 같은 트랜잭션에 저장하지 못했습니다.",
      },
      { status: 500 },
    );
  }
}
