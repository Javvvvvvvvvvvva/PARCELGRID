export const DEFAULT_SITE_ACCESS_ATTEMPT_LIMIT = 8;
export const DEFAULT_SITE_ACCESS_WINDOW_MINUTES = 15;

interface AccessAttemptEntry {
  startedAt: number;
  attempts: number;
}

interface AccessAttemptGlobal {
  __parcelgridSiteAccessAttempts?: Map<string, AccessAttemptEntry>;
}

export interface SiteAccessAttemptResult {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
  resetAt: string;
}

function attemptStore(): Map<string, AccessAttemptEntry> {
  const scope = globalThis as AccessAttemptGlobal;
  if (!scope.__parcelgridSiteAccessAttempts) {
    scope.__parcelgridSiteAccessAttempts = new Map();
  }
  return scope.__parcelgridSiteAccessAttempts;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  maximum: number
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback;
}

export function siteAccessAttemptLimit(
  environment: NodeJS.ProcessEnv = process.env
): number {
  return boundedInteger(
    environment.SITE_ACCESS_ATTEMPT_LIMIT,
    DEFAULT_SITE_ACCESS_ATTEMPT_LIMIT,
    50
  );
}

export function siteAccessWindowMinutes(
  environment: NodeJS.ProcessEnv = process.env
): number {
  return boundedInteger(
    environment.SITE_ACCESS_WINDOW_MINUTES,
    DEFAULT_SITE_ACCESS_WINDOW_MINUTES,
    60
  );
}

/**
 * 공유 비밀번호 무차별 대입 방지를 위한 단일 Node 프로세스 제한.
 * 다중 인스턴스 운영에서는 외부 KV/DB limiter로 교체해야 한다.
 */
export function reserveSiteAccessAttempt(input: {
  identity: string;
  now?: Date;
  environment?: NodeJS.ProcessEnv;
}): SiteAccessAttemptResult {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const limit = siteAccessAttemptLimit(input.environment);
  const windowMs =
    siteAccessWindowMinutes(input.environment) * 60 * 1_000;
  const identity =
    input.identity.normalize("NFKC").trim().slice(0, 240) || "unknown";
  const existing = attemptStore().get(identity);
  const current =
    !existing || nowMs - existing.startedAt >= windowMs
      ? { startedAt: nowMs, attempts: 0 }
      : existing;
  const resetAt = new Date(current.startedAt + windowMs).toISOString();

  if (current.attempts >= limit) {
    return {
      allowed: false,
      limit,
      used: current.attempts,
      remaining: 0,
      resetAt,
    };
  }

  const attempts = current.attempts + 1;
  attemptStore().set(identity, {
    startedAt: current.startedAt,
    attempts,
  });
  return {
    allowed: true,
    limit,
    used: attempts,
    remaining: Math.max(0, limit - attempts),
    resetAt,
  };
}

export function clearSiteAccessAttempts(identity: string): void {
  attemptStore().delete(
    identity.normalize("NFKC").trim().slice(0, 240) || "unknown"
  );
}

export function resetSiteAccessAttemptsForTests(): void {
  attemptStore().clear();
}
