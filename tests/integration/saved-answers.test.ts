import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  HashEmbeddingProvider,
  LocalDiskStorage,
  ask,
  assessEvidence,
  createCourse,
  listSavedAnswers,
  runPending,
  setAnswerSaved,
  setEmbeddingProvider,
  setStorage,
  studentOverview,
  uploadDirect,
  type Subject,
} from '@sanad/core';
import { makePdf } from '../fixtures/make-pdf';
import { createTestStudent, openTestDatabase, resetDatabase } from '../helpers';

/**
 * Saved answers, evidence labelling, and the overview.
 *
 * The property that matters throughout: a saved answer keeps the evidence it
 * was actually given, and one student's saved work is invisible to another.
 */

const { db, close } = openTestDatabase();

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await resetDatabase();
  setStorage(new LocalDiskStorage(await fs.mkdtemp(path.join(os.tmpdir(), 'sanad-saved-'))));
  setEmbeddingProvider(new HashEmbeddingProvider());
});

async function student(): Promise<Subject> {
  const { user } = await createTestStudent(db);
  return { userId: user.id, role: user.role };
}

async function courseWithContent(subject: Subject) {
  const course = await createCourse(db, subject, {
    title: 'Any Subject',
    primaryLanguage: 'en',
    secondaryLanguages: [],
  });
  await uploadDirect(db, subject, {
    clientRef: `saved-${Date.now()}-${Math.random()}`,
    offeringId: course.id,
    filename: 'notes.pdf',
    mimeType: 'application/pdf',
    data: makePdf([
      'A hash table maps keys to buckets using a hash function for fast lookup.',
      'Chaining stores colliding entries in a list attached to the bucket.',
    ]),
  });
  await runPending(db, { max: 30 });
  return course;
}

describe('evidence assessment', () => {
  it('never reports a percentage, because nothing here measures one', () => {
    // A calibrated confidence would need a measurement this system does not
    // make. The output is a word, and the word is derived from real inputs.
    for (const topScore of [0, 0.4, 0.8, 1]) {
      for (const sourceCount of [0, 1, 3]) {
        const result = assessEvidence({ refused: false, topScore, sourceCount });
        expect(result.label).not.toMatch(/\d+\s*%/);
        expect(result.detail).not.toMatch(/\d+\s*%/);
      }
    }
  });

  it('calls a refusal insufficient, whatever the score was', () => {
    const result = assessEvidence({ refused: true, topScore: 0.9, sourceCount: 4 });
    expect(result.strength).toBe('insufficient');
    expect(result.sourceCount).toBe(0);
  });

  it('needs both a close match and corroboration to say strong', () => {
    expect(assessEvidence({ refused: false, topScore: 0.9, sourceCount: 3 }).strength).toBe('strong');
    // A close match from one source is not corroborated.
    expect(assessEvidence({ refused: false, topScore: 0.9, sourceCount: 1 }).strength).toBe('limited');
    // Corroborated but no close match.
    expect(assessEvidence({ refused: false, topScore: 0.4, sourceCount: 3 }).strength).toBe('multiple');
  });
});

describe('saving an answer', () => {
  it('keeps the answer and the citations it was given', async () => {
    const owner = await student();
    const course = await courseWithContent(owner);

    const answer = await ask(db, owner, 'What is chaining in a hash table?', {
      offeringId: course.id,
    });
    expect(answer.refused).toBe(false);
    expect(answer.messageId).toBeTruthy();

    await setAnswerSaved(db, owner, answer.messageId!, true);

    const saved = await listSavedAnswers(db, owner);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.question).toBe('What is chaining in a hash table?');
    expect(saved[0]?.answer).toBe(answer.answer);
    // The stored citations, not a fresh retrieval.
    expect(saved[0]?.citations.length).toBeGreaterThan(0);
    expect(saved[0]?.citations[0]?.label).toBeTruthy();
    expect(saved[0]?.courseTitle).toBe('Any Subject');
  });

  it('unsaves', async () => {
    const owner = await student();
    const course = await courseWithContent(owner);
    const answer = await ask(db, owner, 'What is chaining?', { offeringId: course.id });

    await setAnswerSaved(db, owner, answer.messageId!, true);
    expect(await listSavedAnswers(db, owner)).toHaveLength(1);

    await setAnswerSaved(db, owner, answer.messageId!, false);
    expect(await listSavedAnswers(db, owner)).toHaveLength(0);
  });

  it('refuses to save a refusal — there is nothing in one to keep', async () => {
    const owner = await student();
    const course = await courseWithContent(owner);
    const refusal = await ask(db, owner, 'What is the boiling point of liquid nitrogen?', {
      offeringId: course.id,
    });
    expect(refusal.refused).toBe(true);

    await expect(setAnswerSaved(db, owner, refusal.messageId!, true)).rejects.toThrowError();
  });

  it('will not let one student save or read another’s answer', async () => {
    const owner = await student();
    const stranger = await student();
    const course = await courseWithContent(owner);
    const answer = await ask(db, owner, 'What is chaining?', { offeringId: course.id });

    // A guessed id saves nothing rather than saving somebody else's answer.
    await expect(setAnswerSaved(db, stranger, answer.messageId!, true)).rejects.toThrowError();

    await setAnswerSaved(db, owner, answer.messageId!, true);
    expect(await listSavedAnswers(db, stranger)).toHaveLength(0);
    expect(await listSavedAnswers(db, owner)).toHaveLength(1);
  });
});

describe('the student overview', () => {
  it('counts only the caller’s own work', async () => {
    const owner = await student();
    const stranger = await student();
    const course = await courseWithContent(owner);
    await courseWithContent(stranger);

    const answer = await ask(db, owner, 'What is chaining?', { offeringId: course.id });
    await setAnswerSaved(db, owner, answer.messageId!, true);

    const mine = await studentOverview(db, owner);
    expect(mine.courses.active).toBe(1);
    expect(mine.materials).toBe(1);
    expect(mine.questionsAsked).toBe(1);
    expect(mine.savedAnswers).toBe(1);

    // The stranger's identical work is invisible here, and vice versa.
    const theirs = await studentOverview(db, stranger);
    expect(theirs.questionsAsked).toBe(0);
    expect(theirs.savedAnswers).toBe(0);
    expect(theirs.courses.active).toBe(1);
  });

  it('reports zeroes for a new account rather than failing', async () => {
    const fresh = await student();
    const overview = await studentOverview(db, fresh);

    expect(overview.courses).toEqual({ active: 0, archived: 0 });
    expect(overview.lectures).toEqual({ total: 0, withTranscript: 0 });
    expect(overview.materials).toBe(0);
    expect(overview.weakTopics).toEqual([]);
    expect(overview.nextExams).toEqual([]);
    expect(overview.recentLectures).toEqual([]);
    expect(overview.study.nextAt).toBeNull();
  });
});
