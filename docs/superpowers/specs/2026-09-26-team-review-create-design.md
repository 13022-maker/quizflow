# 小組協作批閱創作題（Team Review & Create）設計（2026-09-26）

## 背景

老師想要一種新的課堂活動：老師預先準備一組「範例答案」（含標準評分），
學生分組即時同步討論並對每則範例答案打分、留短評，最後小組共同延伸寫出
一份新的創作題材/答案。目的不只是批改練習本身，更是希望透過「看別人的
答案、評分討論」激發學生自己的創意延伸。

QuizFlow 目前沒有任何「組隊」「同儕互評」「多人即時共享編輯」相關基礎
（已確認 `src/models/Schema.ts` 無 team/group/peer review 相關表，
`livePlayerSchema` 也沒有 team 分組欄位）。但專案已有一套驗證過的即時
同步基礎設施——Live Mode 的 tick-only realtime adapter（Polling 預設 /
Ably flag 啟用），可以直接複用其設計模式，只是資料模型完全獨立建置。

本 spec 定案的核心決策（brainstorming 過程中已與使用者逐項確認）：

- 批閱對象：**老師預先準備的範例答案組**（非同學真實作業、非 AI 即時生成）
- 產出：**延伸創作題材**（小組討論激發靈感後寫出的新想法/新答案）
- 進行方式：**即時同步**（類 Live Mode，限時、老師開場）
- 分組：**系統/老師隨機分組**（v1 只做這個；學生自組隊留待之後擴充）
- 協作方式：**每人自己裝置，即時同步共享狀態**（非單一裝置代表操作）
- 互動元素：對範例答案打分（4 維度 rubric）+ 短評標註 + 小組即時共創文字
  （**v1 不做自由文字聊天室**，用短評代替討論，避免中小學班級的不當發言/
  審核風險）
- 計分：評分準確度（貼近老師標準分）+ 速度加成 + 其他組投票最佳創意
- 範例答案分配：**所有組看同一份範例答案組**（非 jigsaw 式分配子集）
- 架構路線：**新建獨立 schema**，只共用 `realtimeAdapter` 機制，不與
  `live_game` 共用 table（避免兩種差異很大的遊戲模式邏輯糾纏在一起）

## Scope

本 spec 處理：
- 新 DB schema（`review_set` / `review_sample` / `review_game` /
  `review_team` / `review_player` / `review_score` / `review_submission` /
  `review_vote`）
- 複用 Live Mode 的 tick-only realtime 機制，建一份獨立的
  `src/services/review/` 對應實作
- 完整活動狀態機（lobby → team_forming → reviewing → creating → voting →
  results → ended）
- 三段式計分規則（評分準確度 / 速度加成 / 投票加成）
- 老師端建立範例答案組、開場主控、成果報表
- 學生端加入、分組、評分、共創、投票

不處理（詳見「不在本 spec 範圍」）：
- 學生自組隊（v1 只做系統隨機分組）
- 自由文字聊天室
- AI 輔助生成範例答案組
- jigsaw 式範例答案分配
- 小組創作答案匯入正式題庫
- Playwright E2E 自動化

## 資料模型

比照 `liveGameSchema` / `livePlayerSchema` / `liveAnswerSchema`
（`src/models/Schema.ts` 約 L411-494）的欄位風格：enum 狀態欄、FK cascade、
`lastSeenAt` heartbeat、unique index。

```ts
export const reviewGameStatusEnum = pgEnum('review_game_status', [
  'lobby', 'team_forming', 'reviewing', 'creating', 'voting', 'results', 'ended',
]);

// 可重複使用的「題組」模板，類似 quiz，一次建立可開多場次
export const reviewSetSchema = pgTable('review_set', {
  id: serial('id').primaryKey(),
  ownerId: text('owner_id').notNull(), // orgId，多租戶隔離
  title: text('title').notNull(),
  topicPrompt: text('topic_prompt').notNull(), // 給小組的延伸創作指示
  teamSize: integer('team_size').default(4).notNull(),
  reviewDurationSec: integer('review_duration_sec').default(600).notNull(),
  createDurationSec: integer('create_duration_sec').default(300).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// review_set 底下的範例答案 + 老師標準分（4 維度沿用現有 AI rubric 命名）
export const reviewSampleSchema = pgTable('review_sample', {
  id: serial('id').primaryKey(),
  reviewSetId: integer('review_set_id').notNull()
    .references(() => reviewSetSchema.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  orderIndex: integer('order_index').notNull(),
  refCorrectness: integer('ref_correctness').notNull(), // 0-5
  refCompleteness: integer('ref_completeness').notNull(),
  refClarity: integer('ref_clarity').notNull(),
  refCreativity: integer('ref_creativity').notNull(),
});

// 一場直播場次（review_set 的即時執行實例）
export const reviewGameSchema = pgTable('review_game', {
  id: serial('id').primaryKey(),
  reviewSetId: integer('review_set_id').notNull()
    .references(() => reviewSetSchema.id, { onDelete: 'cascade' }),
  hostUserId: text('host_user_id').notNull(), // Clerk userId
  gamePin: text('game_pin').notNull().unique(),
  status: reviewGameStatusEnum('status').default('lobby').notNull(),
  phaseStartedAt: timestamp('phase_started_at'),
  phaseDurationSec: integer('phase_duration_sec'), // 從 review_set 複製，老師可臨場延長
  createdAt: timestamp('created_at').defaultNow().notNull(),
  endedAt: timestamp('ended_at'),
});

export const reviewTeamSchema = pgTable('review_team', {
  id: serial('id').primaryKey(),
  gameId: integer('game_id').notNull()
    .references(() => reviewGameSchema.id, { onDelete: 'cascade' }),
  teamName: text('team_name').notNull(), // 「第 1 組」
  score: integer('score').default(0).notNull(),
});

export const reviewPlayerSchema = pgTable('review_player', {
  id: serial('id').primaryKey(),
  gameId: integer('game_id').notNull()
    .references(() => reviewGameSchema.id, { onDelete: 'cascade' }),
  teamId: integer('team_id') // team_forming 前為 null
    .references(() => reviewTeamSchema.id, { onDelete: 'set null' }),
  nickname: text('nickname').notNull(),
  playerToken: text('player_token').notNull(),
  lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(), // 沿用 Sub-A heartbeat
  joinedAt: timestamp('joined_at').defaultNow().notNull(),
}, table => ({
  nicknameIdx: uniqueIndex('review_player_game_nickname_idx').on(table.gameId, table.nickname),
  tokenIdx: uniqueIndex('review_player_token_idx').on(table.playerToken),
}));

// 每位學生對每則範例答案的評分 + 可選短評（短評併進此表，不另開標註表）
export const reviewScoreSchema = pgTable('review_score', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id').notNull()
    .references(() => reviewTeamSchema.id, { onDelete: 'cascade' }),
  playerId: integer('player_id').notNull()
    .references(() => reviewPlayerSchema.id, { onDelete: 'cascade' }),
  sampleId: integer('sample_id').notNull()
    .references(() => reviewSampleSchema.id, { onDelete: 'cascade' }),
  correctness: integer('correctness').notNull(),
  completeness: integer('completeness').notNull(),
  clarity: integer('clarity').notNull(),
  creativity: integer('creativity').notNull(),
  comment: text('comment'), // 短評，選填，Zod schema 限 200 字（比照專案「Server Action 必須 Zod 驗證」規則）
  submittedAt: timestamp('submitted_at').defaultNow().notNull(),
}, table => ({
  playerSampleIdx: uniqueIndex('review_score_player_sample_idx').on(table.playerId, table.sampleId),
}));

// 每組最終共同撰寫的延伸創作答案（1 組 1 筆，last-write-wins）
export const reviewSubmissionSchema = pgTable('review_submission', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id').notNull().unique()
    .references(() => reviewTeamSchema.id, { onDelete: 'cascade' }),
  content: text('content').default('').notNull(),
  lastEditedByPlayerId: integer('last_edited_by_player_id')
    .references(() => reviewPlayerSchema.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 創作回合結束後，組間互投最佳創意答案（禁投自己組，app 層驗證）
export const reviewVoteSchema = pgTable('review_vote', {
  id: serial('id').primaryKey(),
  gameId: integer('game_id').notNull()
    .references(() => reviewGameSchema.id, { onDelete: 'cascade' }),
  voterTeamId: integer('voter_team_id').notNull()
    .references(() => reviewTeamSchema.id, { onDelete: 'cascade' }),
  votedForTeamId: integer('voted_for_team_id').notNull()
    .references(() => reviewTeamSchema.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, table => ({
  oneVotePerTeamIdx: uniqueIndex('review_vote_game_voter_idx').on(table.gameId, table.voterTeamId),
}));
```

## 即時同步機制

直接複製 `src/services/live/realtimeAdapter.ts`（`LiveRealtimeAdapter`
interface，`PollingRealtimeAdapter` 1.5s/2s 輪詢、`NEXT_PUBLIC_LIVE_REALTIME`
選擇實作）的結構，建一份平行檔案：

- `src/services/review/realtimeAdapter.ts`：interface 改成
  `subscribeHostState` + `subscribeTeamState`（比 Live Mode 多一層「組」的
  概念——同組所有成員看同一份 team-state，不是個人 player-state）
- `src/services/review/ablyServer.ts`：`publishTick(gameId)`，channel 命名
  `review:{gameId}`，維持 Live Mode 那份設計的兩個關鍵特性：
  1. **tick-only，不帶 state payload**（client 收到 tick 只觸發 REST
     refetch，state 永遠以 REST 為權威來源，沿用 `ablyServer.ts` L30-40
     的模式）
  2. `ABLY_API_KEY` 未設時 `publishTick` no-op，不 throw（`ablyServer.ts`
     L24-26 `isAblyEnabled()` 同款 fallback）
- `src/services/review/ablyAdapter.ts`：token capability 一樣限制
  `subscribe`-only（比照 `ablyServer.ts` L44-56），client 永遠不能偽造
  publish
- `/api/review/ably-auth/route.ts`：同一支 route 依 `role` query 分流
  host/player，比照 `src/app/api/live/ably-auth/route.ts` L44-86

**Middleware 分類**（`src/middleware.ts` L18-64 同款規則，這是本專案已
踩過兩次的坑，必須精確比照）：

- `isPublicApiRoute`（純 token 驗證，不呼叫 Clerk `auth()`）：
  `/api/review/join`、`/api/review/(.*)/team-state`、
  `/api/review/(.*)/score`、`/api/review/(.*)/submission`、
  `/api/review/(.*)/vote`、`/api/review/(.*)/heartbeat`
- `isOptionalAuthRoute`（route 內部會呼叫 `auth()`，但不能被
  `auth.protect()` 強制導去登入頁，因為同一 route 也服務未登入的學生
  player）：`/api/review/ably-auth`
- **不需要特別處理、直接沿用預設保護**：`/api/review/(.*)/host-state`、
  `/api/review/(.*)/phase` 這類純老師操作的路由——`/api/(.*)` 本來就是
  `isProtectedRoute`，不放進上面兩個名單就會自動要求登入，這正是我們要
  的行為（只有老師能呼叫）

## 活動狀態機

`review_game.status` 依序：

```
lobby → team_forming → reviewing → creating → voting → results → ended
```

- **lobby**：老師開場秀房間碼，學生 `/api/review/join`（public route）
  加入，比照 `/api/live/join` 建立 `review_player`（`teamId` 先為 null）
- **team_forming**：老師按「開始分組」，後端依 `review_set.teamSize`
  把已加入的 `review_player` round-robin 平均分進 `review_team`。**v1
  只允許 lobby 階段加入**，team_forming 之後才嘗試加入的學生顯示「活動
  已開始，請等待老師開新場次」，不中途插入分組（避免破壞人數平均）
- **reviewing**（計時回合）：範例答案一次全部展示（非 Live Mode 那種一題
  一題推進的快節奏，這是討論型任務）。每位組員各自對每則範例答案打 4
  維度分數 + 可選短評，`POST /api/review/[gameId]/score`（upsert on
  `unique(playerId, sampleId)`），同組成員即時看到彼此進度
- **creating**（計時回合）：同組共同編輯一份延伸創作答案
  （`review_submission`）。任何組員可編輯，前端 debounce 後
  `POST /api/review/[gameId]/submission` upsert，存檔後 publish tick 讓
  組員刷新看到最新版本。**已知限制**：非逐字元即時協作，是後存覆蓋先存
  （last-write-wins），UI 需提示「其他組員可能正在編輯」
- **voting**：所有組看到「其他組」的最終創作答案（不顯示組名避免人情
  票），`POST /api/review/[gameId]/vote` 投一票給最佳創意（app 層擋
  `voterTeamId === votedForTeamId`，DB unique index 擋重複投票）
- **results**：`src/services/review/scoring.ts` 計算三段式分數並寫入
  `review_team.score`，老師端跳出排行榜，學生端看到自己組的名次拆解

每個階段轉換都由老師端 `POST /api/review/[gameId]/phase`（Clerk auth 驗
`hostUserId`）觸發，比照 `liveActions.ts` 每個 phase-transition action 都
在 DB mutation 後呼叫 `publishTick(gameId)`。老師可在階段結束前手動提前
結束或延長。**只有 reviewing / creating 是計時回合**（`phaseDurationSec`
取自 `review_set.reviewDurationSec` / `createDurationSec`）；lobby、
team_forming、voting、results 沒有固定時限，完全由老師手動按「下一步」
推進，避免投票階段因為秒數壓力讓學生倉促亂投。

## 計分規則

新檔 `src/services/review/scoring.ts`，三段獨立可測試的純函式，總分 =
三者加總，比照 `src/services/live/scoring.ts` 的 19-test TDD 模式（先寫
失敗測試、期望值 hand-derived，不用被測程式碼自己算）：

```ts
// 評分準確度：team 平均分與老師標準分的差距，每差 1 分扣 20（滿分
// 100，差 5 分以上歸零），4 維度平均後依該則答案配分換算
export function calcAccuracyScore(
  teamAvg: { correctness: number; completeness: number; clarity: number; creativity: number },
  ref: { correctness: number; completeness: number; clarity: number; creativity: number },
  pointsForSample: number,
): number { /* ... */ }

// 速度加成：team 所有成員都完成該回合評分才算「該組完成」，用完成時
// 剩餘時間比例計算，500 基底 + 最多再加 500（比照 Live Mode 既有量級）
export function calcSpeedBonus(elapsedSec: number, totalDurationSec: number): number { /* ... */ }

// 投票加成：每收到一票 +100 分，不含自己組
export function calcVoteBonus(votesReceived: number): number { /* ... */ }

export function calcTeamTotalScore(params: {
  accuracyScores: number[]; // 每則範例答案各一筆
  speedBonus: number;
  voteBonus: number;
}): number { /* 加總 */ }
```

> 差距扣分係數（×20）、速度加成量級（500+500）、投票加成（每票
> 100 分）都是初版提案，上線後很可能要依實際課堂體感調整。刻意把這些
> 數字集中寫成具名常數放在 `scoring.ts` 頂部，方便之後快速調整不用改
> 呼叫端邏輯。

**Team 平均分計算的邊界**：若某位組員在 reviewing 階段結束前未送出分數
（老師提前結束），team 平均只採計有送出的人，避免缺考成員拖累整組。

## 老師端：建立內容 + 主控 + 成果報表

**建立範例答案組**（新內容類型，跟 Quiz、VocabSet 平行）：
- Dashboard 新增「建立協作批閱題組」入口，`/dashboard/review` 列表頁
  （比照 quiz 列表）、`/dashboard/review/[reviewSetId]/edit` 編輯頁
- 表單：主題說明（`topicPrompt`）、範例答案清單（每則：內文 + 4 維度
  標準分）、小組人數、審閱/創作回合秒數
- v1 範例答案**手動輸入**，不做 AI 自動生成變體（避免範圍再擴大）

**開場直播**：比照 Live Mode「開始直播」→ 建立 `review_game` → 老師進
`/dashboard/review/host/[gameId]` 主控台，學生進 `/review/join` +
`/review/play/[gameId]`

**成果報表**（`ended` 後）：
- 排行榜：組別、總分、三段分數拆解（準確度／速度／投票）
- 每組明細：對每則範例答案的分數 vs 老師標準分（差距一目了然，幫老師
  看出「學生評分盲點在哪」）、短評內容、最終創作答案全文、收到幾票
- CSV 匯出（沿用現有測驗成績頁的匯出模式）

## Client 元件結構

比照 `src/features/live/`，新增 `src/features/review/`：
`ReviewSetEditor.tsx`（範例答案 + 標準分編輯）、`ReviewHostLobby.tsx`、
`ReviewHostControl.tsx`（階段推進 + 成果報表）、`ReviewPlayerJoin.tsx`、
`ReviewPlayerTeamForming.tsx`、`ReviewPlayerReview.tsx`（評分 + 短評）、
`ReviewPlayerCreate.tsx`（共創編輯）、`ReviewPlayerVote.tsx`。

斷線偵測沿用 Live Mode Sub-A 的純 heartbeat 架構
（`docs/superpowers/specs/2026-04-30-live-mode-disconnect-detection-design.md`）：
`lastSeenAt` 逾時視為離線，UI 顯示離線標記。**與 Live Mode 的差異**：這裡
沒有防作弊需求（不是正式測驗，是排行榜遊戲化活動），所以不需要
`leaveCount` 這類機制。

## 邊界情況

- 遲到加入（team_forming 之後）→ 顯示「活動已開始」，不允許中途插入分組
- 組內人數不均（例如 10 人 teamSize=4 → 3+3+4）→ round-robin 自然處理
- 極端情況只有 1 組（人數太少無法分出對手組）→ voting 階段允許但顯示
  「目前沒有其他組可以投票」，不擋整體流程進到 results
- 學生評分後老師提前結束 reviewing → 已送出的分數保留，未送出視為缺考
  （見「計分規則」邊界說明）
- `review_submission` 為空字串就進 voting → results 顯示「本組未提交」，
  不出現在其他組的投票候選名單
- 斷線重連 → 沿用純 heartbeat，不影響分數

## 風險與回滾

- 全新 schema，完全獨立於 `live_game` 系列表，回滾直接 `DROP TABLE`，
  不影響既有 Live Mode / 測驗功能
- Migration 產生後務必手動檢查 SQL、砍掉不相關 diff（已知
  `migrations/meta/` snapshot 缺失問題，CLAUDE.md「Drizzle migration
  snapshot 脫鉤」段落）
- 計分公式數字是初版提案，抽成具名常數方便日後依課堂回饋快速調整
- 共創答案 last-write-wins 在多人同時編輯時有極低機率「最新修改被舊
  存檔蓋過」，已知限制，v1 不做 OT/CRDT（過度工程，小組通常僅 2-4 人
  同時編輯，碰撞機率低且後果輕微）
- Ably 免費額度：沿用現有 tick-only 設計，訊息量低，跟 Live Mode 共用
  同一份「用戶破 100 再評估付費方案」判斷（記憶
  `ably_upgrade_pending.md`）

## 不在本 spec 範圍

- 學生自組隊（自建/加入小組房）——已與使用者確認先做系統隨機分組，
  之後再加這個選項，屆時另開 spec 或在本功能上加小的擴充
- 自由文字聊天室
- AI 輔助生成範例答案組
- jigsaw 式範例答案分配（不同組看不同子集）
- 小組創作答案匯入正式題庫
- Playwright E2E 自動化（先手動驗證，屬於現有 backlog「Playwright E2E
  測試覆蓋核心流程」的一部分）

## 測試方式

**單元測試**（`src/services/review/scoring.test.ts`，hand-derived 期望
值）：
- `calcAccuracyScore`：精準命中標準分（滿分）、小落差（部分扣分）、
  大落差歸零（差 5 分以上）三種情境 × 4 維度
- `calcSpeedBonus`：完成得早（接近滿額）、完成得晚（接近 0）、超時未完成
  （不計）三種情境
- `calcVoteBonus`：0 票、多票線性累加
- team 平均分計算：某成員缺考時正確排除，不拖累平均

**手動驗證流程**（Live Mode 既有測試覆蓋率低，本 spec 不擴大自動化
範圍）：
1. 老師建立 `review_set`（範例答案 + 標準分）
2. 開場，多分頁模擬多位學生用房間碼加入
3. 老師「開始分組」→ 確認 round-robin 分組人數平均、各分頁看到正確組員
4. reviewing 階段：不同分頁對同一則範例答案打分 → 確認同組其他分頁即時
   看到分數/短評更新
5. creating 階段：兩個分頁同時編輯共創答案 → 確認 debounce 儲存 + 提示
   文字正常運作
6. voting 階段：確認看不到自己組、投票後無法重複投票
7. results：核對排行榜三段分數拆解與 CSV 匯出內容正確
8. 中途讓某分頁斷線（關閉分頁）→ 確認離線標記出現、不影響其他人繼續
