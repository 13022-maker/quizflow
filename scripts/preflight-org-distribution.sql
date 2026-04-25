-- preflight-org-distribution.sql
-- 用途：執行 migrations/0020_org_to_user_remap.sql 之前的 dry-run 檢查
-- 跑法：在 psql 連到目標 DB 後 \i scripts/preflight-org-distribution.sql
-- 目的：確認 Clerk API 撈到的 2 個 org 跟 DB 對得上，沒有「第三個 org」漏網
--
-- 對照 tmp/org-user-map.json：
--   org_3C9Fc71L84O62SBnuFjxtajvY2a → user_3C9FZwiUnMJYsBJ7T05aqmFku58
--   org_3C80WE4tWoeg68Tyq3rSPbOQkyn → user_3C80CmTLeVri8eACvNxCy1yTKPO

-- ==============================================
-- 1. 4 張表 owner_id 分布總覽
-- ==============================================
\echo '=== [1] owner_id 分布總覽 ==='
SELECT 'quiz' AS table_name, owner_id, COUNT(*) AS rows
  FROM quiz GROUP BY owner_id
UNION ALL
SELECT 'ai_usage', owner_id, COUNT(*) FROM ai_usage GROUP BY owner_id
UNION ALL
SELECT 'vocabulary_set', owner_id, COUNT(*) FROM vocabulary_set GROUP BY owner_id
UNION ALL
SELECT 'todo', owner_id, COUNT(*) FROM todo GROUP BY owner_id
ORDER BY table_name, owner_id;

-- ==============================================
-- 2. 預期 0020 會影響的列數（對 mapping 內的 2 個 org）
-- ==============================================
\echo ''
\echo '=== [2] 0020 預期會 UPDATE 的列數 ==='
SELECT 'quiz' AS table_name, owner_id, COUNT(*) AS will_be_updated
  FROM quiz
  WHERE owner_id IN ('org_3C9Fc71L84O62SBnuFjxtajvY2a', 'org_3C80WE4tWoeg68Tyq3rSPbOQkyn')
  GROUP BY owner_id
UNION ALL
SELECT 'ai_usage', owner_id, COUNT(*) FROM ai_usage
  WHERE owner_id IN ('org_3C9Fc71L84O62SBnuFjxtajvY2a', 'org_3C80WE4tWoeg68Tyq3rSPbOQkyn')
  GROUP BY owner_id
UNION ALL
SELECT 'vocabulary_set', owner_id, COUNT(*) FROM vocabulary_set
  WHERE owner_id IN ('org_3C9Fc71L84O62SBnuFjxtajvY2a', 'org_3C80WE4tWoeg68Tyq3rSPbOQkyn')
  GROUP BY owner_id
UNION ALL
SELECT 'todo', owner_id, COUNT(*) FROM todo
  WHERE owner_id IN ('org_3C9Fc71L84O62SBnuFjxtajvY2a', 'org_3C80WE4tWoeg68Tyq3rSPbOQkyn')
  GROUP BY owner_id
ORDER BY table_name, owner_id;

-- ==============================================
-- 3. 警告：偵測「第三個 org」（不在 mapping 內的 org_xxx）
--    預期結果：0 列。若有列必須先補進 mapping 重生 0020。
-- ==============================================
\echo ''
\echo '=== [3] 不在 mapping 內的孤兒 org（必須為 0 列） ==='
SELECT 'quiz' AS table_name, owner_id, COUNT(*) AS orphan_rows
  FROM quiz
  WHERE owner_id LIKE 'org_%'
    AND owner_id NOT IN ('org_3C9Fc71L84O62SBnuFjxtajvY2a', 'org_3C80WE4tWoeg68Tyq3rSPbOQkyn')
  GROUP BY owner_id
UNION ALL
SELECT 'ai_usage', owner_id, COUNT(*) FROM ai_usage
  WHERE owner_id LIKE 'org_%'
    AND owner_id NOT IN ('org_3C9Fc71L84O62SBnuFjxtajvY2a', 'org_3C80WE4tWoeg68Tyq3rSPbOQkyn')
  GROUP BY owner_id
UNION ALL
SELECT 'vocabulary_set', owner_id, COUNT(*) FROM vocabulary_set
  WHERE owner_id LIKE 'org_%'
    AND owner_id NOT IN ('org_3C9Fc71L84O62SBnuFjxtajvY2a', 'org_3C80WE4tWoeg68Tyq3rSPbOQkyn')
  GROUP BY owner_id
UNION ALL
SELECT 'todo', owner_id, COUNT(*) FROM todo
  WHERE owner_id LIKE 'org_%'
    AND owner_id NOT IN ('org_3C9Fc71L84O62SBnuFjxtajvY2a', 'org_3C80WE4tWoeg68Tyq3rSPbOQkyn')
  GROUP BY owner_id
ORDER BY table_name, owner_id;

-- ==============================================
-- 4. 已是 user_xxx 格式的列（不在本次 migration 範圍，跑完不變動）
-- ==============================================
\echo ''
\echo '=== [4] 已是 user_xxx 格式的列（migration 不會動） ==='
SELECT 'quiz' AS table_name, COUNT(*) AS rows_already_user_format
  FROM quiz WHERE owner_id LIKE 'user_%'
UNION ALL
SELECT 'ai_usage', COUNT(*) FROM ai_usage WHERE owner_id LIKE 'user_%'
UNION ALL
SELECT 'vocabulary_set', COUNT(*) FROM vocabulary_set WHERE owner_id LIKE 'user_%'
UNION ALL
SELECT 'todo', COUNT(*) FROM todo WHERE owner_id LIKE 'user_%'
ORDER BY table_name;

-- ==============================================
-- 5. 既不是 org_ 也不是 user_ 的怪資料（理論上應該 0 列）
-- ==============================================
\echo ''
\echo '=== [5] 怪格式 owner_id（必須為 0 列） ==='
SELECT 'quiz' AS table_name, owner_id, COUNT(*) AS weird_rows
  FROM quiz
  WHERE owner_id NOT LIKE 'org_%' AND owner_id NOT LIKE 'user_%'
  GROUP BY owner_id
UNION ALL
SELECT 'ai_usage', owner_id, COUNT(*) FROM ai_usage
  WHERE owner_id NOT LIKE 'org_%' AND owner_id NOT LIKE 'user_%'
  GROUP BY owner_id
UNION ALL
SELECT 'vocabulary_set', owner_id, COUNT(*) FROM vocabulary_set
  WHERE owner_id NOT LIKE 'org_%' AND owner_id NOT LIKE 'user_%'
  GROUP BY owner_id
UNION ALL
SELECT 'todo', owner_id, COUNT(*) FROM todo
  WHERE owner_id NOT LIKE 'org_%' AND owner_id NOT LIKE 'user_%'
  GROUP BY owner_id
ORDER BY table_name, owner_id;

-- 通過條件（全部成立才能跑 0020）：
--   [3] 0 列  ← 沒有第三個 org
--   [5] 0 列  ← 沒有壞資料
--   [2] 加總 == [1] 中 org_ 開頭那批的加總
