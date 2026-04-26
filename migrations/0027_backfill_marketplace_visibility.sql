-- Phase 2 commit 5D backfill: 既有 isMarketplace=true 但 visibility='private' 的 row 補成 'public'
--
-- 背景:Phase 1 commit 2 才加 visibility 欄位,4 個歷史 marketplace quiz 在那之前已 publish,
-- 所以 isMarketplace=true 但 visibility 是預設 'private'。本 commit 把 marketplace 過濾邏輯
-- 改用 visibility='public',若不 backfill 這 4 個會從 marketplace 列表消失(breaking change)。
--
-- 安全性:WHERE 嚴格(is_marketplace=true AND visibility='private')只動目標 row,
-- 已用 Neon MCP query production 確認剛好 4 row 符合,不會誤動其他 row。
UPDATE "quiz" SET "visibility" = 'public' WHERE "is_marketplace" = true AND "visibility" = 'private';
