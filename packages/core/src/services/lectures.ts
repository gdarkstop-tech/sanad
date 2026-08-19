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
  createdAt: Date;
  hasRecording: boolean;
  segmentCount: number;
}

export async function createLecture(
  db: Database,
  subject: Subject,
  offeringId: string,
  input: { title: string; sequenceNo?: number | null; occurredOn?: string | null },
): Promise<LectureView> {
  await getCourseFor(db, subject, offeringId, 'add_content');

  const [row] = await db
    .insert(lectures)
    .values({
      offeringId,
      title: input.title,
      sequenceNo: input.sequenceNo ?? null,
      occurredOn: input.occurredOn ?? null,
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
      return toView(row, counts.hasRecording, counts.segmentCount);
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
  return toView(row, counts.hasRecording, counts.segmentCount);
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
): Promise<{ hasRecording: boolean; segmentCount: number }> {
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

  return { hasRecording: Boolean(recording), segmentCount: segments.length };
}

function toView(
  row: typeof lectures.$inferSelect,
  hasRecording: boolean,
  segmentCount: number,
): LectureView {
  return {
    id: row.id,
    offeringId: row.offeringId,
    title: row.title,
    sequenceNo: row.sequenceNo,
    occurredOn: row.occurredOn,
    status: row.status,
    createdAt: row.createdAt,
    hasRecording,
    segmentCount,
  };
}
