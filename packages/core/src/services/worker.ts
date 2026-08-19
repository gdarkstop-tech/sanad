import { eq } from 'drizzle-orm';
import { materialChunks, materials, type Database } from '@sanad/db';
import { ExtractionError, chunkUnits, extractorFor } from '../ingestion/extract';
import { storage } from '../storage';
import { claim, enqueue, fail, succeed, type JobRecord } from './jobs';
import { chunkMaterialIntoContent, embedPendingChunks, transcribeLecture } from './pipeline';

/**
 * In-process job worker.
 *
 * No separate worker service: the MVP runs on a laptop, and one more process to
 * start is one more thing to fail during a demo. `runPending` is called after
 * an upload and can also be driven by a timer or an admin endpoint. Moving to a
 * standalone worker later needs no change here — it is the same function in a
 * different host.
 */

export type JobHandler = (db: Database, job: JobRecord) => Promise<void>;

export async function extractMaterial(db: Database, job: JobRecord): Promise<void> {
  const [material] = await db
    .select()
    .from(materials)
    .where(eq(materials.id, job.targetId))
    .limit(1);
  if (!material) return; // Deleted while queued: nothing to do, not an error.

  await db
    .update(materials)
    .set({ processingStatus: 'extracting', processingError: null, updatedAt: new Date() })
    .where(eq(materials.id, material.id));

  const extractor = extractorFor(material.mimeType, material.title);
  if (!extractor) {
    // Not a failure: images and media are stored and citable, they just have no
    // text layer yet. Marking them failed would misreport a working upload.
    await db
      .update(materials)
      .set({
        processingStatus: 'ready',
        processingError: null,
        updatedAt: new Date(),
      })
      .where(eq(materials.id, material.id));
    return;
  }

  const data = await storage().get(material.storageKey);
  const result = await extractor.extract(data);

  await db.transaction(async (tx) => {
    await tx.delete(materialChunks).where(eq(materialChunks.materialId, material.id));

    const chunks = chunkUnits(result.units);
    if (chunks.length > 0) {
      await tx.insert(materialChunks).values(
        chunks.map((chunk) => ({
          materialId: material.id,
          seq: chunk.seq,
          text: chunk.text,
          pageNo: chunk.pageNo,
          slideNo: chunk.slideNo,
          charStart: chunk.charStart,
          charEnd: chunk.charEnd,
          language: chunk.language,
          extractor: result.extractor,
        })),
      );
    }

    await tx
      .update(materials)
      .set({
        processingStatus: 'ready',
        pageCount: result.pageCount ?? null,
        updatedAt: new Date(),
      })
      .where(eq(materials.id, material.id));
  });

  // Promote extracted document chunks into the unified retrieval table, then
  // queue embedding for them.
  await chunkMaterialIntoContent(db, material.id);
  await enqueue(db, {
    jobType: 'embed_chunks',
    targetType: 'material',
    targetId: material.id,
  });
}

async function embedChunksJob(db: Database, job: JobRecord): Promise<void> {
  await embedPendingChunks(
    db,
    job.targetType === 'lecture' ? { lectureId: job.targetId } : { materialId: job.targetId },
  );
}

const HANDLERS: Partial<Record<string, JobHandler>> = {
  extract_material: extractMaterial,
  transcribe_lecture: transcribeLecture,
  embed_chunks: embedChunksJob,
};

export function registerHandler(jobType: string, handler: JobHandler): void {
  HANDLERS[jobType] = handler;
}

export interface RunSummary {
  processed: number;
  succeeded: number;
  failed: number;
}

/**
 * Drains up to `max` due jobs.
 *
 * A handler that throws marks the job failed with a retry, and — for material
 * jobs — writes a message the student can act on. Silent failure is the one
 * outcome not permitted: a lecture that never processed must say so.
 */
export async function runPending(
  db: Database,
  options: { max?: number; workerId?: string } = {},
): Promise<RunSummary> {
  const max = options.max ?? 10;
  const workerId = options.workerId ?? `worker-${process.pid}`;
  const summary: RunSummary = { processed: 0, succeeded: 0, failed: 0 };

  for (let i = 0; i < max; i += 1) {
    const job = await claim(db, workerId, new Date(), Object.keys(HANDLERS));
    if (!job) break;
    summary.processed += 1;

    const handler = HANDLERS[job.jobType];
    if (!handler) {
      // Should be unreachable: claim() filters by registered type. Treat it as
      // a real gap rather than looping on it.
      await fail(db, { ...job, attempts: job.maxAttempts }, `No handler for ${job.jobType}`);
      summary.failed += 1;
      continue;
    }

    try {
      await handler(db, job);
      await succeed(db, job.id);
      summary.succeeded += 1;
    } catch (error) {
      // Extraction failures are deterministic — the same extractor on the same
      // bytes fails the same way — so they do not consume retries, and the
      // student sees the reason immediately instead of after three backoffs.
      const deterministic = error instanceof ExtractionError;
      const { willRetry } = deterministic
        ? await fail(db, { ...job, attempts: job.maxAttempts }, error)
        : await fail(db, job, error);
      summary.failed += 1;

      if (job.targetType === 'material' && !willRetry) {
        const userMessage =
          error instanceof ExtractionError
            ? error.userMessage
            : 'Processing failed. Try uploading this file again.';
        await db
          .update(materials)
          .set({
            processingStatus: 'failed',
            processingError: userMessage,
            updatedAt: new Date(),
          })
          .where(eq(materials.id, job.targetId));
      }
    }
  }

  return summary;
}
