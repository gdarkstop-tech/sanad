import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { users } from './identity';

/**
 * Reference data. Registration asks for these, and on day one none of it
 * exists — so a student may create a missing entry, marked unverified.
 * Without this, registration deadlocks on empty tables (DATABASE.md §3).
 */
export const universities = pgTable(
  'universities',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    name: text('name').notNull(),
    country: text('country'),
    isVerified: boolean('is_verified').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('universities_name_country_key').on(t.name, t.country)],
);

export const faculties = pgTable(
  'faculties',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    universityId: uuid('university_id')
      .notNull()
      .references(() => universities.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isVerified: boolean('is_verified').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('faculties_university_name_key').on(t.universityId, t.name)],
);

export const departments = pgTable(
  'departments',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    facultyId: uuid('faculty_id')
      .notNull()
      .references(() => faculties.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isVerified: boolean('is_verified').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('departments_faculty_name_key').on(t.facultyId, t.name)],
);

export const academicYears = pgTable(
  'academic_years',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    universityId: uuid('university_id')
      .notNull()
      .references(() => universities.id, { onDelete: 'cascade' }),
    /** "2025/2026" — a label. Never parsed for meaning. */
    label: text('label').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
  },
  (t) => [
    unique('academic_years_university_label_key').on(t.universityId, t.label),
    check('academic_years_range_ck', sql`${t.endsOn} > ${t.startsOn}`),
  ],
);

/**
 * Terms carry the dates that drive recording retention (DATABASE.md §16):
 * a recording is kept until the end of the term its offering belongs to.
 */
export const academicTerms = pgTable(
  'academic_terms',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    isSummer: boolean('is_summer').notNull().default(false),
    startsOn: date('starts_on').notNull(),
    /** Recording retention horizon. */
    endsOn: date('ends_on').notNull(),
  },
  (t) => [
    unique('academic_terms_year_label_key').on(t.academicYearId, t.label),
    check('academic_terms_range_ck', sql`${t.endsOn} > ${t.startsOn}`),
  ],
);

/**
 * Profiles are separate tables per role: each carries different fields, and a
 * single wide table of mostly-null columns loses every NOT NULL (DATABASE.md §3).
 */
export const studentProfiles = pgTable('student_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  universityId: uuid('university_id').references(() => universities.id, {
    onDelete: 'set null',
  }),
  facultyId: uuid('faculty_id').references(() => faculties.id, { onDelete: 'set null' }),
  departmentId: uuid('department_id').references(() => departments.id, {
    onDelete: 'set null',
  }),
  academicYearId: uuid('academic_year_id').references(() => academicYears.id, {
    onDelete: 'set null',
  }),
  /** Free text. `departmentId` is the structured field for filtering. */
  major: text('major'),
  studentNumber: text('student_number'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const instructorProfiles = pgTable('instructor_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  universityId: uuid('university_id').references(() => universities.id, {
    onDelete: 'set null',
  }),
  departmentId: uuid('department_id').references(() => departments.id, {
    onDelete: 'set null',
  }),
  title: text('title'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const teachingAssistantProfiles = pgTable('teaching_assistant_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  universityId: uuid('university_id').references(() => universities.id, {
    onDelete: 'set null',
  }),
  departmentId: uuid('department_id').references(() => departments.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
