import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  LocalDiskStorage,
  appendChunk,
  completeUpload,
  createCourse,
  createLecture,
  deleteLecture,
  jobs,
  listLectures,
  listMaterials,
  openSession,
  openUpload,
  readLecture,
  runPending,
  setStorage,
  sha256,
  uploadDirect,
  uploadStatus,
  type Subject,
} from '@sanad/core';
import { materialChunks, materials, processingJobs, uploadSessions } from '@sanad/db';
import { makePdf } from '../fixtures/make-pdf';
import { createTestStudent, openTestDatabase, resetDatabase } from '../helpers';

const { db, close } = openTestDatabase();

afterAll(async () => {
  await close();
});

let storageRoot: string;

beforeEach(async () => {
  await resetDatabase();
  storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sanad-content-'));
  setStorage(new LocalDiskStorage(storageRoot));
});

async function student(): Promise<Subject> {
  const { user } = await createTestStudent(db);
  return { userId: user.id, role: user.role };
}

async function course(subject: Subject, title = 'Any Subject') {
  return createCourse(db, subject, {
    title,
    primaryLanguage: 'ar',
    secondaryLanguages: [],
  });
}

describe('lectures', () => {
  it('creates and lists lectures inside a course', async () => {
    const owner = await student();
    const c = await course(owner);

    const lecture = await createLecture(db, owner, c.id, { title: 'Week 1', sequenceNo: 1 });
    expect(lecture.title).toBe('Week 1');
    expect(lecture.status).toBe('scheduled');

    const all = await listLectures(db, owner, c.id);
    expect(all).toHaveLength(1);
    expect(all[0]?.segmentCount).toBe(0);
    expect(all[0]?.hasRecording).toBe(false);
  });

  it('hides another student’s lectures entirely', async () => {
    const owner = await student();
    const other = await student();
    const c = await course(owner);
    const lecture = await createLecture(db, owner, c.id, { title: 'Private' });

    await expect(listLectures(db, other, c.id)).rejects.toMatchObject({ status: 404 });
    await expect(readLecture(db, other, lecture.id)).rejects.toMatchObject({ status: 404 });
  });

  it('refuses lecture creation by a non-owner', async () => {
    const owner = await student();
    const other = await student();
    const c = await course(owner);
    await expect(
      createLecture(db, other, c.id, { title: 'Intruder' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('soft-deletes so a mistake is recoverable', async () => {
    const owner = await student();
    const c = await course(owner);
    const lecture = await createLecture(db, owner, c.id, { title: 'Oops' });

    await deleteLecture(db, owner, lecture.id);

    expect(await listLectures(db, owner, c.id)).toHaveLength(0);
    await expect(readLecture(db, owner, lecture.id)).rejects.toMatchObject({ status: 404 });
  });

  it('opens a capture session and marks the lecture recording', async () => {
    const owner = await student();
    const c = await course(owner);
    const lecture = await createLecture(db, owner, c.id, { title: 'Live one' });

    const session = await openSession(db, owner, lecture.id, {
      captureMode: 'upload',
      languageHints: ['ar', 'en'],
    });
    expect(session.id).toBeTruthy();
    expect((await readLecture(db, owner, lecture.id)).status).toBe('recording');
  });
});

describe('resumable uploads', () => {
  const AUDIO = Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), // WebM signature
    Buffer.from('a'.repeat(300)),
  ]);

  async function open(subject: Subject, offeringId: string, clientRef: string) {
    return openUpload(db, subject, {
      clientRef,
      offeringId,
      filename: 'lecture.webm',
      mimeType: 'audio/webm',
      totalBytes: AUDIO.byteLength,
      checksumSha256: sha256(AUDIO),
    });
  }

  it('uploads in chunks and completes', async () => {
    const owner = await student();
    const c = await course(owner);
    const session = await open(owner, c.id, 'client-ref-basic-000001');

    const half = Math.floor(AUDIO.byteLength / 2);
    await appendChunk(db, owner, session.uploadSessionId, 0, AUDIO.subarray(0, half));
    await appendChunk(db, owner, session.uploadSessionId, half, AUDIO.subarray(half));

    const result = await completeUpload(db, owner, session.uploadSessionId);
    expect(result.processingStatus).toBe('uploaded');
  });

  it('resumes from the byte offset instead of restarting', async () => {
    // The offline case: a recording interrupted mid-upload on a bad connection.
    const owner = await student();
    const c = await course(owner);
    const session = await open(owner, c.id, 'client-ref-resume-000001');

    await appendChunk(db, owner, session.uploadSessionId, 0, AUDIO.subarray(0, 100));

    const status = await uploadStatus(db, owner, session.uploadSessionId);
    expect(status.receivedBytes).toBe(100);

    await appendChunk(db, owner, session.uploadSessionId, 100, AUDIO.subarray(100));
    await completeUpload(db, owner, session.uploadSessionId);

    const [material] = await db.select().from(materials);
    expect(material?.byteSize).toBe(AUDIO.byteLength);
  });

  it('rejects a chunk at the wrong offset rather than corrupting the file', async () => {
    const owner = await student();
    const c = await course(owner);
    const session = await open(owner, c.id, 'client-ref-offset-000001');

    await appendChunk(db, owner, session.uploadSessionId, 0, AUDIO.subarray(0, 100));
    await expect(
      appendChunk(db, owner, session.uploadSessionId, 50, AUDIO.subarray(50)),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('treats a replayed clientRef as a resume, never a second lecture', async () => {
    // An ambiguous network failure must not duplicate a recorded lecture.
    const owner = await student();
    const c = await course(owner);

    const first = await open(owner, c.id, 'client-ref-dedupe-000001');
    await appendChunk(db, owner, first.uploadSessionId, 0, AUDIO);

    const second = await open(owner, c.id, 'client-ref-dedupe-000001');
    expect(second.resumed).toBe(true);
    expect(second.materialId).toBe(first.materialId);
    expect(second.receivedBytes).toBe(AUDIO.byteLength);
    expect(await db.select().from(materials)).toHaveLength(1);
    expect(await db.select().from(uploadSessions)).toHaveLength(1);
  });

  it('fails a corrupted upload rather than ingesting it', async () => {
    const owner = await student();
    const c = await course(owner);
    const session = await openUpload(db, owner, {
      clientRef: 'client-ref-corrupt-00001',
      offeringId: c.id,
      filename: 'lecture.webm',
      mimeType: 'audio/webm',
      totalBytes: AUDIO.byteLength,
      checksumSha256: sha256(Buffer.from('a completely different file')),
    });

    await appendChunk(db, owner, session.uploadSessionId, 0, AUDIO);
    await expect(completeUpload(db, owner, session.uploadSessionId)).rejects.toThrow(/checksum/i);

    const [material] = await db.select().from(materials);
    expect(material?.processingStatus).toBe('failed');
  });

  it('refuses to complete a partial upload', async () => {
    const owner = await student();
    const c = await course(owner);
    const session = await open(owner, c.id, 'client-ref-partial-00001');
    await appendChunk(db, owner, session.uploadSessionId, 0, AUDIO.subarray(0, 100));
    await expect(completeUpload(db, owner, session.uploadSessionId)).rejects.toThrow(/incomplete/i);
  });

  it('rejects a chunk that overruns the declared size', async () => {
    const owner = await student();
    const c = await course(owner);
    const session = await open(owner, c.id, 'client-ref-overrun-00001');
    await expect(
      appendChunk(db, owner, session.uploadSessionId, 0, Buffer.alloc(AUDIO.byteLength + 10)),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('will not let one student touch another’s upload session', async () => {
    const owner = await student();
    const other = await student();
    const c = await course(owner);
    const session = await open(owner, c.id, 'client-ref-owner-000001');

    await expect(uploadStatus(db, other, session.uploadSessionId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      appendChunk(db, other, session.uploadSessionId, 0, AUDIO),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('queues transcription for audio, not text extraction', async () => {
    const owner = await student();
    const c = await course(owner);
    const session = await open(owner, c.id, 'client-ref-queue-000001');
    await appendChunk(db, owner, session.uploadSessionId, 0, AUDIO);
    await completeUpload(db, owner, session.uploadSessionId);

    const queued = await db.select().from(processingJobs);
    expect(queued.map((j) => j.jobType)).toContain('transcribe_lecture');
  });
});

describe('job queue', () => {
  it('claims a job once, even with concurrent workers', async () => {
    await jobs.enqueue(db, {
      jobType: 'extract_material',
      targetType: 'material',
      targetId: '01920000-0000-7000-8000-000000000001',
    });

    const [a, b] = await Promise.all([jobs.claim(db, 'worker-a'), jobs.claim(db, 'worker-b')]);
    const claimed = [a, b].filter(Boolean);
    expect(claimed).toHaveLength(1);
  });

  it('retries with backoff, then marks the job dead', async () => {
    await jobs.enqueue(db, {
      jobType: 'extract_material',
      targetType: 'material',
      targetId: '01920000-0000-7000-8000-000000000002',
    });

    let job = await jobs.claim(db, 'w');
    expect(job).not.toBeNull();
    const first = await jobs.fail(db, job!, new Error('boom'));
    expect(first.willRetry).toBe(true);

    // Exhaust the remaining attempts.
    for (let i = 0; i < 3; i += 1) {
      const next = await jobs.claim(db, 'w', new Date(Date.now() + 3_600_000));
      if (!next) break;
      job = next;
      await jobs.fail(db, next, new Error('boom'));
    }

    const [row] = await db.select().from(processingJobs);
    expect(row?.status).toBe('dead');
    expect(row?.lastError).toContain('boom');
  });

  it('does not claim a job scheduled for the future', async () => {
    await jobs.enqueue(db, {
      jobType: 'extract_material',
      targetType: 'material',
      targetId: '01920000-0000-7000-8000-000000000003',
      runAfter: new Date(Date.now() + 3_600_000),
    });
    expect(await jobs.claim(db, 'w')).toBeNull();
  });
});

describe('material processing end to end', () => {
  it('extracts a PDF into page-anchored chunks and marks it ready', async () => {
    const owner = await student();
    const c = await course(owner);
    const pdf = makePdf([
      'The counter increments on each clock edge',
      'Signals propagate through the network',
    ]);

    const { materialId } = await uploadDirect(db, owner, {
      clientRef: 'client-ref-pdf-0000001',
      offeringId: c.id,
      filename: 'week-1.pdf',
      mimeType: 'application/pdf',
      data: pdf,
    });

    const summary = await runPending(db, { max: 10 });
    expect(summary.failed).toBe(0);

    const [material] = await db.select().from(materials).where(eq(materials.id, materialId));
    expect(material?.processingStatus).toBe('ready');
    expect(material?.pageCount).toBe(2);

    const chunks = await db
      .select()
      .from(materialChunks)
      .where(eq(materialChunks.materialId, materialId));
    expect(chunks.length).toBeGreaterThan(0);
    // Every chunk must carry a citation anchor — that is the product guarantee.
    for (const chunk of chunks) {
      expect(chunk.pageNo).not.toBeNull();
    }
    expect(chunks.some((c) => c.text.includes('counter increments'))).toBe(true);
  });

  it('extracts a text file with character anchors', async () => {
    const owner = await student();
    const c = await course(owner);
    const { materialId } = await uploadDirect(db, owner, {
      clientRef: 'client-ref-txt-0000001',
      offeringId: c.id,
      filename: 'notes.txt',
      mimeType: 'text/plain',
      data: Buffer.from('First paragraph about signals.\n\nSecond paragraph about timing.'),
    });

    await runPending(db, { max: 10 });

    const chunks = await db
      .select()
      .from(materialChunks)
      .where(eq(materialChunks.materialId, materialId));
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]?.charStart).not.toBeNull();
  });

  it('reports a scanned PDF with a message the student can act on', async () => {
    const owner = await student();
    const c = await course(owner);
    // A structurally valid PDF with no text layer — the scanned-document case.
    const { materialId } = await uploadDirect(db, owner, {
      clientRef: 'client-ref-scan-000001',
      offeringId: c.id,
      filename: 'scan.pdf',
      mimeType: 'application/pdf',
      data: makePdf([]),
    });

    await runPending(db, { max: 20 });

    const [material] = await db.select().from(materials).where(eq(materials.id, materialId));
    expect(material?.processingStatus).toBe('failed');
    expect(material?.processingError).toMatch(/scan|text/i);
  });

  it('keeps an image usable without pretending extraction succeeded', async () => {
    const owner = await student();
    const c = await course(owner);
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('fake png body'),
    ]);

    const { materialId } = await uploadDirect(db, owner, {
      clientRef: 'client-ref-png-0000001',
      offeringId: c.id,
      filename: 'diagram.png',
      mimeType: 'image/png',
      data: png,
    });

    await runPending(db, { max: 10 });

    const [material] = await db.select().from(materials).where(eq(materials.id, materialId));
    // No text layer is not a failure — the file is stored, listed and citable.
    expect(material?.processingStatus).toBe('ready');
    expect(material?.processingError).toBeNull();
  });

  it('lists materials for the owner and hides them from everyone else', async () => {
    const owner = await student();
    const other = await student();
    const c = await course(owner);
    await uploadDirect(db, owner, {
      clientRef: 'client-ref-list-0000001',
      offeringId: c.id,
      filename: 'notes.txt',
      mimeType: 'text/plain',
      data: Buffer.from('some notes'),
    });

    expect(await listMaterials(db, owner, c.id)).toHaveLength(1);
    await expect(listMaterials(db, other, c.id)).rejects.toMatchObject({ status: 404 });
  });
});
