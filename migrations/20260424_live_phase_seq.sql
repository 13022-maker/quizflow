-- Live Mode 同步優化：phase 狀態機 + sequence number + 絕對時間 endsAt
-- 1) 在 live_game_status enum 追加 'locked'（倒數已結束、尚未 reveal）
-- 2) 在 live_game 增加 seq / quiz_version / question_ends_at 三欄
-- 注意：**手寫** migration（CLAUDE.md 有記 snapshot 脫鉤），不使用 db:generate

-- 1. enum 追加 'locked'
ALTER TYPE "live_game_status" ADD VALUE IF NOT EXISTS 'locked' BEFORE 'showing_result';
--> statement-breakpoint

-- 2. live_game 新增欄位
ALTER TABLE "live_game" ADD COLUMN IF NOT EXISTS "seq" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "live_game" ADD COLUMN IF NOT EXISTS "quiz_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "live_game" ADD COLUMN IF NOT EXISTS "question_ends_at" timestamp;
