import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { courseOfferings } from './courses';
import { users } from './identity';

export const lectureStatus = pgEnum('lecture_status', [
  'scheduled',
  'recording',
  'processing',
  'ready',
  'failed',
]);
export const captureMode = pgEnum('capture_mode', ['live', 'upload']);
export const confidenceBand = pgEnum('confidence_band', ['high', 'medium', 'low']);
export const materialType = pgEnum('material_type', [
  'pdf', 'ppt', 'pptx', 'doc', 'docx', 'image', 'audio', 'video', 'text', 'other',
]);
export const processingStatus = pgEnum('processing_status', [
  'pending_upload', 'uploaded', 'extracting', 'chunking', 'embedding', 'ready', 'failed',
]);
export const materialRole = pgEnum('material_role', ['original', 'processed']);
export const uploadStatus = pgEnum('upload_status', [
  'pending', 'in_progress', 'completed', 'aborted', 'expired',
]);
export const jobStatus = pgEnum('job_status', [
  'pending', 'running', 'succeeded', 'failed', 'dead',
]);

export const lectures = pgTable(
  'lectures',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    offeringId: uuid('offering_id')
      .notNull()
      .references(() => courseOfferings.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** "Lecture 4". Nullable — courses number themselves differently or not at all. */
    sequenceNo: integer('sequence_no'),
    occurredOn: date('occurred_on'),
    status: lectureStatus('status').notNull().default('scheduled'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('lectures_offering_idx').on(t.offeringId, t.occurredOn)],
);

export const materials = pgTable(
  'materials',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    offeringId: uuid('offering_id')
      .notNull()
      .references(() => courseOfferings.id, { onDelete: 'cascade' }),
    lectureId: uuid('lecture_id').references(() => lectures.id, { onDelete: 'set null' }),
    uploaderUserId: uuid('uploader_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    materialType: materialType('material_type').notNull(),
    mimeType: text('mime_type').notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    checksumSha256: text('checksum_sha256').notNull(),
    storageProvider: text('storage_provider').notNull(),
    /** Reference only. Bytes never live in Postgres. */
    storageKey: text('storage_key').notNull(),
    pageCount: integer('page_count'),
    durationMs: integer('duration_ms'),
    processingStatus: processingStatus('processing_status').notNull().default('pending_upload'),
    processingError: text('processing_error'),
    /** The original is never modified; enhanced audio is a derived row. */
    role: materialRole('role').notNull().default('original'),
    derivedFromMaterialId: uuid('derived_from_material_id'),
    /** Client-generated before recording starts; makes a retried upload idempotent. */
    clientRef: text('client_ref'),
    retentionExpiresAt: timestamp('retention_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('materials_offering_idx').on(t.offeringId, t.createdAt),
    unique('materials_uploader_client_ref_key').on(t.uploaderUserId, t.clientRef),
    check(
      'materials_derived_ck',
      sql`(${t.role} = 'processed') = (${t.derivedFromMaterialId} IS NOT NULL)`,
    ),
  ],
);

export const lectureSessions = pgTable('lecture_sessions', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  lectureId: uuid('lecture_id')
    .notNull()
    .references(() => lectures.id, { onDelete: 'cascade' }),
  captureMode: captureMode('capture_mode').notNull(),
  recordingMaterialId: uuid('recording_material_id').references(() => materials.id, {
    onDelete: 'set null',
  }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  languageHints: text('language_hints').array().notNull().default([]),
  /** Recorded per session so a result can be reproduced later. */
  asrProvider: text('asr_provider'),
  asrModel: text('asr_model'),
  status: lectureStatus('status').notNull().default('recording'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
});

/**
 * The atomic unit of spoken content. `rawText` is written once and never
 * updated — corrections write `displayText` plus an audit row, so the original
 * transcription is always recoverable (DATABASE.md §4).
 */
export const transcriptSegments = pgTable(
  'transcript_segments',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => lectureSessions.id, { onDelete: 'cascade' }),
    lectureId: uuid('lecture_id')
      .notNull()
      .references(() => lectures.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    tStartMs: integer('t_start_ms').notNull(),
    tEndMs: integer('t_end_ms').notNull(),
    rawText: text('raw_text').notNull(),
    displayText: text('display_text').notNull(),
    primaryLanguage: text('primary_language'),
    isCodeSwitched: boolean('is_code_switched').notNull().default(false),
    confidence: real('confidence'),
    confidenceBand: confidenceBand('confidence_band'),
    noSpeechProb: real('no_speech_prob'),
    speakerLabel: text('speaker_label'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('transcript_segments_session_seq_key').on(t.sessionId, t.seq),
    index('transcript_segments_lecture_time_idx').on(t.lectureId, t.tStartMs),
    check('transcript_segments_range_ck', sql`${t.tEndMs} >= ${t.tStartMs}`),
  ],
);

/** Extraction output, preserving the document's own structure. */
export const materialChunks = pgTable(
  'material_chunks',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    materialId: uuid('material_id')
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    text: text('text').notNull(),
    pageNo: integer('page_no'),
    slideNo: integer('slide_no'),
    charStart: integer('char_start'),
    charEnd: integer('char_end'),
    language: text('language'),
    extractor: text('extractor').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('material_chunks_material_seq_key').on(t.materialId, t.seq)],
);

/**
 * Resumable, idempotent uploads. A lecture recorded offline is uploaded later,
 * possibly over a bad connection, possibly more than once.
 */
export const uploadSessions = pgTable(
  'upload_sessions',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    materialId: uuid('material_id')
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    clientRef: text('client_ref').notNull(),
    totalBytes: bigint('total_bytes', { mode: 'number' }).notNull(),
    receivedBytes: bigint('received_bytes', { mode: 'number' }).notNull().default(0),
    checksumSha256: text('checksum_sha256').notNull(),
    status: uploadStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [unique('upload_sessions_user_client_ref_key').on(t.userId, t.clientRef)],
);

/**
 * Job queue in Postgres (ARCHITECTURE.md §3.4). Status is a product
 * requirement, so a table beats a broker: the UI reads progress with a join.
 */
export const processingJobs = pgTable(
  'processing_jobs',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    jobType: text('job_type').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    payload: jsonb('payload').notNull().default({}),
    status: jobStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    lockedBy: text('locked_by'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('processing_jobs_claim_idx').on(t.status, t.runAfter),
    index('processing_jobs_target_idx').on(t.targetType, t.targetId),
  ],
);
