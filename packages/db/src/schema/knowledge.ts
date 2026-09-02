import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
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
import { lectureSessions, lectures, materialChunks, materials, transcriptSegments } from './content';
import { users } from './identity';

/**
 * pgvector column.
 *
 * 384 dimensions: the MVP embeds with a small multilingual ONNX model on CPU
 * (ARCHITECTURE.md §3.9). The dimension is a deployment decision recorded per
 * row in `embeddingModel`, so changing models is an explicit backfill rather
 * than a silent corruption of the index.
 */
export const EMBEDDING_DIMENSIONS = 384;

const vector = customType<{ data: number[]; driverData: string }>({
  dataType: () => `vector(${EMBEDDING_DIMENSIONS})`,
  toDriver: (value) => `[${value.join(',')}]`,
  fromDriver: (value) => JSON.parse(value) as number[],
});

export const chunkSourceType = pgEnum('chunk_source_type', ['transcript', 'material', 'note']);
export const importanceType = pgEnum('importance_type', [
  'exam_relevant',
  'key_concept',
  'common_mistake',
  'repeat_emphasis',
]);
export const summaryScope = pgEnum('summary_scope', ['lecture', 'offering', 'topic', 'exam']);
export const questionType = pgEnum('question_type', [
  'mcq',
  'true_false',
  'short_answer',
  'written',
]);
export const examModeKind = pgEnum('exam_mode_kind', ['practice', 'final_review', 'topic_drill']);

/**
 * The single retrieval unit. Everything searchable becomes a row here,
 * whatever its origin — one vector index, one lexical index, one ranking
 * function, one citation format.
 */
export const contentChunks = pgTable(
  'content_chunks',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    offeringId: uuid('offering_id')
      .notNull()
      .references(() => courseOfferings.id, { onDelete: 'cascade' }),
    sourceType: chunkSourceType('source_type').notNull(),

    // provenance
    lectureId: uuid('lecture_id').references(() => lectures.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => lectureSessions.id, { onDelete: 'cascade' }),
    segmentStartId: uuid('segment_start_id').references(() => transcriptSegments.id, {
      onDelete: 'cascade',
    }),
    segmentEndId: uuid('segment_end_id').references(() => transcriptSegments.id, {
      onDelete: 'cascade',
    }),
    materialId: uuid('material_id').references(() => materials.id, { onDelete: 'cascade' }),
    materialChunkId: uuid('material_chunk_id').references(() => materialChunks.id, {
      onDelete: 'cascade',
    }),

    // citation anchors — what the UI jumps to
    tStartMs: integer('t_start_ms'),
    tEndMs: integer('t_end_ms'),
    pageNo: integer('page_no'),
    slideNo: integer('slide_no'),
    charStart: integer('char_start'),
    charEnd: integer('char_end'),

    // retrieval payload
    text: text('text').notNull(),
    textNormalized: text('text_normalized').notNull(),
    language: text('language'),
    tokenCount: integer('token_count'),
    /** Inherited from ASR; down-weights shaky audio in ranking. */
    confidence: real('confidence'),

    embedding: vector('embedding'),
    embeddingModel: text('embedding_model'),
    embeddingDimensions: integer('embedding_dimensions'),
    embeddedAt: timestamp('embedded_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('content_chunks_offering_idx').on(t.offeringId, t.sourceType),
    index('content_chunks_lecture_idx').on(t.lectureId, t.tStartMs),
    index('content_chunks_pending_idx').on(t.createdAt),
    /**
     * The most important constraint in the schema: a chunk with no anchor is a
     * chunk that cannot be cited, and the database refuses to store one. The
     * citation guarantee rests on uncitable content being unconstructable,
     * not on remembering to add anchors later.
     */
    check(
      'content_chunks_anchor_ck',
      sql`${t.tStartMs} IS NOT NULL OR ${t.pageNo} IS NOT NULL OR ${t.slideNo} IS NOT NULL OR ${t.charStart} IS NOT NULL`,
    ),
  ],
);

/** Cue phrases are rows, never literals in code — any language, any dialect. */
export const emphasisCues = pgTable(
  'emphasis_cues',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    language: text('language').notNull(),
    pattern: text('pattern').notNull(),
    cueType: importanceType('cue_type').notNull(),
    weight: real('weight').notNull().default(1),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [unique('emphasis_cues_language_pattern_key').on(t.language, t.pattern)],
);

export const lectureEmphasis = pgTable(
  'lecture_emphasis',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    lectureId: uuid('lecture_id')
      .notNull()
      .references(() => lectures.id, { onDelete: 'cascade' }),
    segmentId: uuid('segment_id')
      .notNull()
      .references(() => transcriptSegments.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id'),
    /** The instructor's actual words, so the UI can show provenance. */
    quote: text('quote').notNull(),
    tStartMs: integer('t_start_ms').notNull(),
    importanceType: importanceType('importance_type').notNull(),
    confidence: real('confidence').notNull(),
    cueId: uuid('cue_id').references(() => emphasisCues.id, { onDelete: 'set null' }),
    detectedBy: text('detected_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('lecture_emphasis_lecture_idx').on(t.lectureId, t.tStartMs)],
);

/** Topics are derived per course from its own content. Never enumerated in code. */
export const studyTopics = pgTable(
  'study_topics',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    offeringId: uuid('offering_id')
      .notNull()
      .references(() => courseOfferings.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    source: text('source').notNull().default('derived'),
    weight: real('weight').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('study_topics_offering_slug_key').on(t.offeringId, t.slug)],
);

export const topicLinks = pgTable(
  'topic_links',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => studyTopics.id, { onDelete: 'cascade' }),
    chunkId: uuid('chunk_id')
      .notNull()
      .references(() => contentChunks.id, { onDelete: 'cascade' }),
    relevance: real('relevance').notNull().default(1),
  },
  (t) => [unique('topic_links_topic_chunk_key').on(t.topicId, t.chunkId)],
);

export const summaries = pgTable(
  'summaries',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    scopeType: summaryScope('scope_type').notNull(),
    scopeId: uuid('scope_id').notNull(),
    offeringId: uuid('offering_id')
      .notNull()
      .references(() => courseOfferings.id, { onDelete: 'cascade' }),
    language: text('language').notNull().default('en'),
    content: text('content').notNull(),
    /** Which generator produced it: 'extractive' or an LLM model id. */
    generator: text('generator').notNull(),
    isCurrent: boolean('is_current').notNull().default(true),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('summaries_scope_idx').on(t.scopeType, t.scopeId)],
);

export const keywords = pgTable(
  'keywords',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    offeringId: uuid('offering_id')
      .notNull()
      .references(() => courseOfferings.id, { onDelete: 'cascade' }),
    lectureId: uuid('lecture_id').references(() => lectures.id, { onDelete: 'cascade' }),
    term: text('term').notNull(),
    weight: real('weight').notNull().default(1),
  },
  (t) => [index('keywords_offering_idx').on(t.offeringId)],
);

/**
 * Generated study content. `sourceChunkId` is NOT NULL on both tables: an item
 * that cannot name its source cannot be inserted, so the citation guarantee is
 * structural rather than a convention.
 */
export const flashcards = pgTable('flashcards', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  offeringId: uuid('offering_id')
    .notNull()
    .references(() => courseOfferings.id, { onDelete: 'cascade' }),
  topicId: uuid('topic_id').references(() => studyTopics.id, { onDelete: 'set null' }),
  front: text('front').notNull(),
  back: text('back').notNull(),
  language: text('language').notNull().default('en'),
  sourceChunkId: uuid('source_chunk_id')
    .notNull()
    .references(() => contentChunks.id, { onDelete: 'cascade' }),
  generator: text('generator').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const questions = pgTable('questions', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  offeringId: uuid('offering_id')
    .notNull()
    .references(() => courseOfferings.id, { onDelete: 'cascade' }),
  topicId: uuid('topic_id').references(() => studyTopics.id, { onDelete: 'set null' }),
  questionType: questionType('question_type').notNull(),
  stem: text('stem').notNull(),
  modelAnswer: text('model_answer'),
  explanation: text('explanation'),
  difficulty: real('difficulty'),
  language: text('language').notNull().default('en'),
  sourceChunkId: uuid('source_chunk_id')
    .notNull()
    .references(() => contentChunks.id, { onDelete: 'cascade' }),
  /** Links a question to the moment the instructor flagged it as important. */
  emphasisId: uuid('emphasis_id').references(() => lectureEmphasis.id, { onDelete: 'set null' }),
  generator: text('generator').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const questionOptions = pgTable(
  'question_options',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    text: text('text').notNull(),
    isCorrect: boolean('is_correct').notNull().default(false),
  },
  (t) => [unique('question_options_question_seq_key').on(t.questionId, t.seq)],
);

export const exams = pgTable('exams', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  offeringId: uuid('offering_id')
    .notNull()
    .references(() => courseOfferings.id, { onDelete: 'cascade' }),
  studentUserId: uuid('student_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  mode: examModeKind('mode').notNull().default('practice'),
  config: jsonb('config').notNull().default({}),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const examItems = pgTable(
  'exam_items',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    examId: uuid('exam_id')
      .notNull()
      .references(() => exams.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
  },
  (t) => [unique('exam_items_exam_seq_key').on(t.examId, t.seq)],
);

export const quizAttempts = pgTable('quiz_attempts', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  studentUserId: uuid('student_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  offeringId: uuid('offering_id')
    .notNull()
    .references(() => courseOfferings.id, { onDelete: 'cascade' }),
  examId: uuid('exam_id').references(() => exams.id, { onDelete: 'set null' }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  score: real('score'),
  maxScore: real('max_score'),
});

export const attemptAnswers = pgTable(
  'attempt_answers',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => quizAttempts.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id').references(() => studyTopics.id, { onDelete: 'set null' }),
    response: jsonb('response').notNull(),
    isCorrect: boolean('is_correct'),
    answeredAt: timestamp('answered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('attempt_answers_attempt_question_key').on(t.attemptId, t.questionId)],
);

/** Academic memory as structured records, never a prompt. */
export const studentTopicMastery = pgTable(
  'student_topic_mastery',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    studentUserId: uuid('student_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => studyTopics.id, { onDelete: 'cascade' }),
    offeringId: uuid('offering_id')
      .notNull()
      .references(() => courseOfferings.id, { onDelete: 'cascade' }),
    attempts: integer('attempts').notNull().default(0),
    correct: integer('correct').notNull().default(0),
    accuracy: real('accuracy').notNull().default(0),
    exposureCount: integer('exposure_count').notNull().default(0),
    masteryScore: real('mastery_score').notNull().default(0),
    /** How much evidence supports the score — separate from the score itself. */
    confidence: real('confidence').notNull().default(0),
    isWeak: boolean('is_weak').notNull().default(false),
    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('student_topic_mastery_student_topic_key').on(t.studentUserId, t.topicId)],
);

export const qaMessages = pgTable(
  'qa_messages',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    offeringId: uuid('offering_id').references(() => courseOfferings.id, {
      onDelete: 'cascade',
    }),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    refused: boolean('refused').notNull().default(false),
    refusalReason: text('refusal_reason'),
    topScore: real('top_score'),
    /** The validation set: any displayed citation can be re-audited later. */
    retrievedChunkIds: text('retrieved_chunk_ids').array().notNull().default([]),
    generator: text('generator').notNull(),
    latencyMs: integer('latency_ms'),
    /**
     * Set when the student bookmarks this answer.
     *
     * A column rather than a table: every answer is already stored here with
     * its retrieved set, and its validated citations already point at this row.
     * A separate saved-answers table would duplicate all of that and give the
     * two copies a way to disagree.
     */
    savedAt: timestamp('saved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('qa_messages_user_idx').on(t.userId, t.createdAt)],
);

export const citations = pgTable(
  'citations',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    chunkId: uuid('chunk_id')
      .notNull()
      .references(() => contentChunks.id, { onDelete: 'cascade' }),
    quote: text('quote'),
    /** Snapshot, so a rendered citation stays truthful if the index is rebuilt. */
    anchor: jsonb('anchor').notNull(),
    rank: integer('rank').notNull().default(0),
    validated: boolean('validated').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('citations_target_idx').on(t.targetType, t.targetId)],
);
