import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  authenticate,
  registerUser,
  resolveSession,
  revokeSession,
  updateProfile,
} from '@sanad/core';
import { authIdentities, faculties, studentProfiles, universities, users } from '@sanad/db';
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

describe('registration', () => {
  it('creates the user, credential, profile and session together', async () => {
    const email = uniqueEmail();
    const { user, session } = await registerUser(
      db,
      {
        email,
        password: VALID_PASSWORD,
        fullName: 'Sara Ahmed',
        role: 'student',
        interfaceLocale: 'ar',
        timezone: 'Africa/Cairo',
        profile: { major: 'Any Major', studentNumber: '20260001' },
      },
      30,
    );

    expect(user.email).toBe(email);
    expect(user.interfaceLocale).toBe('ar');
    expect(session.token).toBeTruthy();

    const [identity] = await db
      .select()
      .from(authIdentities)
      .where(eq(authIdentities.userId, user.id));
    expect(identity?.provider).toBe('password');
    expect(identity?.passwordHash?.startsWith('$argon2id$')).toBe(true);

    const [profile] = await db
      .select()
      .from(studentProfiles)
      .where(eq(studentProfiles.userId, user.id));
    expect(profile?.major).toBe('Any Major');
  });

  it('never stores the password in plaintext anywhere', async () => {
    const { user } = await createTestStudent(db);
    const [identity] = await db
      .select()
      .from(authIdentities)
      .where(eq(authIdentities.userId, user.id));
    expect(identity?.passwordHash).not.toContain(VALID_PASSWORD);
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(JSON.stringify(row)).not.toContain(VALID_PASSWORD);
  });

  it('creates missing reference data inline, marked unverified', async () => {
    await registerUser(
      db,
      {
        email: uniqueEmail(),
        password: VALID_PASSWORD,
        fullName: 'First Ever User',
        role: 'student',
        interfaceLocale: 'en',
        timezone: 'UTC',
        profile: {
          university: { name: 'Cairo University', country: 'EG' },
          faculty: { name: 'Faculty of Engineering' },
        },
      },
      30,
    );

    const [uni] = await db.select().from(universities);
    expect(uni?.name).toBe('Cairo University');
    expect(uni?.isVerified).toBe(false);

    const [faculty] = await db.select().from(faculties);
    expect(faculty?.universityId).toBe(uni?.id);
  });

  it('reuses an existing university rather than duplicating it', async () => {
    const profile = { university: { name: 'Shared University', country: 'EG' } };
    for (const name of ['A', 'B']) {
      await registerUser(
        db,
        {
          email: uniqueEmail(),
          password: VALID_PASSWORD,
          fullName: name,
          role: 'student',
          interfaceLocale: 'en',
          timezone: 'UTC',
          profile,
        },
        30,
      );
    }
    expect(await db.select().from(universities)).toHaveLength(1);
  });

  it('rejects a duplicate email', async () => {
    const email = uniqueEmail();
    await createTestStudent(db, { email });
    await expect(createTestStudent(db, { email })).rejects.toMatchObject({ status: 409 });
  });

  it('treats email case and whitespace as the same account', async () => {
    const email = uniqueEmail();
    await createTestStudent(db, { email });
    await expect(
      createTestStudent(db, { email: `  ${email.toUpperCase()}  ` }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rolls the whole registration back if any step fails', async () => {
    const email = uniqueEmail();
    await createTestStudent(db, { email });
    const before = (await db.select().from(users)).length;
    await expect(createTestStudent(db, { email })).rejects.toBeDefined();
    expect((await db.select().from(users)).length).toBe(before);
  });
});

describe('authentication', () => {
  it('signs in with correct credentials', async () => {
    const email = uniqueEmail();
    await createTestStudent(db, { email });
    const { user, session } = await authenticate(db, email, VALID_PASSWORD, 30);
    expect(user.email).toBe(email);
    expect(session.token).toBeTruthy();
  });

  it('is case-insensitive on email', async () => {
    const email = uniqueEmail();
    await createTestStudent(db, { email });
    await expect(
      authenticate(db, email.toUpperCase(), VALID_PASSWORD, 30),
    ).resolves.toBeDefined();
  });

  it('rejects a wrong password with 401', async () => {
    const email = uniqueEmail();
    await createTestStudent(db, { email });
    await expect(authenticate(db, email, 'wrong-password', 30)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('gives an unknown email the same 401, revealing nothing', async () => {
    await expect(
      authenticate(db, 'nobody@university.edu', VALID_PASSWORD, 30),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe('sessions', () => {
  it('resolves a valid session token to its user', async () => {
    const { user, token } = await createTestStudent(db);
    const resolved = await resolveSession(db, token);
    expect(resolved?.id).toBe(user.id);
  });

  it('rejects an unknown or absent token', async () => {
    await expect(resolveSession(db, 'not-a-real-token')).resolves.toBeNull();
    await expect(resolveSession(db, undefined)).resolves.toBeNull();
  });

  it('stops resolving after sign-out', async () => {
    const { token } = await createTestStudent(db);
    await revokeSession(db, token);
    await expect(resolveSession(db, token)).resolves.toBeNull();
  });

  it('leaves other sessions of the same user alive', async () => {
    const email = uniqueEmail();
    await createTestStudent(db, { email });
    const first = await authenticate(db, email, VALID_PASSWORD, 30);
    const second = await authenticate(db, email, VALID_PASSWORD, 30);
    await revokeSession(db, first.session.token);
    await expect(resolveSession(db, first.session.token)).resolves.toBeNull();
    await expect(resolveSession(db, second.session.token)).resolves.not.toBeNull();
  });

  it('refuses an expired session', async () => {
    const { token } = await createTestStudent(db);
    const { sessions: sessionTable } = await import('@sanad/db');
    await db
      .update(sessionTable)
      .set({ expiresAt: new Date(Date.now() - 1000) });
    await expect(resolveSession(db, token)).resolves.toBeNull();
  });

  it('refuses a session belonging to a soft-deleted user', async () => {
    const { user, token } = await createTestStudent(db);
    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, user.id));
    await expect(resolveSession(db, token)).resolves.toBeNull();
  });
});

describe('profile', () => {
  it('updates display fields, including interface language', async () => {
    const { user } = await createTestStudent(db);
    const updated = await updateProfile(db, user.id, {
      fullName: 'Updated Name',
      interfaceLocale: 'zh',
    });
    expect(updated.fullName).toBe('Updated Name');
    expect(updated.interfaceLocale).toBe('zh');
  });
});
