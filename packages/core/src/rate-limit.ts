import { and, eq, lt, sql } from 'drizzle-orm';
import { rateLimitBuckets, type Database } from '@sanad/db';
import { AppError } from './errors';

/**
 * Fixed-window rate limiting (ARCHITECTURE.md §9).
 *
 * Fixed windows can allow a burst across a boundary; a sliding window would be
 * tighter. For brute-force protection on sign-in that difference is
 * immaterial, and the simpler thing has fewer ways to be wrong under deadline.
 */
export interface RateLimitRule {
  /** Requests permitted per window. */
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMITS = {
  login: { limit: 10, windowSeconds: 300 },
  register: { limit: 5, windowSeconds: 3600 },
  verificationResend: { limit: 3, windowSeconds: 3600 },
  askAi: { limit: 60, windowSeconds: 3600 },
} as const satisfies Record<string, RateLimitRule>;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

function windowStartFor(rule: RateLimitRule, now: Date): Date {
  const size = rule.windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / size) * size);
}

/**
 * Consumes one unit against `key`. Atomic: the insert-or-increment happens in a
 * single statement, so concurrent attempts cannot both observe a stale count.
 */
export async function consume(
  db: Database,
  key: string,
  rule: RateLimitRule,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const windowStart = windowStartFor(rule, now);
  const expiresAt = new Date(windowStart.getTime() + rule.windowSeconds * 1000);

  const [row] = await db
    .insert(rateLimitBuckets)
    .values({ bucketKey: key, windowStart, count: 1, expiresAt })
    .onConflictDoUpdate({
      target: [rateLimitBuckets.bucketKey, rateLimitBuckets.windowStart],
      set: { count: sql`${rateLimitBuckets.count} + 1` },
    })
    .returning({ count: rateLimitBuckets.count });

  const count = row?.count ?? 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000));

  return {
    allowed: count <= rule.limit,
    remaining: Math.max(0, rule.limit - count),
    retryAfterSeconds,
  };
}

/** Consumes and throws 429 when the limit is exceeded. */
export async function enforce(
  db: Database,
  key: string,
  rule: RateLimitRule,
  now: Date = new Date(),
): Promise<void> {
  const result = await consume(db, key, rule, now);
  if (result.allowed) return;
  throw new AppError({
    status: 429,
    type: 'rate-limited',
    title: 'Too many attempts',
    detail: `Try again in ${result.retryAfterSeconds} seconds.`,
    extensions: { retry_after_seconds: result.retryAfterSeconds },
  });
}

/** Housekeeping: drop expired windows. Safe to call from any request path. */
export async function pruneExpired(db: Database, now: Date = new Date()): Promise<void> {
  await db.delete(rateLimitBuckets).where(lt(rateLimitBuckets.expiresAt, now));
}

/** Test/administrative reset for one key. */
export async function reset(db: Database, key: string): Promise<void> {
  await db.delete(rateLimitBuckets).where(eq(rateLimitBuckets.bucketKey, key));
}

export function ipKey(scope: string, ip: string | null): string {
  return `${scope}:ip:${ip ?? 'unknown'}`;
}

export function identifierKey(scope: string, identifier: string): string {
  return `${scope}:id:${identifier.toLowerCase()}`;
}

export { and };
