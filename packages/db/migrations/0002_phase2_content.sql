CREATE TYPE "public"."capture_mode" AS ENUM('live', 'upload');--> statement-breakpoint
CREATE TYPE "public"."confidence_band" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."lecture_status" AS ENUM('scheduled', 'recording', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."material_role" AS ENUM('original', 'processed');--> statement-breakpoint
CREATE TYPE "public"."material_type" AS ENUM('pdf', 'ppt', 'pptx', 'doc', 'docx', 'image', 'audio', 'video', 'text', 'other');--> statement-breakpoint
CREATE TYPE "public"."processing_status" AS ENUM('pending_upload', 'uploaded', 'extracting', 'chunking', 'embedding', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."upload_status" AS ENUM('pending', 'in_progress', 'completed', 'aborted', 'expired');--> statement-breakpoint
CREATE TABLE "lecture_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lecture_id" uuid NOT NULL,
	"capture_mode" "capture_mode" NOT NULL,
	"recording_material_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"language_hints" text[] DEFAULT '{}' NOT NULL,
	"asr_provider" text,
	"asr_model" text,
	"status" "lecture_status" DEFAULT 'recording' NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "lectures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"offering_id" uuid NOT NULL,
	"title" text NOT NULL,
	"sequence_no" integer,
	"occurred_on" date,
	"status" "lecture_status" DEFAULT 'scheduled' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "material_chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"material_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"text" text NOT NULL,
	"page_no" integer,
	"slide_no" integer,
	"char_start" integer,
	"char_end" integer,
	"language" text,
	"extractor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_chunks_material_seq_key" UNIQUE("material_id","seq")
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"offering_id" uuid NOT NULL,
	"lecture_id" uuid,
	"uploader_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"material_type" "material_type" NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"checksum_sha256" text NOT NULL,
	"storage_provider" text NOT NULL,
	"storage_key" text NOT NULL,
	"page_count" integer,
	"duration_ms" integer,
	"processing_status" "processing_status" DEFAULT 'pending_upload' NOT NULL,
	"processing_error" text,
	"role" "material_role" DEFAULT 'original' NOT NULL,
	"derived_from_material_id" uuid,
	"client_ref" text,
	"retention_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "materials_uploader_client_ref_key" UNIQUE("uploader_user_id","client_ref"),
	CONSTRAINT "materials_derived_ck" CHECK (("materials"."role" = 'processed') = ("materials"."derived_from_material_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "processing_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_type" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcript_segments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"lecture_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"t_start_ms" integer NOT NULL,
	"t_end_ms" integer NOT NULL,
	"raw_text" text NOT NULL,
	"display_text" text NOT NULL,
	"primary_language" text,
	"is_code_switched" boolean DEFAULT false NOT NULL,
	"confidence" real,
	"confidence_band" "confidence_band",
	"no_speech_prob" real,
	"speaker_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transcript_segments_session_seq_key" UNIQUE("session_id","seq"),
	CONSTRAINT "transcript_segments_range_ck" CHECK ("transcript_segments"."t_end_ms" >= "transcript_segments"."t_start_ms")
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"client_ref" text NOT NULL,
	"total_bytes" bigint NOT NULL,
	"received_bytes" bigint DEFAULT 0 NOT NULL,
	"checksum_sha256" text NOT NULL,
	"status" "upload_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "upload_sessions_user_client_ref_key" UNIQUE("user_id","client_ref")
);
--> statement-breakpoint
ALTER TABLE "lecture_sessions" ADD CONSTRAINT "lecture_sessions_lecture_id_lectures_id_fk" FOREIGN KEY ("lecture_id") REFERENCES "public"."lectures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_sessions" ADD CONSTRAINT "lecture_sessions_recording_material_id_materials_id_fk" FOREIGN KEY ("recording_material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_sessions" ADD CONSTRAINT "lecture_sessions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lectures" ADD CONSTRAINT "lectures_offering_id_course_offerings_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lectures" ADD CONSTRAINT "lectures_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_chunks" ADD CONSTRAINT "material_chunks_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_offering_id_course_offerings_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_lecture_id_lectures_id_fk" FOREIGN KEY ("lecture_id") REFERENCES "public"."lectures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_uploader_user_id_users_id_fk" FOREIGN KEY ("uploader_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_session_id_lecture_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."lecture_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_lecture_id_lectures_id_fk" FOREIGN KEY ("lecture_id") REFERENCES "public"."lectures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lectures_offering_idx" ON "lectures" USING btree ("offering_id","occurred_on");--> statement-breakpoint
CREATE INDEX "materials_offering_idx" ON "materials" USING btree ("offering_id","created_at");--> statement-breakpoint
CREATE INDEX "processing_jobs_claim_idx" ON "processing_jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "processing_jobs_target_idx" ON "processing_jobs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "transcript_segments_lecture_time_idx" ON "transcript_segments" USING btree ("lecture_id","t_start_ms");