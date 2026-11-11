import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authenticateSiteAccess,
  createSiteAccessToken,
  isLocalDevelopmentAccessOpen,
  isSiteAccessConfigured,
  matchesSitePassword,
  readSiteAccessToken,
  siteAccessConfiguration,
  verifySiteAccessToken,
} from "../lib/site-access";

const originalPassword = process.env.SITE_ACCESS_PASSWORD;
const originalAccounts = process.env.SITE_ACCESS_ACCOUNTS_JSON;
const originalSessionSecret = process.env.SITE_ACCESS_SESSION_SECRET;
const originalSessionHours = process.env.SITE_ACCESS_SESSION_HOURS;

beforeEach(() => {
  process.env.SITE_ACCESS_PASSWORD = "test-password-0000";
  delete process.env.SITE_ACCESS_ACCOUNTS_JSON;
  delete process.env.SITE_ACCESS_SESSION_SECRET;
  delete process.env.SITE_ACCESS_SESSION_HOURS;
});

afterEach(() => {
  if (originalPassword === undefined) {
    delete process.env.SITE_ACCESS_PASSWORD;
  } else {
    process.env.SITE_ACCESS_PASSWORD = originalPassword;
  }
  if (originalAccounts === undefined) delete process.env.SITE_ACCESS_ACCOUNTS_JSON;
  else process.env.SITE_ACCESS_ACCOUNTS_JSON = originalAccounts;
  if (originalSessionSecret === undefined) delete process.env.SITE_ACCESS_SESSION_SECRET;
  else process.env.SITE_ACCESS_SESSION_SECRET = originalSessionSecret;
  if (originalSessionHours === undefined) delete process.env.SITE_ACCESS_SESSION_HOURS;
  else process.env.SITE_ACCESS_SESSION_HOURS = originalSessionHours;
});

describe("site access gate", () => {
  it("requires a sufficiently long configured password", () => {
    expect(isSiteAccessConfigured()).toBe(true);
    process.env.SITE_ACCESS_PASSWORD = "short";
    expect(isSiteAccessConfigured()).toBe(false);
  });

  it("allows a password-free local development start but never production", () => {
    expect(
      isLocalDevelopmentAccessOpen({ NODE_ENV: "development" }),
    ).toBe(true);
    expect(
      isLocalDevelopmentAccessOpen({ NODE_ENV: "production" }),
    ).toBe(false);
  });

  it("matches only the configured password", async () => {
    await expect(matchesSitePassword("test-password-0000")).resolves.toBe(true);
    await expect(matchesSitePassword("wrong-password-0000")).resolves.toBe(false);
  });

  it("accepts a signed, unexpired access token", async () => {
    const now = Date.UTC(2026, 6, 22);
    const token = await createSiteAccessToken(now);
    await expect(verifySiteAccessToken(token, now + 1_000)).resolves.toBe(true);
    const session = await readSiteAccessToken(token, now + 1_000);
    expect(session).toMatchObject({
      email: "workspace-owner@parcelgrid.local",
      role: "owner",
    });
  });

  it("rejects expired and tampered access tokens", async () => {
    const now = Date.UTC(2026, 6, 22);
    const token = await createSiteAccessToken(now);
    await expect(
      verifySiteAccessToken(token, now + 15 * 24 * 60 * 60 * 1_000),
    ).resolves.toBe(false);
    await expect(verifySiteAccessToken(`${token}0`, now + 1_000)).resolves.toBe(false);
  });

  it("authenticates a named account and preserves its signed RBAC claims", async () => {
    delete process.env.SITE_ACCESS_PASSWORD;
    process.env.SITE_ACCESS_SESSION_SECRET = "session-secret-with-at-least-32-characters";
    const account = {
        userId: "11111111-1111-4111-8111-111111111111",
        orgId: "22222222-2222-4222-8222-222222222222",
        email: "architect@example.com",
        name: "Architect Kim",
        organization: "Example Architects",
        role: "reviewer",
        reviewerRoles: ["architect"],
        password: "architect-password-2026",
      } as const;
    process.env.SITE_ACCESS_ACCOUNTS_JSON = JSON.stringify([account]);

    const configuration = siteAccessConfiguration();
    expect(configuration).toMatchObject({
      configured: true,
      requiresEmail: true,
      accountCount: 1,
      usesDedicatedSessionSecret: true,
    });
    const principal = await authenticateSiteAccess({
      email: "ARCHITECT@example.com",
      password: "architect-password-2026",
    });
    expect(principal).toMatchObject({
      role: "reviewer",
      reviewerRoles: ["architect"],
    });
    const token = await createSiteAccessToken(principal!);
    await expect(readSiteAccessToken(token)).resolves.toMatchObject({
      userId: "11111111-1111-4111-8111-111111111111",
      orgId: "22222222-2222-4222-8222-222222222222",
      role: "reviewer",
      reviewerRoles: ["architect"],
    });
    process.env.SITE_ACCESS_ACCOUNTS_JSON = JSON.stringify([
      { ...account, role: "viewer", reviewerRoles: [] },
    ]);
    await expect(readSiteAccessToken(token)).resolves.toBeNull();
  });

  it("does not open local access when named accounts are configured", () => {
    expect(
      isLocalDevelopmentAccessOpen({
        NODE_ENV: "development",
        SITE_ACCESS_ACCOUNTS_JSON: "[]",
      }),
    ).toBe(false);
  });
});
