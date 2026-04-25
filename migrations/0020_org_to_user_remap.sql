-- 0020_org_to_user_remap.sql
-- 自動生成於 2026-04-25 (scripts/build-org-user-map.ts)
--
-- Phase 1: 4 張表 owner_id 從 Clerk org_xxx 換成 user_xxx
-- 範圍:quiz / ai_usage / vocabulary_set / todo
-- 不在範圍:
--   live_game (已有 host_user_id,Phase 3 改 code 即可)
--   publisher (B 案保留,2026-10-25 重評)
--
-- Idempotent:每條 UPDATE 都用 WHERE 比對特定 owner_id,二次跑 0 筆
-- 兩段:
--   A. Active orgs (Clerk listOrganizations 回的) → 各自的 createdBy
--      2 個 org
--   B. Dead orgs (Clerk 已刪除,從 audit 撈出) → user_3C9FZwiUnMJYsBJ7T05aqmFku58
--      45 個 org

-- =============================================
-- Section A: Active orgs → 各自 createdBy
-- =============================================
-- org_3C9Fc71L84O62SBnuFjxtajvY2a → user_3C9FZwiUnMJYsBJ7T05aqmFku58
UPDATE "quiz" SET owner_id = 'user_3C9FZwiUnMJYsBJ7T05aqmFku58' WHERE owner_id = 'org_3C9Fc71L84O62SBnuFjxtajvY2a';
--> statement-breakpoint
UPDATE "ai_usage" SET owner_id = 'user_3C9FZwiUnMJYsBJ7T05aqmFku58' WHERE owner_id = 'org_3C9Fc71L84O62SBnuFjxtajvY2a';
--> statement-breakpoint
UPDATE "vocabulary_set" SET owner_id = 'user_3C9FZwiUnMJYsBJ7T05aqmFku58' WHERE owner_id = 'org_3C9Fc71L84O62SBnuFjxtajvY2a';
--> statement-breakpoint
UPDATE "todo" SET owner_id = 'user_3C9FZwiUnMJYsBJ7T05aqmFku58' WHERE owner_id = 'org_3C9Fc71L84O62SBnuFjxtajvY2a';
--> statement-breakpoint
-- org_3C80WE4tWoeg68Tyq3rSPbOQkyn → user_3C80CmTLeVri8eACvNxCy1yTKPO
UPDATE "quiz" SET owner_id = 'user_3C80CmTLeVri8eACvNxCy1yTKPO' WHERE owner_id = 'org_3C80WE4tWoeg68Tyq3rSPbOQkyn';
--> statement-breakpoint
UPDATE "ai_usage" SET owner_id = 'user_3C80CmTLeVri8eACvNxCy1yTKPO' WHERE owner_id = 'org_3C80WE4tWoeg68Tyq3rSPbOQkyn';
--> statement-breakpoint
UPDATE "vocabulary_set" SET owner_id = 'user_3C80CmTLeVri8eACvNxCy1yTKPO' WHERE owner_id = 'org_3C80WE4tWoeg68Tyq3rSPbOQkyn';
--> statement-breakpoint
UPDATE "todo" SET owner_id = 'user_3C80CmTLeVri8eACvNxCy1yTKPO' WHERE owner_id = 'org_3C80WE4tWoeg68Tyq3rSPbOQkyn';
--> statement-breakpoint

-- =============================================
-- Section B: Dead orgs (45 個) → user_3C9FZwiUnMJYsBJ7T05aqmFku58
-- =============================================
UPDATE "quiz" SET owner_id = 'user_3C9FZwiUnMJYsBJ7T05aqmFku58' WHERE owner_id IN (
  'org_3BwcJqMgt3oBAF0Bfn4R6tMoneu',
  'org_3C6U8TTFDUKvks35ghxTJi9Upax',
  'org_3BrzjuzIJlzPmYzRit79gxlinwl',
  'org_3C9K6qfUAYIfF1o6kCR2uMI18S3',
  'org_3C6UkqLyaPNU4TqnZMuZNpXR3G9',
  'org_3C9Q5IYj79ZCo14fqxgddpS3Lpx',
  'org_3BwcP3BinmFG8t4qE8TQBp4QZTC',
  'org_3CJIyokYl6pf6QCBXD8XVTorfrc',
  'org_3By6uVG29hYE6BpPfTKYKfYi2Pr',
  'org_3CGFpPLJaNrJej4WyDJlhVyvyND',
  'org_3CTGz7qSlozesHEzCMOvMIsDnIO',
  'org_3CTH0j7WwBBTEUOUHMf3P9a2nfv',
  'org_3CTHNGAqfzxSFZdtH4pIHv6qCfE',
  'org_3CTI2j21JvGbVJy9zOZ1GL2f0LI',
  'org_3CTOwdSd2N71Y5ql4ja3GkezRAU',
  'org_3CVSl9kidzSFnyyGwDHXfhdcN9s',
  'org_3C7iinx4tikt4UpLuXAmhfFNck2',
  'org_3CHf0AQREhMYdYYQyiwz2EjpgCq',
  'org_3CHtdRk4xk9dxNSirKG8MGpYq9n',
  'org_3CNnlzCqsstAujbJMBZoIaUiW1T',
  'org_3CQkplJHQywB6V8yoOLW9vp1cTO',
  'org_3CTGwPUj08hblfCfrqSLNZjoiiE',
  'org_3CTH1Q3uI6dSISMT4Ro1Xx1qrKl',
  'org_3CTH1Y38QJjSOEtLKDmLyOgey2d',
  'org_3CTHQ7zpV1FG3ZANzxsescwqhhH',
  'org_3CTHUi9P5QnO4H0VmBrJnDswP7m',
  'org_3CTHUk09kBAGMIRqsBjDYstPdB9',
  'org_3CTHXaPGWHhWznXk0P5GCenDxg8',
  'org_3CTIAJWOCC2Mo4aUOqGEkTnrsE9',
  'org_3CTIv3sRr1VXCXCyP9AOHg3vZkd',
  'org_3CTIwCh0EUHQQT22d1AHVyWtVaW',
  'org_3CTJFozOjNzLTtqNQhiegyUUzHa',
  'org_3CTJrjSYGDnBMiPzSGk82jwWs90',
  'org_3CTKY1P6luTZR9V4ReQgCq2dRbn',
  'org_3CTKj8Nw4VAXAEzRLZQNm17DOZs',
  'org_3CTKtfTEH6KfWF5IoOzKuHoPUSY',
  'org_3CTMB3xtFrQoSbbPq7au31AfH5H',
  'org_3CTMSkFiuD5dhF9EX2vdKBv4jV9',
  'org_3CTNONsLnhEBwKp2Y1DYJ0ydanO',
  'org_3CTNkYeHmMu5EyG7hYFt4KTlN2Q',
  'org_3CeZvGvY54MT5jWfMnZafqyhCUd',
  'org_3CTIVqCh8hk2ow53B2YyCOGwXbT',
  'org_3CTKQsqUdgERdJcHLefnLyBD1f1',
  'org_3CTTOkUwrHImLgX6qBhLO084kUZ',
  'org_3Cea2kHjf4SNzDxI14ClGKatG0h'
);
--> statement-breakpoint
UPDATE "ai_usage" SET owner_id = 'user_3C9FZwiUnMJYsBJ7T05aqmFku58' WHERE owner_id IN (
  'org_3BwcJqMgt3oBAF0Bfn4R6tMoneu',
  'org_3C6U8TTFDUKvks35ghxTJi9Upax',
  'org_3BrzjuzIJlzPmYzRit79gxlinwl',
  'org_3C9K6qfUAYIfF1o6kCR2uMI18S3',
  'org_3C6UkqLyaPNU4TqnZMuZNpXR3G9',
  'org_3C9Q5IYj79ZCo14fqxgddpS3Lpx',
  'org_3BwcP3BinmFG8t4qE8TQBp4QZTC',
  'org_3CJIyokYl6pf6QCBXD8XVTorfrc',
  'org_3By6uVG29hYE6BpPfTKYKfYi2Pr',
  'org_3CGFpPLJaNrJej4WyDJlhVyvyND',
  'org_3CTGz7qSlozesHEzCMOvMIsDnIO',
  'org_3CTH0j7WwBBTEUOUHMf3P9a2nfv',
  'org_3CTHNGAqfzxSFZdtH4pIHv6qCfE',
  'org_3CTI2j21JvGbVJy9zOZ1GL2f0LI',
  'org_3CTOwdSd2N71Y5ql4ja3GkezRAU',
  'org_3CVSl9kidzSFnyyGwDHXfhdcN9s',
  'org_3C7iinx4tikt4UpLuXAmhfFNck2',
  'org_3CHf0AQREhMYdYYQyiwz2EjpgCq',
  'org_3CHtdRk4xk9dxNSirKG8MGpYq9n',
  'org_3CNnlzCqsstAujbJMBZoIaUiW1T',
  'org_3CQkplJHQywB6V8yoOLW9vp1cTO',
  'org_3CTGwPUj08hblfCfrqSLNZjoiiE',
  'org_3CTH1Q3uI6dSISMT4Ro1Xx1qrKl',
  'org_3CTH1Y38QJjSOEtLKDmLyOgey2d',
  'org_3CTHQ7zpV1FG3ZANzxsescwqhhH',
  'org_3CTHUi9P5QnO4H0VmBrJnDswP7m',
  'org_3CTHUk09kBAGMIRqsBjDYstPdB9',
  'org_3CTHXaPGWHhWznXk0P5GCenDxg8',
  'org_3CTIAJWOCC2Mo4aUOqGEkTnrsE9',
  'org_3CTIv3sRr1VXCXCyP9AOHg3vZkd',
  'org_3CTIwCh0EUHQQT22d1AHVyWtVaW',
  'org_3CTJFozOjNzLTtqNQhiegyUUzHa',
  'org_3CTJrjSYGDnBMiPzSGk82jwWs90',
  'org_3CTKY1P6luTZR9V4ReQgCq2dRbn',
  'org_3CTKj8Nw4VAXAEzRLZQNm17DOZs',
  'org_3CTKtfTEH6KfWF5IoOzKuHoPUSY',
  'org_3CTMB3xtFrQoSbbPq7au31AfH5H',
  'org_3CTMSkFiuD5dhF9EX2vdKBv4jV9',
  'org_3CTNONsLnhEBwKp2Y1DYJ0ydanO',
  'org_3CTNkYeHmMu5EyG7hYFt4KTlN2Q',
  'org_3CeZvGvY54MT5jWfMnZafqyhCUd',
  'org_3CTIVqCh8hk2ow53B2YyCOGwXbT',
  'org_3CTKQsqUdgERdJcHLefnLyBD1f1',
  'org_3CTTOkUwrHImLgX6qBhLO084kUZ',
  'org_3Cea2kHjf4SNzDxI14ClGKatG0h'
);
--> statement-breakpoint
UPDATE "vocabulary_set" SET owner_id = 'user_3C9FZwiUnMJYsBJ7T05aqmFku58' WHERE owner_id IN (
  'org_3BwcJqMgt3oBAF0Bfn4R6tMoneu',
  'org_3C6U8TTFDUKvks35ghxTJi9Upax',
  'org_3BrzjuzIJlzPmYzRit79gxlinwl',
  'org_3C9K6qfUAYIfF1o6kCR2uMI18S3',
  'org_3C6UkqLyaPNU4TqnZMuZNpXR3G9',
  'org_3C9Q5IYj79ZCo14fqxgddpS3Lpx',
  'org_3BwcP3BinmFG8t4qE8TQBp4QZTC',
  'org_3CJIyokYl6pf6QCBXD8XVTorfrc',
  'org_3By6uVG29hYE6BpPfTKYKfYi2Pr',
  'org_3CGFpPLJaNrJej4WyDJlhVyvyND',
  'org_3CTGz7qSlozesHEzCMOvMIsDnIO',
  'org_3CTH0j7WwBBTEUOUHMf3P9a2nfv',
  'org_3CTHNGAqfzxSFZdtH4pIHv6qCfE',
  'org_3CTI2j21JvGbVJy9zOZ1GL2f0LI',
  'org_3CTOwdSd2N71Y5ql4ja3GkezRAU',
  'org_3CVSl9kidzSFnyyGwDHXfhdcN9s',
  'org_3C7iinx4tikt4UpLuXAmhfFNck2',
  'org_3CHf0AQREhMYdYYQyiwz2EjpgCq',
  'org_3CHtdRk4xk9dxNSirKG8MGpYq9n',
  'org_3CNnlzCqsstAujbJMBZoIaUiW1T',
  'org_3CQkplJHQywB6V8yoOLW9vp1cTO',
  'org_3CTGwPUj08hblfCfrqSLNZjoiiE',
  'org_3CTH1Q3uI6dSISMT4Ro1Xx1qrKl',
  'org_3CTH1Y38QJjSOEtLKDmLyOgey2d',
  'org_3CTHQ7zpV1FG3ZANzxsescwqhhH',
  'org_3CTHUi9P5QnO4H0VmBrJnDswP7m',
  'org_3CTHUk09kBAGMIRqsBjDYstPdB9',
  'org_3CTHXaPGWHhWznXk0P5GCenDxg8',
  'org_3CTIAJWOCC2Mo4aUOqGEkTnrsE9',
  'org_3CTIv3sRr1VXCXCyP9AOHg3vZkd',
  'org_3CTIwCh0EUHQQT22d1AHVyWtVaW',
  'org_3CTJFozOjNzLTtqNQhiegyUUzHa',
  'org_3CTJrjSYGDnBMiPzSGk82jwWs90',
  'org_3CTKY1P6luTZR9V4ReQgCq2dRbn',
  'org_3CTKj8Nw4VAXAEzRLZQNm17DOZs',
  'org_3CTKtfTEH6KfWF5IoOzKuHoPUSY',
  'org_3CTMB3xtFrQoSbbPq7au31AfH5H',
  'org_3CTMSkFiuD5dhF9EX2vdKBv4jV9',
  'org_3CTNONsLnhEBwKp2Y1DYJ0ydanO',
  'org_3CTNkYeHmMu5EyG7hYFt4KTlN2Q',
  'org_3CeZvGvY54MT5jWfMnZafqyhCUd',
  'org_3CTIVqCh8hk2ow53B2YyCOGwXbT',
  'org_3CTKQsqUdgERdJcHLefnLyBD1f1',
  'org_3CTTOkUwrHImLgX6qBhLO084kUZ',
  'org_3Cea2kHjf4SNzDxI14ClGKatG0h'
);
--> statement-breakpoint
UPDATE "todo" SET owner_id = 'user_3C9FZwiUnMJYsBJ7T05aqmFku58' WHERE owner_id IN (
  'org_3BwcJqMgt3oBAF0Bfn4R6tMoneu',
  'org_3C6U8TTFDUKvks35ghxTJi9Upax',
  'org_3BrzjuzIJlzPmYzRit79gxlinwl',
  'org_3C9K6qfUAYIfF1o6kCR2uMI18S3',
  'org_3C6UkqLyaPNU4TqnZMuZNpXR3G9',
  'org_3C9Q5IYj79ZCo14fqxgddpS3Lpx',
  'org_3BwcP3BinmFG8t4qE8TQBp4QZTC',
  'org_3CJIyokYl6pf6QCBXD8XVTorfrc',
  'org_3By6uVG29hYE6BpPfTKYKfYi2Pr',
  'org_3CGFpPLJaNrJej4WyDJlhVyvyND',
  'org_3CTGz7qSlozesHEzCMOvMIsDnIO',
  'org_3CTH0j7WwBBTEUOUHMf3P9a2nfv',
  'org_3CTHNGAqfzxSFZdtH4pIHv6qCfE',
  'org_3CTI2j21JvGbVJy9zOZ1GL2f0LI',
  'org_3CTOwdSd2N71Y5ql4ja3GkezRAU',
  'org_3CVSl9kidzSFnyyGwDHXfhdcN9s',
  'org_3C7iinx4tikt4UpLuXAmhfFNck2',
  'org_3CHf0AQREhMYdYYQyiwz2EjpgCq',
  'org_3CHtdRk4xk9dxNSirKG8MGpYq9n',
  'org_3CNnlzCqsstAujbJMBZoIaUiW1T',
  'org_3CQkplJHQywB6V8yoOLW9vp1cTO',
  'org_3CTGwPUj08hblfCfrqSLNZjoiiE',
  'org_3CTH1Q3uI6dSISMT4Ro1Xx1qrKl',
  'org_3CTH1Y38QJjSOEtLKDmLyOgey2d',
  'org_3CTHQ7zpV1FG3ZANzxsescwqhhH',
  'org_3CTHUi9P5QnO4H0VmBrJnDswP7m',
  'org_3CTHUk09kBAGMIRqsBjDYstPdB9',
  'org_3CTHXaPGWHhWznXk0P5GCenDxg8',
  'org_3CTIAJWOCC2Mo4aUOqGEkTnrsE9',
  'org_3CTIv3sRr1VXCXCyP9AOHg3vZkd',
  'org_3CTIwCh0EUHQQT22d1AHVyWtVaW',
  'org_3CTJFozOjNzLTtqNQhiegyUUzHa',
  'org_3CTJrjSYGDnBMiPzSGk82jwWs90',
  'org_3CTKY1P6luTZR9V4ReQgCq2dRbn',
  'org_3CTKj8Nw4VAXAEzRLZQNm17DOZs',
  'org_3CTKtfTEH6KfWF5IoOzKuHoPUSY',
  'org_3CTMB3xtFrQoSbbPq7au31AfH5H',
  'org_3CTMSkFiuD5dhF9EX2vdKBv4jV9',
  'org_3CTNONsLnhEBwKp2Y1DYJ0ydanO',
  'org_3CTNkYeHmMu5EyG7hYFt4KTlN2Q',
  'org_3CeZvGvY54MT5jWfMnZafqyhCUd',
  'org_3CTIVqCh8hk2ow53B2YyCOGwXbT',
  'org_3CTKQsqUdgERdJcHLefnLyBD1f1',
  'org_3CTTOkUwrHImLgX6qBhLO084kUZ',
  'org_3Cea2kHjf4SNzDxI14ClGKatG0h'
);
--> statement-breakpoint
