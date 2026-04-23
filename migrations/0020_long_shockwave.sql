ALTER TABLE "response" ADD COLUMN "student_token" text;--> statement-breakpoint
ALTER TABLE "response" ADD COLUMN "last_answered_question_index" integer DEFAULT -1 NOT NULL;--> statement-breakpoint
ALTER TABLE "response" ADD COLUMN "status" text DEFAULT 'submitted' NOT NULL;--> statement-breakpoint
ALTER TABLE "response" ADD COLUMN "started_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "response" ADD CONSTRAINT "response_student_token_unique" UNIQUE("student_token");