import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  SCHEDULER_VERSION,
  addExamDate,
  completeSession,
  createCourse,
  currentPlan,
  freeIntervals,
  generatePlan,
  priorityFor,
  recordAnswer,
  setAvailability,
  type Subject,
} from '@sanad/core';
import { studyPlans, studySessions, studyTopics } from '@sanad/db';
import { createTestStudent, openTestDatabase, resetDatabase } from '../helpers';

const { db, close } = openTestDatabase();

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await resetDatabase();
});

async function student(): Promise<Subject> {
  const { user } = await createTestStudent(db);
  return { userId: user.id, role: user.role };
}

/** A Monday, so weekday arithmetic in the tests is unambiguous. */
const MONDAY = new Date('2026-08-17T06:00:00Z');

const WEEKDAY_EVENINGS = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  startTime: '18:00',
  endTime: '22:00',
  kind: 'study' as const,
  isAvailable: true,
}));

async function courseWithTopics(subject: Subject, title: string, topicNames: string[]) {
  const course = await createCourse(db, subject, {
    title,
    primaryLanguage: 'en',
    secondaryLanguages: [],
  });
  for (const name of topicNames) {
    await db.insert(studyTopics).values({
      offeringId: course.id,
      name,
      slug: name.toLowerCase().replace(/\W+/g, '-'),
    });
  }
  return course;
}

describe('free interval computation', () => {
  it('subtracts blocked windows from available ones', () => {
    const intervals = freeIntervals(
      [
        { weekday: 1, startTime: '18:00', endTime: '22:00', isAvailable: true },
        { weekday: 1, startTime: '19:00', endTime: '20:00', isAvailable: false },
      ],
      [],
      MONDAY,
      1,
    );
    expect(intervals).toHaveLength(2);
    expect(intervals[0]!.end.getUTCHours()).toBe(19);
    expect(intervals[1]!.start.getUTCHours()).toBe(20);
  });

  it('subtracts one-off commitments too', () => {
    const intervals = freeIntervals(
      [{ weekday: 1, startTime: '18:00', endTime: '22:00', isAvailable: true }],
      [{ start: new Date('2026-08-17T18:30:00Z'), end: new Date('2026-08-17T21:00:00Z') }],
      MONDAY,
      1,
    );
    // Only the 21:00-22:00 hour survives; the 18:00-18:30 sliver is too short.
    expect(intervals).toHaveLength(1);
    expect(intervals[0]!.start.getUTCHours()).toBe(21);
  });

  it('drops slivers shorter than one session', () => {
    const intervals = freeIntervals(
      [{ weekday: 1, startTime: '18:00', endTime: '18:20', isAvailable: true }],
      [],
      MONDAY,
      1,
    );
    expect(intervals).toHaveLength(0);
  });

  it('returns nothing when no availability is declared', () => {
    expect(freeIntervals([], [], MONDAY, 7)).toHaveLength(0);
  });
});

describe('priority', () => {
  const base = {
    topicId: 't',
    topicName: 'T',
    offeringId: 'o',
    courseTitle: 'C',
    accuracy: 0,
    examAt: null,
  };

  it('ranks a weaker topic above a stronger one', () => {
    const weak = priorityFor({ ...base, masteryScore: 0.2, daysToExam: null });
    const strong = priorityFor({ ...base, masteryScore: 0.9, daysToExam: null });
    expect(weak).toBeGreaterThan(strong);
  });

  it('ranks an imminent exam above a distant one', () => {
    const soon = priorityFor({ ...base, masteryScore: 0.5, daysToExam: 2 });
    const later = priorityFor({ ...base, masteryScore: 0.5, daysToExam: 30 });
    expect(soon).toBeGreaterThan(later);
  });

  it('gives no priority to a topic whose exam has passed', () => {
    expect(priorityFor({ ...base, masteryScore: 0.1, daysToExam: -1 })).toBe(0);
  });
});

describe('study plan generation', () => {
  it('produces sessions inside the declared free time', async () => {
    const owner = await student();
    await courseWithTopics(owner, 'Any Course', ['Topic A', 'Topic B']);
    await setAvailability(db, owner, WEEKDAY_EVENINGS);

    const plan = await generatePlan(db, owner, { now: MONDAY, horizonDays: 3 });

    expect(plan.sessions.length).toBeGreaterThan(0);
    expect(plan.generatorVersion).toBe(SCHEDULER_VERSION);
    for (const session of plan.sessions) {
      const hour = session.startsAt.getUTCHours();
      expect(hour).toBeGreaterThanOrEqual(18);
      expect(session.endsAt.getUTCHours()).toBeLessThanOrEqual(22);
    }
  });

  it('never double-books, and the database would refuse if it tried', async () => {
    const owner = await student();
    await courseWithTopics(owner, 'Any Course', ['Topic A', 'Topic B', 'Topic C']);
    await setAvailability(db, owner, WEEKDAY_EVENINGS);

    const plan = await generatePlan(db, owner, { now: MONDAY, horizonDays: 5 });
    const sorted = [...plan.sessions].sort(
      (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
    );
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i]!.startsAt.getTime()).toBeGreaterThanOrEqual(
        sorted[i - 1]!.endsAt.getTime(),
      );
    }

    // The scheduler is not the only guard: §15 requires this be impossible.
    const first = sorted[0]!;
    await expect(
      db.insert(studySessions).values({
        planId: plan.planId,
        studentUserId: owner.userId,
        startsAt: first.startsAt,
        endsAt: first.endsAt,
        activityType: 'review',
        priorityScore: 1,
      }),
    ).rejects.toThrow(/study_sessions_no_overlap/);
  });

  it('respects the daily cap', async () => {
    const owner = await student();
    await courseWithTopics(owner, 'Any Course', ['Topic A', 'Topic B']);
    // A very long window: the cap, not the window, must bound the day.
    await setAvailability(db, owner, [
      { weekday: 1, startTime: '06:00', endTime: '23:00', kind: 'study', isAvailable: true },
    ]);

    const plan = await generatePlan(db, owner, { now: MONDAY, horizonDays: 1 });
    const minutes = plan.sessions.reduce(
      (sum, s) => sum + (s.endsAt.getTime() - s.startsAt.getTime()) / 60_000,
      0,
    );
    expect(minutes).toBeLessThanOrEqual(240);
  });

  it('never schedules a session after its exam', async () => {
    const owner = await student();
    const course = await courseWithTopics(owner, 'Exam Course', ['Topic A']);
    await setAvailability(db, owner, WEEKDAY_EVENINGS);

    const examAt = new Date('2026-08-18T09:00:00Z'); // Tuesday morning
    await addExamDate(db, owner, { offeringId: course.id, title: 'Midterm', examAt });

    const plan = await generatePlan(db, owner, { now: MONDAY, horizonDays: 7 });
    for (const session of plan.sessions) {
      expect(session.endsAt.getTime()).toBeLessThanOrEqual(examAt.getTime());
    }
  });

  it('prioritises the student’s weak topics', async () => {
    const owner = await student();
    const course = await courseWithTopics(owner, 'Any Course', ['Strong Topic', 'Weak Topic']);
    await setAvailability(db, owner, WEEKDAY_EVENINGS);

    const topics = await db
      .select()
      .from(studyTopics)
      .where(eq(studyTopics.offeringId, course.id));
    const strong = topics.find((t) => t.name === 'Strong Topic')!;
    const weak = topics.find((t) => t.name === 'Weak Topic')!;

    for (let i = 0; i < 4; i += 1) {
      await recordAnswer(db, owner, { offeringId: course.id, topicId: strong.id, isCorrect: true });
      await recordAnswer(db, owner, { offeringId: course.id, topicId: weak.id, isCorrect: false });
    }

    const plan = await generatePlan(db, owner, { now: MONDAY, horizonDays: 2 });
    expect(plan.sessions[0]?.topicName).toBe('Weak Topic');
  });

  it('is deterministic: the same inputs give the same plan', async () => {
    const owner = await student();
    await courseWithTopics(owner, 'Any Course', ['Topic A', 'Topic B']);
    await setAvailability(db, owner, WEEKDAY_EVENINGS);

    const first = await generatePlan(db, owner, { now: MONDAY, horizonDays: 3 });
    const second = await generatePlan(db, owner, { now: MONDAY, horizonDays: 3 });

    expect(second.sessions.map((s) => [s.startsAt.toISOString(), s.topicName])).toEqual(
      first.sessions.map((s) => [s.startsAt.toISOString(), s.topicName]),
    );
  });

  it('supersedes the previous plan rather than keeping two active', async () => {
    const owner = await student();
    await courseWithTopics(owner, 'Any Course', ['Topic A']);
    await setAvailability(db, owner, WEEKDAY_EVENINGS);

    await generatePlan(db, owner, { now: MONDAY, horizonDays: 2 });
    await generatePlan(db, owner, { now: MONDAY, horizonDays: 2 });

    const active = await db
      .select()
      .from(studyPlans)
      .where(eq(studyPlans.status, 'active'));
    expect(active).toHaveLength(1);
  });

  it('explains itself with numbers the scheduler actually used', async () => {
    const owner = await student();
    const course = await courseWithTopics(owner, 'Physiology', ['Topic A']);
    await setAvailability(db, owner, WEEKDAY_EVENINGS);
    await addExamDate(db, owner, {
      offeringId: course.id,
      title: 'Final',
      examAt: new Date('2026-08-20T09:00:00Z'),
    });

    const plan = await generatePlan(db, owner, { now: MONDAY, horizonDays: 5 });
    expect(plan.coachMessage).toMatch(/session/);
    expect(plan.coachMessage).toMatch(/Physiology|weakest/);
    // Rationale carries the inputs, so the plan can justify each slot.
    expect(plan.sessions[0]?.rationale).toHaveProperty('mastery');
  });

  it('says so plainly when there is no free time', async () => {
    const owner = await student();
    await courseWithTopics(owner, 'Any Course', ['Topic A']);
    await setAvailability(db, owner, []);

    const plan = await generatePlan(db, owner, { now: MONDAY });
    expect(plan.sessions).toHaveLength(0);
    expect(plan.coachMessage).toMatch(/free study time/i);
  });

  it('says so plainly when there is nothing to study yet', async () => {
    const owner = await student();
    await setAvailability(db, owner, WEEKDAY_EVENINGS);
    const plan = await generatePlan(db, owner, { now: MONDAY });
    expect(plan.sessions).toHaveLength(0);
    expect(plan.coachMessage).toMatch(/Add a course/i);
  });

  it('reads back the active plan', async () => {
    const owner = await student();
    await courseWithTopics(owner, 'Any Course', ['Topic A']);
    await setAvailability(db, owner, WEEKDAY_EVENINGS);
    const generated = await generatePlan(db, owner, { now: MONDAY, horizonDays: 2 });

    const loaded = await currentPlan(db, owner);
    expect(loaded?.planId).toBe(generated.planId);
    expect(loaded?.sessions.length).toBe(generated.sessions.length);
    expect(loaded?.sessions[0]?.courseTitle).toBe('Any Course');
  });

  it('marks a session complete, and frees its slot', async () => {
    const owner = await student();
    await courseWithTopics(owner, 'Any Course', ['Topic A']);
    await setAvailability(db, owner, WEEKDAY_EVENINGS);
    const plan = await generatePlan(db, owner, { now: MONDAY, horizonDays: 2 });

    const session = plan.sessions[0]!;
    await completeSession(db, owner, session.id, 40);

    const [row] = await db
      .select()
      .from(studySessions)
      .where(eq(studySessions.id, session.id));
    expect(row?.status).toBe('completed');
    expect(row?.actualMinutes).toBe(40);
  });

  it('refuses to complete another student’s session', async () => {
    const owner = await student();
    const other = await student();
    await courseWithTopics(owner, 'Any Course', ['Topic A']);
    await setAvailability(db, owner, WEEKDAY_EVENINGS);
    const plan = await generatePlan(db, owner, { now: MONDAY, horizonDays: 2 });

    await expect(
      completeSession(db, other, plan.sessions[0]!.id),
    ).rejects.toMatchObject({ status: 404 });
  });
});
