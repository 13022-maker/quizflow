-- Tier 2 護城河功能：自適應測驗（CAT）+ AI 口說評量
-- 1) question_type enum 追加 'speaking'
-- 2) question 追加 difficulty (1–5，預設 3)
-- 3) quiz 追加 adaptive_mode / adaptive_target_count
-- 4) response 追加 estimated_ability（CAT 收斂後的 theta 估計）
-- 5) answer 追加 audio_url + speech_assessment（口說題評量結果）
-- 注意：**手寫** migration 以繞過 Drizzle migration snapshot 脫鉤（CLAUDE.md 有記載），
-- 不使用 db:generate 避免把既有 marketplace / vocab / quiz_mode / live_mode / publisher 欄位重複塞入

ALTER TYPE "question_type" ADD VALUE IF NOT EXISTS 'speaking';--> statement-breakpoint
ALTER TABLE "question" ADD COLUMN IF NOT EXISTS "difficulty" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz" ADD COLUMN IF NOT EXISTS "adaptive_mode" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz" ADD COLUMN IF NOT EXISTS "adaptive_target_count" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "response" ADD COLUMN IF NOT EXISTS "estimated_ability" real;--> statement-breakpoint
ALTER TABLE "answer" ADD COLUMN IF NOT EXISTS "audio_url" text;--> statement-breakpoint
ALTER TABLE "answer" ADD COLUMN IF NOT EXISTS "speech_assessment" jsonb;
