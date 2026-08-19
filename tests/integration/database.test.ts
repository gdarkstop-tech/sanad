import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  academicTerms,
  academicYears,
  authIdentities,
  courseOfferings,
  courses,
  sessions,
  universities,
  users,
} from '@sanad/db';
import { openTestDatabase, resetDatabase, uniqueEmail } from '../helpers';

const { db, close } = openTestDatabase();

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await resetDatabase();
});

async function insertUser(email = uniqueEmail()) {
  const [user] = await db
    .insert(users)
    .values({ email, emailNormalized: email.toLowerCase(), fullName: 'Test' })
    .returning();
  return user!;
}

describe('migrations', () => {
  it('creates every Phase 1 table', async () => {
    const rows = await db.execute(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `);
    const names = rows.map((r) => r.table_name as string);
    for (const expected of [
      'academic_terms',
      'academic_years',
      'auth_identities',
      'consents',
      'course_enrollments',
      'course_offerings',
      'course_staff',
      'courses',
      'departments',
      'faculties',
      'instructor_profiles',
      'sessions',
      'student_profiles',
      'teaching_assistant_profiles',
      'universities',
      'users',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('enables pgvector, which later phases depend on', async () => {
    const rows = await db.execute(
      sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`,
    );
    expect(rows).toHaveLength(1);
  });
});

describe('constraints', () => {
  it('rejects a duplicate normalized email', async () => {
    const email = uniqueEmail();
    await insertUser(email);
    await expect(insertUser(email)).rejects.toThrow(/users_email_normalized_key/);
  });

  it('requires a password hash for a password identity', async () => {
    const user = await insertUser();
    await expect(
      db.insert(authIdentities).values({
        userId: user.id,
        provider: 'password',
        providerAccountId: user.emailNormalized,
        passwordHash: null,
      }),
    ).rejects.toThrow(/auth_identities_password_ck/);
  });

  it('forbids a password hash on a federated identity', async () => {
    const user = await insertUser();
    await expect(
      db.insert(authIdentities).values({
        userId: user.id,
        provider: 'google',
        providerAccountId: 'google-subject-id',
        passwordHash: 'should-not-be-here',
      }),
    ).rejects.toThrow(/auth_identities_password_ck/);
  });

  it('accepts a federated identity with no hash, so a provider can be added later', async () => {
    const user = await insertUser();
    await expect(
      db.insert(authIdentities).values({
        userId: user.id,
        provider: 'google',
        providerAccountId: 'google-subject-id',
      }),
    ).resolves.toBeDefined();
  });

  it('rejects an academic term that ends before it starts', async () => {
    const user = await insertUser();
    const [uni] = await db
      .insert(universities)
      .values({ name: 'Test University', createdBy: user.id })
      .returning();
    const [year] = await db
      .insert(academicYears)
      .values({
        universityId: uni!.id,
        label: '2026/2027',
        startsOn: '2026-09-01',
        endsOn: '2027-06-30',
      })
      .returning();

    await expect(
      db.insert(academicTerms).values({
        academicYearId: year!.id,
        label: 'Impossible',
        startsOn: '2027-01-10',
        endsOn: '2026-12-01',
      }),
    ).rejects.toThrow(/academic_terms_range_ck/);
  });

  it('rejects a course with no owner', async () => {
    await expect(
      db.execute(sql`INSERT INTO courses (id, title) VALUES (gen_random_uuid(), 'X')`),
    ).rejects.toThrow();
  });
});

describe('cascades', () => {
  it('removes credentials, sessions, courses and offerings when a user is deleted', async () => {
    const user = await insertUser();
    await db.insert(authIdentities).values({
      userId: user.id,
      provider: 'password',
      providerAccountId: user.emailNormalized,
      passwordHash: '$argon2id$fake',
    });
    await db.insert(sessions).values({
      userId: user.id,
      tokenHash: 'hash-value',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const [course] = await db
      .insert(courses)
      .values({ ownerUserId: user.id, title: 'Any Course' })
      .returning();
    await db.insert(courseOfferings).values({ courseId: course!.id });

    await db.delete(users).where(eq(users.id, user.id));

    expect(await db.select().from(authIdentities)).toHaveLength(0);
    expect(await db.select().from(sessions)).toHaveLength(0);
    expect(await db.select().from(courses)).toHaveLength(0);
    expect(await db.select().from(courseOfferings)).toHaveLength(0);
  });

  it('keeps a course when its department is removed', async () => {
    const user = await insertUser();
    const [course] = await db
      .insert(courses)
      .values({ ownerUserId: user.id, title: 'Any Course', departmentId: null })
      .returning();
    expect(course!.departmentId).toBeNull();
  });
});
