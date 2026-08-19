import { and, eq } from 'drizzle-orm';
import {
  attemptAnswers,
  questionOptions,
  questions,
  quizAttempts,
  studentTopicMastery,
  studyTopics,
  type Database,
} from '@sanad/db';
import { Errors } from '../errors';
import type { Subject } from '../permissions';
import { normalizeForSearch } from '../text';
import { getCourseFor } from './courses';

/**
 * Academic memory (§17 of the brief).
 *
 * Structured records, computed deterministically. No prompt tells a model to
 * "remember the student" — mastery is a row, so it is queryable, testable, and
 * explainable to the student.
 */

/** Mastery blends accuracy with recency; weights are configuration. */
const ACCURACY_WEIGHT = 0.75;
const RECENCY_WEIGHT = 0.25;
const WEAK_THRESHOLD = 0.6;
/** Below this many attempts, an estimate is not trusted enough to act on. */
const MIN_ATTEMPTS_FOR_CONFIDENCE = 3;

export interface MasteryRow {
  topicId: string;
  topicName: string;
  attempts: number;
  correct: number;
  accuracy: number;
  masteryScore: number;
  confidence: number;
  isWeak: boolean;
  lastReviewedAt: Date | null;
}

export function recencyFactor(lastReviewedAt: Date | null, now: Date = new Date()): number {
  if (!lastReviewedAt) return 0;
  const days = (now.getTime() - lastReviewedAt.getTime()) / 86_400_000;
  // Halves roughly every 10 days: recent practice counts for more.
  return Math.max(0, Math.min(1, Math.exp(-days / 10)));
}

export function computeMastery(input: {
  attempts: number;
  correct: number;
  lastReviewedAt: Date | null;
  now?: Date;
}): { accuracy: number; masteryScore: number; confidence: number; isWeak: boolean } {
  const accuracy = input.attempts > 0 ? input.correct / input.attempts : 0;
  const recency = recencyFactor(input.lastReviewedAt, input.now);
  const masteryScore = ACCURACY_WEIGHT * accuracy + RECENCY_WEIGHT * recency;

  // Confidence is separate from the score. One wrong answer on a fresh topic
  // must not brand a student "weak" and send the scheduler chasing it.
  const confidence = Math.min(1, input.attempts / MIN_ATTEMPTS_FOR_CONFIDENCE);
  const isWeak = masteryScore < WEAK_THRESHOLD && confidence >= 1;

  return {
    accuracy: Number(accuracy.toFixed(4)),
    masteryScore: Number(masteryScore.toFixed(4)),
    confidence: Number(confidence.toFixed(4)),
    isWeak,
  };
}

export async function recordAnswer(
  db: Database,
  subject: Subject,
  input: {
    offeringId: string;
    topicId: string | null;
    isCorrect: boolean;
    now?: Date;
  },
): Promise<void> {
  if (!input.topicId) return;
  const now = input.now ?? new Date();

  const [existing] = await db
    .select()
    .from(studentTopicMastery)
    .where(
      and(
        eq(studentTopicMastery.studentUserId, subject.userId),
        eq(studentTopicMastery.topicId, input.topicId),
      ),
    )
    .limit(1);

  const attempts = (existing?.attempts ?? 0) + 1;
  const correct = (existing?.correct ?? 0) + (input.isCorrect ? 1 : 0);
  const computed = computeMastery({ attempts, correct, lastReviewedAt: now, now });

  const values = {
    studentUserId: subject.userId,
    topicId: input.topicId,
    offeringId: input.offeringId,
    attempts,
    correct,
    exposureCount: (existing?.exposureCount ?? 0) + 1,
    lastReviewedAt: now,
    updatedAt: now,
    ...computed,
  };

  if (existing) {
    await db
      .update(studentTopicMastery)
      .set(values)
      .where(eq(studentTopicMastery.id, existing.id));
  } else {
    await db.insert(studentTopicMastery).values(values);
  }
}

export async function masteryFor(
  db: Database,
  subject: Subject,
  offeringId: string,
): Promise<MasteryRow[]> {
  await getCourseFor(db, subject, offeringId, 'read');

  const rows = await db
    .select({
      topicId: studyTopics.id,
      topicName: studyTopics.name,
      attempts: studentTopicMastery.attempts,
      correct: studentTopicMastery.correct,
      accuracy: studentTopicMastery.accuracy,
      masteryScore: studentTopicMastery.masteryScore,
      confidence: studentTopicMastery.confidence,
      isWeak: studentTopicMastery.isWeak,
      lastReviewedAt: studentTopicMastery.lastReviewedAt,
    })
    .from(studentTopicMastery)
    .innerJoin(studyTopics, eq(studyTopics.id, studentTopicMastery.topicId))
    .where(
      and(
        eq(studentTopicMastery.studentUserId, subject.userId),
        eq(studentTopicMastery.offeringId, offeringId),
      ),
    )
    .orderBy(studentTopicMastery.masteryScore);

  return rows;
}

export interface GradedAnswer {
  questionId: string;
  isCorrect: boolean | null;
  correctAnswer: string | null;
  explanation: string | null;
}

/**
 * Grades one answer and updates mastery in the same call.
 *
 * MCQ and short answers grade deterministically. Written answers are recorded
 * but not auto-graded: marking free prose without a model would be guesswork,
 * and guessing at a grade is worse than showing the model answer and letting
 * the student judge.
 */
export async function submitAnswer(
  db: Database,
  subject: Subject,
  attemptId: string,
  input: { questionId: string; response: string },
): Promise<GradedAnswer> {
  const [attempt] = await db
    .select()
    .from(quizAttempts)
    .where(eq(quizAttempts.id, attemptId))
    .limit(1);
  if (!attempt || attempt.studentUserId !== subject.userId) throw Errors.notFound('Attempt');

  const [question] = await db
    .select()
    .from(questions)
    .where(eq(questions.id, input.questionId))
    .limit(1);
  if (!question || question.offeringId !== attempt.offeringId) {
    throw Errors.notFound('Question');
  }

  let isCorrect: boolean | null = null;

  if (question.questionType === 'mcq') {
    const options = await db
      .select()
      .from(questionOptions)
      .where(eq(questionOptions.questionId, question.id));
    const chosen = options.find(
      (option) => option.id === input.response || option.text === input.response,
    );
    isCorrect = chosen ? chosen.isCorrect : false;
  } else if (question.questionType === 'short_answer') {
    const expected = normalizeForSearch(question.modelAnswer ?? '');
    const given = normalizeForSearch(input.response);
    isCorrect = expected.length > 0 && given.length > 0 && given.includes(expected.split(' ')[0]!);
  }
  // 'written' stays null: recorded, shown against the model answer, not graded.

  await db
    .insert(attemptAnswers)
    .values({
      attemptId,
      questionId: question.id,
      topicId: question.topicId,
      response: { text: input.response },
      isCorrect,
    })
    .onConflictDoUpdate({
      target: [attemptAnswers.attemptId, attemptAnswers.questionId],
      set: { response: { text: input.response }, isCorrect },
    });

  if (isCorrect !== null) {
    await recordAnswer(db, subject, {
      offeringId: attempt.offeringId,
      topicId: question.topicId,
      isCorrect,
    });
  }

  return {
    questionId: question.id,
    isCorrect,
    correctAnswer: question.modelAnswer,
    explanation: question.explanation,
  };
}

export async function startAttempt(
  db: Database,
  subject: Subject,
  offeringId: string,
  examId?: string,
): Promise<{ attemptId: string }> {
  await getCourseFor(db, subject, offeringId, 'read');
  const [attempt] = await db
    .insert(quizAttempts)
    .values({ studentUserId: subject.userId, offeringId, examId: examId ?? null })
    .returning({ id: quizAttempts.id });
  if (!attempt) throw Errors.internal();
  return { attemptId: attempt.id };
}

export async function completeAttempt(
  db: Database,
  subject: Subject,
  attemptId: string,
): Promise<{ score: number; maxScore: number }> {
  const [attempt] = await db
    .select()
    .from(quizAttempts)
    .where(eq(quizAttempts.id, attemptId))
    .limit(1);
  if (!attempt || attempt.studentUserId !== subject.userId) throw Errors.notFound('Attempt');

  const answers = await db
    .select()
    .from(attemptAnswers)
    .where(eq(attemptAnswers.attemptId, attemptId));

  const graded = answers.filter((answer) => answer.isCorrect !== null);
  const score = graded.filter((answer) => answer.isCorrect).length;
  const maxScore = graded.length;

  await db
    .update(quizAttempts)
    .set({ completedAt: new Date(), score, maxScore })
    .where(eq(quizAttempts.id, attemptId));

  return { score, maxScore };
}
