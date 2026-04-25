-- 108 新課綱「學習表現」代碼對齊
-- question 追加 competency_code (nullable text)，例：5-IV-3、a-IV-1
-- AI 出題時老師可選填對齊指標，題目卡片可顯示徽章便於審題與後續成績分析
-- 注意：**手寫** migration 以繞過 Drizzle migration snapshot 脫鉤（CLAUDE.md 有記載）

ALTER TABLE "question" ADD COLUMN IF NOT EXISTS "competency_code" text;
