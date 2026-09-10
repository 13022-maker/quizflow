# 合併 prpispace@gmail.com 與 13022@cyvs.tyc.edu.tw 兩個帳號的資料

## 背景
使用者本人同時用兩個 email 在 production 各自建立了獨立帳號，累積了各自的測驗、單字卡、適性練習等資料，現在想讓兩個帳號「同一個人使用」、資料共用。

**重要限制**：這個需求分兩塊，只有第一塊可由 Claude Code 在這次對話完成：
1. **資料庫合併**（本次執行）：把其中一個帳號的資料全部搬到另一個帳號名下。
2. **Clerk 登入身分合併**（使用者自行到 Clerk 後台操作）：把其中一個 email 加成另一個 Clerk 帳號的「額外 email」，讓兩個 email 都能登入同一份資料。這步驟需要 Clerk 帳號管理權限與 email 驗證信，Claude Code 沒有 Clerk API 存取權，也不代為操作帳號安全設定。

## 帳號驗證（避免踩 dual-instance 舊坑）
筆記裡舊的 email↔userId 對照已過期，這次改用使用者在 production 瀏覽器 console 現場跑
`window.Clerk.user.id` + `primaryEmailAddress` 確認，取得真實值：

| Email | 真實 Clerk userId（production, `special-osprey-55` instance） |
|---|---|
| prpispace@gmail.com | `user_3BwcGyRlECuWD5t7MSmi1bDpzeL` |
| 13022@cyvs.tyc.edu.tw | `user_3Brzh6zszlRtDdjuVU6bcnomVYi` |

## 現況資料量（Neon `summer-band-65497949` / production branch，2026-09-10 查詢）

| 資料表 | prpispace（主帳號） | 13022@cyvs（併入） |
|---|---|---|
| quiz | 104 | 57 |
| adaptive_practice | 30 | 6 |
| adaptive_subject | 24 | 5 |
| vocabulary_set | 1 | 4 |
| ai_usage | 0 | 1 |
| live_game（host_user_id） | 35 | 15 |
| todo | 0 | 0 |
| user_streak | 目前 2 天 | 目前 5 天 |
| user_trial | 已過期（2026-08-17） | 已過期（2026-08-17） |
| subscription | pro / active（手動核發） | pro / active（手動核發） |
| paddle_customer | 空表，兩邊都無資料 | — |

Production 未啟用 Paddle 正式扣款（`paddle_customer` 空表），兩帳號的 Pro 都是手動核發，**合併不影響任何真實金流**。

## 決策
- **主帳號（保留）**：prpispace@gmail.com（`user_3BwcGyRlECuWD5t7MSmi1bDpzeL`），資料量較多
- **併入帳號（資料全部搬過去，帳號本身不刪）**：13022@cyvs.tyc.edu.tw（`user_3Brzh6zszlRtDdjuVU6bcnomVYi`）
- **連續學習天數**：合併後保留 13022@cyvs 的 5 天紀錄（含 `current_streak` / `longest_streak` / `last_activity_at` / `freezes_left` / `frozen_until` 一併搬過去），蓋掉主帳號原本的 2 天

## 執行方式
一般內容表（`owner_id` / `host_user_id` 直接 UPDATE，無 unique 衝突風險）：
`quiz`、`vocabulary_set`、`adaptive_practice`、`adaptive_subject`、`ai_usage`、`todo`、`live_game`

特殊表（`clerk_user_id` 有 UNIQUE 限制，兩帳號都已有自己的 row，不能直接 UPDATE 會撞 unique constraint）：
- `user_streak`：把 13022 的四個欄位值搬進 prpispace 的既有 row，再刪掉 13022 的 row
- `user_trial`：兩邊都已過期、與目前 Pro 狀態無關，直接刪掉 13022 的 row
- `subscription`：主帳號已有 active pro row，直接刪掉 13022 的 row（不影響 `isProOrAbove` 判斷邏輯，因為之後只會用主帳號 userId 登入查詢）

**安全程序**（照專案既有 production DB 操作慣例）：
1. Neon fork 一個臨時 branch，在 fork 上先跑一次完整 migration SQL，人工核對結果
2. Fork 驗證通過後，在 production 對受影響的 8 張表個別建立 `_backup_YYYYMMDD_mergeaccount_<table>` 備份（CREATE TABLE ... AS SELECT，只挑 13022 那些 row）
3. 正式在 production 執行同一批 SQL
4. 執行後重新查一次各表的 count，確認 13022 名下已歸零、prpispace 名下等於原本兩邊加總
5. 備份表保留至少到使用者確認資料在 UI 上正常顯示為止，之後再手動清

## 使用者仍需自己做的事（Clerk 後台）
1. 決定要不要繼續留著 13022@cyvs.tyc.edu.tw 這個 Clerk 帳號（此時它底下已經沒有任何資料，登入會看到空的 dashboard）
2. 如果想讓兩個 email 都能登入同一份資料：到 Clerk 後台，把 13022@cyvs.tyc.edu.tw 從舊帳號移除，改加到 prpispace@gmail.com 帳號當「額外 email」（Account → Email addresses → Add email → 收驗證信驗證）
3. 完成後兩個 email 都能登入，看到的都是合併後同一份資料
