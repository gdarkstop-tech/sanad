import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  lectureSessions,
  lectures,
  materials,
  transcriptSegments,
  type Database,
} from '@sanad/db';
import { Errors } from '../errors';
import type { Subject } from '../permissions';
import { getCourseFor } from './courses';

/**
 * Lectures belong to a course offering, and every entry point resolves the
 * course permission first — a lecture is never reachable by ID alone
 * (ARCHITECTURE.md §7).
 */

export interface LectureView {
  id: string;
  offeringId: string;
  title: string;
  sequenceNo: number | null;
  occurredOn: string | null;
  status: string;
  folder: string | null;
  createdAt: Date;
  hasRecording: boolean;
  segmentCount: number;
  /**
   * How the transcript was produced, or null when there isn't one.
   *
   * This is surfaced, not merely stored. On a machine without whisper.cpp the
   * pipeline falls back to `FixtureAsrProvider`, which *synthesizes* plausible
   * lecture sentences from the audio's hash — useful for developing the rest of
   * the pipeline, indistinguishable from a real transcript on screen. A student
   * looking at a synthetic transcript has to be told so, and so does anyone
   * reading an answer, a flashcard or a summary derived from it.
   */
  transcription: TranscriptionSource | null;
}

export interface TranscriptionSource {
  provider: string;
  model: string | null;
  /** True when nothing recognized real speech: the text is placeholder content. */
  isSynthetic: boolean;
}

/** Providers that do not perform real speech recognition. */
const SYNTHETIC_ASR_PROVIDERS = new Set(['fixture']);

export function transcriptionSourceOf(
  provider: string | null,
  model: string | null,
): TranscriptionSource | null {
  if (!provider) return null;
  return { provider, model, isSynthetic: SYNTHETIC_ASR_PROVIDERS.has(provider) };
}

export async function createLecture(
  db: Database,
  subject: Subject,
  offeringId: string,
  input: {
    title: string;
    sequenceNo?: number | null;
    occurredOn?: string | null;
    folder?: string | null;
  },
): Promise<LectureView> {
  await getCourseFor(db, subject, offeringId, 'add_content');

  const [row] = await db
    .insert(lectures)
    .values({
      offeringId,
      title: input.title,
      sequenceNo: input.sequenceNo ?? null,
      occurredOn: input.occurredOn ?? null,
      folder: normalizeFolder(input.folder),
      createdBy: subject.userId,
    })
    .returning();
  if (!row) throw Errors.internal();

  return toView(row, false, 0);
}

export async function listLectures(
  db: Database,
  subject: Subject,
  offeringId: string,
): Promise<LectureView[]> {
  await getCourseFor(db, subject, offeringId, 'read');

  const rows = await db
    .select()
    .from(lectures)
    .where(and(eq(lectures.offeringId, offeringId), isNull(lectures.deletedAt)))
    .orderBy(desc(lectures.createdAt));

  return Promise.all(
    rows.map(async (row) => {
      const counts = await lectureCounts(db, row.id);
      return toView(row, counts.hasRecording, counts.segmentCount, counts.transcription);
    }),
  );
}

export async function getLecture(
  db: Database,
  subject: Subject,
  lectureId: string,
  action: 'read' | 'add_content' = 'read',
): Promise<typeof lectures.$inferSelect> {
  const [row] = await db
    .select()
    .from(lectures)
    .where(and(eq(lectures.id, lectureId), isNull(lectures.deletedAt)))
    .limit(1);
  if (!row) throw Errors.notFound('Lecture');

  // Permission lives with the course, not the lecture.
  await getCourseFor(db, subject, row.offeringId, action);
  return row;
}

export async function readLecture(
  db: Database,
  subject: Subject,
  lectureId: string,
): Promise<LectureView> {
  const row = await getLecture(db, subject, lectureId);
  const counts = await lectureCounts(db, row.id);
  return toView(row, counts.hasRecording, counts.segmentCount, counts.transcription);
}

/**
 * Normalizes a folder label.
 *
 * Trimmed, length-capped, and empty means "no folder" — so a student clearing
 * the field ungroups the lecture instead of creating a folder named "".
 */
export function normalizeFolder(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim().slice(0, 80);
  return trimmed.length > 0 ? trimmed : null;
}

/** Renames a lecture or moves it between folders. */
export async function updateLecture(
  db: Database,
  subject: Subject,
  lectureId: string,
  patch: { title?: string; folder?: string | null; occurredOn?: string | null },
): Promise<LectureView> {
  const row = await getLecture(db, subject, lectureId, 'add_content');

  const changes: Partial<typeof lectures.$inferInsert> = { updatedAt: new Date() };
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (title.length === 0) throw Errors.validation('A lecture needs a title.');
    changes.title = title.slice(0, 200);
  }
  // `undefined` means "leave it alone"; explicit null means "ungroup it".
  if (patch.folder !== undefined) changes.folder = normalizeFolder(patch.folder);
  if (patch.occurredOn !== undefined) changes.occurredOn = patch.occurredOn;

  const [updated] = await db
    .update(lectures)
    .set(changes)
    .where(eq(lectures.id, row.id))
    .returning();
  if (!updated) throw Errors.notFound('Lecture');

  const counts = await lectureCounts(db, updated.id);
  return toView(updated, counts.hasRecording, counts.segmentCount, counts.transcription);
}

export async function deleteLecture(
  db: Database,
  subject: Subject,
  lectureId: string,
): Promise<void> {
  const row = await getLecture(db, subject, lectureId, 'add_content');
  await db
    .update(lectures)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(lectures.id, row.id));
}

export async function setLectureStatus(
  db: Database,
  lectureId: string,
  status: 'scheduled' | 'recording' | 'processing' | 'ready' | 'failed',
): Promise<void> {
  await db
    .update(lectures)
    .set({ status, updatedAt: new Date() })
    .where(eq(lectures.id, lectureId));
}

/**
 * Opens a capture session. `upload` covers both a file the student uploads and
 * a recording made offline — they enter the same pipeline and produce the same
 * archive entry (AI_PIPELINE.md §2).
 */
export async function openSession(
  db: Database,
  subject: Subject,
  lectureId: string,
  input: { captureMode: 'live' | 'upload'; languageHints?: string[] },
): Promise<{ id: string }> {
  await getLecture(db, subject, lectureId, 'add_content');

  const [row] = await db
    .insert(lectureSessions)
    .values({
      lectureId,
      captureMode: input.captureMode,
      languageHints: input.languageHints ?? [],
      createdBy: subject.userId,
    })
    .returning({ id: lectureSessions.id });
  if (!row) throw Errors.internal();

  await setLectureStatus(db, lectureId, 'recording');
  return row;
}

async function lectureCounts(
  db: Database,
  lectureId: string,
): Promise<{
  hasRecording: boolean;
  segmentCount: number;
  transcription: TranscriptionSource | null;
}> {
  const [recording] = await db
    .select({ id: materials.id })
    .from(materials)
    .where(
      and(
        eq(materials.lectureId, lectureId),
        eq(materials.materialType, 'audio'),
        isNull(materials.deletedAt),
      ),
    )
    .limit(1);

  const segments = await db
    .select({ id: transcriptSegments.id })
    .from(transcriptSegments)
    .where(eq(transcriptSegments.lectureId, lectureId));

  // The most recent session that actually produced a transcript is the one
  // whose provenance the transcript carries.
  const [session] = await db
    .select({ provider: lectureSessions.asrProvider, model: lectureSessions.asrModel })
    .from(lectureSessions)
    .where(eq(lectureSessions.lectureId, lectureId))
    .orderBy(desc(lectureSessions.startedAt))
    .limit(1);

  return {
    hasRecording: Boolean(recording),
    segmentCount: segments.length,
    transcription:
      segments.length > 0 ? transcriptionSourceOf(session?.provider ?? null, session?.model ?? null) : null,
  };
}

function toView(
  row: typeof lectures.$inferSelect,
  hasRecording: boolean,
  segmentCount: number,
  transcription?: TranscriptionSource | null,
): LectureView {
  return {
    id: row.id,
    offeringId: row.offeringId,
    title: row.title,
    sequenceNo: row.sequenceNo,
    occurredOn: row.occurredOn,
    status: row.status,
    folder: row.folder,
    createdAt: row.createdAt,
    hasRecording,
    segmentCount,
    transcription: transcription ?? null,
  };
}
