import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  contentChunks,
  emphasisCues,
  lectureEmphasis,
  lectureSessions,
  lectures,
  materialChunks,
  materials,
  transcriptSegments,
  type Database,
} from '@sanad/db';
import { bandFor, resolveAsrProvider } from '../asr';
import { embeddings, toVectorLiteral } from '../embeddings';
import { normalizeForSearch } from '../text';
import type { JobRecord } from './jobs';
import { enqueue } from './jobs';

/**
 * Lecture processing: audio to a searchable, citable archive entry.
 *
 * Runs identically whether the recording was captured live or made offline and
 * uploaded later — the same segments, anchors and chunks come out either way
 * (AI_PIPELINE.md §2).
 */

const TRANSCRIPT_CHUNK_MS = 45_000;

export async function transcribeLecture(db: Database, job: JobRecord): Promise<void> {
  const [material] = await db
    .select()
    .from(materials)
    .where(eq(materials.id, job.targetId))
    .limit(1);
  if (!material) return;

  const lectureId = material.lectureId;
  if (!lectureId) {
    // Audio uploaded to a course but not attached to a lecture: still stored
    // and listed, just not transcribed. Not an error.
    await db
      .update(materials)
      .set({ processingStatus: 'ready', updatedAt: new Date() })
      .where(eq(materials.id, material.id));
    return;
  }

  await db
    .update(materials)
    .set({ processingStatus: 'extracting', processingError: null, updatedAt: new Date() })
    .where(eq(materials.id, material.id));
  await db
    .update(lectures)
    .set({ status: 'processing', updatedAt: new Date() })
    .where(eq(lectures.id, lectureId));

  const { storage } = await import('../storage');
  const localPath = storage().localPath(material.storageKey);
  if (!localPath) throw new Error('ASR requires a local file path');

  const provider = await resolveAsrProvider();
  const result = await provider.transcribeFile(localPath, { languageHints: ['ar', 'en'] });

  const [session] = await db
    .insert(lectureSessions)
    .values({
      lectureId,
      captureMode: 'upload',
      recordingMaterialId: material.id,
      endedAt: new Date(),
      languageHints: ['ar', 'en'],
      // Recorded per session so a transcript always says what produced it —
      // fixture output must never be mistaken for a real engine's.
      asrProvider: provider.name,
      asrModel: provider.model,
      status: 'ready',
    })
    .returning();
  if (!session) throw new Error('Could not open a lecture session');

  await db.transaction(async (tx) => {
    if (result.segments.length > 0) {
      await tx.insert(transcriptSegments).values(
        result.segments.map((segment) => ({
          sessionId: session.id,
          lectureId,
          seq: segment.seq,
          tStartMs: segment.tStartMs,
          tEndMs: segment.tEndMs,
          // Written once and never updated: corrections write displayText, so
          // the original recognition is always recoverable.
          rawText: segment.text,
          displayText: segment.text,
          primaryLanguage: segment.language,
          isCodeSwitched: segment.isCodeSwitched,
          confidence: segment.confidence,
          confidenceBand: bandFor(segment.confidence),
        })),
      );
    }

    await tx
      .update(materials)
      .set({
        processingStatus: 'ready',
        durationMs: result.durationMs,
        updatedAt: new Date(),
      })
      .where(eq(materials.id, material.id));
  });

  await chunkTranscript(db, lectureId);
  await detectEmphasis(db, lectureId);

  await db
    .update(lectures)
    .set({ status: 'ready', updatedAt: new Date() })
    .where(eq(lectures.id, lectureId));

  await enqueue(db, { jobType: 'embed_chunks', targetType: 'lecture', targetId: lectureId });
  await enqueue(db, { jobType: 'enrich_lecture', targetType: 'lecture', targetId: lectureId });
}

/**
 * Groups transcript segments into retrieval-sized chunks.
 *
 * Every chunk keeps the start of its first segment and the end of its last as
 * its citation anchor, so a search result jumps to the second the words were
 * actually spoken.
 */
export async function chunkTranscript(db: Database, lectureId: string): Promise<number> {
  const [lecture] = await db
    .select()
    .from(lectures)
    .where(eq(lectures.id, lectureId))
    .limit(1);
  if (!lecture) return 0;

  const segments = await db
    .select()
    .from(transcriptSegments)
    .where(eq(transcriptSegments.lectureId, lectureId))
    .orderBy(transcriptSegments.seq);
  if (segments.length === 0) return 0;

  await db
    .delete(contentChunks)
    .where(and(eq(contentChunks.lectureId, lectureId), eq(contentChunks.sourceType, 'transcript')));

  const groups: Array<typeof segments> = [];
  let current: typeof segments = [];
  let windowStart = segments[0]!.tStartMs;

  for (const segment of segments) {
    if (current.length > 0 && segment.tEndMs - windowStart > TRANSCRIPT_CHUNK_MS) {
      groups.push(current);
      // One segment of overlap: a definition straddling a boundary is a
      // definition retrieval cannot find.
      current = [current[current.length - 1]!];
      windowStart = current[0]!.tStartMs;
    }
    current.push(segment);
  }
  if (current.length > 0) groups.push(current);

  const rows = groups.map((group) => {
    const text = group.map((s) => s.displayText).join(' ').trim();
    const confidences = group
      .map((s) => s.confidence)
      .filter((c): c is number => c !== null);
    return {
      offeringId: lecture.offeringId,
      sourceType: 'transcript' as const,
      lectureId,
      sessionId: group[0]!.sessionId,
      segmentStartId: group[0]!.id,
      segmentEndId: group[group.length - 1]!.id,
      tStartMs: group[0]!.tStartMs,
      tEndMs: group[group.length - 1]!.tEndMs,
      text,
      textNormalized: normalizeForSearch(text),
      language: group[0]!.primaryLanguage,
      confidence:
        confidences.length > 0
          ? confidences.reduce((a, b) => a + b, 0) / confidences.length
          : null,
    };
  });

  const usable = rows.filter((row) => row.text.length > 0);
  if (usable.length > 0) await db.insert(contentChunks).values(usable);
  return usable.length;
}

/** Promotes extracted document chunks into the unified retrieval table. */
export async function chunkMaterialIntoContent(
  db: Database,
  materialId: string,
): Promise<number> {
  const [material] = await db
    .select()
    .from(materials)
    .where(eq(materials.id, materialId))
    .limit(1);
  if (!material) return 0;

  const extracted = await db
    .select()
    .from(materialChunks)
    .where(eq(materialChunks.materialId, materialId))
    .orderBy(materialChunks.seq);
  if (extracted.length === 0) return 0;

  await db.delete(contentChunks).where(eq(contentChunks.materialId, materialId));

  const rows = extracted
    .filter((chunk) => chunk.text.trim().length > 0)
    .map((chunk) => ({
      offeringId: material.offeringId,
      sourceType: 'material' as const,
      materialId: material.id,
      materialChunkId: chunk.id,
      lectureId: material.lectureId,
      pageNo: chunk.pageNo,
      slideNo: chunk.slideNo,
      charStart: chunk.charStart,
      charEnd: chunk.charEnd,
      text: chunk.text,
      textNormalized: normalizeForSearch(chunk.text),
      language: chunk.language,
    }));

  if (rows.length > 0) await db.insert(contentChunks).values(rows);
  return rows.length;
}

/**
 * Emphasis detection (AI_PIPELINE.md §7).
 *
 * Cue phrases live in `emphasis_cues` as rows — adding a language or a dialect
 * is an insert, never a code change. The stored record keeps the instructor's
 * actual words and the timestamp, which is what lets Exam Mode show
 * provenance and play the moment.
 */
export async function detectEmphasis(db: Database, lectureId: string): Promise<number> {
  const cues = await db.select().from(emphasisCues).where(eq(emphasisCues.isActive, true));
  if (cues.length === 0) return 0;

  const segments = await db
    .select()
    .from(transcriptSegments)
    .where(eq(transcriptSegments.lectureId, lectureId))
    .orderBy(transcriptSegments.seq);

  await db.delete(lectureEmphasis).where(eq(lectureEmphasis.lectureId, lectureId));

  const found: Array<typeof lectureEmphasis.$inferInsert> = [];
  for (const segment of segments) {
    const haystack = normalizeForSearch(segment.displayText);
    for (const cue of cues) {
      const needle = normalizeForSearch(cue.pattern);
      if (!needle || !haystack.includes(needle)) continue;
      found.push({
        lectureId,
        segmentId: segment.id,
        quote: segment.displayText,
        tStartMs: segment.tStartMs,
        importanceType: cue.cueType,
        // Cue matching alone over-triggers; the weight carries that honestly
        // rather than presenting a match as certainty.
        confidence: Math.min(0.95, 0.6 * cue.weight),
        cueId: cue.id,
        detectedBy: 'cue',
      });
      break;
    }
  }

  if (found.length > 0) await db.insert(lectureEmphasis).values(found);
  return found.length;
}

/**
 * Embeds chunks that do not yet have a vector.
 *
 * Batched, and resumable by construction: the query selects on
 * `embedding IS NULL`, so an interrupted run simply continues.
 */
export async function embedPendingChunks(
  db: Database,
  scope: { offeringId?: string; lectureId?: string; materialId?: string } = {},
  batchSize = 32,
): Promise<number> {
  const provider = embeddings();
  if (!(await provider.isAvailable())) return 0;

  const filters = [isNull(contentChunks.embedding)];
  if (scope.offeringId) filters.push(eq(contentChunks.offeringId, scope.offeringId));
  if (scope.lectureId) filters.push(eq(contentChunks.lectureId, scope.lectureId));
  if (scope.materialId) filters.push(eq(contentChunks.materialId, scope.materialId));

  const pending = await db
    .select({ id: contentChunks.id, text: contentChunks.text })
    .from(contentChunks)
    .where(and(...filters))
    .limit(batchSize * 8);
  if (pending.length === 0) return 0;

  let embedded = 0;
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    const vectors = await provider.embed(
      batch.map((chunk) => chunk.text),
      'document',
    );

    for (let j = 0; j < batch.length; j += 1) {
      const vector = vectors[j];
      const row = batch[j];
      if (!vector || !row) continue;
      await db.execute(sql`
        UPDATE content_chunks
        SET embedding = ${toVectorLiteral(vector)}::vector,
            embedding_model = ${provider.name},
            embedding_dimensions = ${provider.dimensions},
            embedded_at = now()
        WHERE id = ${row.id}
      `);
      embedded += 1;
    }
  }

  return embedded;
}

/** Seeds cue phrases. Data, not code — extend by inserting rows. */
export const DEFAULT_EMPHASIS_CUES: Array<{
  language: string;
  pattern: string;
  cueType: 'exam_relevant' | 'key_concept';
  weight: number;
}> = [
  { language: 'en', pattern: 'this is important for the exam', cueType: 'exam_relevant', weight: 1.5 },
  { language: 'en', pattern: 'will come in the exam', cueType: 'exam_relevant', weight: 1.5 },
  { language: 'en', pattern: 'this will be on the exam', cueType: 'exam_relevant', weight: 1.5 },
  { language: 'en', pattern: 'remember this', cueType: 'key_concept', weight: 1.0 },
  { language: 'en', pattern: 'this is important', cueType: 'key_concept', weight: 1.0 },
  { language: 'en', pattern: 'focus on this', cueType: 'key_concept', weight: 1.0 },
  { language: 'ar', pattern: 'مهم في الامتحان', cueType: 'exam_relevant', weight: 1.5 },
  { language: 'ar', pattern: 'هيجي في الامتحان', cueType: 'exam_relevant', weight: 1.5 },
  { language: 'ar', pattern: 'دي مهمة', cueType: 'key_concept', weight: 1.0 },
  { language: 'ar', pattern: 'ركزوا', cueType: 'key_concept', weight: 1.0 },
  { language: 'ar', pattern: 'نقطة مهمة', cueType: 'key_concept', weight: 1.0 },
];

export async function seedEmphasisCues(db: Database): Promise<void> {
  await db.insert(emphasisCues).values(DEFAULT_EMPHASIS_CUES).onConflictDoNothing();
}
