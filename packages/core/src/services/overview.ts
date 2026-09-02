import { and, count, desc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  contentChunks,
  courseExams,
  courseOfferings,
  courses,
  lectures,
  materials,
  qaMessages,
  studentTopicMastery,
  studySessions,
  studyTopics,
  transcriptSegments,
  type Database,
} from '@sanad/db';
import type { Subject } from '../permissions';

/**
 * The student's own numbers, for the home screen.
 *
 * Every field is a count or a row from the database. Nothing here is estimated,
 * projected, or scored by a model — if a number cannot be derived from what the
 * student actually did, it is not on this page. A dashboard that invents
 * "82% mastery" teaches a student to distrust the ones that are real.
 */

export interface StudentOverview {
  courses: { active: number; archived: number };
  lectures: { total: number; withTranscript: number };
  materials: number;
  study: { completed: number; upcoming: number; nextAt: Date | null };
  questionsAsked: number;
  savedAnswers: number;
  weakTopics: Array<{ id: string; name: string; masteryScore: number; courseTitle: string | null }>;
  nextExams: Array<{ id: string; title: string; courseTitle: string; examAt: Date; daysAway: number }>;
  recentLectures: Array<{ id: string; title: string; courseTitle: string; createdAt: Date }>;
}

export async function studentOverview(
  db: Database,
  subject: Subject,
): Promise<StudentOverview> {
  const owned = db
    .select({ id: courseOfferings.id })
    .from(courseOfferings)
    .innerJoin(courses, eq(courses.id, courseOfferings.courseId))
    .where(and(eq(courses.ownerUserId, subject.userId), isNull(courses.deletedAt)));

  const [courseCounts] = await db
    .select({
      active: count(sql`CASE WHEN ${courseOfferings.archivedAt} IS NULL THEN 1 END`),
      archived: count(sql`CASE WHEN ${courseOfferings.archivedAt} IS NOT NULL THEN 1 END`),
    })
    .from(courseOfferings)
    .innerJoin(courses, eq(courses.id, courseOfferings.courseId))
    .where(and(eq(courses.ownerUserId, subject.userId), isNull(courses.deletedAt)));

  const [lectureCounts] = await db
    .select({
      total: count(),
      withTranscript: count(
        sql`CASE WHEN EXISTS (
          SELECT 1 FROM ${transcriptSegments} WHERE ${transcriptSegments.lectureId} = ${lectures.id}
        ) THEN 1 END`,
      ),
    })
    .from(lectures)
    .where(and(sql`${lectures.offeringId} IN ${owned}`, isNull(lectures.deletedAt)));

  const [materialCount] = await db
    .select({ total: count() })
    .from(materials)
    .where(and(sql`${materials.offeringId} IN ${owned}`, isNull(materials.deletedAt)));

  const now = new Date();
  const [sessionCounts] = await db
    .select({
      completed: count(sql`CASE WHEN ${studySessions.status} = 'completed' THEN 1 END`),
      upcoming: count(
        sql`CASE WHEN ${studySessions.status} = 'planned' AND ${studySessions.startsAt} >= ${now.toISOString()}::timestamptz THEN 1 END`,
      ),
    })
    .from(studySessions)
    .where(eq(studySessions.studentUserId, subject.userId));

  const [nextSession] = await db
    .select({ startsAt: studySessions.startsAt })
    .from(studySessions)
    .where(
      and(
        eq(studySessions.studentUserId, subject.userId),
        eq(studySessions.status, 'planned'),
        gte(studySessions.startsAt, now),
      ),
    )
    .orderBy(studySessions.startsAt)
    .limit(1);

  const [questionCounts] = await db
    .select({
      asked: count(),
      saved: count(sql`CASE WHEN ${qaMessages.savedAt} IS NOT NULL THEN 1 END`),
    })
    .from(qaMessages)
    .where(eq(qaMessages.userId, subject.userId));

  // Weak topics come from answered questions only. Confidence is stored
  // separately from score precisely so thin evidence never brands a topic weak.
  const weakTopics = await db
    .select({
      id: studyTopics.id,
      name: studyTopics.name,
      masteryScore: studentTopicMastery.masteryScore,
      courseTitle: courses.title,
    })
    .from(studentTopicMastery)
    .innerJoin(studyTopics, eq(studyTopics.id, studentTopicMastery.topicId))
    .leftJoin(courseOfferings, eq(courseOfferings.id, studyTopics.offeringId))
    .leftJoin(courses, eq(courses.id, courseOfferings.courseId))
    .where(
      and(
        eq(studentTopicMastery.studentUserId, subject.userId),
        eq(studentTopicMastery.isWeak, true),
      ),
    )
    .orderBy(studentTopicMastery.masteryScore)
    .limit(5);

  const exams = await db
    .select({
      id: courseExams.id,
      title: courseExams.title,
      courseTitle: courses.title,
      examAt: courseExams.examAt,
    })
    .from(courseExams)
    .innerJoin(courseOfferings, eq(courseOfferings.id, courseExams.offeringId))
    .innerJoin(courses, eq(courses.id, courseOfferings.courseId))
    .where(and(eq(courseExams.studentUserId, subject.userId), gte(courseExams.examAt, now)))
    .orderBy(courseExams.examAt)
    .limit(3);

  const recentLectures = await db
    .select({
      id: lectures.id,
      title: lectures.title,
      courseTitle: courses.title,
      createdAt: lectures.createdAt,
    })
    .from(lectures)
    .innerJoin(courseOfferings, eq(courseOfferings.id, lectures.offeringId))
    .innerJoin(courses, eq(courses.id, courseOfferings.courseId))
    .where(
      and(
        eq(courses.ownerUserId, subject.userId),
        isNull(lectures.deletedAt),
        isNull(courses.deletedAt),
      ),
    )
    .orderBy(desc(lectures.createdAt))
    .limit(4);

  return {
    courses: { active: courseCounts?.active ?? 0, archived: courseCounts?.archived ?? 0 },
    lectures: {
      total: lectureCounts?.total ?? 0,
      withTranscript: lectureCounts?.withTranscript ?? 0,
    },
    materials: materialCount?.total ?? 0,
    study: {
      completed: sessionCounts?.completed ?? 0,
      upcoming: sessionCounts?.upcoming ?? 0,
      nextAt: nextSession?.startsAt ?? null,
    },
    questionsAsked: questionCounts?.asked ?? 0,
    savedAnswers: questionCounts?.saved ?? 0,
    weakTopics: weakTopics.map((topic) => ({
      id: topic.id,
      name: topic.name,
      masteryScore: topic.masteryScore,
      courseTitle: topic.courseTitle,
    })),
    nextExams: exams.map((exam) => ({
      ...exam,
      daysAway: Math.max(0, Math.ceil((exam.examAt.getTime() - now.getTime()) / 86_400_000)),
    })),
    recentLectures,
  };
}
