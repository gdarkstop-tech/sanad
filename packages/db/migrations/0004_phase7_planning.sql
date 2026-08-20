CREATE TYPE "public"."availability_kind" AS ENUM('study', 'work', 'gym', 'class', 'sleep', 'other');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('active', 'superseded', 'archived');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('planned', 'completed', 'skipped', 'rescheduled');--> statement-breakpoint
CREATE TABLE "course_exams" (
	"id" uuid PRIMARY KEY NOT NULL,
	"offering_id" uuid NOT NULL,
	"student_user_id" uuid,
	"title" text NOT NULL,
	"exam_at" timestamp with time zone NOT NULL,
	"weight" real DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_commitments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"student_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" "availability_kind" DEFAULT 'other' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	CONSTRAINT "student_commitments_range_ck" CHECK ("student_commitments"."ends_at" > "student_commitments"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "study_availability" (
	"id" uuid PRIMARY KEY NOT NULL,
	"student_user_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"kind" "availability_kind" NOT NULL,
	"is_available" boolean NOT NULL,
	CONSTRAINT "study_availability_weekday_ck" CHECK ("study_availability"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "study_availability_range_ck" CHECK ("study_availability"."end_time" > "study_availability"."start_time")
);
--> statement-breakpoint
CREATE TABLE "study_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"student_user_id" uuid NOT NULL,
	"horizon_start" date NOT NULL,
	"horizon_end" date NOT NULL,
	"status" "plan_status" DEFAULT 'active' NOT NULL,
	"generator_version" text NOT NULL,
	"constraints_snapshot" jsonb NOT NULL,
	"coach_message" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"student_user_id" uuid NOT NULL,
	"offering_id" uuid,
	"topic_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"activity_type" text NOT NULL,
	"priority_score" real NOT NULL,
	"status" "session_status" DEFAULT 'planned' NOT NULL,
	"rationale" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"actual_minutes" integer,
	CONSTRAINT "study_sessions_range_ck" CHECK ("study_sessions"."ends_at" > "study_sessions"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "course_exams" ADD CONSTRAINT "course_exams_offering_id_course_offerings_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_exams" ADD CONSTRAINT "course_exams_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_commitments" ADD CONSTRAINT "student_commitments_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_availability" ADD CONSTRAINT "study_availability_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_plans" ADD CONSTRAINT "study_plans_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_plan_id_study_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."study_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_offering_id_course_offerings_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_topic_id_study_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."study_topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_exams_offering_idx" ON "course_exams" USING btree ("offering_id","exam_at");--> statement-breakpoint
CREATE INDEX "student_commitments_user_idx" ON "student_commitments" USING btree ("student_user_id","starts_at");--> statement-breakpoint
CREATE INDEX "study_availability_user_idx" ON "study_availability" USING btree ("student_user_id","weekday");--> statement-breakpoint
CREATE UNIQUE INDEX "study_plans_one_active_idx" ON "study_plans" USING btree ("student_user_id") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "study_sessions_student_idx" ON "study_sessions" USING btree ("student_user_id","starts_at");--> statement-breakpoint
-- Double-booking is prevented by the database, not only by the scheduler.
-- §15 of the brief requires the coach never double-books; a constraint
-- guarantees it even if a scheduler bug tries. Requires btree_gist for the
-- equality half of the exclusion.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_no_overlap"
  EXCLUDE USING gist (
    "student_user_id" WITH =,
    tstzrange("starts_at", "ends_at") WITH &&
  ) WHERE (status = 'planned');
