CREATE TYPE "public"."chunk_source_type" AS ENUM('transcript', 'material', 'note');--> statement-breakpoint
CREATE TYPE "public"."exam_mode_kind" AS ENUM('practice', 'final_review', 'topic_drill');--> statement-breakpoint
CREATE TYPE "public"."importance_type" AS ENUM('exam_relevant', 'key_concept', 'common_mistake', 'repeat_emphasis');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('mcq', 'true_false', 'short_answer', 'written');--> statement-breakpoint
CREATE TYPE "public"."summary_scope" AS ENUM('lecture', 'offering', 'topic', 'exam');--> statement-breakpoint
CREATE TABLE "attempt_answers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"attempt_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"topic_id" uuid,
	"response" jsonb NOT NULL,
	"is_correct" boolean,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attempt_answers_attempt_question_key" UNIQUE("attempt_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "citations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"chunk_id" uuid NOT NULL,
	"quote" text,
	"anchor" jsonb NOT NULL,
	"rank" integer DEFAULT 0 NOT NULL,
	"validated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"offering_id" uuid NOT NULL,
	"source_type" "chunk_source_type" NOT NULL,
	"lecture_id" uuid,
	"session_id" uuid,
	"segment_start_id" uuid,
	"segment_end_id" uuid,
	"material_id" uuid,
	"material_chunk_id" uuid,
	"t_start_ms" integer,
	"t_end_ms" integer,
	"page_no" integer,
	"slide_no" integer,
	"char_start" integer,
	"char_end" integer,
	"text" text NOT NULL,
	"text_normalized" text NOT NULL,
	"language" text,
	"token_count" integer,
	"confidence" real,
	"embedding" vector(384),
	"embedding_model" text,
	"embedding_dimensions" integer,
	"embedded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_chunks_anchor_ck" CHECK ("content_chunks"."t_start_ms" IS NOT NULL OR "content_chunks"."page_no" IS NOT NULL OR "content_chunks"."slide_no" IS NOT NULL OR "content_chunks"."char_start" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "emphasis_cues" (
	"id" uuid PRIMARY KEY NOT NULL,
	"language" text NOT NULL,
	"pattern" text NOT NULL,
	"cue_type" "importance_type" NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "emphasis_cues_language_pattern_key" UNIQUE("language","pattern")
);
--> statement-breakpoint
CREATE TABLE "exam_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"exam_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	CONSTRAINT "exam_items_exam_seq_key" UNIQUE("exam_id","seq")
);
--> statement-breakpoint
CREATE TABLE "exams" (
	"id" uuid PRIMARY KEY NOT NULL,
	"offering_id" uuid NOT NULL,
	"student_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"mode" "exam_mode_kind" DEFAULT 'practice' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flashcards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"offering_id" uuid NOT NULL,
	"topic_id" uuid,
	"front" text NOT NULL,
	"back" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"source_chunk_id" uuid NOT NULL,
	"generator" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keywords" (
	"id" uuid PRIMARY KEY NOT NULL,
	"offering_id" uuid NOT NULL,
	"lecture_id" uuid,
	"term" text NOT NULL,
	"weight" real DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lecture_emphasis" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lecture_id" uuid NOT NULL,
	"segment_id" uuid NOT NULL,
	"topic_id" uuid,
	"quote" text NOT NULL,
	"t_start_ms" integer NOT NULL,
	"importance_type" "importance_type" NOT NULL,
	"confidence" real NOT NULL,
	"cue_id" uuid,
	"detected_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qa_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"offering_id" uuid,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"refused" boolean DEFAULT false NOT NULL,
	"refusal_reason" text,
	"top_score" real,
	"retrieved_chunk_ids" text[] DEFAULT '{}' NOT NULL,
	"generator" text NOT NULL,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_options" (
	"id" uuid PRIMARY KEY NOT NULL,
	"question_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"text" text NOT NULL,
	"is_correct" boolean DEFAULT false NOT NULL,
	CONSTRAINT "question_options_question_seq_key" UNIQUE("question_id","seq")
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"offering_id" uuid NOT NULL,
	"topic_id" uuid,
	"question_type" "question_type" NOT NULL,
	"stem" text NOT NULL,
	"model_answer" text,
	"explanation" text,
	"difficulty" real,
	"language" text DEFAULT 'en' NOT NULL,
	"source_chunk_id" uuid NOT NULL,
	"emphasis_id" uuid,
	"generator" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"student_user_id" uuid NOT NULL,
	"offering_id" uuid NOT NULL,
	"exam_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"score" real,
	"max_score" real
);
--> statement-breakpoint
CREATE TABLE "student_topic_mastery" (
	"id" uuid PRIMARY KEY NOT NULL,
	"student_user_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"offering_id" uuid NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"correct" integer DEFAULT 0 NOT NULL,
	"accuracy" real DEFAULT 0 NOT NULL,
	"exposure_count" integer DEFAULT 0 NOT NULL,
	"mastery_score" real DEFAULT 0 NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"is_weak" boolean DEFAULT false NOT NULL,
	"last_reviewed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_topic_mastery_student_topic_key" UNIQUE("student_user_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE "study_topics" (
	"id" uuid PRIMARY KEY NOT NULL,
	"offering_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"source" text DEFAULT 'derived' NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_topics_offering_slug_key" UNIQUE("offering_id","slug")
);
--> statement-breakpoint
CREATE TABLE "summaries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope_type" "summary_scope" NOT NULL,
	"scope_id" uuid NOT NULL,
	"offering_id" uuid NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"content" text NOT NULL,
	"generator" text NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"topic_id" uuid NOT NULL,
	"chunk_id" uuid NOT NULL,
	"relevance" real DEFAULT 1 NOT NULL,
	CONSTRAINT "topic_links_topic_chunk_key" UNIQUE("topic_id","chunk_id")
);
--> statement-breakpoint
ALTER TABLE "attempt_answers" ADD CONSTRAINT "attempt_answers_attempt_id_quiz_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."quiz_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_answers" ADD CONSTRAINT "attempt_answers_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_answers" ADD CONSTRAINT "attempt_answers_topic_id_study_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."study_topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_chunk_id_content_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."content_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_chunks" ADD CONSTRAINT "content_chunks_offering_id_course_offerings_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_chunks" ADD CONSTRAINT "content_chunks_lecture_id_lectures_id_fk" FOREIGN KEY ("lecture_id") REFERENCES "public"."lectures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_chunks" ADD CONSTRAINT "content_chunks_session_id_lecture_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."lecture_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_chunks" ADD CONSTRAINT "content_chunks_segment_start_id_transcript_segments_id_fk" FOREIGN KEY ("segment_start_id") REFERENCES "public"."transcript_segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_chunks" ADD CONSTRAINT "content_chunks_segment_end_id_transcript_segments_id_fk" FOREIGN KEY ("segment_end_id") REFERENCES "public"."transcript_segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_chunks" ADD CONSTRAINT "content_chunks_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_chunks" ADD CONSTRAINT "content_chunks_material_chunk_id_material_chunks_id_fk" FOREIGN KEY ("material_chunk_id") REFERENCES "public"."material_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_items" ADD CONSTRAINT "exam_items_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_items" ADD CONSTRAINT "exam_items_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_offering_id_course_offerings_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flashcards" ADD CONSTRAINT "flashcards_offering_id_course_offerings_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flashcards" ADD CONSTRAINT "flashcards_topic_id_study_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."study_topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flashcards" ADD CONSTRAINT "flashcards_source_chunk_id_content_chunks_id_fk" FOREIGN KEY ("source_chunk_id") REFERENCES "public"."content_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keywords" ADD CONSTRAINT "keywords_offering_id_course_offerings_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keywords" ADD CONSTRAINT "keywords_lecture_id_lectures_id_fk" FOREIGN KEY ("lecture_id") REFERENCES "public"."lectures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_emphasis" ADD CONSTRAINT "lecture_emphasis_lecture_id_lectures_id_fk" FOREIGN KEY ("lecture_id") REFERENCES "public"."lectures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_emphasis" ADD CONSTRAINT "lecture_emphasis_segment_id_transcript_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."transcript_segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_emphasis" ADD CONSTRAINT "lecture_emphasis_cue_id_emphasis_cues_id_fk" FOREIGN KEY ("cue_id") REFERENCES "public"."emphasis_cues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_messages" ADD CONSTRAINT "qa_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_messages" ADD CONSTRAINT "qa_messages_offering_id_course_offerings_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_options" ADD CONSTRAINT "question_options_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_offering_id_course_offerings_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_topic_id_study_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."study_topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_source_chunk_id_content_chunks_id_fk" FOREIGN KEY ("source_chunk_id") REFERENCES "public"."content_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_emphasis_id_lecture_emphasis_id_fk" FOREIGN KEY ("emphasis_id") REFERENCES "public"."lecture_emphasis"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_offering_id_course_offerings_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_topic_mastery" ADD CONSTRAINT "student_topic_mastery_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_topic_mastery" ADD CONSTRAINT "student_topic_mastery_topic_id_study_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."study_topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_topic_mastery" ADD CONSTRAINT "student_topic_mastery_offering_id_course_offerings_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_topics" ADD CONSTRAINT "study_topics_offering_id_course_offerings_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summaries" ADD CONSTRAINT "summaries_offering_id_course_offerings_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_links" ADD CONSTRAINT "topic_links_topic_id_study_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."study_topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_links" ADD CONSTRAINT "topic_links_chunk_id_content_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."content_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "citations_target_idx" ON "citations" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "content_chunks_offering_idx" ON "content_chunks" USING btree ("offering_id","source_type");--> statement-breakpoint
CREATE INDEX "content_chunks_lecture_idx" ON "content_chunks" USING btree ("lecture_id","t_start_ms");--> statement-breakpoint
CREATE INDEX "content_chunks_pending_idx" ON "content_chunks" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "keywords_offering_idx" ON "keywords" USING btree ("offering_id");--> statement-breakpoint
CREATE INDEX "lecture_emphasis_lecture_idx" ON "lecture_emphasis" USING btree ("lecture_id","t_start_ms");--> statement-breakpoint
CREATE INDEX "qa_messages_user_idx" ON "qa_messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "summaries_scope_idx" ON "summaries" USING btree ("scope_type","scope_id");--> statement-breakpoint
-- Vector and lexical indexes: drizzle-kit does not emit HNSW or expression
-- indexes, so they are written by hand. Retrieval filters by offering first,
-- which is both the permission boundary and what keeps HNSW fast.
CREATE INDEX IF NOT EXISTS "content_chunks_embedding_idx" ON "content_chunks" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_chunks_tsv_idx" ON "content_chunks" USING gin (to_tsvector('simple', "text_normalized"));
