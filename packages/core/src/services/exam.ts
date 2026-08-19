import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  contentChunks,
  examItems,
  exams,
  flashcards,
  keywords,
  lectureEmphasis,
  lectures,
  questionOptions,
  questions,
  studentTopicMastery,
  studyTopics,
  type Database,
} from '@sanad/db';
import { Errors } from '../errors';
import type { Subject } from '../permissions';
import { formatTimestamp } from './retrieval';
import { currentSummary, enrichScope } from './study-content';
import { getCourseFor } from './courses';

/**
 * Exam Mode.
 *
 * Assembles everything the student needs from what their own course actually
 * contains. Two weights decide what gets prioritised, and both are
 * configuration rather than code:
 *
 * - **instructor emphasis** — content the professor flagged as exam-relevant
 * - **weak topics** — where the student's own answers say they struggle
 *
 * Every generated item carries a source, enforced by a NOT NULL column rather
 * than by convention.
 */

export interface EmphasisHighlight {
  quote: string;
  lectureTitle: string | null;
  lectureId: string;
  tStartMs: number;
  timestamp: string;
  importanceType: string;
}

export interface ExamPack {
  examId: string;
  courseTitle: string;
  summary: string | null;
  keywords: string[];
  emphasis: EmphasisHighlight[];
  weakTopics: Array<{ id: string; name: string; masteryScore: number; accuracy: number }>;
  flashcards: Array<{ id: string; front: string; back: string; sourceChunkId: string }>;
  questions: Array<{
    id: string;
    type: string;
    stem: string;
    modelAnswer: string | null;
    options: Array<{ id: string; text: string; isCorrect: boolean }>;
    sourceChunkId: string;
    sourceLabel: string;
  }>;
}

export interface ExamConfig {
  questionCount?: number;
  emphasisWeight?: number;
  weakTopicWeight?: number;
}

export async function generateExam(
  db: Database,
  subject: Subject,
  offeringId: string,
  config: ExamConfig = {},
): Promise<ExamPack> {
  const { course } = await getCourseFor(db, subject, offeringId, 'read');

  const questionCount = Math.min(config.questionCount ?? 12, 40);
  const emphasisWeight = config.emphasisWeight ?? 2.5;
  const weakTopicWeight = config.weakTopicWeight ?? 1.5;

  /*
   * Ensure *course-level* derived content exists.
   *
   * Checking "are there any questions" is not enough: per-lecture enrichment
   * runs automatically after each recording, so questions exist while the
   * course-wide summary does not and materials that belong to no lecture have
   * contributed nothing. Keying on the offering-scope summary is what makes
   * Exam Mode cover the whole course.
   */
  let summary = await currentSummary(db, 'offering', offeringId);
  if (!summary) {
    await enrichScope(db, { offeringId });
    summary = await currentSummary(db, 'offering', offeringId);
  }

  const keywordRows = await db
    .select()
    .from(keywords)
    .where(eq(keywords.offeringId, offeringId))
    .orderBy(desc(keywords.weight))
    .limit(15);

  // Instructor-flagged moments, with the words and the timestamp, so the UI can
  // show provenance and the student can play the moment.
  const lectureRows = await db
    .select({ id: lectures.id, title: lectures.title })
    .from(lectures)
    .where(eq(lectures.offeringId, offeringId));
  const lectureTitles = new Map(lectureRows.map((row) => [row.id, row.title]));

  const emphasisRows = lectureRows.length
    ? await db
        .select()
        .from(lectureEmphasis)
        .where(inArray(lectureEmphasis.lectureId, lectureRows.map((row) => row.id)))
        .orderBy(desc(lectureEmphasis.confidence))
        .limit(10)
    : [];

  const emphasis: EmphasisHighlight[] = emphasisRows.map((row) => ({
    quote: row.quote,
    lectureId: row.lectureId,
    lectureTitle: lectureTitles.get(row.lectureId) ?? null,
    tStartMs: row.tStartMs,
    timestamp: formatTimestamp(row.tStartMs),
    importanceType: row.importanceType,
  }));

  const weakRows = await db
    .select({
      id: studyTopics.id,
      name: studyTopics.name,
      masteryScore: studentTopicMastery.masteryScore,
      accuracy: studentTopicMastery.accuracy,
    })
    .from(studentTopicMastery)
    .innerJoin(studyTopics, eq(studyTopics.id, studentTopicMastery.topicId))
    .where(
      and(
        eq(studentTopicMastery.studentUserId, subject.userId),
        eq(studentTopicMastery.offeringId, offeringId),
        eq(studentTopicMastery.isWeak, true),
      ),
    )
    .orderBy(studentTopicMastery.masteryScore)
    .limit(8);

  const weakTopicIds = new Set(weakRows.map((row) => row.id));

  const cardRows = await db
    .select()
    .from(flashcards)
    .where(eq(flashcards.offeringId, offeringId))
    .limit(20);

  const questionRows = await db
    .select()
    .from(questions)
    .where(eq(questions.offeringId, offeringId));

  // Rank by emphasis and by the student's weak topics — the two signals that
  // make this exam *theirs* rather than a generic quiz.
  const emphasisChunkIds = await emphasisedChunkIds(db, offeringId);
  const ranked = questionRows
    .map((question) => {
      let weight = 1;
      if (emphasisChunkIds.has(question.sourceChunkId)) weight *= emphasisWeight;
      if (question.topicId && weakTopicIds.has(question.topicId)) weight *= weakTopicWeight;
      return { question, weight };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, questionCount);

  const [exam] = await db
    .insert(exams)
    .values({
      offeringId,
      studentUserId: subject.userId,
      title: `Practice exam — ${course.title}`,
      mode: 'practice',
      config: { questionCount, emphasisWeight, weakTopicWeight },
    })
    .returning();
  if (!exam) throw Errors.internal();

  if (ranked.length > 0) {
    await db.insert(examItems).values(
      ranked.map((entry, index) => ({
        examId: exam.id,
        questionId: entry.question.id,
        seq: index,
      })),
    );
  }

  const optionRows = ranked.length
    ? await db
        .select()
        .from(questionOptions)
        .where(inArray(questionOptions.questionId, ranked.map((r) => r.question.id)))
    : [];

  const sourceLabels = await labelsForChunks(
    db,
    ranked.map((entry) => entry.question.sourceChunkId),
  );

  return {
    examId: exam.id,
    courseTitle: course.title,
    summary,
    keywords: keywordRows.map((row) => row.term),
    emphasis,
    weakTopics: weakRows.map((row) => ({
      id: row.id,
      name: row.name,
      masteryScore: row.masteryScore,
      accuracy: row.accuracy,
    })),
    flashcards: cardRows.map((row) => ({
      id: row.id,
      front: row.front,
      back: row.back,
      sourceChunkId: row.sourceChunkId,
    })),
    questions: ranked.map((entry) => ({
      id: entry.question.id,
      type: entry.question.questionType,
      stem: entry.question.stem,
      modelAnswer: entry.question.modelAnswer,
      options: optionRows
        .filter((option) => option.questionId === entry.question.id)
        .sort((a, b) => a.seq - b.seq)
        .map((option) => ({ id: option.id, text: option.text, isCorrect: option.isCorrect })),
      sourceChunkId: entry.question.sourceChunkId,
      sourceLabel: sourceLabels.get(entry.question.sourceChunkId) ?? 'Course material',
    })),
  };
}

/** Chunks whose time span contains an instructor-flagged moment. */
async function emphasisedChunkIds(db: Database, offeringId: string): Promise<Set<string>> {
  const rows = await db.execute<{ id: string }>(sql`
    SELECT DISTINCT cc.id
    FROM content_chunks cc
    JOIN lecture_emphasis le
      ON le.lecture_id = cc.lecture_id
     AND le.t_start_ms BETWEEN cc.t_start_ms AND cc.t_end_ms
    WHERE cc.offering_id = ${offeringId}
  `);
  return new Set(rows.map((row) => row.id));
}

/** Human-readable source label per chunk, for rendering beside each question. */
async function labelsForChunks(
  db: Database,
  chunkIds: string[],
): Promise<Map<string, string>> {
  if (chunkIds.length === 0) return new Map();

  const rows = await db.execute<{
    id: string;
    lecture_title: string | null;
    material_title: string | null;
    t_start_ms: number | null;
    page_no: number | null;
  }>(sql`
    SELECT cc.id, l.title AS lecture_title, m.title AS material_title,
           cc.t_start_ms, cc.page_no
    FROM content_chunks cc
    LEFT JOIN lectures l ON l.id = cc.lecture_id
    LEFT JOIN materials m ON m.id = cc.material_id
    WHERE cc.id IN (${sql.join(chunkIds.map((id) => sql`${id}`), sql`, `)})
  `);

  const labels = new Map<string, string>();
  for (const row of rows) {
    if (row.t_start_ms !== null && row.lecture_title) {
      labels.set(row.id, `${row.lecture_title} — ${formatTimestamp(row.t_start_ms)}`);
    } else if (row.page_no !== null) {
      labels.set(row.id, `${row.material_title ?? 'Document'} — page ${row.page_no}`);
    } else {
      labels.set(row.id, row.material_title ?? row.lecture_title ?? 'Course material');
    }
  }
  return labels;
}

export async function readExam(
  db: Database,
  subject: Subject,
  examId: string,
): Promise<ExamPack> {
  const [exam] = await db.select().from(exams).where(eq(exams.id, examId)).limit(1);
  if (!exam || exam.studentUserId !== subject.userId) throw Errors.notFound('Exam');
  return generateExam(db, subject, exam.offeringId, exam.config as ExamConfig);
}
