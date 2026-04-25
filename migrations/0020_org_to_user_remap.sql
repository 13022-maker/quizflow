-- 0020_org_to_user_remap.sql
-- 自動生成於 2026-04-25 (scripts/build-org-user-map.ts)
--
-- Phase 1: 4 張表 owner_id 從 Clerk org_xxx 換成 creator user_xxx
-- 範圍:quiz / ai_usage / vocabulary_set / todo
-- 不在範圍:
--   live_game (已有 host_user_id,Phase 3 改 code 即可)
--   publisher (B 案保留,2026-10-25 重評)
--
-- Idempotent:WHERE owner_id = 'org_xxx',二次跑 0 筆
-- 對照筆數:2

-- org_3C9Fc71L84O62SBnuFjxtajvY2a → user_3C9FZwiUnMJYsBJ7T05aqmFku58
UPDATE "quiz" SET owner_id = 'user_3C9FZwiUnMJYsBJ7T05aqmFku58' WHERE owner_id = 'org_3C9Fc71L84O62SBnuFjxtajvY2a';
UPDATE "ai_usage" SET owner_id = 'user_3C9FZwiUnMJYsBJ7T05aqmFku58' WHERE owner_id = 'org_3C9Fc71L84O62SBnuFjxtajvY2a';
UPDATE "vocabulary_set" SET owner_id = 'user_3C9FZwiUnMJYsBJ7T05aqmFku58' WHERE owner_id = 'org_3C9Fc71L84O62SBnuFjxtajvY2a';
UPDATE "todo" SET owner_id = 'user_3C9FZwiUnMJYsBJ7T05aqmFku58' WHERE owner_id = 'org_3C9Fc71L84O62SBnuFjxtajvY2a';
--> statement-breakpoint
-- org_3C80WE4tWoeg68Tyq3rSPbOQkyn → user_3C80CmTLeVri8eACvNxCy1yTKPO
UPDATE "quiz" SET owner_id = 'user_3C80CmTLeVri8eACvNxCy1yTKPO' WHERE owner_id = 'org_3C80WE4tWoeg68Tyq3rSPbOQkyn';
UPDATE "ai_usage" SET owner_id = 'user_3C80CmTLeVri8eACvNxCy1yTKPO' WHERE owner_id = 'org_3C80WE4tWoeg68Tyq3rSPbOQkyn';
UPDATE "vocabulary_set" SET owner_id = 'user_3C80CmTLeVri8eACvNxCy1yTKPO' WHERE owner_id = 'org_3C80WE4tWoeg68Tyq3rSPbOQkyn';
UPDATE "todo" SET owner_id = 'user_3C80CmTLeVri8eACvNxCy1yTKPO' WHERE owner_id = 'org_3C80WE4tWoeg68Tyq3rSPbOQkyn';
--> statement-breakpoint
