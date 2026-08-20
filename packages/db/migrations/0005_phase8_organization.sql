ALTER TABLE "course_offerings" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lectures" ADD COLUMN "folder" text;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "folder" text;--> statement-breakpoint
-- Folder listings are per course and are read on every course page.
CREATE INDEX IF NOT EXISTS "lectures_folder_idx" ON "lectures" ("offering_id","folder");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "materials_folder_idx" ON "materials" ("offering_id","folder");--> statement-breakpoint
-- The course list filters archived courses out on every load.
CREATE INDEX IF NOT EXISTS "course_offerings_archived_idx" ON "course_offerings" ("archived_at");
