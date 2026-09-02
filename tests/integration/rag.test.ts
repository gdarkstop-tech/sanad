import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  FixtureAsrProvider,
  HashEmbeddingProvider,
  LocalDiskStorage,
  REFUSAL_TEXT,
  RETRIEVAL_THRESHOLD,
  ask,
  chunkTranscript,
  citationLabel,
  createCourse,
  createLecture,
  deepLinkFor,
  detectEmphasis,
  detectSegmentLanguage,
  embedPendingChunks,
  readLecture,
  retrieve,
  runPending,
  seedEmphasisCues,
  transcriptionSourceOf,
  setAsrProvider,
  setEmbeddingProvider,
  setStorage,
  uploadDirect,
  type Subject,
} from '@sanad/core';
import { citations, contentChunks, lectureEmphasis, qaMessages, transcriptSegments } from '@sanad/db';
import { makePdf } from '../fixtures/make-pdf';
import { createTestStudent, openTestDatabase, resetDatabase } from '../helpers';

const { db, close } = openTestDatabase();

afterAll(async () => {
  await close();
});

let storageRoot: string;

beforeEach(async () => {
  await resetDatabase();
  storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sanad-rag-'));
  setStorage(new LocalDiskStorage(storageRoot));
  setAsrProvider(new FixtureAsrProvider());
  // Deterministic embeddings: the real ONNX model is exercised separately, and
  // tests should not depend on a model download.
  setEmbeddingProvider(new HashEmbeddingProvider());
  await seedEmphasisCues(db);
});

async function student(): Promise<Subject> {
  const { user } = await createTestStudent(db);
  return { userId: user.id, role: user.role };
}

async function course(subject: Subject, title = 'Any Subject') {
  return createCourse(db, subject, { title, primaryLanguage: 'en', secondaryLanguages: [] });
}

/** Seeds a lecture with a known transcript, via the sidecar fixture path. */
async function seedLecture(
  subject: Subject,
  offeringId: string,
  title: string,
  lines: Array<{ text: string; confidence?: number }>,
) {
  const lecture = await createLecture(db, subject, offeringId, { title });

  const audio = Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
    Buffer.from(`audio-${title}`),
  ]);
  const { materialId } = await uploadDirect(db, subject, {
    clientRef: `ref-${title.replace(/\W/g, '')}-${Date.now()}`,
    offeringId,
    lectureId: lecture.id,
    filename: 'lecture.webm',
    mimeType: 'audio/webm',
    data: audio,
  });

  // The fixture reads a sidecar next to the audio, so a test controls exactly
  // what the "recognizer" produced.
  const { storage } = await import('@sanad/core');
  const localPath = storage().localPath(
    (await db.query.materials.findFirst({ where: (m, { eq: e }) => e(m.id, materialId) }))
      ?.storageKey ?? '',
  );
  await fs.writeFile(
    `${localPath}.transcript.json`,
    JSON.stringify(
      lines.map((line, index) => ({
        tStartMs: index * 10_000,
        tEndMs: index * 10_000 + 9_000,
        text: line.text,
        confidence: line.confidence ?? 0.92,
      })),
    ),
  );

  await runPending(db, { max: 20 });
  return lecture;
}

describe('ASR fixture provider', () => {
  it('preserves Arabic/English code-switching rather than normalizing it', () => {
    expect(detectSegmentLanguage('الـ definition ده مهم').isCodeSwitched).toBe(true);
    expect(detectSegmentLanguage('الدائرة الرقمية تعمل').language).toBe('ar');
    expect(detectSegmentLanguage('the circuit works well').language).toBe('en');
  });

  it('is deterministic for the same audio', async () => {
    const file = path.join(storageRoot, 'a.webm');
    await fs.writeFile(file, Buffer.from('same bytes every time'));
    const provider = new FixtureAsrProvider();
    const first = await provider.transcribeFile(file, { languageHints: ['ar', 'en'] });
    const second = await provider.transcribeFile(file, { languageHints: ['ar', 'en'] });
    expect(first.segments.map((s) => s.text)).toEqual(second.segments.map((s) => s.text));
    expect(first.segments.length).toBeGreaterThan(0);
  });

  it('produces ordered, non-overlapping timestamps and confidence values', async () => {
    const file = path.join(storageRoot, 'b.webm');
    await fs.writeFile(file, Buffer.from('another recording'));
    const result = await new FixtureAsrProvider().transcribeFile(file);
    for (const segment of result.segments) {
      expect(segment.tEndMs).toBeGreaterThan(segment.tStartMs);
      expect(segment.confidence).toBeGreaterThan(0);
      expect(segment.confidence).toBeLessThanOrEqual(1);
    }
    for (let i = 1; i < result.segments.length; i += 1) {
      expect(result.segments[i]!.tStartMs).toBeGreaterThanOrEqual(result.segments[i - 1]!.tEndMs);
    }
  });
});

describe('lecture processing', () => {
  it('turns a recording into timestamped segments and anchored chunks', async () => {
    const owner = await student();
    const c = await course(owner);
    const lecture = await seedLecture(owner, c.id, 'Session One', [
      { text: 'We begin with the first principle and its consequences' },
      { text: 'The second case behaves differently under load' },
      { text: 'الـ threshold ده مهم في الامتحان' },
    ]);

    const segments = await db
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.lectureId, lecture.id));
    expect(segments).toHaveLength(3);
    expect(segments.every((s) => s.rawText === s.displayText)).toBe(true);

    const chunks = await db
      .select()
      .from(contentChunks)
      .where(eq(contentChunks.lectureId, lecture.id));
    expect(chunks.length).toBeGreaterThan(0);
    // Every chunk must be citable — the database refuses anchorless rows.
    for (const chunk of chunks) {
      expect(chunk.tStartMs).not.toBeNull();
      expect(chunk.sourceType).toBe('transcript');
    }
  });

  it('records which provider produced the transcript', async () => {
    const owner = await student();
    const c = await course(owner);
    const lecture = await seedLecture(owner, c.id, 'Provenance', [
      { text: 'A line of spoken content for the record' },
    ]);
    const session = await db.query.lectureSessions.findFirst({
      where: (s, { eq: e }) => e(s.lectureId, lecture.id),
    });
    // Fixture output must never be mistakable for a real engine's.
    expect(session?.asrProvider).toBe('fixture');
  });

  it('flags emphasis with the instructor’s own words and a timestamp', async () => {
    const owner = await student();
    const c = await course(owner);
    const lecture = await seedLecture(owner, c.id, 'Emphasis', [
      { text: 'An ordinary sentence with no particular weight to it' },
      { text: 'Pay attention because this is important for the exam next week' },
      { text: 'دي نقطة مهمة جدا في الشرح' },
    ]);

    await detectEmphasis(db, lecture.id);
    const flagged = await db
      .select()
      .from(lectureEmphasis)
      .where(eq(lectureEmphasis.lectureId, lecture.id));

    expect(flagged.length).toBeGreaterThanOrEqual(1);
    const examFlag = flagged.find((f) => f.importanceType === 'exam_relevant');
    expect(examFlag?.quote).toContain('important for the exam');
    expect(examFlag?.tStartMs).toBe(10_000);
  });

  it('re-chunking is idempotent rather than duplicating', async () => {
    const owner = await student();
    const c = await course(owner);
    const lecture = await seedLecture(owner, c.id, 'Idempotent', [
      { text: 'Content that will be chunked more than once during processing' },
    ]);
    const before = await db.select().from(contentChunks).where(eq(contentChunks.lectureId, lecture.id));
    await chunkTranscript(db, lecture.id);
    const after = await db.select().from(contentChunks).where(eq(contentChunks.lectureId, lecture.id));
    expect(after.length).toBe(before.length);
  });
});

describe('unified search', () => {
  it('finds content across both a transcript and a PDF', async () => {
    const owner = await student();
    const c = await course(owner);
    await seedLecture(owner, c.id, 'Lecture on membranes', [
      { text: 'Osmosis moves water across a semipermeable membrane' },
    ]);
    await uploadDirect(db, owner, {
      clientRef: 'ref-search-pdf-00001',
      offeringId: c.id,
      filename: 'slides.pdf',
      mimeType: 'application/pdf',
      data: makePdf(['Osmosis and diffusion govern transport in cells']),
    });
    await runPending(db, { max: 20 });
    await embedPendingChunks(db, { offeringId: c.id });

    const result = await retrieve(db, owner, 'osmosis', { offeringId: c.id });
    expect(result.chunks.length).toBeGreaterThan(0);
    const kinds = new Set(result.chunks.map((chunk) => chunk.sourceType));
    expect(kinds.has('transcript') || kinds.has('material')).toBe(true);
  });

  it('never returns another student’s content', async () => {
    const alice = await student();
    const bob = await student();
    const aliceCourse = await course(alice, 'Alice Course');
    await seedLecture(alice, aliceCourse.id, 'Alice Lecture', [
      { text: 'A distinctive phrase about photosynthesis in Alice material' },
    ]);
    await embedPendingChunks(db, {});

    const mine = await retrieve(db, alice, 'photosynthesis');
    expect(mine.chunks.length).toBeGreaterThan(0);

    // The permission filter lives inside the retrieval query itself.
    const theirs = await retrieve(db, bob, 'photosynthesis');
    expect(theirs.chunks).toHaveLength(0);
  });

  it('produces a citation label and a deep link for every result', async () => {
    const owner = await student();
    const c = await course(owner);
    await seedLecture(owner, c.id, 'Lecture 4', [
      { text: 'Enzymes lower the activation energy of a reaction' },
    ]);
    await embedPendingChunks(db, { offeringId: c.id });

    const result = await retrieve(db, owner, 'enzymes activation energy', { offeringId: c.id });
    const first = result.chunks[0]!;
    expect(citationLabel(first)).toMatch(/Lecture 4 — \d+:\d{2}/);
    expect(deepLinkFor(first)).toMatch(/^\/lectures\/.+\?t=\d+$/);

    // Every anchor kind has to survive into the link, or the citation opens
    // the right document at the wrong place.
    const base = { ...first, lectureId: null, tStartMs: null, materialId: 'm1' };
    expect(deepLinkFor({ ...base, pageNo: 7, slideNo: null })).toBe('/materials/m1?page=7');
    expect(deepLinkFor({ ...base, pageNo: null, slideNo: 12 })).toBe('/materials/m1?slide=12');
    expect(deepLinkFor({ ...base, pageNo: null, slideNo: null })).toBe('/materials/m1');
  });

  it('returns nothing for an empty query rather than everything', async () => {
    const owner = await student();
    const result = await retrieve(db, owner, '   ');
    expect(result.chunks).toHaveLength(0);
  });
});

describe('Ask Sanad — grounded answering', () => {
  it('answers from the student’s materials with validated citations', async () => {
    const owner = await student();
    const c = await course(owner);
    await seedLecture(owner, c.id, 'Lecture 2', [
      { text: 'Mitochondria generate most of the cell ATP through oxidative phosphorylation' },
    ]);
    await embedPendingChunks(db, { offeringId: c.id });

    const answer = await ask(db, owner, 'What did the professor say about mitochondria?', {
      offeringId: c.id,
    });

    expect(answer.refused).toBe(false);
    expect(answer.citations.length).toBeGreaterThan(0);
    expect(answer.answer).toContain('Mitochondria');

    // Every citation must resolve to a real, retrieved chunk.
    const stored = await db.select().from(contentChunks);
    const ids = new Set(stored.map((chunk) => chunk.id));
    for (const citation of answer.citations) {
      expect(ids.has(citation.chunkId)).toBe(true);
      expect(citation.label.length).toBeGreaterThan(0);
    }
  });

  it('REFUSES a question its materials do not cover — the demo beat', async () => {
    // This is the product's central claim, so it is a test, not a hope.
    const owner = await student();
    const c = await course(owner);
    await seedLecture(owner, c.id, 'Lecture 1', [
      { text: 'Plate tectonics explains the movement of continental crust' },
    ]);
    await embedPendingChunks(db, { offeringId: c.id });

    const answer = await ask(db, owner, 'What is the capital city of Australia?', {
      offeringId: c.id,
    });

    expect(answer.refused).toBe(true);
    expect(answer.answer).toBe(REFUSAL_TEXT);
    expect(answer.citations).toHaveLength(0);
    // The generator is never invoked below the threshold.
    expect(answer.generator).toBe('none');
    expect(answer.topScore).toBeLessThan(RETRIEVAL_THRESHOLD);
  });

  it('refuses rather than reaching into another student’s course', async () => {
    const alice = await student();
    const bob = await student();
    const aliceCourse = await course(alice);
    await seedLecture(alice, aliceCourse.id, 'Private Lecture', [
      { text: 'The Krebs cycle produces NADH in the mitochondrial matrix' },
    ]);
    await embedPendingChunks(db, {});

    const answer = await ask(db, bob, 'What about the Krebs cycle?');
    expect(answer.refused).toBe(true);
    expect(answer.citations).toHaveLength(0);
  });

  it('records the retrieved set so any citation can be audited later', async () => {
    const owner = await student();
    const c = await course(owner);
    await seedLecture(owner, c.id, 'Audit', [
      { text: 'Capillary action draws water upward through narrow tubes' },
    ]);
    await embedPendingChunks(db, { offeringId: c.id });

    const answer = await ask(db, owner, 'capillary action', { offeringId: c.id });
    const [message] = await db.select().from(qaMessages);

    expect(message?.retrievedChunkIds.length).toBeGreaterThan(0);
    for (const citation of answer.citations) {
      expect(message?.retrievedChunkIds).toContain(citation.chunkId);
    }

    const stored = await db.select().from(citations);
    expect(stored.every((row) => row.validated)).toBe(true);
  });

  it('persists a refusal too, so the behaviour is observable', async () => {
    const owner = await student();
    const c = await course(owner);
    await ask(db, owner, 'something entirely unrelated to anything', { offeringId: c.id });
    const [message] = await db.select().from(qaMessages);
    expect(message?.refused).toBe(true);
    expect(message?.refusalReason).toBe('below_threshold');
  });
});

describe('transcript provenance', () => {
  /**
   * Without whisper.cpp the pipeline falls back to a fixture that *synthesizes*
   * plausible lecture sentences. That is fine for development and unacceptable
   * on screen without a warning, so the flag has to survive from the session
   * row all the way to whatever renders the lecture.
   */
  it('marks a fixture-produced transcript as synthetic', async () => {
    const owner = await student();
    const offering = await course(owner);
    const seeded = await seedLecture(owner, offering.id, 'Lecture 01', [
      { text: 'A hash table maps keys to buckets using a hash function' },
    ]);

    const view = await readLecture(db, owner, seeded.id);
    expect(view.transcription).not.toBeNull();
    expect(view.transcription?.provider).toBe('fixture');
    expect(view.transcription?.isSynthetic).toBe(true);
  });

  it('does not mark a real engine as synthetic', () => {
    // The allowlist is on the fake, not the real ones: a new engine added later
    // is treated as real unless it declares otherwise.
    expect(transcriptionSourceOf('whispercpp', 'base')?.isSynthetic).toBe(false);
    expect(transcriptionSourceOf('fixture', 'fixture-v1')?.isSynthetic).toBe(true);
  });

  it('reports nothing when there is no transcript to attribute', async () => {
    const owner = await student();
    const offering = await course(owner);
    const lecture = await createLecture(db, owner, offering.id, { title: 'Not recorded yet' });

    const view = await readLecture(db, owner, lecture.id);
    expect(view.segmentCount).toBe(0);
    expect(view.transcription).toBeNull();
  });
});
