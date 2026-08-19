import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { academicTerms, departments, universities } from './academic';
import { enrollmentStatus, userRole } from './enums';
import { users } from './identity';

/**
 * Catalogue entry. Student-owned: `ownerUserId` is the authority for update
 * and delete (ARCHITECTURE.md §7). Nothing about a subject is enumerated
 * here or anywhere in application code — a course is whatever the student
 * types (DATABASE.md §3, brief §32).
 */
export const courses = pgTable(
  'courses',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Nullable: a student may create a course before any institutional record exists. */
    universityId: uuid('university_id').references(() => universities.id, {
      onDelete: 'set null',
    }),
    departmentId: uuid('department_id').references(() => departments.id, {
      onDelete: 'set null',
    }),
    /** "CS201" — opaque to the application. */
    code: text('code'),
    title: text('title').notNull(),
    description: text('description'),
    /** UI affordance only. */
    color: text('color'),
    /** Seed fixtures flag themselves so the course-agnostic check can find them. */
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('courses_owner_idx').on(t.ownerUserId)],
);

/**
 * One delivery of a course in one term. Content, enrollment, and retention
 * hang off the offering, not the catalogue entry (DATABASE.md §3).
 * Created together with the course in a single transaction; the split never
 * surfaces in the UI, which calls an offering "a course".
 */
export const courseOfferings = pgTable(
  'course_offerings',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    termId: uuid('term_id').references(() => academicTerms.id, { onDelete: 'set null' }),
    /** Fallback label when no institutional term record exists. */
    termLabel: text('term_label'),
    /** Content language hint for ASR and generation. Not a constraint. */
    primaryLanguage: text('primary_language').notNull().default('ar'),
    /** e.g. ['en'] for code-switched delivery. */
    secondaryLanguages: text('secondary_languages').array().notNull().default([]),
    /** Per-course generation config. Never subject logic in code. */
    questionProfile: jsonb('question_profile').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('course_offerings_course_term_key').on(t.courseId, t.termId),
    index('course_offerings_course_idx').on(t.courseId),
  ],
);

export const courseEnrollments = pgTable(
  'course_enrollments',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    offeringId: uuid('offering_id')
      .notNull()
      .references(() => courseOfferings.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: enrollmentStatus('status').notNull().default('active'),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('course_enrollments_offering_user_key').on(t.offeringId, t.userId),
    index('course_enrollments_user_idx').on(t.userId, t.status),
  ],
);

/**
 * Staff assignment exists in the schema, but carries no course-management
 * permission in the MVP — instructors and TAs cannot edit student courses
 * (ARCHITECTURE.md §7). It becomes meaningful with the deferred instructor
 * features.
 */
export const courseStaff = pgTable(
  'course_staff',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    offeringId: uuid('offering_id')
      .notNull()
      .references(() => courseOfferings.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    staffRole: userRole('staff_role').notNull(),
  },
  (t) => [unique('course_staff_offering_user_key').on(t.offeringId, t.userId)],
);
