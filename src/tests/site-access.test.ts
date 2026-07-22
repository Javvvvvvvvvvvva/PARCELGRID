import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSiteAccessToken,
  isSiteAccessConfigured,
  matchesSitePassword,
  verifySiteAccessToken,
} from "../lib/site-access";

const originalPassword = process.env.SITE_ACCESS_PASSWORD;

beforeEach(() => {
  process.env.SITE_ACCESS_PASSWORD = "test-password-0000";
});

afterEach(() => {
  if (originalPassword === undefined) {
    delete process.env.SITE_ACCESS_PASSWORD;
  } else {
    process.env.SITE_ACCESS_PASSWORD = originalPassword;
  }
});

describe("site access gate", () => {
  it("requires a sufficiently long configured password", () => {
    expect(isSiteAccessConfigured()).toBe(true);
    process.env.SITE_ACCESS_PASSWORD = "short";
    expect(isSiteAccessConfigured()).toBe(false);
  });

  it("matches only the configured password", async () => {
    await expect(matchesSitePassword("test-password-0000")).resolves.toBe(true);
    await expect(matchesSitePassword("wrong-password-0000")).resolves.toBe(false);
  });

  it("accepts a signed, unexpired access token", async () => {
    const now = Date.UTC(2026, 6, 22);
    const token = await createSiteAccessToken(now);
    await expect(verifySiteAccessToken(token, now + 1_000)).resolves.toBe(true);
  });

  it("rejects expired and tampered access tokens", async () => {
    const now = Date.UTC(2026, 6, 22);
    const token = await createSiteAccessToken(now);
    await expect(
      verifySiteAccessToken(token, now + 15 * 24 * 60 * 60 * 1_000),
    ).resolves.toBe(false);
    await expect(verifySiteAccessToken(`${token}0`, now + 1_000)).resolves.toBe(false);
  });
});
