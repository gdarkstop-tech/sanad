import { and, eq, gt } from 'drizzle-orm';
import type { RegisterInput } from '@sanad/contracts';
import {
  academicYears,
  authIdentities,
  departments,
  faculties,
  instructorProfiles,
  sessions,
  studentProfiles,
  teachingAssistantProfiles,
  universities,
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

/**
 * The student's academic identity, resolved to names rather than ids.
 *
 * The ids are the structured fields the rest of the system filters on; a
 * profile screen needs the labels, and resolving them here means every caller
 * does not repeat four joins.
 */
export interface StudentProfileView {
  user: AuthenticatedUser;
  universityId: string | null;
  universityName: string | null;
  facultyId: string | null;
  facultyName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  academicYearId: string | null;
  academicYearLabel: string | null;
  major: string | null;
  studentNumber: string | null;
}

export async function readProfile(
  db: Database,
  user: AuthenticatedUser,
): Promise<StudentProfileView> {
  const [row] = await db
    .select({
      profile: studentProfiles,
      universityName: universities.name,
      facultyName: faculties.name,
      departmentName: departments.name,
      academicYearLabel: academicYears.label,
    })
    .from(studentProfiles)
    .leftJoin(universities, eq(universities.id, studentProfiles.universityId))
    .leftJoin(faculties, eq(faculties.id, studentProfiles.facultyId))
    .leftJoin(departments, eq(departments.id, studentProfiles.departmentId))
    .leftJoin(academicYears, eq(academicYears.id, studentProfiles.academicYearId))
    .where(eq(studentProfiles.userId, user.id))
    .limit(1);

  return {
    user,
    universityId: row?.profile.universityId ?? null,
    universityName: row?.universityName ?? null,
    facultyId: row?.profile.facultyId ?? null,
    facultyName: row?.facultyName ?? null,
    departmentId: row?.profile.departmentId ?? null,
    departmentName: row?.departmentName ?? null,
    academicYearId: row?.profile.academicYearId ?? null,
    academicYearLabel: row?.academicYearLabel ?? null,
    major: row?.profile.major ?? null,
    studentNumber: row?.profile.studentNumber ?? null,
  };
}

/**
 * Updates the student's own profile.
 *
 * University, faculty and department are resolved the same way registration
 * resolves them — by name, creating the reference row if it is genuinely new —
 * so a student at an institution nobody has entered yet is not locked out of
 * their own profile by a dropdown.
 */
export async function updateStudentProfile(
  db: Database,
  user: AuthenticatedUser,
  patch: {
    fullName?: string;
    interfaceLocale?: string;
    timezone?: string;
    universityName?: string | null;
    facultyName?: string | null;
    departmentName?: string | null;
    academicYearId?: string | null;
    major?: string | null;
    studentNumber?: string | null;
  },
): Promise<StudentProfileView> {
  const account: { fullName?: string; interfaceLocale?: string; timezone?: string } = {};
  if (patch.fullName !== undefined) {
    const fullName = patch.fullName.trim();
    if (fullName.length === 0) throw Errors.validation('A name cannot be empty.');
    account.fullName = fullName.slice(0, 200);
  }
  if (patch.interfaceLocale !== undefined) account.interfaceLocale = patch.interfaceLocale;
  if (patch.timezone !== undefined) account.timezone = patch.timezone;

  const updated =
    Object.keys(account).length > 0 ? await updateProfile(db, user.id, account) : user;

  const [existing] = await db
    .select()
    .from(studentProfiles)
    .where(eq(studentProfiles.userId, user.id))
    .limit(1);

  const clean = (value: string | null | undefined): string | null | undefined =>
    value === undefined ? undefined : value === null ? null : value.trim() || null;

  let universityId = existing?.universityId ?? null;
  let facultyId = existing?.facultyId ?? null;
  let departmentId = existing?.departmentId ?? null;

  const universityName = clean(patch.universityName);
  if (universityName !== undefined) {
    universityId = universityName
      ? await resolveUniversity(db, { name: universityName }, user.id)
      : null;
    // A faculty belongs to a university and a department to a faculty, so
    // changing the parent invalidates the children rather than leaving a
    // department attached to an institution it is not part of.
    facultyId = null;
    departmentId = null;
  }

  const facultyName = clean(patch.facultyName);
  if (facultyName !== undefined) {
    facultyId =
      facultyName && universityId
        ? await resolveFaculty(db, universityId, { name: facultyName }, user.id)
        : null;
    departmentId = null;
  }

  const departmentName = clean(patch.departmentName);
  if (departmentName !== undefined) {
    departmentId =
      departmentName && facultyId
        ? await resolveDepartment(db, facultyId, { name: departmentName }, user.id)
        : null;
  }

  const values = {
    universityId,
    facultyId,
    departmentId,
    academicYearId:
      patch.academicYearId !== undefined
        ? patch.academicYearId
        : (existing?.academicYearId ?? null),
    major: clean(patch.major) !== undefined ? (clean(patch.major) ?? null) : (existing?.major ?? null),
    studentNumber:
      clean(patch.studentNumber) !== undefined
        ? (clean(patch.studentNumber) ?? null)
        : (existing?.studentNumber ?? null),
    updatedAt: new Date(),
  };

  if (existing) {
    await db.update(studentProfiles).set(values).where(eq(studentProfiles.userId, user.id));
  } else {
    await db.insert(studentProfiles).values({ userId: user.id, ...values });
  }

  return readProfile(db, updated);
}
