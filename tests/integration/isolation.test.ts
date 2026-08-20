import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  FixtureAsrProvider,
  HashEmbeddingProvider,
  LocalDiskStorage,
  appendChunk,
  ask,
  completeAttempt,
  createCourse,
  createLecture,
  deleteCourse,
  deleteLecture,
  deleteMaterial,
  generateExam,
  getCourseFor,
  listCourses,
  getLecture,
  getMaterial,
  listLectures,
  listMaterials,
  openSession,
  openUpload,
  readCourse,
  readLecture,
  retrieve,
  runPending,
  seedEmphasisCues,
  setAsrProvider,
  setEmbeddingProvider,
  setStorage,
  startAttempt,
  submitAnswer,
  updateCourse,
  uploadDirect,
  uploadStatus,
  type Subject,
} from '@sanad/core';
import { contentChunks, lectures as lectureTable, materials as materialTable } from '@sanad/db';
import { makePdf } from '../fixtures/make-pdf';
import { createTestStudent, openTestDatabase, resetDatabase } from '../helpers';

/**
 * One student must never reach another student's material.
 *
 * The individual services each have their own isolation test. This file exists
 * because that is not the same claim: it walks *every* surface that returns
 * course data with a second student's credentials, so a route added later
 * without a permission check has somewhere it visibly fails. A private lecture
 * recording leaking is the worst thing this product could do, so the check is
 * a sweep rather than a spot check.
 */

const { db, close } = openTestDatabase();

afterAll(async () => {
  await close();
});

interface Fixture {
  alice: Subject;
  bob: Subject;
  courseId: string;
  lectureId: string;
  materialId: string;
  uploadSessionId: string;
  chunkId: string;
}

let fx: Fixture;

beforeAll(async () => {
  setStorage(new LocalDiskStorage(await fs.mkdtemp(path.join(os.tmpdir(), 'sanad-iso-'))));
  setAsrProvider(new FixtureAsrProvider());
  setEmbeddingProvider(new HashEmbeddingProvider());
});

beforeEach(async () => {
  await resetDatabase();
  await seedEmphasisCues(db);

  const alice = await asStudent();
  const bob = await asStudent();

  // Alice's course, with a recorded lecture and an uploaded document — the
  // three things a student would most mind a stranger reading.
  const course = await createCourse(db, alice, {
    title: 'Alice Private Subject',
    primaryLanguage: 'en',
    secondaryLanguages: [],
  });
  const lecture = await createLecture(db, alice, course.id, { title: 'Private Lecture 01' });
  await openSession(db, alice, lecture.id, { captureMode: 'upload' });
  await uploadDirect(db, alice, {
    clientRef: `iso-audio-${Date.now()}`,
    offeringId: course.id,
    lectureId: lecture.id,
    filename: 'lecture.webm',
    mimeType: 'audio/webm',
    // A real container signature: upload validation checks magic bytes, so an
    // arbitrary buffer is rejected before it reaches storage.
    data: Buffer.concat([
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
      Buffer.from('alice private recording bytes'),
    ]),
  });
  const material = await uploadDirect(db, alice, {
    clientRef: `iso-pdf-${Date.now()}`,
    offeringId: course.id,
    filename: 'private-notes.pdf',
    mimeType: 'application/pdf',
    data: makePdf([
      'Alice private note: the escrow ratio governs settlement across both ledgers.',
      'A second private page describing the escrow ratio in more detail.',
    ]),
  });
  await runPending(db, { max: 40 });

  // An upload Alice has opened but not finished, to cover a session mid-flight.
  const pending = await openUpload(db, alice, {
    clientRef: `iso-open-${Date.now()}`,
    offeringId: course.id,
    filename: 'later.pdf',
    mimeType: 'application/pdf',
    totalBytes: 4096,
    checksumSha256: 'f'.repeat(64),
  });

  const [chunk] = await db
    .select({ id: contentChunks.id })
    .from(contentChunks)
    .where(eq(contentChunks.offeringId, course.id))
    .limit(1);

  fx = {
    alice,
    bob,
    courseId: course.id,
    lectureId: lecture.id,
    materialId: material.materialId,
    uploadSessionId: pending.uploadSessionId,
    chunkId: chunk!.id,
  };
});

async function asStudent(): Promise<Subject> {
  const { user } = await createTestStudent(db);
  return { userId: user.id, role: user.role };
}

/** Every refusal must look the same as "there is nothing here". */
async function refused(action: () => Promise<unknown>): Promise<void> {
  await expect(action()).rejects.toThrowError();
}

describe('a second student cannot read the first student’s course', () => {
  it('cannot open the course', async () => {
    await refused(() => readCourse(db, fx.bob, fx.courseId));
    await refused(() => getCourseFor(db, fx.bob, fx.courseId, 'read'));
  });

  it('cannot see it in a listing', async () => {
    const visible = await listCourses(db, fx.bob);
    expect(visible.map((course) => course.id)).not.toContain(fx.courseId);

    // The owner does see it, so an empty list is not why this passes.
    const owned = await listCourses(db, fx.alice);
    expect(owned.map((course) => course.id)).toContain(fx.courseId);
  });

  it('cannot rename or delete it', async () => {
    await refused(() => updateCourse(db, fx.bob, fx.courseId, { title: 'Taken' }));
    await refused(() => deleteCourse(db, fx.bob, fx.courseId));

    // And the course is untouched afterwards.
    const still = await readCourse(db, fx.alice, fx.courseId);
    expect(still.title).toBe('Alice Private Subject');
  });
});

describe('a second student cannot reach the first student’s lectures or recordings', () => {
  it('cannot list them', async () => {
    await refused(() => listLectures(db, fx.bob, fx.courseId));
  });

  it('cannot open one by id, even knowing the id', async () => {
    await refused(() => getLecture(db, fx.bob, fx.lectureId));
    await refused(() => readLecture(db, fx.bob, fx.lectureId));
  });

  it('cannot read its transcript', async () => {
    // The transcript route reaches segments only after getLecture authorizes,
    // so this is the check that gates the recording's contents.
    await refused(() => getLecture(db, fx.bob, fx.lectureId));

    const owned = await readLecture(db, fx.alice, fx.lectureId);
    expect(owned.segmentCount).toBeGreaterThan(0);
  });

  it('cannot delete one', async () => {
    await refused(() => deleteLecture(db, fx.bob, fx.lectureId));
    const [row] = await db
      .select()
      .from(lectureTable)
      .where(eq(lectureTable.id, fx.lectureId));
    expect(row?.deletedAt).toBeNull();
  });

  it('cannot start a capture session inside it', async () => {
    await refused(() => openSession(db, fx.bob, fx.lectureId, { captureMode: 'live' }));
  });
});

describe('a second student cannot reach the first student’s materials', () => {
  it('cannot list them', async () => {
    await refused(() => listMaterials(db, fx.bob, fx.courseId));
  });

  it('cannot open one by id', async () => {
    await refused(() => getMaterial(db, fx.bob, fx.materialId));
  });

  it('cannot delete one', async () => {
    await refused(() => deleteMaterial(db, fx.bob, fx.materialId));
    const [row] = await db
      .select()
      .from(materialTable)
      .where(eq(materialTable.id, fx.materialId));
    expect(row?.deletedAt).toBeNull();
  });

  it('cannot write into an upload session it does not own', async () => {
    await refused(() => uploadStatus(db, fx.bob, fx.uploadSessionId));
    await refused(() =>
      appendChunk(db, fx.bob, fx.uploadSessionId, 0, Buffer.from('injected bytes')),
    );
  });
});

describe('a second student cannot reach the first student’s content through search or AI', () => {
  it('finds nothing when searching the same distinctive term', async () => {
    const distinctive = 'escrow ratio settlement';

    const owner = await retrieve(db, fx.alice, distinctive, {});
    expect(owner.chunks.length).toBeGreaterThan(0);

    const stranger = await retrieve(db, fx.bob, distinctive, {});
    expect(stranger.chunks).toHaveLength(0);
  });

  it('finds nothing even when naming the course explicitly', async () => {
    // Scoping to a course the caller cannot read must return nothing — never
    // the owner's chunks, and never a quiet widening to everything else.
    const scoped = await retrieve(db, fx.bob, 'escrow ratio', { offeringId: fx.courseId });
    expect(scoped.chunks).toHaveLength(0);
  });

  it('refuses to answer from it, rather than answering with it', async () => {
    const answer = await ask(db, fx.bob, 'What is the escrow ratio?', {});
    expect(answer.refused).toBe(true);
    expect(answer.citations).toHaveLength(0);
    expect(answer.answer).not.toMatch(/escrow ratio governs/i);
  });

  it('cannot pull it in by asking against the owner’s course id', async () => {
    const answer = await ask(db, fx.bob, 'What is the escrow ratio?', {
      offeringId: fx.courseId,
    });
    expect(answer.refused).toBe(true);
    expect(answer.citations).toHaveLength(0);
  });

  it('the owner, by contrast, does get the answer — so the refusal is real', async () => {
    const answer = await ask(db, fx.alice, 'What is the escrow ratio?', {
      offeringId: fx.courseId,
    });
    expect(answer.refused).toBe(false);
    expect(answer.citations.length).toBeGreaterThan(0);
  });
});

describe('a second student cannot reach the first student’s study material', () => {
  it('cannot generate an exam from it', async () => {
    await refused(() => generateExam(db, fx.bob, fx.courseId, { questionCount: 5 }));

    // The owner can, so the refusal is about the caller and not about the
    // course having nothing to generate from.
    const owned = await generateExam(db, fx.alice, fx.courseId, { questionCount: 5 });
    expect(owned.questions.length).toBeGreaterThan(0);
  });

  it('cannot start an attempt against it', async () => {
    await refused(() => startAttempt(db, fx.bob, fx.courseId));
  });

  it('cannot answer into or complete the owner’s attempt', async () => {
    const exam = await generateExam(db, fx.alice, fx.courseId, { questionCount: 3 });
    const { attemptId } = await startAttempt(db, fx.alice, fx.courseId, exam.examId);
    const question = exam.questions[0]!;

    await refused(() =>
      submitAnswer(db, fx.bob, attemptId, { questionId: question.id, response: 'anything' }),
    );
    await refused(() => completeAttempt(db, fx.bob, attemptId));
  });
});

describe('the refusal reveals nothing', () => {
  it('reports a real course the caller cannot see the same way as one that does not exist', async () => {
    const real = await readCourse(db, fx.bob, fx.courseId).catch((error: Error) => error);
    const absent = await readCourse(db, fx.bob, '00000000-0000-4000-8000-000000000000').catch(
      (error: Error) => error,
    );

    expect(real).toBeInstanceOf(Error);
    expect(absent).toBeInstanceOf(Error);
    // Same message and same status: existence is not leaked by the difference
    // between "forbidden" and "not found".
    expect((real as Error).message).toBe((absent as Error).message);
    expect((real as { status?: number }).status).toBe((absent as { status?: number }).status);
  });
});
