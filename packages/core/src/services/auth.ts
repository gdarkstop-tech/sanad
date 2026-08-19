import { and, eq, gt } from 'drizzle-orm';
import type { RegisterInput } from '@sanad/contracts';
import {
  authIdentities,
  instructorProfiles,
  sessions,
  studentProfiles,
  teachingAssistantProfiles,
  users,
  type Database,
} from '@sanad/db';
import { Errors } from '../errors';
import { hashPassword, verifyPassword } from '../password';
import type { Role } from '../permissions';
import {
  generateSessionToken,
  hashSessionToken,
  isExpired,
  sessionExpiry,
} from '../session';
import { normalizeEmail } from '../text';
import { resolveDepartment, resolveFaculty, resolveUniversity } from './reference';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  fullName: string;
  interfaceLocale: string;
  timezone: string;
  emailVerified: boolean;
}

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

function toAuthenticatedUser(row: typeof users.$inferSelect): AuthenticatedUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    fullName: row.fullName,
    interfaceLocale: row.interfaceLocale,
    timezone: row.timezone,
    emailVerified: row.emailVerifiedAt !== null,
  };
}

/**
 * Registration is one transaction: user, credential, profile, and any
 * reference data the student provisioned inline. A partial registration —
 * a user with no credential, or a profile pointing at a university that was
 * rolled back — is not a state the system should be able to reach.
 */
export async function registerUser(
  db: Database,
  input: RegisterInput,
  ttlDays: number,
): Promise<{ user: AuthenticatedUser; session: IssuedSession }> {
  const emailNormalized = normalizeEmail(input.email);

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.emailNormalized, emailNormalized))
    .limit(1);
  if (existing) {
    throw Errors.conflict('Email already registered', 'This email already has an account.');
  }

  const passwordHash = await hashPassword(input.password);

  const created = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        email: input.email.trim(),
        emailNormalized,
        role: input.role,
        fullName: input.fullName,
        interfaceLocale: input.interfaceLocale,
        timezone: input.timezone,
      })
      .returning();
    if (!user) throw Errors.internal();

    await tx.insert(authIdentities).values({
      userId: user.id,
      provider: 'password',
      providerAccountId: emailNormalized,
      passwordHash,
    });

    const p = input.profile;
    const universityId = p.university
      ? await resolveUniversity(tx as unknown as Database, p.university, user.id)
      : null;
    const facultyId =
      universityId && p.faculty
        ? await resolveFaculty(tx as unknown as Database, universityId, p.faculty, user.id)
        : null;
    const departmentId =
      facultyId && p.department
        ? await resolveDepartment(tx as unknown as Database, facultyId, p.department, user.id)
        : null;

    if (user.role === 'student') {
      await tx.insert(studentProfiles).values({
        userId: user.id,
        universityId,
        facultyId,
        departmentId,
        academicYearId: p.academicYearId ?? null,
        major: p.major ?? null,
        studentNumber: p.studentNumber ?? null,
      });
    } else if (user.role === 'instructor') {
      await tx
        .insert(instructorProfiles)
        .values({ userId: user.id, universityId, departmentId });
    } else if (user.role === 'teaching_assistant') {
      await tx
        .insert(teachingAssistantProfiles)
        .values({ userId: user.id, universityId, departmentId });
    }

    return user;
  });

  const session = await issueSession(db, created.id, ttlDays);
  return { user: toAuthenticatedUser(created), session };
}

/**
 * Failure is deliberately indistinguishable between "no such account" and
 * "wrong password", and always pays the cost of a hash verification so the
 * response time does not reveal which it was.
 */
export async function authenticate(
  db: Database,
  email: string,
  password: string,
  ttlDays: number,
): Promise<{ user: AuthenticatedUser; session: IssuedSession }> {
  const emailNormalized = normalizeEmail(email);

  const [row] = await db
    .select({ user: users, identity: authIdentities })
    .from(authIdentities)
    .innerJoin(users, eq(users.id, authIdentities.userId))
    .where(
      and(
        eq(authIdentities.provider, 'password'),
        eq(authIdentities.providerAccountId, emailNormalized),
      ),
    )
    .limit(1);

  // Dummy verify keeps the timing of a missing account close to a wrong password.
  const storedHash =
    row?.identity.passwordHash ??
    '$argon2id$v=19$m=19456,t=2,p=1$c2FuYWRkdW1teXNhbHQ$0000000000000000000000000000000000000000000';
  const ok = await verifyPassword(storedHash, password);

  if (!row || !ok || row.user.deletedAt) {
    throw Errors.unauthenticated();
  }

  await db
    .update(authIdentities)
    .set({ lastUsedAt: new Date() })
    .where(eq(authIdentities.id, row.identity.id));

  const session = await issueSession(db, row.user.id, ttlDays);
  return { user: toAuthenticatedUser(row.user), session };
}

export async function issueSession(
  db: Database,
  userId: string,
  ttlDays: number,
): Promise<IssuedSession> {
  const token = generateSessionToken();
  const expiresAt = sessionExpiry(ttlDays);
  await db
    .insert(sessions)
    .values({ userId, tokenHash: hashSessionToken(token), expiresAt });
  return { token, expiresAt };
}

/** Returns null for any invalid, expired, or deleted-user session. */
export async function resolveSession(
  db: Database,
  token: string | undefined,
): Promise<AuthenticatedUser | null> {
  if (!token) return null;

  const [row] = await db
    .select({ user: users, session: sessions })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashSessionToken(token)),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!row || isExpired(row.session.expiresAt) || row.user.deletedAt) return null;
  return toAuthenticatedUser(row.user);
}

export async function revokeSession(db: Database, token: string | undefined): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)));
}

export async function updateProfile(
  db: Database,
  userId: string,
  patch: { fullName?: string; interfaceLocale?: string; timezone?: string },
): Promise<AuthenticatedUser> {
  const [updated] = await db
    .update(users)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  if (!updated) throw Errors.notFound('User');
  return toAuthenticatedUser(updated);
}
