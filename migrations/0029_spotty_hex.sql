ALTER TABLE "vocabulary_set" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "vocabulary_set" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "vocabulary_set" ADD COLUMN "grade_level" text;--> statement-breakpoint
ALTER TABLE "vocabulary_set" ADD COLUMN "fork_count" integer DEFAULT 0 NOT NULL;