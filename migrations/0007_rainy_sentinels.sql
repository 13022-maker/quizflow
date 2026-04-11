ALTER TABLE "quiz" ADD COLUMN "prevent_leave" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "response" ADD COLUMN "leave_count" integer DEFAULT 0 NOT NULL;