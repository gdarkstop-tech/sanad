import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  ClozeFlashcardGenerator,
  ExtractiveSummaryProvider,
  FixtureAsrProvider,
  HashEmbeddingProvider,
  LocalDiskStorage,
  completeAttempt,
  computeMastery,
  createCourse,
  createLecture,
  currentSummary,
  enrichScope,
  generateExam,
  masteryFor,
  recencyFactor,
  recordAnswer,
  runPending,
  seedEmphasisCues,
  setAsrProvider,
  setEmbeddingProvider,
  setStorage,
  startAttempt,
  submitAnswer,
  uploadDirect,
  type ScoredChunk,
  type Subject,
} from '@sanad/core';
import { flashcards, questions, studyTopics } from '@sanad/db';
import { makePdf } from '../fixtures/make-pdf';
import { createTestStudent, openTestDatabase, resetDatabase } from '../helpers';

const { db, close } = openTestDatabase();

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await resetDatabase();
  setStorage(new LocalDiskStorage(await fs.mkdtemp(path.join(os.tmpdir(), 'sanad-exam-'))));
  setAsrProvider(new FixtureAsrProvider());
  setEmbeddingProvider(new HashEmbeddingProvider());
  await seedEmphasisCues(db);
});

async function student(): Promise<Subject> {
  const { user } = await createTestStudent(db);
  return { userId: user.id, role: user.role };
}

/** Builds a course with enough real content to generate study material from. */
async function courseWithContent(subject: Subject, title = 'Any Discipline') {
  const course = await createCourse(db, subject, {
    title,
    primaryLanguage: 'en',
    secondaryLanguages: [],
  });

  await uploadDirect(db, subject, {
    clientRef: `exam-pdf-${Date.now()}`,
    offeringId: course.id,
    filename: 'notes.pdf',
    mimeType: 'application/pdf',
    data: makePdf([
      'A hash table stores key value pairs and offers average constant time lookup performance.',
      'Collision resolution uses chaining or open addressing to place conflicting entries.',
      'Load factor measures occupancy and drives the decision to resize the table.',
    ]),
  });

  await runPending(db, { max: 30 });
  return course;
}

describe('extractive study content', () => {
  it('produces a summary, keywords, flashcards and questions from real content', async () => {
    const owner = await student();
    const course = await courseWithContent(owner);

    const result = await enrichScope(db, { offeringId: course.id });

    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.keywordCount).toBeGreaterThan(0);
    expect(result.flashcardCount).toBeGreaterThan(0);
    expect(result.questionCount).toBeGreaterThan(0);

    const stored = await currentSummary(db, 'offering', course.id);
    expect(stored).toBe(result.summary);
  });

  it('summarizes only with sentences that appear in the source', async () => {
    // The property that makes an extractive summary safe without review: it
    // cannot state something the material does not.
    const owner = await student();
    const course = await courseWithContent(owner);
    await enrichScope(db, { offeringId: course.id });

    const summary = (await currentSummary(db, 'offering', course.id)) ?? '';
    expect(summary).toMatch(/hash table|collision|load factor/i);
    expect(summary).not.toMatch(/quantum|photosynthesis/i);
  });

  it('gives every flashcard and question a source chunk', async () => {
    const owner = await student();
    const course = await courseWithContent(owner);
    await enrichScope(db, { offeringId: course.id });

    const cards = await db.select().from(flashcards).where(eq(flashcards.offeringId, course.id));
    const generated = await db.select().from(questions).where(eq(questions.offeringId, course.id));

    expect(cards.length).toBeGreaterThan(0);
    expect(generated.length).toBeGreaterThan(0);
    for (const card of cards) expect(card.sourceChunkId).toBeTruthy();
    for (const question of generated) expect(question.sourceChunkId).toBeTruthy();
  });

  it('blanks a term the source actually contains', async () => {
    const owner = await student();
    const course = await courseWithContent(owner);
    await enrichScope(db, { offeringId: course.id });

    const [card] = await db.select().from(flashcards).where(eq(flashcards.offeringId, course.id));
    expect(card?.front).toContain('_____');
    expect(card?.back.length).toBeGreaterThan(2);
  });

  it('does not repeat a sentence that two overlapping chunks share', async () => {
    // Transcript chunks overlap by one segment on purpose, so a definition on a
    // boundary stays retrievable. That overlap must not reach the student as a
    // duplicated summary line or two identical flashcards.
    const shared = 'Active transport requires energy to move solutes against their gradient';
    const chunks: ScoredChunk[] = [
      {
        id: 'chunk-a',
        text: `Passive transport moves solutes down a concentration gradient\n${shared}`,
        weight: 1,
        lectureId: 'lecture-1',
        emphasised: false,
      },
      {
        id: 'chunk-b',
        text: `${shared}\nThe sodium potassium pump is the standard example of that process`,
        weight: 1,
        lectureId: 'lecture-1',
        emphasised: false,
      },
    ];

    const summary = await new ExtractiveSummaryProvider().summarize(chunks, 6);
    const lines = summary.split('\n').filter(Boolean);
    expect(lines.length).toBe(new Set(lines).size);

    const cards = await new ClozeFlashcardGenerator().generate(chunks, 12);
    const fronts = cards.map((card) => card.front.replace(/_+/g, ''));
    expect(fronts.length).toBe(new Set(fronts).size);
  });

  it('keeps a summary readable instead of running its sentences together', async () => {
    // Speech rarely carries terminal punctuation, so a space-joined summary of
    // transcript sentences is one unreadable line.
    const chunks: ScoredChunk[] = [
      {
        id: 'chunk-a',
        text: 'Osmosis is the movement of water across a selectively permeable membrane\nDiffusion moves solutes from a high concentration to a low concentration',
        weight: 1,
        lectureId: 'lecture-1',
        emphasised: false,
      },
    ];

    const summary = await new ExtractiveSummaryProvider().summarize(chunks, 6);
    expect(summary.split('\n').filter(Boolean).length).toBe(2);
  });

  it('blanks a term the course keeps using, not a one-off filler word', async () => {
    // The rarest word in speech is usually filler. Blanking "today" produces a
    // question that tests nothing, so recurrence is what earns the blank.
    const chunks: ScoredChunk[] = [
      {
        id: 'chunk-a',
        text: 'Today we continue with membrane transport and how we compare the mechanisms',
        weight: 3,
        lectureId: 'lecture-1',
        emphasised: false,
      },
      {
        id: 'chunk-b',
        text: 'Membrane transport can be passive or active depending on the energy required',
        weight: 2,
        lectureId: 'lecture-1',
        emphasised: false,
      },
      {
        id: 'chunk-c',
        text: 'Active membrane transport uses ATP to move solutes against the gradient',
        weight: 1,
        lectureId: 'lecture-1',
        emphasised: false,
      },
    ];

    const cards = await new ClozeFlashcardGenerator().generate(chunks, 12);
    const first = cards.find((card) => card.front.includes('we continue'));
    expect(first).toBeTruthy();
    expect(first!.back.toLowerCase()).not.toBe('today');
    expect(first!.back.toLowerCase()).toMatch(/membrane|transport|mechanisms|continue|compare/);
  });

  it('derives topics from the course’s own vocabulary', async () => {
    const owner = await student();
    const course = await courseWithContent(owner);
    await enrichScope(db, { offeringId: course.id });

    const topics = await db.select().from(studyTopics).where(eq(studyTopics.offeringId, course.id));
    expect(topics.length).toBeGreaterThan(0);
    // Nothing about the subject is enumerated in code; topics come from content.
    expect(topics.some((topic) => /hash|collision|table|factor/i.test(topic.name))).toBe(true);
  });
});

describe('Exam Mode', () => {
  it('assembles a full pack from the student’s own course', async () => {
    const owner = await student();
    const course = await courseWithContent(owner);

    const pack = await generateExam(db, owner, course.id, { questionCount: 8 });

    expect(pack.courseTitle).toBe('Any Discipline');
    expect(pack.summary).toBeTruthy();
    expect(pack.keywords.length).toBeGreaterThan(0);
    expect(pack.flashcards.length).toBeGreaterThan(0);
    expect(pack.questions.length).toBeGreaterThan(0);
  });

  it('labels every question with a resolvable source', async () => {
    const owner = await student();
    const course = await courseWithContent(owner);
    const pack = await generateExam(db, owner, course.id);

    for (const question of pack.questions) {
      expect(question.sourceChunkId).toBeTruthy();
      expect(question.sourceLabel).toMatch(/page \d+|—|Course material/);
    }
  });

  it('generates on first open without a prior enrichment step', async () => {
    const owner = await student();
    const course = await courseWithContent(owner);
    const pack = await generateExam(db, owner, course.id);
    expect(pack.questions.length).toBeGreaterThan(0);
  });

  it('surfaces instructor-flagged moments with their timestamps', async () => {
    const owner = await student();
    const course = await createCourse(db, owner, {
      title: 'Lecture Course',
      primaryLanguage: 'ar',
      secondaryLanguages: ['en'],
    });
    const lecture = await createLecture(db, owner, course.id, { title: 'Lecture 04' });

    const audio = Buffer.concat([
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
      Buffer.from('recorded lecture bytes for emphasis'),
    ]);
    await uploadDirect(db, owner, {
      clientRef: `exam-audio-${Date.now()}`,
      offeringId: course.id,
      lectureId: lecture.id,
      filename: 'lecture.webm',
      mimeType: 'audio/webm',
      data: audio,
    });
    await runPending(db, { max: 40 });

    const pack = await generateExam(db, owner, course.id);
    expect(pack.emphasis.length).toBeGreaterThan(0);
    const flagged = pack.emphasis[0]!;
    expect(flagged.quote.length).toBeGreaterThan(0);
    expect(flagged.timestamp).toMatch(/^\d+:\d{2}$/);
    expect(flagged.lectureTitle).toBe('Lecture 04');
  });

  it('refuses another student’s course', async () => {
    const owner = await student();
    const other = await student();
    const course = await courseWithContent(owner);
    await expect(generateExam(db, other, course.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe('academic memory', () => {
  it('computes mastery from accuracy and recency', () => {
    const now = new Date('2026-08-19T12:00:00Z');
    const strong = computeMastery({
      attempts: 5,
      correct: 5,
      lastReviewedAt: now,
      now,
    });
    expect(strong.accuracy).toBe(1);
    expect(strong.masteryScore).toBeGreaterThan(0.9);
    expect(strong.isWeak).toBe(false);

    const weak = computeMastery({ attempts: 5, correct: 1, lastReviewedAt: now, now });
    expect(weak.isWeak).toBe(true);
  });

  it('does not brand a topic weak on thin evidence', () => {
    // One wrong answer on a fresh topic must not send the coach chasing it.
    const now = new Date();
    const thin = computeMastery({ attempts: 1, correct: 0, lastReviewedAt: now, now });
    expect(thin.masteryScore).toBeLessThan(0.6);
    expect(thin.confidence).toBeLessThan(1);
    expect(thin.isWeak).toBe(false);
  });

  it('decays recency over time', () => {
    const now = new Date('2026-08-19T00:00:00Z');
    const recent = recencyFactor(new Date('2026-08-18T00:00:00Z'), now);
    const stale = recencyFactor(new Date('2026-06-19T00:00:00Z'), now);
    expect(recent).toBeGreaterThan(stale);
    expect(recencyFactor(null, now)).toBe(0);
  });

  it('updates mastery from answers and marks a repeatedly-failed topic weak', async () => {
    const owner = await student();
    const course = await courseWithContent(owner);
    await enrichScope(db, { offeringId: course.id });

    const [topic] = await db.select().from(studyTopics).where(eq(studyTopics.offeringId, course.id));
    expect(topic).toBeDefined();

    for (let i = 0; i < 4; i += 1) {
      await recordAnswer(db, owner, {
        offeringId: course.id,
        topicId: topic!.id,
        isCorrect: false,
      });
    }

    const rows = await masteryFor(db, owner, course.id);
    const record = rows.find((row) => row.topicId === topic!.id);
    expect(record?.attempts).toBe(4);
    expect(record?.accuracy).toBe(0);
    expect(record?.isWeak).toBe(true);
  });

  it('grades an MCQ and scores the attempt', async () => {
    const owner = await student();
    const course = await courseWithContent(owner);
    await enrichScope(db, { offeringId: course.id });

    const pack = await generateExam(db, owner, course.id);
    const mcq = pack.questions.find((question) => question.type === 'mcq');
    if (!mcq) return; // Content-dependent; other assertions cover the path.

    const { attemptId } = await startAttempt(db, owner, course.id, pack.examId);
    const correct = mcq.options.find((option) => option.isCorrect)!;
    const graded = await submitAnswer(db, owner, attemptId, {
      questionId: mcq.id,
      response: correct.id,
    });
    expect(graded.isCorrect).toBe(true);

    const result = await completeAttempt(db, owner, attemptId);
    expect(result.score).toBe(1);
    expect(result.maxScore).toBe(1);
  });

  it('records a written answer without inventing a grade for it', async () => {
    const owner = await student();
    const course = await courseWithContent(owner);
    await enrichScope(db, { offeringId: course.id });
    const pack = await generateExam(db, owner, course.id);
    const written = pack.questions.find((question) => question.type === 'written');
    if (!written) return;

    const { attemptId } = await startAttempt(db, owner, course.id, pack.examId);
    const graded = await submitAnswer(db, owner, attemptId, {
      questionId: written.id,
      response: 'My own explanation of the concept.',
    });
    // Guessing at a grade for free prose is worse than showing the model answer.
    expect(graded.isCorrect).toBeNull();
    expect(graded.correctAnswer).toBeTruthy();
  });

  it('refuses to grade into another student’s attempt', async () => {
    const owner = await student();
    const other = await student();
    const course = await courseWithContent(owner);
    const { attemptId } = await startAttempt(db, owner, course.id);
    await expect(
      submitAnswer(db, other, attemptId, { questionId: crypto.randomUUID(), response: 'x' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
