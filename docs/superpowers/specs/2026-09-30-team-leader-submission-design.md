# 小組協作批閱創作題：獨立草稿 + 隊長投票送出（2026-09-30）

## 背景

「小組協作批閱創作題」（Team Review & Create，2026-09-26 上線，
`docs/superpowers/specs/2026-09-26-team-review-create-design.md`）的
creating 階段目前是「1 組 1 筆 `review_submission`、全文覆蓋、
last-write-wins」：任何組員打字都會蓋掉其他組員剛存的版本，前端也明確
提示這個限制（`ReviewPlayerCreate.tsx:43`）。老師端進一步反映：與其讓
內容互相覆蓋、事後只能看到「最後一次存檔」，不如讓每個組員都能保留
自己的想法，再由小組推選一位隊長挑選/整合出最終答案送出。

本 spec 定案的核心決策（brainstorming 過程中已與使用者逐項確認）：

- 儲存範圍：**保留每人獨立草稿**，不再是單一共用文字框
- 隊長產生方式：**組員互投**，creating 階段一開始就能投票，**即時多數決**
  （不設「投票視窗關閉」的兩段式關卡，避免多一層狀態機和卡關風險）
- 隊長職責：挑一份組員草稿當基底，可再微調後**明確按下送出**
- 逾時處理：老師把階段從 creating 推進到 voting 時，若隊長還沒按送出，
  系統自動用隊長「目前選定/正在編輯」的內容送出
- 送出時機**不影響計分**：已確認 `speedBonus`（`reviewActions.ts:309-317`）
  只依 reviewing 階段的評分完成時間計算，creating 階段目前沒有對應的
  計分掛鉤，本次也不新增——隊長提早送出純粹是狀態上的完成，不加分

## Scope

本 spec 處理：
- 新增 `review_draft`（組員獨立草稿）、`review_leader_vote`（隊長投票）
  兩張表
- `review_team` 加 `leader_id`、`review_submission` 加 `submitted_at` /
  `auto_submitted`
- creating 階段的隊長即時多數決計票邏輯
- `ReviewPlayerCreate.tsx` 拆成「我的草稿」「隊員草稿一覽（唯讀）」
  「隊長專屬整合送出面板」三塊
- `startVoting()`（`reviewActions.ts:235`）加入逾時自動送出 fallback
- 老師端「貢獻度」顯示資料來源從 `review_submission_edit` 改成
  `review_draft`（原因見下方「老師端影響」）

不處理（詳見「不在本 spec 範圍」）：
- creating 階段的速度加成計分
- 隊長異動歷史記錄（只存目前 leader_id，不記錄「曾經是誰」）
- 組員對草稿本身的按讚/評論

## 資料模型

比照既有 `review_*` 系列表的欄位風格（`src/models/Schema.ts:496-672`）。

```ts
// 每位組員自己的獨立草稿（取代原本「1 組 1 筆」的共用文字框）
export const reviewDraftSchema = pgTable('review_draft', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id').notNull()
    .references(() => reviewTeamSchema.id, { onDelete: 'cascade' }),
  playerId: integer('player_id').notNull()
    .references(() => reviewPlayerSchema.id, { onDelete: 'cascade' }),
  content: text('content').default('').notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
}, table => ({
  teamPlayerIdx: uniqueIndex('review_draft_team_player_idx').on(table.teamId, table.playerId),
}));

// 組內互投隊長，可改投（upsert on team+voter）
export const reviewLeaderVoteSchema = pgTable('review_leader_vote', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id').notNull()
    .references(() => reviewTeamSchema.id, { onDelete: 'cascade' }),
  voterPlayerId: integer('voter_player_id').notNull()
    .references(() => reviewPlayerSchema.id, { onDelete: 'cascade' }),
  votedForPlayerId: integer('voted_for_player_id').notNull()
    .references(() => reviewPlayerSchema.id, { onDelete: 'cascade' }),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
}, table => ({
  teamVoterIdx: uniqueIndex('review_leader_vote_team_voter_idx').on(table.teamId, table.voterPlayerId),
}));
```

`reviewTeamSchema`（Schema.ts:558）加一欄：
```ts
leaderId: integer('leader_id')
  .references(() => reviewPlayerSchema.id, { onDelete: 'set null' }),
```

`reviewSubmissionSchema`（Schema.ts:625）加兩欄，語意從「共用草稿」
轉為「這組的最終答案」：
```ts
submittedAt: timestamp('submitted_at', { mode: 'date' }), // null = 隊長尚未明確送出
autoSubmitted: boolean('auto_submitted').default(false).notNull(), // true = 逾時系統代送
```

`reviewSubmissionEditSchema`（Schema.ts:639）維持不變，繼續記錄「誰存過
最終答案」的事件日誌——只是往後這張表只會出現「當下擔任隊長」的
playerId（若隊長中途換人，會換成新隊長的 id，但同一時間點只會有一位
寫入者），不會再出現非隊長組員（見下方老師端影響）。

## 隊長即時多數決

- creating 階段一開始，畫面同時顯示「投給隊長」小工具跟自己的草稿欄，
  **兩者不互相阻擋**：不用等投票結束才能開始寫草稿。
- 後端 `upsertLeaderVote()`（新函式，仿 `upsertSubmission` 寫法）
  upsert `review_leader_vote`（unique `teamId+voterPlayerId`，可改投），
  寫完立刻重新計算該組目前票數最高者，寫回 `review_team.leader_id`
  （平票時取「最早加入該組」者，用 `review_player.joined_at` 排序）。
- **預設隊長**：team_forming 分組完成當下，`leader_id` 就先填入
  「該組最早加入的成員」（同一套平票規則的邊界值），確保任何時候都有
  人能整合送出，不會出現「無人有寫入權限」的卡關狀態。
- 為什麼不做「投票視窗關閉才鎖定」的兩段式流程：那需要額外一個狀態
  （例如 `voting_leader` sub-status）跟一個「誰來判定投票結束」的觸發
  點，多一層狀態機、多一種卡住的可能（例如永遠沒投滿）。即時多數決
  功能等價（组员随时都知道目前谁是隊長），複雜度小很多。

## 草稿撰寫與整合送出

`ReviewPlayerCreate.tsx` 拆成三塊：

1. **我的草稿**：自己的文字框，寫入 `review_draft`（沿用現有 1.5 秒
   debounce autosave 機制，`AUTOSAVE_DEBOUNCE_MS`），各自獨立不互相
   覆蓋。
2. **隊員草稿一覽**（唯讀）：列出所有組員（含自己）目前的草稿內容，
   標示目前當選隊長是誰。
3. **隊長專屬整合面板**（只有 `me.id === team.leaderId` 才看得到）：
   - 每份草稿旁一個「採用這份當基底」按鈕，點下去把該內容複製進
     「最終答案」文字框（client 端複製，不是新的持久化欄位）
   - 最終答案文字框比照現有 autosave 機制寫入 `review_submission`
     （`upsertSubmission` 加一道權限檢查：`playerId !== team.leaderId`
     時回 403 `NOT_TEAM_LEADER`）
   - 「確認送出」按鈕：呼叫新 API，寫入 `submitted_at = now()`；送出後
     鎖定（後續 `upsertSubmission` 對已 `submitted_at` 非 null 的
     team 一律回 409 `ALREADY_SUBMITTED`，隊長不能再改）

非隊長成員在整合面板位置只看到狀態文字：「隊長 {nickname} 正在整理
最終答案」或送出後「已送出，等待老師進入下一階段」。

## 逾時自動送出（`startVoting()` fallback）

`reviewActions.ts:235` 的 `startVoting()` 在把 `game.status` 改成
`voting` 之前，對每一組檢查 `review_submission.submitted_at`：

- 非 null（隊長已明確送出）→ 不動它
- null（隊長沒按送出）→ 用「當下 `review_submission.content`」直接補
  `submitted_at = now()`、`auto_submitted = true`
- 若該組 `review_submission` 整筆都不存在（隊長連基底都没選）→ 退而
  用隊長自己的草稿內容（`review_draft` 裡 `playerId = leader_id` 那
  筆）補上；隊長自己也沒寫的話，落成空字串送出（跟現行「本組未提交」
  的顯示邏輯一致，見 2026-09-26 spec「邊界情況」段）

## 老師端影響

- **`ReviewHostResults.tsx` 的「貢獻度」顯示需要換資料來源**：目前
  `getHostState`（`reviewStore.ts:129/159`）與 `getResultsDetail`
  （`reviewStore.ts:190/234`）都是拿 `review_submission_edit` 事件日誌
  餵給 `summarizeContributors()`，顯示「暱稱(N次)」。這個功能改成
  「只有隊長能寫 `review_submission`」後，`review_submission_edit`
  往後只會累積 leaderId 一個人的紀錄，非隊長全部變成 0 次，**這個既有
  功能會被本次改動默默弄壞**，必須同步修正：改成統計每個組員在
  `review_draft` 是否有內容（或依 `content.length`），才能反映「誰真的
  有動手寫草稿」。
- 新增顯示：目前隊長是誰、`auto_submitted` 是否為 true（讓老師知道
  「這組是被動送出，不是隊長自己按的」）。
- `startVoting()` / `finishGame()` 其餘計分邏輯不用改，讀取來源還是
  `review_submission.content`，只是內容的產生方式變了，對老師端主控
  流程本身無感。

## 邊界情況

- 隊長中途離線（斷線）→ 沿用既有 heartbeat 機制顯示離線標記，不影響
  投票/送出邏輯；其他組員仍可改投別人當隊長頂替
- 只有 1 位組員的組（人數不足）→ 該成員自動且永遠是隊長，投票工具
  仍顯示但只能投自己，行為自然一致不用特判
  （即時多數決通用計票邏輯天然涵蓋這個情況）
- 隊長已送出後又被改投下臺（別人票數反超）→ `review_submission` 的
  鎖定狀態不受影響（已送出的內容不會因為 leader_id 換人而復活成可編
  輯），新隊長只能等下一場次或老師退回階段才能再動；v1 不做「老師手動
  解鎖已送出答案」的功能

## 風險與回滾

- 全新增兩張表 + 兩個既有表各加欄位，皆可個別 `DROP
  TABLE`/`ALTER TABLE ... DROP COLUMN` 回滾，不影響其餘 review_* 系列
  表結構
- Migration 產生後務必手動檢查 SQL、砍掉不相關 diff（CLAUDE.md
  「Drizzle migration snapshot 脫鉤」段落已知問題）
- 「貢獻度」資料來源改動屬於既有功能的必要修正，需要在同一個 PR 內
  一併處理，不能只做本次新功能而放著舊顯示壞掉

## 不在本 spec 範圍

- creating 階段的速度加成計分（目前沒有、本次也不新增）
- 隊長異動歷史記錄（只存目前是誰，不記錄「誰曾經當過隊長」）
- 老師手動指定/罷免隊長（v1 只做組員互投，教師端不介入）
- 組員對草稿的按讚/評論/子投票（只有「投給隊長」這一種投票）
- 老師手動解鎖已送出的最終答案

## 測試方式

**單元測試**（`src/services/review/leaderVote.test.ts`，比照現有
`scoring.test.ts` 的 hand-derived 期望值模式）：
- 計票函式：單一領先者、平票取最早加入者、只有一人投票、尚無人投票
  （回傳預設最早加入者）四種情境
- fallback 補送出邏輯：`submitted_at` 已存在時不覆蓋、為 null 時用
  `review_submission.content`、`review_submission` 不存在時退用隊長
  草稿、隊長也沒草稿時落成空字串，四種情境

**手動驗證流程**：
1. 老師開場、多分頁模擬組員加入分組
2. creating 階段：分頁 A 投給分頁 B → 確認所有分頁即時看到「目前隊長：
   B」；分頁 A 改投自己 → 領先者變化即時反映
3. 分頁 A、B、C 各自在「我的草稿」打不同內容 → 確認三份互不覆蓋、
   隊長（B）的「隊員草稿一覽」看得到三份
4. 隊長 B 選 A 的草稿當基底、微調後按送出 → 確認 A、C 分頁狀態變
   「已送出」，B 自己不能再編輯（送出後鎖定）
5. 另開一組，隊長故意不按送出，老師直接按「進入投票階段」→ 確認該組
   `auto_submitted = true`，內容為隊長當下文字框的值
6. 老師端結果頁確認「貢獻度」正確反映每位組員的草稿字數/是否有寫，
   而非只顯示隊長一人
