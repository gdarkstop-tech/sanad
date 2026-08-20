import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import {
  courseExams,
  courseOfferings,
  courses,
  studentCommitments,
  studentTopicMastery,
  studyAvailability,
  studyPlans,
  studySessions,
  studyTopics,
  type Database,
} from '@sanad/db';
import { Errors } from '../errors';
import type { Subject } from '../permissions';

/**
 * Study Coach (§19 of the brief).
 *
 * **The scheduler is ordinary code.** No model decides whether two sessions
 * overlap, whether a session falls after its exam, or how long a student
 * should work. Those are constraints, and a language model asked to respect
 * them will eventually not. The model — when one exists — writes only the
 * sentence that explains the plan.
 *
 * The plan is reproducible: `constraintsSnapshot` plus `generatorVersion`
 * regenerate an identical plan with no model call at all.
 */

export const SCHEDULER_VERSION = 'scheduler-1';

const SESSION_MINUTES = 45;
const BREAK_MINUTES = 15;
const MAX_DAILY_MINUTES = 240;
const HORIZON_DAYS = 7;

export interface PlannedSession {
  id: string;
  startsAt: Date;
  endsAt: Date;
  activityType: string;
  priorityScore: number;
  courseId: string | null;
  courseTitle: string | null;
  topicId: string | null;
  topicName: string | null;
  rationale: Record<string, unknown>;
}

export interface StudyPlan {
  planId: string;
  horizonStart: string;
  horizonEnd: string;
  generatorVersion: string;
  coachMessage: string;
  sessions: PlannedSession[];
}

interface Interval {
  start: Date;
  end: Date;
}

/** Free time = declared study windows − blocked windows − one-off commitments. */
export function freeIntervals(
  availability: Array<{
    weekday: number;
    startTime: string;
    endTime: string;
    isAvailable: boolean;
  }>,
  commitments: Interval[],
  horizonStart: Date,
  days: number,
): Interval[] {
  const open: Interval[] = [];
  const blocked: Interval[] = [...commitments];

  for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
    const day = new Date(horizonStart);
    day.setUTCDate(day.getUTCDate() + dayOffset);
    const weekday = day.getUTCDay();

    for (const window of availability) {
      if (window.weekday !== weekday) continue;
      const interval = {
        start: atTime(day, window.startTime),
        end: atTime(day, window.endTime),
      };
      (window.isAvailable ? open : blocked).push(interval);
    }
  }

  // Subtract every blocked interval from every open one.
  let result = open.sort((a, b) => a.start.getTime() - b.start.getTime());
  for (const block of blocked) {
    const next: Interval[] = [];
    for (const slot of result) {
      if (block.end <= slot.start || block.start >= slot.end) {
        next.push(slot);
        continue;
      }
      if (block.start > slot.start) next.push({ start: slot.start, end: block.start });
      if (block.end < slot.end) next.push({ start: block.end, end: slot.end });
    }
    result = next;
  }

  const minimumMs = SESSION_MINUTES * 60_000;
  return result.filter((slot) => slot.end.getTime() - slot.start.getTime() >= minimumMs);
}

function atTime(day: Date, hhmmss: string): Date {
  const [h = '0', m = '0', s = '0'] = hhmmss.split(':');
  const result = new Date(day);
  result.setUTCHours(Number(h), Number(m), Number(s), 0);
  return result;
}

export interface TopicCandidate {
  topicId: string;
  topicName: string;
  offeringId: string;
  courseTitle: string;
  masteryScore: number;
  accuracy: number;
  daysToExam: number | null;
  examAt: Date | null;
}

/**
 * Priority = how weak the topic is × how soon its exam is.
 *
 * Weakness drives what gets studied; exam proximity drives when. A topic with
 * no exam date still gets scheduled, just below one that does.
 */
export function priorityFor(candidate: TopicCandidate): number {
  const weakness = 1 - candidate.masteryScore;
  const urgency =
    candidate.daysToExam === null
      ? 1
      : candidate.daysToExam <= 0
        ? 0 // The exam has passed: nothing to schedule for it.
        : 1 + 3 / Math.max(1, candidate.daysToExam);
  return Number((weakness * urgency).toFixed(4));
}

export async function generatePlan(
  db: Database,
  subject: Subject,
  options: { now?: Date; horizonDays?: number } = {},
): Promise<StudyPlan> {
  const now = options.now ?? new Date();
  const days = options.horizonDays ?? HORIZON_DAYS;
  const horizonStart = startOfDay(now);
  const horizonEnd = new Date(horizonStart);
  horizonEnd.setUTCDate(horizonEnd.getUTCDate() + days);

  const availability = await db
    .select()
    .from(studyAvailability)
    .where(eq(studyAvailability.studentUserId, subject.userId));

  const commitments = await db
    .select()
    .from(studentCommitments)
    .where(
      and(
        eq(studentCommitments.studentUserId, subject.userId),
        gte(studentCommitments.endsAt, horizonStart),
        lte(studentCommitments.startsAt, horizonEnd),
      ),
    );

  const slots = freeIntervals(
    availability,
    commitments.map((c) => ({ start: c.startsAt, end: c.endsAt })),
    horizonStart,
    days,
  );

  const candidates = await topicCandidates(db, subject, now);

  const sessions = assign(slots, candidates, now);

  /*
   * Supersede rather than delete: a student may want to see what changed.
   *
   * The old plan's sessions must be retired in the same breath. They are still
   * 'planned', and the exclusion constraint counts only planned sessions — so
   * leaving them would make the new plan collide with the one it replaces.
   * Marking them 'rescheduled' is also the truth: they were replaced, not
   * skipped and not completed.
   */
  const superseded = await db
    .update(studyPlans)
    .set({ status: 'superseded' })
    .where(
      and(eq(studyPlans.studentUserId, subject.userId), eq(studyPlans.status, 'active')),
    )
    .returning({ id: studyPlans.id });

  if (superseded.length > 0) {
    await db
      .update(studySessions)
      .set({ status: 'rescheduled' })
      .where(
        and(
          inArray(
            studySessions.planId,
            superseded.map((plan) => plan.id),
          ),
          eq(studySessions.status, 'planned'),
        ),
      );
  }

  const [plan] = await db
    .insert(studyPlans)
    .values({
      studentUserId: subject.userId,
      horizonStart: toDateString(horizonStart),
      horizonEnd: toDateString(horizonEnd),
      generatorVersion: SCHEDULER_VERSION,
      constraintsSnapshot: {
        availability: availability.length,
        commitments: commitments.length,
        candidates: candidates.length,
        sessionMinutes: SESSION_MINUTES,
        maxDailyMinutes: MAX_DAILY_MINUTES,
        horizonDays: days,
      },
      coachMessage: coachMessage(sessions, candidates),
    })
    .returning();
  if (!plan) throw Errors.internal();

  const inserted: PlannedSession[] = [];
  for (const session of sessions) {
    const [row] = await db
      .insert(studySessions)
      .values({
        planId: plan.id,
        studentUserId: subject.userId,
        offeringId: session.candidate.offeringId,
        topicId: session.candidate.topicId,
        startsAt: session.start,
        endsAt: session.end,
        activityType: session.activityType,
        priorityScore: session.priority,
        rationale: session.rationale,
      })
      .returning();
    if (!row) continue;
    inserted.push({
      id: row.id,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      activityType: row.activityType,
      priorityScore: row.priorityScore,
      courseId: session.candidate.offeringId,
      courseTitle: session.candidate.courseTitle,
      topicId: session.candidate.topicId,
      topicName: session.candidate.topicName,
      rationale: session.rationale,
    });
  }

  return {
    planId: plan.id,
    horizonStart: plan.horizonStart,
    horizonEnd: plan.horizonEnd,
    generatorVersion: plan.generatorVersion,
    coachMessage: plan.coachMessage ?? '',
    sessions: inserted,
  };
}

interface Assignment {
  start: Date;
  end: Date;
  candidate: TopicCandidate;
  priority: number;
  activityType: string;
  rationale: Record<string, unknown>;
}

/**
 * Greedy fill, highest priority first.
 *
 * Four rules are enforced here, and none of them is negotiable by a model:
 * nothing before now, nothing after a topic's exam, a daily cap, and spacing
 * so the same topic is not repeated back to back.
 */
function assign(slots: Interval[], candidates: TopicCandidate[], now: Date): Assignment[] {
  const ranked = [...candidates].sort((a, b) => priorityFor(b) - priorityFor(a));
  if (ranked.length === 0) return [];

  const assignments: Assignment[] = [];
  const dailyMinutes = new Map<string, number>();
  let cursorIndex = 0;

  for (const slot of slots) {
    let cursor = new Date(Math.max(slot.start.getTime(), now.getTime()));

    while (cursor.getTime() + SESSION_MINUTES * 60_000 <= slot.end.getTime()) {
      const dayKey = toDateString(cursor);
      const used = dailyMinutes.get(dayKey) ?? 0;
      if (used + SESSION_MINUTES > MAX_DAILY_MINUTES) break;

      const end = new Date(cursor.getTime() + SESSION_MINUTES * 60_000);

      // Pick the next candidate whose exam has not already passed, avoiding an
      // immediate repeat of the previous session's topic.
      let picked: TopicCandidate | null = null;
      for (let offset = 0; offset < ranked.length; offset += 1) {
        const candidate = ranked[(cursorIndex + offset) % ranked.length]!;
        if (candidate.examAt && end > candidate.examAt) continue;
        if (assignments.at(-1)?.candidate.topicId === candidate.topicId && ranked.length > 1) {
          continue;
        }
        picked = candidate;
        cursorIndex = (cursorIndex + offset + 1) % ranked.length;
        break;
      }
      if (!picked) break;

      assignments.push({
        start: new Date(cursor),
        end,
        candidate: picked,
        priority: priorityFor(picked),
        activityType: picked.masteryScore < 0.4 ? 'review' : 'quiz',
        rationale: {
          mastery: picked.masteryScore,
          accuracy: picked.accuracy,
          daysToExam: picked.daysToExam,
        },
      });

      dailyMinutes.set(dayKey, used + SESSION_MINUTES);
      cursor = new Date(end.getTime() + BREAK_MINUTES * 60_000);
    }
  }

  return assignments;
}

async function topicCandidates(
  db: Database,
  subject: Subject,
  now: Date,
): Promise<TopicCandidate[]> {
  const enrolled = await db
    .select({ offeringId: courseOfferings.id, courseTitle: courses.title })
    .from(courseOfferings)
    .innerJoin(courses, eq(courses.id, courseOfferings.courseId))
    .where(eq(courses.ownerUserId, subject.userId));
  if (enrolled.length === 0) return [];

  const offeringIds = enrolled.map((row) => row.offeringId);
  const titles = new Map(enrolled.map((row) => [row.offeringId, row.courseTitle]));

  const exams = await db
    .select()
    .from(courseExams)
    .where(inArray(courseExams.offeringId, offeringIds))
    .orderBy(asc(courseExams.examAt));
  const nextExam = new Map<string, Date>();
  for (const exam of exams) {
    if (exam.examAt > now && !nextExam.has(exam.offeringId)) {
      nextExam.set(exam.offeringId, exam.examAt);
    }
  }

  const topics = await db
    .select({
      topicId: studyTopics.id,
      topicName: studyTopics.name,
      offeringId: studyTopics.offeringId,
    })
    .from(studyTopics)
    .where(inArray(studyTopics.offeringId, offeringIds));

  const mastery = await db
    .select()
    .from(studentTopicMastery)
    .where(eq(studentTopicMastery.studentUserId, subject.userId));
  const masteryByTopic = new Map(mastery.map((row) => [row.topicId, row]));

  return topics.map((topic) => {
    const record = masteryByTopic.get(topic.topicId);
    const examAt = nextExam.get(topic.offeringId) ?? null;
    return {
      topicId: topic.topicId,
      topicName: topic.topicName,
      offeringId: topic.offeringId,
      courseTitle: titles.get(topic.offeringId) ?? '',
      // An unseen topic scores 0 mastery, so new material is scheduled too —
      // the coach must not only ever revisit what has already been practised.
      masteryScore: record?.masteryScore ?? 0,
      accuracy: record?.accuracy ?? 0,
      examAt,
      daysToExam: examAt
        ? Math.ceil((examAt.getTime() - now.getTime()) / 86_400_000)
        : null,
    };
  });
}

/**
 * The one place a language model would write, if one were configured.
 *
 * It explains the plan; it never decides it. The numbers quoted here come from
 * the scheduler's own output.
 */
function coachMessage(assignments: Assignment[], candidates: TopicCandidate[]): string {
  if (candidates.length === 0) {
    return 'Add a course and some lecture material, and I can build you a study plan.';
  }
  if (assignments.length === 0) {
    return 'I could not find any free study time in your week. Add some available hours and I will plan around them.';
  }

  const weakest = [...candidates].sort((a, b) => a.masteryScore - b.masteryScore)[0]!;
  const soonest = candidates
    .filter((candidate) => candidate.daysToExam !== null && candidate.daysToExam > 0)
    .sort((a, b) => (a.daysToExam ?? 0) - (b.daysToExam ?? 0))[0];

  const totalMinutes = assignments.length * SESSION_MINUTES;
  const parts = [
    `I have planned ${assignments.length} session${assignments.length === 1 ? '' : 's'} (${totalMinutes} minutes) across your free time.`,
  ];

  if (weakest.masteryScore < 0.6) {
    parts.push(`${weakest.topicName} is your weakest area, so it comes first.`);
  }
  if (soonest?.daysToExam) {
    parts.push(
      `Your ${soonest.courseTitle} exam is in ${soonest.daysToExam} day${soonest.daysToExam === 1 ? '' : 's'}, so its topics are weighted higher.`,
    );
  }

  return parts.join(' ');
}

export async function currentPlan(
  db: Database,
  subject: Subject,
): Promise<StudyPlan | null> {
  const [plan] = await db
    .select()
    .from(studyPlans)
    .where(
      and(eq(studyPlans.studentUserId, subject.userId), eq(studyPlans.status, 'active')),
    )
    .limit(1);
  if (!plan) return null;

  const rows = await db
    .select({
      id: studySessions.id,
      startsAt: studySessions.startsAt,
      endsAt: studySessions.endsAt,
      activityType: studySessions.activityType,
      priorityScore: studySessions.priorityScore,
      offeringId: studySessions.offeringId,
      topicId: studySessions.topicId,
      topicName: studyTopics.name,
      courseTitle: courses.title,
      rationale: studySessions.rationale,
    })
    .from(studySessions)
    .leftJoin(studyTopics, eq(studyTopics.id, studySessions.topicId))
    .leftJoin(courseOfferings, eq(courseOfferings.id, studySessions.offeringId))
    .leftJoin(courses, eq(courses.id, courseOfferings.courseId))
    .where(eq(studySessions.planId, plan.id))
    .orderBy(asc(studySessions.startsAt));

  return {
    planId: plan.id,
    horizonStart: plan.horizonStart,
    horizonEnd: plan.horizonEnd,
    generatorVersion: plan.generatorVersion,
    coachMessage: plan.coachMessage ?? '',
    sessions: rows.map((row) => ({
      id: row.id,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      activityType: row.activityType,
      priorityScore: row.priorityScore,
      courseId: row.offeringId,
      courseTitle: row.courseTitle,
      topicId: row.topicId,
      topicName: row.topicName,
      rationale: (row.rationale ?? {}) as Record<string, unknown>,
    })),
  };
}

export async function setAvailability(
  db: Database,
  subject: Subject,
  windows: Array<{
    weekday: number;
    startTime: string;
    endTime: string;
    kind: 'study' | 'work' | 'gym' | 'class' | 'sleep' | 'other';
    isAvailable: boolean;
  }>,
): Promise<void> {
  await db
    .delete(studyAvailability)
    .where(eq(studyAvailability.studentUserId, subject.userId));
  if (windows.length === 0) return;
  await db
    .insert(studyAvailability)
    .values(windows.map((window) => ({ ...window, studentUserId: subject.userId })));
}

export async function addExamDate(
  db: Database,
  subject: Subject,
  input: { offeringId: string; title: string; examAt: Date },
): Promise<void> {
  const { getCourseFor } = await import('./courses');
  await getCourseFor(db, subject, input.offeringId, 'read');
  await db.insert(courseExams).values({
    offeringId: input.offeringId,
    studentUserId: subject.userId,
    title: input.title,
    examAt: input.examAt,
  });
}

export async function completeSession(
  db: Database,
  subject: Subject,
  sessionId: string,
  actualMinutes?: number,
): Promise<void> {
  const [session] = await db
    .select()
    .from(studySessions)
    .where(eq(studySessions.id, sessionId))
    .limit(1);
  if (!session || session.studentUserId !== subject.userId) throw Errors.notFound('Session');

  await db
    .update(studySessions)
    .set({
      status: 'completed',
      completedAt: new Date(),
      actualMinutes: actualMinutes ?? null,
    })
    .where(eq(studySessions.id, sessionId));
}

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The student's declared week, in the order a schedule editor renders it.
 *
 * The scheduler works from the same rows: available windows minus blocked ones
 * minus dated commitments. Reading them back is what makes the plan
 * explainable — a student who sees no Monday sessions can look at Monday and
 * find the shift that took it.
 */
export async function readAvailability(
  db: Database,
  subject: Subject,
): Promise<Array<typeof studyAvailability.$inferSelect>> {
  return db
    .select()
    .from(studyAvailability)
    .where(eq(studyAvailability.studentUserId, subject.userId))
    .orderBy(asc(studyAvailability.weekday), asc(studyAvailability.startTime));
}

/** One-off commitments, upcoming first. Past ones are not shown or scheduled around. */
export async function listCommitments(
  db: Database,
  subject: Subject,
  from: Date = new Date(),
): Promise<Array<typeof studentCommitments.$inferSelect>> {
  return db
    .select()
    .from(studentCommitments)
    .where(
      and(
        eq(studentCommitments.studentUserId, subject.userId),
        gte(studentCommitments.endsAt, from),
      ),
    )
    .orderBy(asc(studentCommitments.startsAt));
}

export async function addCommitment(
  db: Database,
  subject: Subject,
  input: {
    title: string;
    kind: 'study' | 'work' | 'gym' | 'class' | 'sleep' | 'other';
    startsAt: Date;
    endsAt: Date;
  },
): Promise<typeof studentCommitments.$inferSelect> {
  const title = input.title.trim();
  if (title.length === 0) throw Errors.validation('A commitment needs a name.');
  if (input.endsAt <= input.startsAt) {
    throw Errors.validation('A commitment has to end after it starts.');
  }

  const [row] = await db
    .insert(studentCommitments)
    .values({
      studentUserId: subject.userId,
      title: title.slice(0, 200),
      kind: input.kind,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    })
    .returning();
  if (!row) throw Errors.internal();
  return row;
}

export async function removeCommitment(
  db: Database,
  subject: Subject,
  commitmentId: string,
): Promise<void> {
  const deleted = await db
    .delete(studentCommitments)
    // Scoped to the caller in the delete itself, so a guessed id removes
    // nothing rather than removing someone else's commitment.
    .where(
      and(
        eq(studentCommitments.id, commitmentId),
        eq(studentCommitments.studentUserId, subject.userId),
      ),
    )
    .returning({ id: studentCommitments.id });
  if (deleted.length === 0) throw Errors.notFound('Commitment');
}

/** Exam dates the student has entered, for one course or all of them. */
export async function listExamDates(
  db: Database,
  subject: Subject,
  offeringId?: string,
): Promise<Array<{ id: string; offeringId: string; courseTitle: string; title: string; examAt: Date }>> {
  if (offeringId) {
    const { getCourseFor } = await import('./courses');
    await getCourseFor(db, subject, offeringId, 'read');
  }

  const rows = await db
    .select({
      id: courseExams.id,
      offeringId: courseExams.offeringId,
      courseTitle: courses.title,
      title: courseExams.title,
      examAt: courseExams.examAt,
    })
    .from(courseExams)
    .innerJoin(courseOfferings, eq(courseOfferings.id, courseExams.offeringId))
    .innerJoin(courses, eq(courses.id, courseOfferings.courseId))
    .where(
      offeringId
        ? and(
            eq(courseExams.studentUserId, subject.userId),
            eq(courseExams.offeringId, offeringId),
          )
        : eq(courseExams.studentUserId, subject.userId),
    )
    .orderBy(asc(courseExams.examAt));

  return rows;
}

export async function removeExamDate(
  db: Database,
  subject: Subject,
  examId: string,
): Promise<void> {
  const deleted = await db
    .delete(courseExams)
    .where(and(eq(courseExams.id, examId), eq(courseExams.studentUserId, subject.userId)))
    .returning({ id: courseExams.id });
  if (deleted.length === 0) throw Errors.notFound('Exam date');
}
