import { and, desc, eq, isNull, or } from 'drizzle-orm';
import type { CreateCourseInput, UpdateCourseInput } from '@sanad/contracts';
import {
  courseEnrollments,
  courseOfferings,
  courses,
  type Database,
} from '@sanad/db';
import { Errors } from '../errors';
import { canActOnCourse, type CourseAction, type Subject } from '../permissions';

/**
 * A "course" in the API is an offering (DATABASE.md §3). Creating one makes
 * both rows in a single transaction, so the catalogue/offering split never
 * surfaces in the UI.
 *
 * Nothing here knows what a subject is. `title` is whatever the student typed.
 */

export interface CourseView {
  id: string; // offering id — the client's course id
  courseId: string;
  title: string;
  code: string | null;
  description: string | null;
  color: string | null;
  primaryLanguage: string;
  secondaryLanguages: string[];
  termLabel: string | null;
  isOwner: boolean;
  archivedAt: Date | null;
  createdAt: Date;
}

export async function createCourse(
  db: Database,
  subject: Subject,
  input: CreateCourseInput,
): Promise<CourseView> {
  const termId = input.term && 'id' in input.term ? input.term.id : null;
  const termLabel = input.term && 'label' in input.term ? input.term.label : null;

  return db.transaction(async (tx) => {
    const [course] = await tx
      .insert(courses)
      .values({
        ownerUserId: subject.userId,
        title: input.title,
        code: input.code ?? null,
        description: input.description ?? null,
        color: input.color ?? null,
        departmentId: input.departmentId ?? null,
      })
      .returning();
    if (!course) throw Errors.internal();

    const [offering] = await tx
      .insert(courseOfferings)
      .values({
        courseId: course.id,
        termId,
        termLabel,
        primaryLanguage: input.primaryLanguage,
        secondaryLanguages: input.secondaryLanguages,
      })
      .returning();
    if (!offering) throw Errors.internal();

    // The owner is enrolled in their own course so content queries need only
    // one path, not "owner OR enrolled" everywhere downstream.
    await tx
      .insert(courseEnrollments)
      .values({ offeringId: offering.id, userId: subject.userId });

    return toView(course, offering, true);
  });
}

/**
 * Lists the caller's courses.
 *
 * Archived courses are hidden by default rather than deleted: a student who
 * archives last semester has not asked to lose its lectures, and `deletedAt`
 * already means deleted.
 */
export async function listCourses(
  db: Database,
  subject: Subject,
  options: { includeArchived?: boolean } = {},
): Promise<CourseView[]> {
  const rows = await db
    .select({ course: courses, offering: courseOfferings })
    .from(courseOfferings)
    .innerJoin(courses, eq(courses.id, courseOfferings.courseId))
    .leftJoin(
      courseEnrollments,
      and(
        eq(courseEnrollments.offeringId, courseOfferings.id),
        eq(courseEnrollments.userId, subject.userId),
      ),
    )
    .where(
      and(
        isNull(courses.deletedAt),
        options.includeArchived ? undefined : isNull(courseOfferings.archivedAt),
        or(eq(courses.ownerUserId, subject.userId), eq(courseEnrollments.userId, subject.userId)),
      ),
    )
    .orderBy(desc(courses.createdAt));

  return rows.map((r) => toView(r.course, r.offering, r.course.ownerUserId === subject.userId));
}

/**
 * Archives or restores a course.
 *
 * Reversible on purpose, and separate from deletion: archiving is a filing
 * decision, deletion is a destructive one, and conflating them means a student
 * tidying up loses a semester.
 */
export async function setCourseArchived(
  db: Database,
  subject: Subject,
  offeringId: string,
  archived: boolean,
): Promise<CourseView> {
  const { course } = await getCourseFor(db, subject, offeringId, 'update');
  const [offering] = await db
    .update(courseOfferings)
    .set({ archivedAt: archived ? new Date() : null })
    .where(eq(courseOfferings.id, offeringId))
    .returning();
  if (!offering) throw Errors.notFound('Course');
  return toView(course, offering, course.ownerUserId === subject.userId);
}

/**
 * Loads an offering and evaluates the permission centrally. Every course
 * endpoint goes through here — no handler writes its own ownership check
 * (ARCHITECTURE.md §7).
 */
export async function getCourseFor(
  db: Database,
  subject: Subject,
  offeringId: string,
  action: CourseAction,
): Promise<{ course: typeof courses.$inferSelect; offering: typeof courseOfferings.$inferSelect }> {
  const [row] = await db
    .select({ course: courses, offering: courseOfferings, enrollmentId: courseEnrollments.id })
    .from(courseOfferings)
    .innerJoin(courses, eq(courses.id, courseOfferings.courseId))
    .leftJoin(
      courseEnrollments,
      and(
        eq(courseEnrollments.offeringId, courseOfferings.id),
        eq(courseEnrollments.userId, subject.userId),
      ),
    )
    .where(and(eq(courseOfferings.id, offeringId), isNull(courses.deletedAt)))
    .limit(1);

  if (!row) throw Errors.notFound('Course');

  const decision = canActOnCourse(subject, action, {
    ownerUserId: row.course.ownerUserId,
    isEnrolled: row.enrollmentId !== null,
  });

  if (!decision.allowed) {
    throw decision.reason === 'not_found'
      ? Errors.notFound('Course')
      : Errors.forbidden('Only the course owner can do this.');
  }

  return { course: row.course, offering: row.offering };
}

export async function readCourse(
  db: Database,
  subject: Subject,
  offeringId: string,
): Promise<CourseView> {
  const { course, offering } = await getCourseFor(db, subject, offeringId, 'read');
  return toView(course, offering, course.ownerUserId === subject.userId);
}

export async function updateCourse(
  db: Database,
  subject: Subject,
  offeringId: string,
  patch: UpdateCourseInput,
): Promise<CourseView> {
  const { course, offering } = await getCourseFor(db, subject, offeringId, 'update');

  const courseFields = {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.code !== undefined ? { code: patch.code } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.color !== undefined ? { color: patch.color } : {}),
  };
  const offeringFields = {
    ...(patch.primaryLanguage !== undefined
      ? { primaryLanguage: patch.primaryLanguage }
      : {}),
    ...(patch.secondaryLanguages !== undefined
      ? { secondaryLanguages: patch.secondaryLanguages }
      : {}),
  };

  return db.transaction(async (tx) => {
    let nextCourse = course;
    if (Object.keys(courseFields).length > 0) {
      const [updated] = await tx
        .update(courses)
        .set({ ...courseFields, updatedAt: new Date() })
        .where(eq(courses.id, course.id))
        .returning();
      if (updated) nextCourse = updated;
    }

    let nextOffering = offering;
    if (Object.keys(offeringFields).length > 0) {
      const [updated] = await tx
        .update(courseOfferings)
        .set(offeringFields)
        .where(eq(courseOfferings.id, offering.id))
        .returning();
      if (updated) nextOffering = updated;
    }

    return toView(nextCourse, nextOffering, true);
  });
}

/** Soft delete: a mis-deleted course with a semester of lectures must be recoverable. */
export async function deleteCourse(
  db: Database,
  subject: Subject,
  offeringId: string,
): Promise<void> {
  const { course } = await getCourseFor(db, subject, offeringId, 'delete');
  await db
    .update(courses)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(courses.id, course.id));
}

function toView(
  course: typeof courses.$inferSelect,
  offering: typeof courseOfferings.$inferSelect,
  isOwner: boolean,
): CourseView {
  return {
    id: offering.id,
    courseId: course.id,
    title: course.title,
    code: course.code,
    description: course.description,
    color: course.color,
    primaryLanguage: offering.primaryLanguage,
    secondaryLanguages: offering.secondaryLanguages,
    termLabel: offering.termLabel,
    isOwner,
    archivedAt: offering.archivedAt,
    createdAt: course.createdAt,
  };
}
