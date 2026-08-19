import { and, eq, ilike, isNull, or } from 'drizzle-orm';
import {
  academicTerms,
  academicYears,
  departments,
  faculties,
  universities,
  type Database,
} from '@sanad/db';

/**
 * Reference data resolution.
 *
 * Every helper accepts either an existing id or a name to create. Registration
 * on an empty database has to work, so a student may provision a missing
 * university, faculty, or department — flagged unverified so institutional
 * data can be reconciled later (DATABASE.md §3).
 */

export type Ref<TCreate> = { id: string } | TCreate;

function isExisting<T>(ref: Ref<T>): ref is { id: string } {
  return typeof (ref as { id?: unknown }).id === 'string';
}

export async function resolveUniversity(
  db: Database,
  ref: Ref<{ name: string; country?: string }>,
  createdBy: string | null,
): Promise<string | null> {
  if (isExisting(ref)) {
    const [found] = await db
      .select({ id: universities.id })
      .from(universities)
      .where(eq(universities.id, ref.id))
      .limit(1);
    return found?.id ?? null;
  }

  const country = ref.country ?? null;
  const [existing] = await db
    .select({ id: universities.id })
    .from(universities)
    .where(
      and(
        eq(universities.name, ref.name),
        country === null ? isNull(universities.country) : eq(universities.country, country),
      ),
    )
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(universities)
    .values({ name: ref.name, country, isVerified: false, createdBy })
    .returning({ id: universities.id });
  return created?.id ?? null;
}

export async function resolveFaculty(
  db: Database,
  universityId: string,
  ref: Ref<{ name: string }>,
  createdBy: string | null,
): Promise<string | null> {
  if (isExisting(ref)) {
    const [found] = await db
      .select({ id: faculties.id })
      .from(faculties)
      .where(and(eq(faculties.id, ref.id), eq(faculties.universityId, universityId)))
      .limit(1);
    return found?.id ?? null;
  }

  const [existing] = await db
    .select({ id: faculties.id })
    .from(faculties)
    .where(and(eq(faculties.universityId, universityId), eq(faculties.name, ref.name)))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(faculties)
    .values({ universityId, name: ref.name, isVerified: false, createdBy })
    .returning({ id: faculties.id });
  return created?.id ?? null;
}

export async function resolveDepartment(
  db: Database,
  facultyId: string,
  ref: Ref<{ name: string }>,
  createdBy: string | null,
): Promise<string | null> {
  if (isExisting(ref)) {
    const [found] = await db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.id, ref.id), eq(departments.facultyId, facultyId)))
      .limit(1);
    return found?.id ?? null;
  }

  const [existing] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.facultyId, facultyId), eq(departments.name, ref.name)))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(departments)
    .values({ facultyId, name: ref.name, isVerified: false, createdBy })
    .returning({ id: departments.id });
  return created?.id ?? null;
}

export async function searchUniversities(db: Database, query: string, limit = 20) {
  const q = query.trim();
  return db
    .select({
      id: universities.id,
      name: universities.name,
      country: universities.country,
      isVerified: universities.isVerified,
    })
    .from(universities)
    .where(q ? or(ilike(universities.name, `%${q}%`)) : undefined)
    .limit(Math.min(limit, 50));
}

export async function listFaculties(db: Database, universityId: string) {
  return db
    .select({ id: faculties.id, name: faculties.name, isVerified: faculties.isVerified })
    .from(faculties)
    .where(eq(faculties.universityId, universityId));
}

export async function listDepartments(db: Database, facultyId: string) {
  return db
    .select({
      id: departments.id,
      name: departments.name,
      isVerified: departments.isVerified,
    })
    .from(departments)
    .where(eq(departments.facultyId, facultyId));
}

export async function listAcademicYears(db: Database, universityId: string) {
  return db
    .select({
      id: academicYears.id,
      label: academicYears.label,
      startsOn: academicYears.startsOn,
      endsOn: academicYears.endsOn,
    })
    .from(academicYears)
    .where(eq(academicYears.universityId, universityId));
}

export async function findTermById(db: Database, termId: string) {
  const [term] = await db
    .select({ id: academicTerms.id, label: academicTerms.label, endsOn: academicTerms.endsOn })
    .from(academicTerms)
    .where(eq(academicTerms.id, termId))
    .limit(1);
  return term ?? null;
}
