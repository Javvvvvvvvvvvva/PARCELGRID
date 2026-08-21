export const DEFAULT_CONCEPT_RENDER_DAILY_LIMIT = 6;
const MAX_CONFIGURED_DAILY_LIMIT = 50;

interface QuotaEntry {
  day: string;
  used: number;
}

interface ConceptRenderQuotaGlobal {
  __parcelgridConceptRenderQuota?: Map<string, QuotaEntry>;
}

export interface ConceptRenderQuotaResult {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
  resetAt: string;
}

function quotaStore(): Map<string, QuotaEntry> {
  const scope = globalThis as ConceptRenderQuotaGlobal;
  if (!scope.__parcelgridConceptRenderQuota) {
    scope.__parcelgridConceptRenderQuota = new Map();
  }
  return scope.__parcelgridConceptRenderQuota;
}

export function conceptRenderDailyLimit(
  environment: NodeJS.ProcessEnv = process.env
): number {
  const parsed = Number(environment.CONCEPT_RENDER_DAILY_LIMIT);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_CONCEPT_RENDER_DAILY_LIMIT;
  }
  return Math.min(MAX_CONFIGURED_DAILY_LIMIT, parsed);
}

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function nextUtcDay(now: Date): string {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1
    )
  ).toISOString();
}

/**
 * 프로젝트별 일일 이미지 생성 한도.
 *
 * 단일 Node 프로세스 안에서는 강제되며 개발·사내 서버의 실수성 반복 호출을
 * 차단한다. 다중 인스턴스 배포에서는 외부 KV/DB rate limiter로 교체해야 한다.
 */
export function reserveConceptRenderQuota(input: {
  projectId: string;
  now?: Date;
  environment?: NodeJS.ProcessEnv;
}): ConceptRenderQuotaResult {
  const now = input.now ?? new Date();
  const day = utcDay(now);
  const projectId = input.projectId.normalize("NFKC").trim() || "unknown";
  const key = `${projectId}:${day}`;
  const limit = conceptRenderDailyLimit(input.environment);
  const current = quotaStore().get(key) ?? { day, used: 0 };

  if (current.used >= limit) {
    return {
      allowed: false,
      limit,
      used: current.used,
      remaining: 0,
      resetAt: nextUtcDay(now),
    };
  }

  const used = current.used + 1;
  quotaStore().set(key, { day, used });
  return {
    allowed: true,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    resetAt: nextUtcDay(now),
  };
}

export function resetConceptRenderQuotaForTests(): void {
  quotaStore().clear();
}
