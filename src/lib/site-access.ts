const ACCESS_COOKIE_NAME = "parcelgrid_access";
const ACCESS_TOKEN_VERSION = "v1";
const ACCESS_DURATION_SECONDS = 60 * 60 * 24 * 14;

const encoder = new TextEncoder();

function configuredPassword(): string {
  return process.env.SITE_ACCESS_PASSWORD?.trim() ?? "";
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
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

async function sign(value: string): Promise<string> {
  const password = configuredPassword();
  if (!password) return "";

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToHex(new Uint8Array(signature));
}

export function isSiteAccessConfigured(): boolean {
  return configuredPassword().length >= 12;
}

/** 로컬 개발은 형제·협업자가 env 없이 바로 확인할 수 있게 연다. */
export function isLocalDevelopmentAccessOpen(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const passwordLength = environment.SITE_ACCESS_PASSWORD?.trim().length ?? 0;
  return environment.NODE_ENV !== "production" && passwordLength < 12;
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

export async function createSiteAccessToken(now = Date.now()): Promise<string> {
  if (!isSiteAccessConfigured()) {
    throw new Error("SITE_ACCESS_PASSWORD is not configured.");
  }

  const expiresAt = now + ACCESS_DURATION_SECONDS * 1000;
  const payload = `${ACCESS_TOKEN_VERSION}.${expiresAt}`;
  const signature = await sign(payload);
  return `${payload}.${signature}`;
}

export async function verifySiteAccessToken(
  token: string | undefined,
  now = Date.now(),
): Promise<boolean> {
  if (!token || !isSiteAccessConfigured()) return false;

  const [version, expiresAtText, providedSignature, extra] = token.split(".");
  if (
    extra !== undefined ||
    version !== ACCESS_TOKEN_VERSION ||
    !/^\d+$/.test(expiresAtText ?? "") ||
    !providedSignature
  ) {
    return false;
  }

  const expiresAt = Number(expiresAtText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;

  const expectedSignature = await sign(`${version}.${expiresAtText}`);
  return constantTimeEqual(providedSignature, expectedSignature);
}

export const siteAccessCookie = {
  name: ACCESS_COOKIE_NAME,
  maxAge: ACCESS_DURATION_SECONDS,
} as const;
