import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { courseOfferings } from './courses';
import { users } from './identity';
import { studyTopics } from './knowledge';

export const availabilityKind = pgEnum('availability_kind', [
  'study',
  'work',
  'gym',
  'class',
  'sleep',
  'other',
]);
export const planStatus = pgEnum('plan_status', ['active', 'superseded', 'archived']);
export const sessionStatus = pgEnum('session_status', [
  'planned',
  'completed',
  'skipped',
  'rescheduled',
]);

/**
 * Weekly availability. `isAvailable = false` marks a blocked window (work, gym,
 * sleep); the scheduler derives free intervals by subtraction rather than
 * asking anyone to enumerate them.
 */
export const studyAvailability = pgTable(
  'study_availability',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    studentUserId: uuid('student_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    weekday: integer('weekday').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    kind: availabilityKind('kind').notNull(),
    /** false marks a blocked window; the scheduler subtracts these. */
    isAvailable: boolean('is_available').notNull(),
  },
  (t) => [
    index('study_availability_user_idx').on(t.studentUserId, t.weekday),
    check('study_availability_weekday_ck', sql`${t.weekday} BETWEEN 0 AND 6`),
    check('study_availability_range_ck', sql`${t.endTime} > ${t.startTime}`),
  ],
);

export const studentCommitments = pgTable(
  'student_commitments',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    studentUserId: uuid('student_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    kind: availabilityKind('kind').notNull().default('other'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('student_commitments_user_idx').on(t.studentUserId, t.startsAt),
    check('student_commitments_range_ck', sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

/** Exam dates drive urgency, and are a hard horizon: nothing is scheduled after one. */
export const courseExams = pgTable(
  'course_exams',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    offeringId: uuid('offering_id')
      .notNull()
      .references(() => courseOfferings.id, { onDelete: 'cascade' }),
    studentUserId: uuid('student_user_id').references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    examAt: timestamp('exam_at', { withTimezone: true }).notNull(),
    weight: real('weight').notNull().default(1),
  },
  (t) => [index('course_exams_offering_idx').on(t.offeringId, t.examAt)],
);

export const studyPlans = pgTable(
  'study_plans',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    studentUserId: uuid('student_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    horizonStart: date('horizon_start').notNull(),
    horizonEnd: date('horizon_end').notNull(),
    status: planStatus('status').notNull().default('active'),
    /** Version of the deterministic scheduler that produced this plan. */
    generatorVersion: text('generator_version').notNull(),
    /** Inputs used, so a plan is reproducible without any model call. */
    constraintsSnapshot: jsonb('constraints_snapshot').notNull(),
    coachMessage: text('coach_message'),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One active plan per student: a second would be ambiguous, not useful.
    uniqueIndex('study_plans_one_active_idx')
      .on(t.studentUserId)
      .where(sql`status = 'active'`),
  ],
);

export const studySessions = pgTable(
  'study_sessions',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    planId: uuid('plan_id')
      .notNull()
      .references(() => studyPlans.id, { onDelete: 'cascade' }),
    studentUserId: uuid('student_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    offeringId: uuid('offering_id').references(() => courseOfferings.id, {
      onDelete: 'cascade',
    }),
    topicId: uuid('topic_id').references(() => studyTopics.id, { onDelete: 'set null' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    activityType: text('activity_type').notNull(),
    priorityScore: real('priority_score').notNull(),
    status: sessionStatus('status').notNull().default('planned'),
    /** The numbers the scheduler actually used, so a plan can explain itself. */
    rationale: jsonb('rationale').notNull().default({}),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    actualMinutes: integer('actual_minutes'),
  },
  (t) => [
    index('study_sessions_student_idx').on(t.studentUserId, t.startsAt),
    check('study_sessions_range_ck', sql`${t.endsAt} > ${t.startsAt}`),
  ],
);
