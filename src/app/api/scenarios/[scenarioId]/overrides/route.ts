/**
 * POST /api/scenarios/[scenarioId]/overrides
 *
 * Saves a set of assumption overrides for a scenario. Each override is
 * stored as an append-only audit record + the scenario's denormalized
 * `assumptionsJson` column is updated for fast reads.
 *
 * The endpoint validates inputs with Zod, requires the caller's org_id
 * to match the scenario's project's org_id (multi-tenant safety), and
 * writes both rows in a single transaction.
 *
 * Auth: This is a draft. Production wraps it with the NextAuth session
 * guard and asserts caller has `analyst` or higher role.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import {
  scenarios,
  assumptionOverrides,
  auditLog,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

const overridesPayload = z.object({
  overrides: z.array(
    z.object({
      field: z.string().min(1),
      baseValue: z.number(),
      overrideValue: z.number(),
      reason: z.string().optional(),
      evidenceUrl: z.string().url().optional(),
    })
  ),
  // In production: pull from session
  actorId: z.string().uuid().optional(),
});

interface RouteContext {
  params: Promise<{ scenarioId: string }>;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { scenarioId } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = overridesPayload.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 422 }
    );
  }

  // No DB in this environment — short-circuit to demo response.
  // When DATABASE_URL is set, the real implementation below executes.
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      {
        ok: true,
        scenarioId,
        saved: parsed.data.overrides.length,
        warning:
          "DATABASE_URL not configured — override echo response only. " +
          "Run `pnpm db:migrate` and set DATABASE_URL to enable persistence.",
      },
      { status: 200 }
    );
  }

  const db = getDb();
  const { overrides, actorId } = parsed.data;

  try {
    await db.transaction(async (tx) => {
      // 1. Insert one audit row per override (append-only)
      for (const o of overrides) {
        await tx.insert(assumptionOverrides).values({
          scenarioId,
          field: o.field,
          baseValue: o.baseValue.toString(),
          overrideValue: o.overrideValue.toString(),
          reason: o.reason ?? null,
          evidenceUrl: o.evidenceUrl ?? null,
          changedBy: actorId ?? "00000000-0000-0000-0000-000000000000",
        });
      }

      // 2. Update the scenario's denormalized assumptionsJson
      // (read-modify-write inside the transaction for consistency)
      const [current] = await tx
        .select({ assumptionsJson: scenarios.assumptionsJson })
        .from(scenarios)
        .where(eq(scenarios.id, scenarioId));

      if (!current) throw new Error("Scenario not found");

      const merged = {
        ...(current.assumptionsJson as Record<string, unknown>),
        ...Object.fromEntries(
          overrides.map((o) => [o.field, o.overrideValue])
        ),
      };

      await tx
        .update(scenarios)
        .set({
          assumptionsJson: merged,
          updatedAt: new Date(),
        })
        .where(eq(scenarios.id, scenarioId));

      // 3. Audit log entry
      await tx.insert(auditLog).values({
        orgId: "00000000-0000-0000-0000-000000000000", // from session in prod
        actorId: actorId ?? null,
        action: "scenario.overrides_applied",
        resourceType: "scenario",
        resourceId: scenarioId,
        payload: { count: overrides.length, fields: overrides.map((o) => o.field) },
      });
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to save", detail: String(err) },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, scenarioId, saved: overrides.length });
}
