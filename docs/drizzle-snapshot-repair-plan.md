# Drizzle Migration Snapshot 修復計畫（2026-04-22 autonomous session）

## TL;DR

**現狀比 CLAUDE.md 寫的樂觀**：`0018_snapshot.json` 已是完整（18 tables 全包含），`npm run db:generate` 以它為 base 應該不會把 vocab / marketplace 當 diff 重複產出。**建議：維持現狀、低優先**；若之後真要補洞，走本文方案 B。

## 現狀盤點

### Journal（`migrations/meta/_journal.json`）vs Snapshot 檔案

| idx | tag | snapshot 檔 | 狀態 |
|---|---|---|---|
| 0 | `0000_init-db` | `0000_snapshot.json` | ✓ |
| 1 | `0001_luxuriant_daredevil` | `0001_snapshot.json` | **✗ 缺** |
| 2 | `0002_lame_whirlwind` | `0002_snapshot.json` | ✓ |
| 3 | `0003_silent_night_nurse` | `0003_snapshot.json` | ✓ |
| 4 | `0004_past_microbe` | `0004_snapshot.json` | ✓ |
| 5 | `0005_glorious_madrox` | `0005_snapshot.json` | ✓ |
| 6 | `0006_quiet_sasquatch` | `0006_snapshot.json` | ✓ |
| 7 | `0007_rainy_sentinels` | `0007_snapshot.json` | ✓ |
| 8 | `0008_perpetual_wild_pack` | `0008_snapshot.json` | ✓ |
| 9 | `0009_wild_stingray` | `0009_snapshot.json` | ✓ |
| 10 | `0010_living_matthew_murdock` | `0010_snapshot.json` | ✓ |
| 11 | `0011_mean_lionheart` | `0011_snapshot.json` | ✓ |
| 12 | `0012_flimsy_ravenous` | `0012_snapshot.json` | ✓ |
| 13 | `0013_useful_titania` | `0013_snapshot.json` | ✓ |
| 14 | `0014_complete_morbius` | `0014_snapshot.json` | ✓ |
| 15 | `0015_marketplace_columns` | `0015_snapshot.json` | **✗ 缺** |
| 16 | `0016_vocabulary_tables` | `0016_snapshot.json` | **✗ 缺** |
| 17 | `0017_quiz_mode` | `0017_snapshot.json` | **✗ 缺** |
| 18 | `0018_live_mode` | `0018_snapshot.json` | ✓（含 18 tables 完整 schema）|

**4 個缺失：0001、0015、0016、0017。**（CLAUDE.md 原寫 0015-0017，漏算 0001）

### 為何 CLAUDE.md 的擔憂多半不會發生

CLAUDE.md 寫：
> 「導致下次 npm run db:generate 會把 vocab 表、quiz marketplace 欄位等既有內容當 diff 又塞一次到新產 migration 裡」

實測 `0018_snapshot.json` 已包含完整 18 個 tables：
```
ai_usage / answer / live_answer / live_game / live_player / organization /
paddle_customer / question / quiz / quiz_attempt / quiz_final_score /
response / subscription / todo / user_streak / user_trial /
vocabulary_card / vocabulary_set
```
也就是 vocab / marketplace / paddle / live 全部都在 latest snapshot 裡。`drizzle-kit generate` 以 latest snapshot 作 base diff，不會把已存在的表重複產出。

推測：CLAUDE.md 的描述寫於更早期（可能 0014 或更早是 latest 時），當時確實會漏。後續 PR 補 0018 snapshot 時順便把所有前面 tables 都寫進去，無意中把問題修掉了。

## drizzle-kit 對缺失中間 snapshot 的容忍度

| 操作 | 是否受影響 |
|---|---|
| `drizzle-kit generate`（產新 migration）| 不受影響（只看 latest）|
| `drizzle-kit migrate`（跑 SQL）| 完全不受影響（只看 SQL 檔 + journal）|
| `drizzle-kit push`（直推 schema，不產 migration）| 不受影響 |
| `drizzle-kit studio`（DB GUI）| 不受影響 |
| `drizzle-kit drop`（回退特定 migration）| **受影響** — 若要 drop 到 0014，它需要讀 0014 snapshot（存在）⇒ OK；若要 drop 到 0015，需讀 0015（缺）⇒ 失敗。實務上罕用這功能 |
| 未來第三方 migration 檢查工具 | 可能受影響 |

結論：**除非要做 partial rollback，否則不影響開發**。

## 修復方案

### 方案 A：不修復（推薦）

- 成本：0
- 風險：0
- 壞處：無法 partial rollback（例如回到 0014 狀態）— 實務上幾乎不用
- 之後 `npm run db:generate` 產生新 migration 時，若新 migration 造成 `0019_snapshot.json`，下一次會以 0019 為 base，穩定運作

### 方案 B：手動重建缺失的 snapshot（中等工程）

**原理**：每個 snapshot = 前一個 snapshot + 對應 SQL 的 schema 變更。

**步驟（以 0015 為例）：**

1. 取 `0014_snapshot.json` 複製為 `0015_snapshot.json` 起點
2. 讀 `migrations/0015_marketplace_columns.sql`，依 SQL 手動 apply 到 JSON：
   - 若 SQL 是 `ALTER TABLE quiz ADD COLUMN is_published boolean...`：在 `tables.public.quiz.columns` 裡新增對應欄位
   - 若 SQL 是 `CREATE TABLE...`：新增 table 物件
3. 更新 `0015_snapshot.json` 裡的 top-level `id`（每個 snapshot 都有個 uuid）與 `prevId`（指向 `0014_snapshot.json.id`）
4. 重複處理 0001、0016、0017

**工期**：每個 snapshot ~15 分鐘人工作業，4 個 = 1 小時。

**風險**：
- 手動合成的 snapshot 跟 drizzle-kit autogen 可能有微小差異（欄位順序、default expression 的字串形式、constraint 命名 hash）
- 這些差異若被放進 repo，未來 `db:generate` 可能誤判有 diff 並嘗試產生 no-op migration
- **建議**：如果真要做，每補一個 snapshot 就跑一次 `npm run db:generate`，確認 output 是「No schema changes detected」才進下一個

### 方案 C：重建整條 migration history（重工程，不建議）

- 刪掉所有 migrations/ + 所有 snapshots
- 從 Schema.ts 一鍵 `drizzle-kit generate` 產生一條 squashed initial migration
- Production / Preview / Dev DB 都已有 schema，新 migration 不能直接跑
- 需要用 `__drizzle_migrations` 表手動 insert 假的「已執行」紀錄（bless），或用 `drizzle-kit introspect` + mark
- 超高風險、跨環境操作、任何一步失敗都要重拉

## 我的推薦

**現階段走方案 A（什麼都不做）**，理由：
1. 目前日常開發不受影響
2. 修復本身有風險（方案 B 可能引入 no-op diff、方案 C 可能 break DB）
3. 修復沒有 business value（除非真要做 partial rollback）
4. 團隊若要確保 schema history 整潔，**長期解法是在 PR checklist 加上「每次 `db:generate` 產出的所有檔（.sql + snapshot）都要一起 commit」**，從源頭杜絕

若未來要走方案 B，可跟「下一個需要大改 schema」的 PR 綁一起做（反正那時候要動 migrations），一次補齊四個洞。

## CLAUDE.md 建議修正

原段落：
```
### Drizzle migration snapshot 脫鉤（已存在問題，非本次造成）
migrations/meta/ 缺 0015/0016/0017 的 snapshot，導致下次 npm run db:generate
會把 vocab 表、quiz marketplace 欄位等既有內容當 diff 又塞一次到新產 migration
裡。
```

改為：
```
### Drizzle migration snapshot 缺洞（低影響）
migrations/meta/ 缺 0001、0015、0016、0017 共 4 個中間 snapshot。
最新的 0018_snapshot.json 已包含完整 18 tables，所以 npm run db:generate
不會把既有 schema 當 diff 重複產出（之前擔心的情況未發生）。
只影響 drizzle-kit drop 的 partial rollback 能力，實務上不用。修復計畫見
docs/drizzle-snapshot-repair-plan.md 方案 B，建議等下次大改 schema 再順手補。
```
