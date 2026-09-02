import { and, asc, count, desc, eq, isNull } from 'drizzle-orm';
import {
  academicTerms,
  courseOfferings,
  lectures,
  materialChunks,
  materials,
  uploadSessions,
  type Database,
} from '@sanad/db';
import { Errors } from '../errors';
import { validateUpload, type MaterialType } from '../files';
import type { Subject } from '../permissions';
import { sha256, storage, storageKeyFor } from '../storage';
import { getCourseFor } from './courses';
import { enqueue } from './jobs';
import { getLecture, normalizeFolder } from './lectures';

/**
 * Uploads, resumable and idempotent (ARCHITECTURE.md §3.10).
 *
 * A lecture recorded offline is uploaded later, possibly over a bad connection,
 * possibly more than once. Two failure modes must be impossible: a partial
 * upload restarting from zero, and a retried upload becoming a second lecture.
 * `clientRef` — generated on the device before recording starts — closes both.
 */

const SESSION_TTL_HOURS = 72;

export interface OpenUploadInput {
  clientRef: string;
  offeringId: string;
  lectureId?: string | null;
  filename: string;
  mimeType: string;
  totalBytes: number;
  checksumSha256: string;
  folder?: string | null;
}

export interface UploadSessionView {
  uploadSessionId: string;
  materialId: string;
  receivedBytes: number;
  totalBytes: number;
  status: string;
  /** True when this call joined an upload already in progress. */
  resumed: boolean;
}

export async function openUpload(
  db: Database,
  subject: Subject,
  input: OpenUploadInput,
): Promise<UploadSessionView> {
  await getCourseFor(db, subject, input.offeringId, 'add_content');
  if (input.lectureId) await getLecture(db, subject, input.lectureId, 'add_content');

  const validated = validateUpload({
    filename: input.filename,
    mimeType: input.mimeType,
    byteSize: input.totalBytes,
  });

  // Re-opening with the same clientRef resumes rather than duplicating. This is
  // the whole point: an ambiguous network failure must not create two lectures.
  const [existing] = await db
    .select()
    .from(uploadSessions)
    .where(
      and(
        eq(uploadSessions.userId, subject.userId),
        eq(uploadSessions.clientRef, input.clientRef),
      ),
    )
    .limit(1);

  if (existing) {
    return {
      uploadSessionId: existing.id,
      materialId: existing.materialId,
      receivedBytes: existing.receivedBytes,
      totalBytes: existing.totalBytes,
      status: existing.status,
      resumed: true,
    };
  }

  const retentionExpiresAt = await retentionFor(db, input.offeringId, validated.type);

  return db.transaction(async (tx) => {
    const [material] = await tx
      .insert(materials)
      .values({
        offeringId: input.offeringId,
        lectureId: input.lectureId ?? null,
        uploaderUserId: subject.userId,
        title: validated.filename,
        materialType: validated.type,
        mimeType: validated.mimeType,
        byteSize: validated.byteSize,
        checksumSha256: input.checksumSha256,
        storageProvider: storage().name,
        storageKey: 'pending',
        processingStatus: 'pending_upload',
        clientRef: input.clientRef,
        folder: normalizeFolder(input.folder),
        retentionExpiresAt,
      })
      .returning();
    if (!material) throw Errors.internal();

    const storageKey = storageKeyFor({
      offeringId: input.offeringId,
      materialId: material.id,
      filename: validated.filename,
    });
    await tx.update(materials).set({ storageKey }).where(eq(materials.id, material.id));

    const [session] = await tx
      .insert(uploadSessions)
      .values({
        userId: subject.userId,
        materialId: material.id,
        clientRef: input.clientRef,
        totalBytes: validated.byteSize,
        checksumSha256: input.checksumSha256,
        status: 'pending',
        expiresAt: new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000),
      })
      .returning();
    if (!session) throw Errors.internal();

    return {
      uploadSessionId: session.id,
      materialId: material.id,
      receivedBytes: 0,
      totalBytes: validated.byteSize,
      status: session.status,
      resumed: false,
    };
  });
}

async function loadSession(db: Database, subject: Subject, uploadSessionId: string) {
  const [session] = await db
    .select()
    .from(uploadSessions)
    .where(
      and(eq(uploadSessions.id, uploadSessionId), eq(uploadSessions.userId, subject.userId)),
    )
    .limit(1);
  if (!session) throw Errors.notFound('Upload session');
  return session;
}

export async function uploadStatus(
  db: Database,
  subject: Subject,
  uploadSessionId: string,
): Promise<UploadSessionView> {
  const session = await loadSession(db, subject, uploadSessionId);
  return {
    uploadSessionId: session.id,
    materialId: session.materialId,
    receivedBytes: session.receivedBytes,
    totalBytes: session.totalBytes,
    status: session.status,
    resumed: false,
  };
}

/**
 * Appends one chunk at the expected offset.
 *
 * The offset is checked rather than trusted: a client that resumes from the
 * wrong place would otherwise corrupt the file silently, and the checksum would
 * only reveal it at the very end of a long upload.
 */
export async function appendChunk(
  db: Database,
  subject: Subject,
  uploadSessionId: string,
  offset: number,
  chunk: Buffer,
): Promise<UploadSessionView> {
  const session = await loadSession(db, subject, uploadSessionId);

  if (session.status === 'completed') {
    throw Errors.conflict('Upload already completed');
  }
  if (offset !== session.receivedBytes) {
    throw Errors.conflict(
      'Wrong upload offset',
      `Expected ${session.receivedBytes} but received ${offset}. Fetch the session to resume from the right place.`,
    );
  }
  if (session.receivedBytes + chunk.byteLength > session.totalBytes) {
    throw Errors.validation('Chunk exceeds the declared total size.');
  }

  const [material] = await db
    .select({ storageKey: materials.storageKey })
    .from(materials)
    .where(eq(materials.id, session.materialId))
    .limit(1);
  if (!material) throw Errors.notFound('Material');

  const total = await storage().append(material.storageKey, chunk);

  const [updated] = await db
    .update(uploadSessions)
    .set({ receivedBytes: total, status: 'in_progress', updatedAt: new Date() })
    .where(eq(uploadSessions.id, session.id))
    .returning();

  return {
    uploadSessionId: session.id,
    materialId: session.materialId,
    receivedBytes: updated?.receivedBytes ?? total,
    totalBytes: session.totalBytes,
    status: updated?.status ?? 'in_progress',
    resumed: false,
  };
}

/**
 * Verifies the upload and queues processing.
 *
 * A checksum mismatch fails the session rather than ingesting a corrupted
 * recording — a transcript built from a truncated file is worse than a visible
 * failure the student can retry.
 */
export async function completeUpload(
  db: Database,
  subject: Subject,
  uploadSessionId: string,
): Promise<{ materialId: string; processingStatus: string }> {
  const session = await loadSession(db, subject, uploadSessionId);

  const [material] = await db
    .select()
    .from(materials)
    .where(eq(materials.id, session.materialId))
    .limit(1);
  if (!material) throw Errors.notFound('Material');

  if (session.status === 'completed') {
    return { materialId: material.id, processingStatus: material.processingStatus };
  }

  const stored = await storage().stat(material.storageKey);
  if (!stored || stored.byteSize !== session.totalBytes) {
    await db
      .update(uploadSessions)
      .set({ status: 'pending', lastError: 'Incomplete upload', updatedAt: new Date() })
      .where(eq(uploadSessions.id, session.id));
    throw Errors.validation(
      `Upload is incomplete: ${stored?.byteSize ?? 0} of ${session.totalBytes} bytes received.`,
    );
  }

  const bytes = await storage().get(material.storageKey);
  const actual = sha256(bytes);
  if (session.checksumSha256 && actual !== session.checksumSha256) {
    await db
      .update(uploadSessions)
      .set({ status: 'aborted', lastError: 'Checksum mismatch', updatedAt: new Date() })
      .where(eq(uploadSessions.id, session.id));
    await db
      .update(materials)
      .set({ processingStatus: 'failed', processingError: 'Checksum mismatch' })
      .where(eq(materials.id, material.id));
    throw Errors.validation('The uploaded file does not match its checksum. Please retry.');
  }

  await db.transaction(async (tx) => {
    await tx
      .update(uploadSessions)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(eq(uploadSessions.id, session.id));
    await tx
      .update(materials)
      .set({ processingStatus: 'uploaded', checksumSha256: actual, updatedAt: new Date() })
      .where(eq(materials.id, material.id));
  });

  // Audio and video go to transcription; everything else to text extraction.
  const isMedia = material.materialType === 'audio' || material.materialType === 'video';
  await enqueue(db, {
    jobType: isMedia ? 'transcribe_lecture' : 'extract_material',
    targetType: 'material',
    targetId: material.id,
  });

  return { materialId: material.id, processingStatus: 'uploaded' };
}

/** Single-shot upload for small files: open, append, complete in one call. */
export async function uploadDirect(
  db: Database,
  subject: Subject,
  input: Omit<OpenUploadInput, 'totalBytes' | 'checksumSha256'> & { data: Buffer },
): Promise<{ materialId: string }> {
  validateUpload({
    filename: input.filename,
    mimeType: input.mimeType,
    byteSize: input.data.byteLength,
    head: input.data.subarray(0, 16),
  });

  const session = await openUpload(db, subject, {
    ...input,
    totalBytes: input.data.byteLength,
    checksumSha256: sha256(input.data),
  });

  if (session.receivedBytes === 0) {
    await appendChunk(db, subject, session.uploadSessionId, 0, input.data);
  }
  const result = await completeUpload(db, subject, session.uploadSessionId);
  return { materialId: result.materialId };
}

export async function listMaterials(
  db: Database,
  subject: Subject,
  offeringId: string,
): Promise<Array<typeof materials.$inferSelect>> {
  await getCourseFor(db, subject, offeringId, 'read');
  return db
    .select()
    .from(materials)
    .where(and(eq(materials.offeringId, offeringId), isNull(materials.deletedAt)))
    .orderBy(desc(materials.createdAt));
}

export async function getMaterial(
  db: Database,
  subject: Subject,
  materialId: string,
): Promise<typeof materials.$inferSelect> {
  const [row] = await db
    .select()
    .from(materials)
    .where(and(eq(materials.id, materialId), isNull(materials.deletedAt)))
    .limit(1);
  if (!row) throw Errors.notFound('Material');
  await getCourseFor(db, subject, row.offeringId, 'read');
  return row;
}

/** Renames a material or moves it between folders. */
export async function updateMaterial(
  db: Database,
  subject: Subject,
  materialId: string,
  patch: { title?: string; folder?: string | null },
): Promise<typeof materials.$inferSelect> {
  const material = await getMaterial(db, subject, materialId);
  await getCourseFor(db, subject, material.offeringId, 'add_content');

  const changes: Partial<typeof materials.$inferInsert> = { updatedAt: new Date() };
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (title.length === 0) throw Errors.validation('A material needs a title.');
    changes.title = title.slice(0, 200);
  }
  if (patch.folder !== undefined) changes.folder = normalizeFolder(patch.folder);

  const [updated] = await db
    .update(materials)
    .set(changes)
    .where(eq(materials.id, material.id))
    .returning();
  if (!updated) throw Errors.notFound('Material');
  return updated;
}

/**
 * The folder labels actually in use in one course, with how much is in each.
 *
 * Derived from the content rather than stored as its own table: a folder that
 * nothing is filed under is not a folder anyone needs to see, and this way
 * there is no second list to keep in step.
 */
export async function listFolders(
  db: Database,
  subject: Subject,
  offeringId: string,
): Promise<Array<{ name: string; lectureCount: number; materialCount: number }>> {
  await getCourseFor(db, subject, offeringId, 'read');

  const [lectureRows, materialRows] = await Promise.all([
    db
      .select({ folder: lectures.folder, count: count() })
      .from(lectures)
      .where(and(eq(lectures.offeringId, offeringId), isNull(lectures.deletedAt)))
      .groupBy(lectures.folder),
    db
      .select({ folder: materials.folder, count: count() })
      .from(materials)
      .where(and(eq(materials.offeringId, offeringId), isNull(materials.deletedAt)))
      .groupBy(materials.folder),
  ]);

  const totals = new Map<string, { lectureCount: number; materialCount: number }>();
  const bump = (folder: string | null, key: 'lectureCount' | 'materialCount', by: number) => {
    if (!folder) return;
    const entry = totals.get(folder) ?? { lectureCount: 0, materialCount: 0 };
    entry[key] += by;
    totals.set(folder, entry);
  };
  for (const row of lectureRows) bump(row.folder, 'lectureCount', row.count);
  for (const row of materialRows) bump(row.folder, 'materialCount', row.count);

  return [...totals.entries()]
    .map(([name, counts]) => ({ name, ...counts }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function deleteMaterial(
  db: Database,
  subject: Subject,
  materialId: string,
): Promise<void> {
  const row = await getMaterial(db, subject, materialId);
  await getCourseFor(db, subject, row.offeringId, 'add_content');
  await db
    .update(materials)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(materials.id, materialId));
}

/**
 * Recordings expire at the end of the academic term; derived content does not
 * (DATABASE.md §16). A course with no term record has no expiry, which is the
 * safe default — better to keep audio than to delete it on a guess.
 */
async function retentionFor(
  db: Database,
  offeringId: string,
  type: MaterialType,
): Promise<Date | null> {
  if (type !== 'audio' && type !== 'video') return null;

  const [row] = await db
    .select({ endsOn: academicTerms.endsOn })
    .from(courseOfferings)
    .leftJoin(academicTerms, eq(academicTerms.id, courseOfferings.termId))
    .where(eq(courseOfferings.id, offeringId))
    .limit(1);

  return row?.endsOn ? new Date(`${row.endsOn}T23:59:59Z`) : null;
}

export interface MaterialExcerpt {
  id: string;
  seq: number;
  text: string;
  pageNo: number | null;
  slideNo: number | null;
  charStart: number | null;
  /** "page 7", "slide 12", or null when the anchor is a character offset. */
  label: string | null;
}

/**
 * A document's extracted text, in order, with its citation anchors.
 *
 * This exists because a citation has to be checkable. Sanad tells a student
 * "week-4-slides.pdf — page 1" and, until now, clicking that led to a 404: the
 * link was generated but no page ever rendered it. A citation nobody can open
 * is a claim, not evidence.
 */
export async function readMaterialExcerpts(
  db: Database,
  subject: Subject,
  materialId: string,
): Promise<{ material: typeof materials.$inferSelect; excerpts: MaterialExcerpt[] }> {
  // Ownership is resolved here, so the excerpts below cannot outrun it.
  const material = await getMaterial(db, subject, materialId);

  const rows = await db
    .select()
    .from(materialChunks)
    .where(eq(materialChunks.materialId, material.id))
    .orderBy(asc(materialChunks.seq));

  return {
    material,
    excerpts: rows.map((row) => ({
      id: row.id,
      seq: row.seq,
      text: row.text,
      pageNo: row.pageNo,
      slideNo: row.slideNo,
      charStart: row.charStart,
      label:
        row.pageNo !== null
          ? `page ${row.pageNo}`
          : row.slideNo !== null
            ? `slide ${row.slideNo}`
            : null,
    })),
  };
}
