-- backup-before-0020.sql
-- 用途：執行 migrations/0020_org_to_user_remap.sql 之前備份 4 張表
-- 跑法：在 psql 連到目標 DB 後 \i scripts/backup-before-0020.sql
-- 命名：xxx_backup_20260425（同日重跑會 ERROR：already exists，是預期行為）
--
-- 還原指令見檔尾。

\echo '=== 建立 4 張表的快照備份 ==='

CREATE TABLE quiz_backup_20260425 AS SELECT * FROM quiz;
CREATE TABLE ai_usage_backup_20260425 AS SELECT * FROM ai_usage;
CREATE TABLE vocabulary_set_backup_20260425 AS SELECT * FROM vocabulary_set;
CREATE TABLE todo_backup_20260425 AS SELECT * FROM todo;

-- ==============================================
-- 驗證：source 跟 backup 筆數一致
-- ==============================================
\echo ''
\echo '=== 驗證 backup 筆數 ==='
SELECT 'quiz' AS table_name,
       (SELECT COUNT(*) FROM quiz) AS source_rows,
       (SELECT COUNT(*) FROM quiz_backup_20260425) AS backup_rows
UNION ALL
SELECT 'ai_usage',
       (SELECT COUNT(*) FROM ai_usage),
       (SELECT COUNT(*) FROM ai_usage_backup_20260425)
UNION ALL
SELECT 'vocabulary_set',
       (SELECT COUNT(*) FROM vocabulary_set),
       (SELECT COUNT(*) FROM vocabulary_set_backup_20260425)
UNION ALL
SELECT 'todo',
       (SELECT COUNT(*) FROM todo),
       (SELECT COUNT(*) FROM todo_backup_20260425)
ORDER BY table_name;

-- 通過條件：source_rows = backup_rows，否則停手別跑 0020。

-- ==============================================
-- 還原（rollback 0020 用，**僅在出問題時手動執行**）
-- ==============================================
-- 方式 A：只還原 owner_id 欄位（推薦，不影響 backup 後新增的列）
--   UPDATE quiz q
--     SET owner_id = b.owner_id
--     FROM quiz_backup_20260425 b
--     WHERE q.id = b.id AND q.owner_id <> b.owner_id;
--   UPDATE ai_usage a
--     SET owner_id = b.owner_id
--     FROM ai_usage_backup_20260425 b
--     WHERE a.id = b.id AND a.owner_id <> b.owner_id;
--   UPDATE vocabulary_set v
--     SET owner_id = b.owner_id
--     FROM vocabulary_set_backup_20260425 b
--     WHERE v.id = b.id AND v.owner_id <> b.owner_id;
--   UPDATE todo t
--     SET owner_id = b.owner_id
--     FROM todo_backup_20260425 b
--     WHERE t.id = b.id AND t.owner_id <> b.owner_id;
--
-- 方式 B：整列覆蓋（會丟掉 backup 之後的新資料，不推薦）
--   TRUNCATE quiz; INSERT INTO quiz SELECT * FROM quiz_backup_20260425;
--   ... (其他三張同)
--
-- ==============================================
-- 確認 0020 沒事後清理 backup（建議至少留 7 天再刪）
-- ==============================================
--   DROP TABLE quiz_backup_20260425;
--   DROP TABLE ai_usage_backup_20260425;
--   DROP TABLE vocabulary_set_backup_20260425;
--   DROP TABLE todo_backup_20260425;
