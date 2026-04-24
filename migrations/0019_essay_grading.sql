-- 申論題 / 作文 AI 批改（含評分量表）
-- 1. question.rubric 儲存每題的評分量表（JSONB，null 時前端沿用系統預設 4 面向）
-- 2. answer 新增批改結果欄位：points / ai_grading / teacher_feedback / graded_at / graded_by
-- 3. ai_usage 新增 feature 欄位以區分 question_generation 與 essay_grading quota
ALTER TABLE "question" ADD COLUMN "rubric" jsonb;--> statement-breakpoint
ALTER TABLE "answer" ADD COLUMN "points" integer;--> statement-breakpoint
ALTER TABLE "answer" ADD COLUMN "ai_grading" jsonb;--> statement-breakpoint
ALTER TABLE "answer" ADD COLUMN "teacher_feedback" text;--> statement-breakpoint
ALTER TABLE "answer" ADD COLUMN "graded_at" timestamp;--> statement-breakpoint
ALTER TABLE "answer" ADD COLUMN "graded_by" text;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "feature" text DEFAULT 'question_generation' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_usage_owner_ym_feature_idx" ON "ai_usage" USING btree ("owner_id","year_month","feature");
