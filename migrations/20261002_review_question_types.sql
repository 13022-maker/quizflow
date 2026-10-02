CREATE TYPE "public"."review_create_mode" AS ENUM('free_text', 'question');--> statement-breakpoint
CREATE TYPE "public"."review_mode" AS ENUM('rubric', 'judgment', 'error_spot', 'ranking');--> statement-breakpoint
ALTER TABLE "review_score" ALTER COLUMN "correctness" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "review_score" ALTER COLUMN "completeness" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "review_score" ALTER COLUMN "clarity" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "review_score" ALTER COLUMN "creativity" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "review_sample" ADD COLUMN "ref_data" jsonb;--> statement-breakpoint
ALTER TABLE "review_score" ADD COLUMN "response_data" jsonb;--> statement-breakpoint
ALTER TABLE "review_set" ADD COLUMN "review_mode" "review_mode" DEFAULT 'rubric' NOT NULL;--> statement-breakpoint
ALTER TABLE "review_set" ADD COLUMN "create_mode" "review_create_mode" DEFAULT 'free_text' NOT NULL;
