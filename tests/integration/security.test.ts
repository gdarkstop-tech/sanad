import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  RATE_LIMITS,
  assertCsrf,
  authenticate,
  generateCsrfToken,
  identifierKey,
  ipKey,
  isVerified,
  issueVerification,
  rateLimit,
  requiresCsrfCheck,
  verifyEmail,
} from '@sanad/core';
import { emailVerificationTokens, users } from '@sanad/db';
import {
  VALID_PASSWORD,
  createTestStudent,
  openTestDatabase,
  resetDatabase,
  uniqueEmail,
} from '../helpers';

const { db, close } = openTestDatabase();

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await resetDatabase();
});

describe('rate limiting', () => {
  const rule = { limit: 3, windowSeconds: 60 };

  it('allows requests up to the limit and blocks beyond it', async () => {
    const key = `test:${Date.now()}`;
    for (let i = 0; i < rule.limit; i += 1) {
      expect((await rateLimit.consume(db, key, rule)).allowed).toBe(true);
    }
    const blocked = await rateLimit.consume(db, key, rule);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('throws 429 with a retry hint once exceeded', async () => {
    const key = `test:throw:${Date.now()}`;
    for (let i = 0; i < rule.limit; i += 1) await rateLimit.enforce(db, key, rule);
    await expect(rateLimit.enforce(db, key, rule)).rejects.toMatchObject({ status: 429 });
  });

  it('keeps separate keys independent', async () => {
    const a = `test:a:${Date.now()}`;
    const b = `test:b:${Date.now()}`;
    for (let i = 0; i < rule.limit; i += 1) await rateLimit.consume(db, a, rule);
    expect((await rateLimit.consume(db, a, rule)).allowed).toBe(false);
    expect((await rateLimit.consume(db, b, rule)).allowed).toBe(true);
  });

  it('starts a fresh window once the old one passes', async () => {
    const key = `test:window:${Date.now()}`;
    const first = new Date('2026-08-19T10:00:00Z');
    const later = new Date('2026-08-19T10:02:00Z');
    for (let i = 0; i < rule.limit; i += 1) await rateLimit.consume(db, key, rule, first);
    expect((await rateLimit.consume(db, key, rule, first)).allowed).toBe(false);
    expect((await rateLimit.consume(db, key, rule, later)).allowed).toBe(true);
  });

  it('buckets sign-in by IP and by email separately', async () => {
    // One host spraying many accounts, and many hosts targeting one account,
    // are different attacks; either bucket alone leaves a gap.
    const byIp = ipKey('login', '203.0.113.5');
    const byEmail = identifierKey('login', 'Someone@University.edu');
    expect(byIp).not.toEqual(byEmail);
    expect(identifierKey('login', 'SOMEONE@university.edu')).toEqual(byEmail);

    for (let i = 0; i < RATE_LIMITS.login.limit; i += 1) {
      await rateLimit.consume(db, byIp, RATE_LIMITS.login);
    }
    expect((await rateLimit.consume(db, byIp, RATE_LIMITS.login)).allowed).toBe(false);
    expect((await rateLimit.consume(db, byEmail, RATE_LIMITS.login)).allowed).toBe(true);
  });

  it('prunes expired windows', async () => {
    const key = `test:prune:${Date.now()}`;
    await rateLimit.consume(db, key, rule, new Date('2026-08-19T10:00:00Z'));
    await rateLimit.pruneExpired(db, new Date('2026-08-19T12:00:00Z'));
    expect((await rateLimit.consume(db, key, rule, new Date('2026-08-19T12:00:00Z'))).allowed).toBe(true);
  });

  it('does not lock a legitimate user out after a few typos', async () => {
    const email = uniqueEmail();
    await createTestStudent(db, { email });
    const key = identifierKey('login', email);
    for (let i = 0; i < 3; i += 1) {
      await rateLimit.enforce(db, key, RATE_LIMITS.login);
      await expect(authenticate(db, email, 'wrong', 30)).rejects.toMatchObject({ status: 401 });
    }
    await rateLimit.enforce(db, key, RATE_LIMITS.login);
    await expect(authenticate(db, email, VALID_PASSWORD, 30)).resolves.toBeDefined();
  });
});

describe('CSRF', () => {
  it('skips safe methods', () => {
    expect(requiresCsrfCheck('GET')).toBe(false);
    expect(requiresCsrfCheck('HEAD')).toBe(false);
    expect(requiresCsrfCheck('POST')).toBe(true);
    expect(requiresCsrfCheck('delete')).toBe(true);
  });

  it('accepts a matching cookie and header', () => {
    const token = generateCsrfToken();
    expect(() => assertCsrf('POST', token, token)).not.toThrow();
  });

  it('rejects a mismatch', () => {
    expect(() => assertCsrf('POST', generateCsrfToken(), generateCsrfToken())).toThrow();
  });

  it('rejects a missing header — the cross-site case', () => {
    // An attacker's page can make the browser send the cookie but cannot read
    // it to build the header, so absence must fail rather than skip.
    const token = generateCsrfToken();
    expect(() => assertCsrf('POST', token, undefined)).toThrow(/CSRF/);
  });

  it('rejects when neither side has a token', () => {
    expect(() => assertCsrf('POST', undefined, undefined)).toThrow();
  });

  it('generates unpredictable tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, generateCsrfToken));
    expect(tokens.size).toBe(200);
  });
});

describe('email verification', () => {
  it('starts unverified and becomes verified through the token', async () => {
    const { user } = await createTestStudent(db);
    expect(await isVerified(db, user.id)).toBe(false);

    const { token } = await issueVerification(db, user.id);
    await verifyEmail(db, token);

    expect(await isVerified(db, user.id)).toBe(true);
  });

  it('stores only the hash of the token', async () => {
    const { user } = await createTestStudent(db);
    const { token } = await issueVerification(db, user.id);
    const [row] = await db
      .select()
      .from(emailVerificationTokens)
      .where(eq(emailVerificationTokens.userId, user.id));
    expect(row?.tokenHash).not.toEqual(token);
    expect(row?.tokenHash).toHaveLength(64);
  });

  it('refuses a replayed token', async () => {
    const { user } = await createTestStudent(db);
    const { token } = await issueVerification(db, user.id);
    await verifyEmail(db, token);
    await expect(verifyEmail(db, token)).rejects.toMatchObject({ status: 400 });
  });

  it('refuses an expired token', async () => {
    const { user } = await createTestStudent(db);
    const { token } = await issueVerification(db, user.id, new Date('2026-01-01T00:00:00Z'));
    await expect(verifyEmail(db, token, new Date('2026-01-03T00:00:00Z'))).rejects.toMatchObject({
      status: 400,
    });
  });

  it('refuses an unknown token', async () => {
    await expect(verifyEmail(db, 'not-a-real-token')).rejects.toMatchObject({ status: 400 });
  });

  it('exposes verification state on the authenticated user', async () => {
    const email = uniqueEmail();
    await createTestStudent(db, { email });
    const before = await authenticate(db, email, VALID_PASSWORD, 30);
    expect(before.user.emailVerified).toBe(false);

    const { token } = await issueVerification(db, before.user.id);
    await verifyEmail(db, token);

    const after = await authenticate(db, email, VALID_PASSWORD, 30);
    expect(after.user.emailVerified).toBe(true);
  });

  it('drops tokens when the user is deleted', async () => {
    const { user } = await createTestStudent(db);
    await issueVerification(db, user.id);
    await db.delete(users).where(eq(users.id, user.id));
    expect(await db.select().from(emailVerificationTokens)).toHaveLength(0);
  });
});
