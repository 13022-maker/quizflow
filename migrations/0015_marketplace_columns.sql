ALTER TABLE "quiz" ADD COLUMN "is_marketplace" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "quiz" ADD COLUMN "grade_level" text;--> statement-breakpoint
ALTER TABLE "quiz" ADD COLUMN "tags" jsonb;--> statement-breakpoint
ALTER TABLE "quiz" ADD COLUMN "copy_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz" ADD COLUMN "original_quiz_id" integer;
