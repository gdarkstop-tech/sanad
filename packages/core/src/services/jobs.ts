import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { processingJobs, type Database } from '@sanad/db';

/**
 * Job queue on Postgres (ARCHITECTURE.md §3.4).
 *
 * No Redis: job status is already a product requirement, so keeping it in a
 * table means the UI reads progress with a join instead of polling a broker,
 * and job state is transactional with the data it produces.
 */

export type JobType =
  | 'extract_material'
  | 'chunk_material'
  | 'transcribe_lecture'
  | 'enrich_lecture'
  | 'embed_chunks';

export interface JobRecord {
  id: string;
  jobType: string;
  targetType: string;
  targetId: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

export async function enqueue(
  db: Database,
  job: {
    jobType: JobType;
    targetType: string;
    targetId: string;
    payload?: Record<string, unknown>;
    runAfter?: Date;
  },
): Promise<{ id: string }> {
  const [row] = await db
    .insert(processingJobs)
    .values({
      jobType: job.jobType,
      targetType: job.targetType,
      targetId: job.targetId,
      payload: job.payload ?? {},
      runAfter: job.runAfter ?? new Date(),
    })
    .returning({ id: processingJobs.id });
  return { id: row?.id ?? '' };
}

/**
 * Claims one due job.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes this safe with more than one worker:
 * a row being considered by one worker is invisible to another rather than
 * blocking it.
 */
export async function claim(
  db: Database,
  workerId: string,
  now: Date = new Date(),
  /**
   * Only claim types the caller can actually run. A job whose handler does not
   * exist yet stays pending rather than burning its attempts — Phase 4 enqueues
   * embedding work before Phase 4 exists to perform it.
   */
  jobTypes?: readonly string[],
): Promise<JobRecord | null> {
  // Bound as an ISO string with an explicit cast: a Date cannot be bound into
  // a raw statement by the driver.
  const nowIso = now.toISOString();
  const rows = await db.execute<{
    id: string;
    job_type: string;
    target_type: string;
    target_id: string;
    payload: Record<string, unknown>;
    attempts: number;
    max_attempts: number;
  }>(sql`
    UPDATE processing_jobs
    SET status = 'running',
        locked_by = ${workerId},
        locked_at = ${nowIso}::timestamptz,
        attempts = attempts + 1,
        updated_at = ${nowIso}::timestamptz
    WHERE id = (
      SELECT id FROM processing_jobs
      WHERE status = 'pending' AND run_after <= ${nowIso}::timestamptz
        ${
          jobTypes && jobTypes.length > 0
            ? sql`AND job_type IN (${sql.join(
                jobTypes.map((t) => sql`${t}`),
                sql`, `,
              )})`
            : sql``
        }
      ORDER BY run_after ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, job_type, target_type, target_id, payload, attempts, max_attempts
  `);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    jobType: row.job_type,
    targetType: row.target_type,
    targetId: row.target_id,
    payload: row.payload ?? {},
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
  };
}

export async function succeed(db: Database, jobId: string): Promise<void> {
  await db
    .update(processingJobs)
    .set({ status: 'succeeded', lockedBy: null, lockedAt: null, updatedAt: new Date() })
    .where(eq(processingJobs.id, jobId));
}

/**
 * Records a failure and decides whether to retry.
 *
 * Backoff is exponential so a transient fault is retried soon and a persistent
 * one stops consuming the worker. Past `maxAttempts` the job is `dead`, not
 * silently dropped: a lecture that failed to process must remain visible.
 */
export async function fail(
  db: Database,
  job: JobRecord,
  error: unknown,
  now: Date = new Date(),
): Promise<{ willRetry: boolean }> {
  const message = error instanceof Error ? error.message : String(error);
  const willRetry = job.attempts < job.maxAttempts;
  const backoffMs = Math.min(60_000 * 2 ** (job.attempts - 1), 15 * 60_000);

  await db
    .update(processingJobs)
    .set({
      status: willRetry ? 'pending' : 'dead',
      lastError: message.slice(0, 2000),
      lockedBy: null,
      lockedAt: null,
      runAfter: willRetry ? new Date(now.getTime() + backoffMs) : now,
      updatedAt: now,
    })
    .where(eq(processingJobs.id, job.id));

  return { willRetry };
}

export async function jobsFor(
  db: Database,
  targetType: string,
  targetId: string,
): Promise<Array<typeof processingJobs.$inferSelect>> {
  return db
    .select()
    .from(processingJobs)
    .where(
      and(eq(processingJobs.targetType, targetType), eq(processingJobs.targetId, targetId)),
    )
    .orderBy(asc(processingJobs.createdAt));
}

export async function pendingCount(db: Database, now: Date = new Date()): Promise<number> {
  const rows = await db
    .select({ id: processingJobs.id })
    .from(processingJobs)
    .where(and(eq(processingJobs.status, 'pending'), lte(processingJobs.runAfter, now)));
  return rows.length;
}
