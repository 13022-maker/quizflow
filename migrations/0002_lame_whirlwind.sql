ALTER TABLE "quiz" ADD COLUMN IF NOT EXISTS "allowed_attempts" integer;--> statement-breakpoint
ALTER TABLE "quiz" ADD COLUMN IF NOT EXISTS "show_answers" boolean DEFAULT true NOT NULL;
