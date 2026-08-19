import { describe, expect, it } from 'vitest';
import {
  canActOnCourse,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  isExpired,
  isUuid,
  loadConfig,
  newId,
  normalizeEmail,
  normalizeForSearch,
  safeEqual,
  sessionExpiry,
  verifyPassword,
} from '@sanad/core';

describe('password hashing', () => {
  it('produces an argon2id hash that verifies', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    await expect(verifyPassword(hash, 'correct-horse-battery')).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct-horse-battery');
    await expect(verifyPassword(hash, 'wrong-password')).resolves.toBe(false);
  });

  it('salts: the same password hashes differently each time', async () => {
    const a = await hashPassword('same-password-twice');
    const b = await hashPassword('same-password-twice');
    expect(a).not.toEqual(b);
  });

  it('returns false rather than throwing on a malformed stored hash', async () => {
    await expect(verifyPassword('not-a-hash', 'anything')).resolves.toBe(false);
  });
});

describe('sessions', () => {
  it('never stores the raw token', () => {
    const token = generateSessionToken();
    const hashed = hashSessionToken(token);
    expect(hashed).not.toEqual(token);
    expect(hashed).toHaveLength(64);
    expect(hashSessionToken(token)).toEqual(hashed);
  });

  it('generates unpredictable tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, generateSessionToken));
    expect(tokens.size).toBe(200);
  });

  it('computes and detects expiry', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const expires = sessionExpiry(30, now);
    expect(expires.toISOString()).toBe('2026-01-31T00:00:00.000Z');
    expect(isExpired(expires, now)).toBe(false);
    expect(isExpired(expires, new Date('2026-02-01T00:00:00Z'))).toBe(true);
  });

  it('compares secrets safely, including different lengths', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('identifiers', () => {
  it('generates valid, unique, time-ordered v7 ids', () => {
    const a = newId();
    const b = newId();
    expect(isUuid(a)).toBe(true);
    expect(a).not.toEqual(b);
    expect(a < b || a.slice(0, 8) === b.slice(0, 8)).toBe(true);
  });
});

describe('text normalization', () => {
  it('strips tashkeel and normalizes alef, ya, and ta marbuta', () => {
    expect(normalizeForSearch('الأَنْظِمَة')).toBe(normalizeForSearch('الانظمه'));
    expect(normalizeForSearch('مُحَاضَرَة')).toBe(normalizeForSearch('محاضره'));
  });

  it('folds Arabic-Indic digits to ASCII', () => {
    expect(normalizeForSearch('٤٢')).toBe('42');
  });

  it('is idempotent, so index-time and query-time cannot drift', () => {
    const once = normalizeForSearch('الْمُحَاضَرَة ٣ — Lecture');
    expect(normalizeForSearch(once)).toBe(once);
  });

  it('normalizes emails for uniqueness', () => {
    expect(normalizeEmail('  Student@University.EDU ')).toBe('student@university.edu');
  });
});

describe('course permissions', () => {
  const owner = { userId: 'user-owner', role: 'student' as const };
  const other = { userId: 'user-other', role: 'student' as const };
  const instructor = { userId: 'user-teacher', role: 'instructor' as const };
  const admin = { userId: 'user-admin', role: 'admin' as const };
  const course = { ownerUserId: 'user-owner', isEnrolled: false };

  it('lets the owner do everything', () => {
    for (const action of ['read', 'update', 'delete', 'add_content'] as const) {
      expect(canActOnCourse(owner, action, course).allowed).toBe(true);
    }
  });

  it('hides a course from an unrelated student', () => {
    expect(canActOnCourse(other, 'read', course)).toEqual({
      allowed: false,
      reason: 'not_found',
    });
  });

  it('lets an enrolled student read but not modify', () => {
    const enrolled = { ownerUserId: 'user-owner', isEnrolled: true };
    expect(canActOnCourse(other, 'read', enrolled).allowed).toBe(true);
    expect(canActOnCourse(other, 'update', enrolled)).toEqual({
      allowed: false,
      reason: 'forbidden',
    });
  });

  it('gives instructors no course-management permission in the MVP', () => {
    expect(canActOnCourse(instructor, 'update', course).allowed).toBe(false);
    expect(canActOnCourse(instructor, 'delete', course).allowed).toBe(false);
  });

  it('reports not_found rather than forbidden to a non-enrolled non-owner', () => {
    // Leaking "this exists but you may not touch it" is itself information.
    expect(canActOnCourse(other, 'delete', course)).toEqual({
      allowed: false,
      reason: 'not_found',
    });
  });

  it('allows admins', () => {
    expect(canActOnCourse(admin, 'delete', course).allowed).toBe(true);
  });
});

describe('configuration', () => {
  const base = {
    DATABASE_URL: 'postgres://localhost:5432/x',
    APP_SECRET: 'a'.repeat(32),
  };

  it('loads a valid environment', () => {
    const cfg = loadConfig({ ...base, SESSION_TTL_DAYS: '14' });
    expect(cfg.sessionTtlDays).toBe(14);
    expect(cfg.isProduction).toBe(false);
  });

  it('fails fast when a secret is missing', () => {
    expect(() => loadConfig({ DATABASE_URL: base.DATABASE_URL })).toThrow(
      /APP_SECRET/,
    );
  });

  it('rejects a short secret', () => {
    expect(() =>
      loadConfig({ ...base, APP_SECRET: 'too-short' }),
    ).toThrow(/at least 32/);
  });

  it('rejects a nonsensical session TTL', () => {
    expect(() =>
      loadConfig({ ...base, SESSION_TTL_DAYS: '0' }),
    ).toThrow(/SESSION_TTL_DAYS/);
  });
});
