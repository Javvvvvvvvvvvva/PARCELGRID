import { beforeEach, describe, expect, it } from "vitest";
import {
  conceptRenderDailyLimit,
  reserveConceptRenderQuota,
  resetConceptRenderQuotaForTests,
} from "@/lib/runtime/concept-render-quota";

describe("concept render quota", () => {
  beforeEach(() => resetConceptRenderQuotaForTests());

  it("uses a safe default and bounds configured limits", () => {
    expect(conceptRenderDailyLimit({} as unknown as NodeJS.ProcessEnv)).toBe(6);
    expect(
      conceptRenderDailyLimit({
        CONCEPT_RENDER_DAILY_LIMIT: "1000",
      } as unknown as NodeJS.ProcessEnv)
    ).toBe(50);
  });

  it("blocks requests after the project daily limit and resets next day", () => {
    const environment = {
      CONCEPT_RENDER_DAILY_LIMIT: "2",
    } as unknown as NodeJS.ProcessEnv;
    const now = new Date("2026-08-21T12:00:00.000Z");

    expect(
      reserveConceptRenderQuota({ projectId: "P1", now, environment }).allowed
    ).toBe(true);
    expect(
      reserveConceptRenderQuota({ projectId: "P1", now, environment }).remaining
    ).toBe(0);
    expect(
      reserveConceptRenderQuota({ projectId: "P1", now, environment }).allowed
    ).toBe(false);
    expect(
      reserveConceptRenderQuota({
        projectId: "P1",
        now: new Date("2026-08-22T00:01:00.000Z"),
        environment,
      }).allowed
    ).toBe(true);
  });
});
