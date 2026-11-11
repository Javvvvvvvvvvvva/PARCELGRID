import {
  isExpertReviewerRole,
  isOrganizationRole,
  type AccessPrincipal,
} from "@/lib/auth/roles";

const ACCESS_COOKIE_NAME = "parcelgrid_access";
const ACCESS_TOKEN_VERSION = "v2";
const DEFAULT_ACCESS_DURATION_HOURS = 12;
const MAX_ACCESS_DURATION_HOURS = 24 * 7;
const LEGACY_USER_ID = "00000000-0000-4000-8000-000000000001";
const LEGACY_ORG_ID = "00000000-0000-4000-8000-000000000002";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface ConfiguredAccessAccount extends AccessPrincipal {
  password?: string;
  passwordSha256?: string;
}

interface SiteAccessTokenPayload {
  version: typeof ACCESS_TOKEN_VERSION;
  subject: string;
  organizationId: string;
  email: string;
  name: string;
  organization: string;
  role: AccessPrincipal["role"];
  reviewerRoles: AccessPrincipal["reviewerRoles"];
  issuedAt: number;
  expiresAt: number;
  sessionId: string;
}

export interface SiteAccessSession extends AccessPrincipal {
  issuedAt: number;
  expiresAt: number;
  sessionId: string;
}

export interface SiteAccessConfiguration {
  configured: boolean;
  requiresEmail: boolean;
  accountCount: number;
  usesDedicatedSessionSecret: boolean;
  errors: string[];
}

function configuredPassword(environment: NodeJS.ProcessEnv = process.env): string {
  return environment.SITE_ACCESS_PASSWORD?.trim() ?? "";
}

function signingSecret(environment: NodeJS.ProcessEnv = process.env): string {
  return (
    environment.SITE_ACCESS_SESSION_SECRET?.trim() ||
    configuredPassword(environment)
  );
}

function accessDurationHours(environment: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(environment.SITE_ACCESS_SESSION_HOURS);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_ACCESS_DURATION_HOURS) {
    return DEFAULT_ACCESS_DURATION_HOURS;
  }
  return parsed;
}

function uuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function validEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

function normalizeReviewerRoles(value: unknown): AccessPrincipal["reviewerRoles"] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isExpertReviewerRole))];
}

function parseConfiguredAccounts(
  environment: NodeJS.ProcessEnv = process.env,
): { accounts: ConfiguredAccessAccount[]; errors: string[] } {
  const raw = environment.SITE_ACCESS_ACCOUNTS_JSON?.trim();
  if (!raw) return { accounts: [], errors: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      accounts: [],
      errors: ["SITE_ACCESS_ACCOUNTS_JSON이 유효한 JSON 배열이 아닙니다."],
    };
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 100) {
    return {
      accounts: [],
      errors: ["SITE_ACCESS_ACCOUNTS_JSON에는 1~100개의 계정이 필요합니다."],
    };
  }

  const accounts: ConfiguredAccessAccount[] = [];
  const errors: string[] = [];
  const seenEmails = new Set<string>();
  for (const [index, candidate] of parsed.entries()) {
    if (!candidate || typeof candidate !== "object") {
      errors.push(`접근 계정 ${index + 1}의 형식이 올바르지 않습니다.`);
      continue;
    }
    const value = candidate as Record<string, unknown>;
    const email = typeof value.email === "string" ? value.email.trim().toLowerCase() : "";
    const name = typeof value.name === "string" ? value.name.trim() : "";
    const organization =
      typeof value.organization === "string" ? value.organization.trim() : "";
    const password =
      typeof value.password === "string" ? value.password.trim() : undefined;
    const passwordSha256 =
      typeof value.passwordSha256 === "string"
        ? value.passwordSha256.trim().toLowerCase()
        : undefined;

    if (!uuid(value.userId) || !uuid(value.orgId)) {
      errors.push(`접근 계정 ${index + 1}의 userId와 orgId는 UUID여야 합니다.`);
    }
    if (!validEmail(email) || seenEmails.has(email)) {
      errors.push(`접근 계정 ${index + 1}의 이메일이 없거나 중복됐습니다.`);
    }
    if (!name || !organization) {
      errors.push(`접근 계정 ${index + 1}의 이름과 소속이 필요합니다.`);
    }
    if (!isOrganizationRole(value.role)) {
      errors.push(`접근 계정 ${index + 1}의 조직 역할이 올바르지 않습니다.`);
    }
    if (
      (!password || password.length < 12) &&
      (!passwordSha256 || !/^[a-f0-9]{64}$/.test(passwordSha256))
    ) {
      errors.push(
        `접근 계정 ${index + 1}에는 12자 이상 비밀번호 또는 SHA-256 해시가 필요합니다.`,
      );
    }
    if (
      uuid(value.userId) &&
      uuid(value.orgId) &&
      validEmail(email) &&
      !seenEmails.has(email) &&
      name &&
      organization &&
      isOrganizationRole(value.role) &&
      ((password && password.length >= 12) ||
        (passwordSha256 && /^[a-f0-9]{64}$/.test(passwordSha256)))
    ) {
      seenEmails.add(email);
      accounts.push({
        userId: value.userId,
        orgId: value.orgId,
        email,
        name,
        organization,
        role: value.role,
        reviewerRoles: normalizeReviewerRoles(value.reviewerRoles),
        password,
        passwordSha256,
      });
    }
  }
  return { accounts: errors.length === 0 ? accounts : [], errors };
}

function legacyPrincipal(
  environment: NodeJS.ProcessEnv = process.env,
): AccessPrincipal {
  const configuredRoles = (environment.SITE_ACCESS_REVIEWER_ROLES ?? "")
    .split(",")
    .map((role) => role.trim())
    .filter(isExpertReviewerRole);
  const role = isOrganizationRole(environment.SITE_ACCESS_ROLE)
    ? environment.SITE_ACCESS_ROLE
    : "owner";
  return {
    userId: uuid(environment.SITE_ACCESS_USER_ID)
      ? environment.SITE_ACCESS_USER_ID
      : LEGACY_USER_ID,
    orgId: uuid(environment.SITE_ACCESS_ORG_ID)
      ? environment.SITE_ACCESS_ORG_ID
      : LEGACY_ORG_ID,
    email: validEmail(environment.SITE_ACCESS_EMAIL)
      ? environment.SITE_ACCESS_EMAIL.trim().toLowerCase()
      : "workspace-owner@parcelgrid.local",
    name: environment.SITE_ACCESS_NAME?.trim() || "Workspace Owner",
    organization:
      environment.SITE_ACCESS_ORGANIZATION?.trim() || "PARCELGRID Workspace",
    role,
    reviewerRoles: [...new Set(configuredRoles)],
  };
}

export function localDevelopmentPrincipal(): AccessPrincipal {
  return {
    userId: "00000000-0000-4000-8000-000000000010",
    orgId: "00000000-0000-4000-8000-000000000020",
    email: "local-owner@parcelgrid.local",
    name: "로컬 소유자",
    organization: "PARCELGRID 로컬 워크스페이스",
    role: "owner",
    reviewerRoles: [
      "architect",
      "developer",
      "cost-manager",
      "project-manager",
      "finance-specialist",
      "accountant",
      "tax-advisor",
      "insurance-underwriter",
      "risk-engineer",
      "sales-marketing",
      "licensed-broker",
    ],
  };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

async function sign(
  value: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const secret = signingSecret(environment);
  if (secret.length < 12) return "";
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function isTokenPayload(value: unknown): value is SiteAccessTokenPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    payload.version === ACCESS_TOKEN_VERSION &&
    uuid(payload.subject) &&
    uuid(payload.organizationId) &&
    validEmail(payload.email) &&
    typeof payload.name === "string" &&
    payload.name.length > 0 &&
    typeof payload.organization === "string" &&
    payload.organization.length > 0 &&
    isOrganizationRole(payload.role) &&
    Array.isArray(payload.reviewerRoles) &&
    payload.reviewerRoles.every(isExpertReviewerRole) &&
    typeof payload.issuedAt === "number" &&
    Number.isSafeInteger(payload.issuedAt) &&
    typeof payload.expiresAt === "number" &&
    Number.isSafeInteger(payload.expiresAt) &&
    typeof payload.sessionId === "string" &&
    /^[0-9a-f-]{36}$/i.test(payload.sessionId)
  );
}

export function siteAccessConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): SiteAccessConfiguration {
  const { accounts, errors } = parseConfiguredAccounts(environment);
  const password = configuredPassword(environment);
  const secret = signingSecret(environment);
  const hasCredential = accounts.length > 0 || password.length >= 12;
  if (!hasCredential && errors.length === 0) {
    errors.push("12자 이상의 사이트 비밀번호 또는 접근 계정이 필요합니다.");
  }
  if (secret.length < 12) {
    errors.push("세션 서명 비밀값이 12자보다 짧습니다.");
  }
  return {
    configured: errors.length === 0 && hasCredential && secret.length >= 12,
    requiresEmail: accounts.length > 0,
    accountCount: accounts.length,
    usesDedicatedSessionSecret:
      (environment.SITE_ACCESS_SESSION_SECRET?.trim().length ?? 0) >= 32,
    errors,
  };
}

export function isSiteAccessConfigured(): boolean {
  return siteAccessConfiguration().configured;
}

/** 로컬 개발은 env 없이 실행하되 모든 요청에 명시적인 개발 주체를 부여한다. */
export function isLocalDevelopmentAccessOpen(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const passwordLength = environment.SITE_ACCESS_PASSWORD?.trim().length ?? 0;
  const accountsConfigured = Boolean(
    environment.SITE_ACCESS_ACCOUNTS_JSON?.trim(),
  );
  return (
    environment.NODE_ENV !== "production" &&
    passwordLength < 12 &&
    !accountsConfigured
  );
}

export async function matchesSitePassword(candidate: string): Promise<boolean> {
  const expected = configuredPassword();
  if (expected.length < 12 || typeof candidate !== "string") return false;
  const [candidateHash, expectedHash] = await Promise.all([
    sha256(candidate),
    sha256(expected),
  ]);
  return constantTimeEqual(candidateHash, expectedHash);
}

export async function authenticateSiteAccess(input: {
  email?: string;
  password: string;
}): Promise<AccessPrincipal | null> {
  const { accounts } = parseConfiguredAccounts();
  if (accounts.length === 0) {
    return (await matchesSitePassword(input.password)) ? legacyPrincipal() : null;
  }

  const normalizedEmail = input.email?.trim().toLowerCase() ?? "";
  const account = accounts.find((candidate) => candidate.email === normalizedEmail);
  if (!account) {
    await sha256(input.password);
    return null;
  }
  const candidateHash = await sha256(input.password);
  const expectedHash = account.passwordSha256 ?? (await sha256(account.password ?? ""));
  if (!constantTimeEqual(candidateHash, expectedHash)) return null;
  return {
    userId: account.userId,
    orgId: account.orgId,
    email: account.email,
    name: account.name,
    organization: account.organization,
    role: account.role,
    reviewerRoles: account.reviewerRoles,
  };
}

export async function createSiteAccessToken(
  principalOrNow: AccessPrincipal | number = legacyPrincipal(),
  requestedNow = Date.now(),
): Promise<string> {
  if (!siteAccessConfiguration().configured) {
    throw new Error("Site access authentication is not configured.");
  }
  const principal =
    typeof principalOrNow === "number" ? legacyPrincipal() : principalOrNow;
  const now =
    typeof principalOrNow === "number" ? principalOrNow : requestedNow;
  const payload: SiteAccessTokenPayload = {
    version: ACCESS_TOKEN_VERSION,
    subject: principal.userId,
    organizationId: principal.orgId,
    email: principal.email,
    name: principal.name,
    organization: principal.organization,
    role: principal.role,
    reviewerRoles: [...new Set(principal.reviewerRoles)],
    issuedAt: now,
    expiresAt: now + siteAccessSessionMaxAge() * 1_000,
    sessionId: crypto.randomUUID(),
  };
  const encoded = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const signedValue = `${ACCESS_TOKEN_VERSION}.${encoded}`;
  return `${signedValue}.${await sign(signedValue)}`;
}

export async function readSiteAccessToken(
  token: string | undefined,
  now = Date.now(),
): Promise<SiteAccessSession | null> {
  if (!token || !isSiteAccessConfigured()) return null;
  const [version, encoded, providedSignature, extra] = token.split(".");
  if (
    extra !== undefined ||
    version !== ACCESS_TOKEN_VERSION ||
    !encoded ||
    !providedSignature
  ) {
    return null;
  }
  const expectedSignature = await sign(`${version}.${encoded}`);
  if (!constantTimeEqual(providedSignature, expectedSignature)) return null;

  const bytes = base64UrlToBytes(encoded);
  if (!bytes) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes));
  } catch {
    return null;
  }
  if (!isTokenPayload(parsed)) return null;
  if (
    parsed.issuedAt > now + 60_000 ||
    parsed.expiresAt <= now ||
    parsed.expiresAt <= parsed.issuedAt ||
    parsed.expiresAt - parsed.issuedAt >
      MAX_ACCESS_DURATION_HOURS * 60 * 60 * 1_000
  ) {
    return null;
  }
  const { accounts } = parseConfiguredAccounts();
  if (accounts.length > 0) {
    const activeAccount = accounts.find(
      (account) =>
        account.userId === parsed.subject &&
        account.orgId === parsed.organizationId &&
        account.email === parsed.email,
    );
    const tokenReviewerRoles = [...parsed.reviewerRoles].sort().join(",");
    const activeReviewerRoles = [...(activeAccount?.reviewerRoles ?? [])]
      .sort()
      .join(",");
    if (
      !activeAccount ||
      activeAccount.role !== parsed.role ||
      activeReviewerRoles !== tokenReviewerRoles
    ) {
      return null;
    }
  }
  return {
    userId: parsed.subject,
    orgId: parsed.organizationId,
    email: parsed.email,
    name: parsed.name,
    organization: parsed.organization,
    role: parsed.role,
    reviewerRoles: [...new Set(parsed.reviewerRoles)],
    issuedAt: parsed.issuedAt,
    expiresAt: parsed.expiresAt,
    sessionId: parsed.sessionId,
  };
}

export async function verifySiteAccessToken(
  token: string | undefined,
  now = Date.now(),
): Promise<boolean> {
  return Boolean(await readSiteAccessToken(token, now));
}

export function siteAccessSessionMaxAge(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  return accessDurationHours(environment) * 60 * 60;
}

export const siteAccessCookie = {
  name: ACCESS_COOKIE_NAME,
} as const;
