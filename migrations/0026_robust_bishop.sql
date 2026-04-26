-- Phase 2 commit 5C:tags jsonb → text[]
-- Drizzle 預設不加 USING cast。jsonb→text[] PG 不能直接 cast。
-- USING expression 不允許 subquery,所以用 PL/pgSQL function 包(function body 允許 subquery）。
-- pg_temp 是臨時 schema,session 結束自動清,不污染 production。
-- Neon preview branch (br-royal-pond-a1ovyy90) 已 dry-run 驗證:163 row 中 4 個有 tags
-- 全部正確轉 text[](含中文字符）。
CREATE OR REPLACE FUNCTION pg_temp.jsonb_to_text_array(j jsonb) RETURNS text[] AS $$
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;
  RETURN ARRAY(SELECT jsonb_array_elements_text(j));
END;
$$ LANGUAGE plpgsql IMMUTABLE;
--> statement-breakpoint
ALTER TABLE "quiz" ALTER COLUMN "tags" SET DATA TYPE text[] USING pg_temp.jsonb_to_text_array(tags);