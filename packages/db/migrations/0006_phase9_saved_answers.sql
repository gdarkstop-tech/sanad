ALTER TABLE "qa_messages" ADD COLUMN "saved_at" timestamp with time zone;--> statement-breakpoint
-- Saved answers are listed per student, newest first.
CREATE INDEX IF NOT EXISTS "qa_messages_saved_idx" ON "qa_messages" ("user_id","saved_at" DESC) WHERE "saved_at" IS NOT NULL;
