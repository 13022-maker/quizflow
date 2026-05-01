# Fork API Scope Draft — Phase 1 commit 2

> **狀態**:✅ 2026-05-01 已實作完成,留檔作為設計史。
>   - `f4148a0` feat(fork): /api/quizzes/[id]/fork API + 純邏輯 + 19 測試
>   - `f4cb536` refactor(fork): copyQuizFromMarketplace 改用 fork.ts/fork-dao.ts 共用核心
>
> Q4-Q9 收工拍板:Q4 Pro only / Q5 Clerk session / Q6 `{ newQuizId, redirectUrl }` /
> Q7 error code 表(429 留空)/ Q8 rate limit 留 TODO / Q9 中文「副本」固定。
> Q3 對照表全照本文檔。Marketplace Server Action 刻意保留 Free 入口(傳 isPro=true 跳過 plan check),
> Pro only 限制只在 API route 啟用(給 mobile / 第三方用)。
>
> **原狀態**:草稿,2026-04-28 收工前暫存。明天另開 session 從這份 + 後續 brainstorming 問題繼續。
> **依賴**:Phase 1 commit 1 schema delta 已完成(visibility / slug / publishedAt / forkedFromId / forkCount / tags NOT NULL + 兩個 partial index 都在 production main)。

## 已對齊的設計決策

### Q1 — Server Action vs API route 關係:**雙軌(B)**
- 既有 `copyQuizFromMarketplace` Server Action(`src/actions/marketplaceActions.ts:107`)留著供 `/marketplace` 頁直接呼叫
- 新增 `/api/quiz/[id]/fork` API route 給未來 mobile / 第三方 / iframe widget 用
- **共用核心邏輯**`forkQuiz(sourceId, ownerId)`:Server Action + API route 都 call 它,確保 transaction 與深拷貝行為一致

### Q2 — Source visibility:**public + unlisted(B)**
- 可被 fork 的 quiz:`visibility IN ('public', 'unlisted')`
- 不允許 fork private(只 owner 看得到的不開放)
- **self-fork 不在這個 commit**:複製自己的 quiz 是另一個語意(模板),應該獨立 endpoint(例如 `/duplicate`)
- **Lineage 一律保留**:`forkedFromId` 不論 source 是 public 還 unlisted 都寫入,顯示層之後再決定 unlisted source 是否揭露來源 title

## Q3 — 拷貝範圍對照表(等明天確認 / 修正)

### quiz 表(31 欄位)

| 欄位 | 處理 | 理由 |
|---|---|---|
| `title` | ✅ 加 `（複製）` 後綴 | 同既有行為,辨識方便 |
| `description` | ✅ 直接拷 | |
| `category` / `gradeLevel` / `tags` | ✅ 直接拷 | 教學分類有意義 |
| `quizMode`(standard/vocab) | ✅ 直接拷 | 模式應一致 |
| `shuffleQuestions` / `shuffleOptions` | ✅ 直接拷 | 設定有意圖,使用者可改 |
| `allowedAttempts` / `showAnswers` / `timeLimitSeconds` / `preventLeave` | ✅ 直接拷 | 同上 |
| `scoringMode` / `attemptDecayRate` | ✅ 直接拷 | 同上 |
| `accessCode` | ❌ 新生成(`nanoid(8)`)| 唯一 |
| `roomCode` | ❌ 新生成(6 碼大寫英數)| 唯一 |
| `status` | ❌ 強制 `'draft'` | 新 quiz 不直接發佈 |
| `expiresAt` | ❌ NULL | fork 不繼承到期 |
| `visibility` | ❌ 強制 `'private'` | 新 quiz 預設不公開,使用者要再決定 |
| `slug` | ❌ NULL | slug 全域唯一,且只在 public 才需要 |
| `publishedAt` | ❌ NULL | 重新計時 |
| `forkedFromId` | 🆕 = `sourceId` | lineage |
| `forkCount` | ❌ 0 | 新 quiz 從零起算 |
| `publisherId` / `isbn` / `chapter` / `bookTitle` | ❌ NULL | **個人 fork 不該繼承書商認證**(否則南一書局徽章被一般老師繼承,品牌污染)|
| `ownerId` | 🆕 = 當前 userId | |
| `createdAt` / `updatedAt` | ❌ defaultNow() | |

### question 表(每題)

| 欄位 | 處理 |
|---|---|
| `type` / `body` / `imageUrl` / `audioUrl` / `audioTranscript` | ✅ 直接拷 |
| `options` / `correctAnswers` | ✅ 直接拷 |
| `points` / `position` | ✅ 直接拷(維持原順序與配分)|
| **`aiHint`** | ✅ 直接拷(**修現況的 bug**,既有 Server Action 漏拷)|
| `quizId` | 🆕 = 新 quiz id |
| `id` / `createdAt` / `updatedAt` | ❌ 重新生成 |

### 不在這個 commit(commit 2 scope = Fork API 本體)
- AI 弱點分析 cache:不繼承
- response / answer / quiz_attempt / quiz_final_score:全不拷(學生作答資料,fork 出來是空殼題目)
- live_game / live_player / live_answer:同上,直播競賽資料不繼承

## 既有 `copyQuizFromMarketplace` 已知漏洞(本次 commit 一併修)

1. **沒在 DB transaction 裡** — quiz insert 成功後 question insert 失敗會留 orphan quiz + 沒人發現
2. **沒拷貝 `aiHint`** — question 表欄位漏掉
3. **只能 fork `visibility='public'`** — unlisted 連結被忽略(本次擴充)
4. **沒 plan/quota 限制** — Q4 會處理
5. **無 unit test** — 本次補

## 還沒問的(明天繼續)

- **Q4 — Plan/quota gating**:Pro only?Free 帶 quota(月 N 次)?完全免費?
- **Q5 — Auth on API route**:Clerk session(同 Server Action)?另外接 Bearer token / API key?CSRF 保護?
- **Q6 — Response shape**:`{ newQuizId }` 還是 `{ redirectUrl: '/dashboard/quizzes/[id]/edit' }`?
- **Q7 — Error semantics**:HTTP 400 / 401 / 403 / 404 / 409 / 429 / 500 對應什麼狀況?
- **Q8 — Rate limiting**:per-user / per-IP / 全站?用 Vercel runtime cache 還是 DB 計數?
- **Q9 — Title 後綴 i18n**:UI 是 zh/en 雙語,「（複製）」應該依 source.title 語言 / 使用者語言來?還是固定中文?

## 明天 session 開頭給 Claude 的提示

> 看 `docs/fork-api-scope-draft.md`,Q1+Q2 已對齊(雙軌 + public/unlisted),Q3 對照表等我審。從 Q3 確認開始繼續 brainstorming,接著 Q4 plan/quota gating。

## 環境狀態(收工時)

- main HEAD: `ed91a76` feat(schema): quiz tags 補 NOT NULL + 兩個社群化 partial index (#60)
- Working tree:乾淨(只有 session 開始就有的 untracked scripts / .claude/commands)
- Neon production main: migration 0030_foamy_miek 已套用,179 row tags 全部 backfill
- Neon preview branch `preview-social-1-schema-delta`:**已刪除**
- `.env.local` line 9 `DATABASE_URL_PREVIEW`:還在(指向已刪 branch),明天若要新 dry-run 要重建 preview branch + 更新 URI;若不需要可直接刪這行
