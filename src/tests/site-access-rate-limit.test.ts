import { afterEach, describe, expect, it } from "vitest";
import {
  clearSiteAccessAttempts,
  reserveSiteAccessAttempt,
  resetSiteAccessAttemptsForTests,
  siteAccessAttemptLimit,
  siteAccessWindowMinutes,
} from "@/lib/runtime/site-access-rate-limit";

afterEach(() => resetSiteAccessAttemptsForTests());

describe("site access rate limit", () => {
  it("blocks attempts after the configured limit", () => {
    const environment = {
      SITE_ACCESS_ATTEMPT_LIMIT: "2",
      SITE_ACCESS_WINDOW_MINUTES: "15",
    } as unknown as NodeJS.ProcessEnv;
    const now = new Date("2026-08-21T00:00:00.000Z");

    expect(
      reserveSiteAccessAttempt({ identity: "client-a", now, environment })
        .allowed
    ).toBe(true);
    expect(
      reserveSiteAccessAttempt({ identity: "client-a", now, environment })
        .allowed
    ).toBe(true);
    const blocked = reserveSiteAccessAttempt({
      identity: "client-a",
      now,
      environment,
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("opens a new window after the configured duration", () => {
    const environment = {
      SITE_ACCESS_ATTEMPT_LIMIT: "1",
      SITE_ACCESS_WINDOW_MINUTES: "5",
    } as unknown as NodeJS.ProcessEnv;

    reserveSiteAccessAttempt({
      identity: "client-a",
      now: new Date("2026-08-21T00:00:00.000Z"),
      environment,
    });
    expect(
      reserveSiteAccessAttempt({
        identity: "client-a",
        now: new Date("2026-08-21T00:04:59.000Z"),
        environment,
      }).allowed
    ).toBe(false);
    expect(
      reserveSiteAccessAttempt({
        identity: "client-a",
        now: new Date("2026-08-21T00:05:00.000Z"),
        environment,
      }).allowed
    ).toBe(true);
  });

  it("clears failures after a successful login", () => {
    const environment = {
      SITE_ACCESS_ATTEMPT_LIMIT: "1",
    } as unknown as NodeJS.ProcessEnv;
    const now = new Date("2026-08-21T00:00:00.000Z");
    reserveSiteAccessAttempt({
      identity: "client-a",
      now,
      environment,
    });
    clearSiteAccessAttempts("client-a");

    expect(
      reserveSiteAccessAttempt({
        identity: "client-a",
        now,
        environment,
      }).allowed
    ).toBe(true);
  });

  it("bounds invalid environment configuration", () => {
    const environment = {
      SITE_ACCESS_ATTEMPT_LIMIT: "999",
      SITE_ACCESS_WINDOW_MINUTES: "0",
    } as unknown as NodeJS.ProcessEnv;

    expect(siteAccessAttemptLimit(environment)).toBe(50);
    expect(siteAccessWindowMinutes(environment)).toBe(15);
  });
});
