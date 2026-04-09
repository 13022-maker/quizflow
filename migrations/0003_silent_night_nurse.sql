ALTER TABLE "quiz" ADD COLUMN "access_code" text;--> statement-breakpoint
ALTER TABLE "quiz" ADD CONSTRAINT "quiz_access_code_unique" UNIQUE("access_code");