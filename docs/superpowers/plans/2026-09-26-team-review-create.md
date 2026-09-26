# 小組協作批閱創作題（Team Review & Create）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 老師預備一組範例答案（含標準評分），學生系統隨機分組、即時同步對每則範例答案打分/留短評，最後共同延伸寫出一份新創作題材；計分排行榜比照 Live Mode。

**Architecture:** 全新獨立 `review_*` schema（不與 `live_game` 共用表），只複用 `src/services/live/realtimeAdapter.ts` 的 tick-only 即時同步設計模式（Polling 預設 / Ably flag 啟用）。老師端狀態轉換走 Server Actions（Clerk 驗證），學生端讀寫走 public REST（playerToken 驗證），架構完全比照 Live Mode 的 `liveStore.ts` / `liveActions.ts` / `/api/live/*` 三層分工。

**Tech Stack:** Next.js 14 App Router、TypeScript strict、Drizzle ORM + PostgreSQL、Clerk、Zod、Vitest、Tailwind + Shadcn UI、既有 Ably/Polling realtime adapter 模式。

**Spec:** `docs/superpowers/specs/2026-09-26-team-review-create-design.md`

## Global Constraints

- 所有 API Route 檔案最頂端加 `export const runtime = 'nodejs'`
- 所有 API 回應一律用 `NextResponse.json()`
- Server Action 必須先驗證 Clerk `auth()` 與資源擁有權，再用 Zod 驗證輸入
- UI 文字、錯誤訊息、程式碼註解一律繁體中文；變數/函式/路由/檔案名稱一律英文（camelCase/kebab-case）
- `src/models/Schema.ts` 變更後必須執行 `npm run db:generate`，並手動檢查產生的 SQL、刪除不屬於本次改動的 CREATE/ALTER（已知 `migrations/meta/` snapshot 缺失問題）
- Middleware 白名單分類必須精確比照 `src/middleware.ts:18-64`：純 token 驗證的學生端點放 `isPublicApiRoute`；route 內會呼叫 `auth()` 但不能強制登入的端點放 `isOptionalAuthRoute`；純老師端點（Clerk 保護）兩個名單都不用加，靠 `isProtectedRoute` 預設保護
- 純邏輯函式（`scoring.ts`、`teamAssignment.ts`）一律先寫失敗測試、期望值 hand-derived，再寫最小實作（TDD）
- 每個 phase-transition 的 mutation（Server Action / API Route）都要在 DB 寫入成功後呼叫 `publishTick(gameId)`
- 'use server' 檔案內寫入 timestamp 欄位一律用 JS `new Date(...)` 物件，不要用含 `${param}` 的 Drizzle `sql` 模板（Next.js Server Action 編譯器會把它吃掉變 null，`liveActions.ts:22-24` 已有記錄）
- Commit 訊息中文動詞開頭，不要用英文專有名詞當第一個詞（commitlint 限制）

## 資料流總覽（給執行者的心智模型）

- **老師**：Clerk 登入 → Server Actions（`reviewSetActions.ts` 建內容、`reviewActions.ts` 控場次）→ REST `GET /api/review/[gameId]/host-state`（tick 觸發輪詢，Clerk 保護）
- **學生**：無登入 → REST `POST /api/review/join` 拿 `playerToken`（存 localStorage）→ REST `GET /api/review/[gameId]/team-state`（tick 觸發輪詢，token 驗證）→ REST `POST .../score` / `.../submission` / `.../vote` / `.../heartbeat`
- **即時同步**：兩端都只是「tick 到了就重打 REST」，REST 回應永遠是權威 state，channel 訊息本身不帶 payload（比照 `ablyServer.ts` 設計）
- **時限**：`reviewing` / `creating` 兩個計時回合的秒數只用來給前端顯示倒數，**不會**觸發伺服器自動切換階段——所有階段轉換都是老師手動觸發的 Server Action（這是刻意的簡化：避免複製 Live Mode 那套 `nextTransitionAt` 自動推進 + self-heal 機制，這裡的活動本質上是討論型任務，過早自動切階段對教學体驗反而不利）

## File Map

新增檔案：
- `src/services/review/teamAssignment.ts` + `.test.ts` — 小組分配純函式
- `src/services/review/scoring.ts` + `.test.ts` — 計分純函式
- `src/services/review/types.ts` — 共用型別
- `src/services/review/realtimeAdapter.ts` / `ablyServer.ts` / `ablyAdapter.ts` — 即時同步
- `src/services/review/reviewStore.ts` — DB 存取層
- `src/services/review/reviewPlayerSession.ts` — 學生 localStorage 身分
- `src/actions/reviewSetActions.ts` — 老師建立/編輯題組
- `src/actions/reviewActions.ts` — 老師場次流程控制
- `src/app/api/review/join/route.ts`
- `src/app/api/review/ably-auth/route.ts`
- `src/app/api/review/[gameId]/host-state/route.ts`
- `src/app/api/review/[gameId]/team-state/route.ts`
- `src/app/api/review/[gameId]/score/route.ts`
- `src/app/api/review/[gameId]/submission/route.ts`
- `src/app/api/review/[gameId]/vote/route.ts`
- `src/app/api/review/[gameId]/heartbeat/route.ts`
- `src/app/api/review/[gameId]/export-csv/route.ts`
- `src/hooks/useReviewHeartbeat.ts` / `useReviewHostGame.ts` / `useReviewTeamGame.ts`
- `src/features/review/ReviewSetEditor.tsx`
- `src/features/review/ReviewHostLobby.tsx` / `ReviewHostProgress.tsx` / `ReviewHostResults.tsx`
- `src/features/review/ReviewPlayerJoin.tsx` / `ReviewPlayerReview.tsx` / `ReviewPlayerCreate.tsx` / `ReviewPlayerVote.tsx` / `ReviewTeamResult.tsx`
- `src/app/[locale]/(auth)/dashboard/review/page.tsx`、`new/page.tsx`、`[reviewSetId]/edit/page.tsx`、`host/[gameId]/page.tsx` + `ReviewHostRoom.tsx`
- `src/app/[locale]/review/join/page.tsx`、`play/[gameId]/page.tsx` + `ReviewPlayRoom.tsx`

修改檔案：
- `src/models/Schema.ts`（新增 8 個表）
- `src/middleware.ts`（新增白名單條目）

---

### Task 1: DB Schema + Migration

**Files:**
- Modify: `src/models/Schema.ts`（在 `liveAnswerSchema` 定義之後、`todoSchema` 之前插入新區塊，約在現有檔案 L494-496 之間）
- Create: `migrations/xxxx_review_mode.sql`（`npm run db:generate` 自動產生，實際編號由工具決定）

**Interfaces:**
- Produces：`reviewGameStatusEnum`、`reviewSetSchema`、`reviewSampleSchema`、`reviewGameSchema`、`reviewTeamSchema`、`reviewPlayerSchema`、`reviewScoreSchema`、`reviewSubmissionSchema`、`reviewVoteSchema`（後續所有 task 都 import 這些）

- [ ] **Step 1: 在 `src/models/Schema.ts` 插入新表定義**

在 `liveAnswerSchema`（L466-494）結束的 `);` 之後、`export const todoSchema`（L496）之前插入：

```ts
// ---------- 小組協作批閱創作題（Team Review & Create） ----------
// 老師預備範例答案組 + 標準評分 → 學生系統隨機分組即時同步評分/短評 →
// 小組共創延伸答案 → 組間投票 → 計分排行榜（比照 Live Mode）
// 獨立於 live_game 系列表，只共用 realtimeAdapter 的 tick-only 機制

export const reviewGameStatusEnum = pgEnum('review_game_status', [
  'lobby', // 等待玩家加入
  'team_forming', // 已分組，等待老師開始 reviewing
  'reviewing', // 評分回合進行中
  'creating', // 共創回合進行中
  'voting', // 投票回合進行中
  'results', // 已計分，顯示排行榜
  'ended', // 場次已結束
]);

// 可重複使用的「題組」模板，類似 quiz，一次建立可開多場次
export const reviewSetSchema = pgTable('review_set', {
  id: serial('id').primaryKey(),
  ownerId: text('owner_id').notNull(), // Clerk userId，比照 quizSchema.ownerId
  title: text('title').notNull(),
  topicPrompt: text('topic_prompt').notNull(), // 給小組的延伸創作指示
  teamSize: integer('team_size').default(4).notNull(),
  reviewDurationSec: integer('review_duration_sec').default(600).notNull(),
  createDurationSec: integer('create_duration_sec').default(300).notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

// review_set 底下的範例答案 + 老師標準分（4 維度沿用現有 AI rubric 命名，0-5 分）
export const reviewSampleSchema = pgTable('review_sample', {
  id: serial('id').primaryKey(),
  reviewSetId: integer('review_set_id')
    .notNull()
    .references(() => reviewSetSchema.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  orderIndex: integer('order_index').notNull(),
  refCorrectness: integer('ref_correctness').notNull(),
  refCompleteness: integer('ref_completeness').notNull(),
  refClarity: integer('ref_clarity').notNull(),
  refCreativity: integer('ref_creativity').notNull(),
});

// 一場直播場次（review_set 的即時執行實例）
export const reviewGameSchema = pgTable('review_game', {
  id: serial('id').primaryKey(),
  reviewSetId: integer('review_set_id')
    .notNull()
    .references(() => reviewSetSchema.id, { onDelete: 'cascade' }),
  hostUserId: text('host_user_id').notNull(), // Clerk userId
  gamePin: text('game_pin').notNull().unique(),
  status: reviewGameStatusEnum('status').default('lobby').notNull(),
  // 目前階段起始時間 + 目標秒數：只給前端算倒數顯示用，不驅動伺服器自動切換階段
  phaseStartedAt: timestamp('phase_started_at', { mode: 'date' }),
  phaseDurationSec: integer('phase_duration_sec'),
  // reviewing 回合實際起訖時間（用來算速度加成；離開 reviewing 後 phaseStartedAt
  // 會被下個階段覆寫，所以另外存一份）
  reviewingStartedAt: timestamp('reviewing_started_at', { mode: 'date' }),
  reviewingEndedAt: timestamp('reviewing_ended_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  endedAt: timestamp('ended_at', { mode: 'date' }),
});

export const reviewTeamSchema = pgTable('review_team', {
  id: serial('id').primaryKey(),
  gameId: integer('game_id')
    .notNull()
    .references(() => reviewGameSchema.id, { onDelete: 'cascade' }),
  teamName: text('team_name').notNull(), // 「第 1 組」
  // 三段分數各自存欄位（而非只存加總），讓 results 報表可以直接讀，不用在
  // 顯示層重算一次公式（避免兩處公式分岔）；score 永遠等於三者加總
  accuracyScore: integer('accuracy_score').default(0).notNull(),
  speedBonus: integer('speed_bonus').default(0).notNull(),
  voteBonus: integer('vote_bonus').default(0).notNull(),
  score: integer('score').default(0).notNull(),
});

export const reviewPlayerSchema = pgTable(
  'review_player',
  {
    id: serial('id').primaryKey(),
    gameId: integer('game_id')
      .notNull()
      .references(() => reviewGameSchema.id, { onDelete: 'cascade' }),
    teamId: integer('team_id') // team_forming 前為 null
      .references(() => reviewTeamSchema.id, { onDelete: 'set null' }),
    nickname: text('nickname').notNull(),
    playerToken: text('player_token').notNull(),
    lastSeenAt: timestamp('last_seen_at', { mode: 'date' }).defaultNow().notNull(),
    joinedAt: timestamp('joined_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => ({
    gameNicknameIdx: uniqueIndex('review_player_game_nickname_idx').on(
      table.gameId,
      table.nickname,
    ),
    playerTokenIdx: uniqueIndex('review_player_token_idx').on(table.playerToken),
  }),
);

// 每位學生對每則範例答案的評分 + 可選短評（短評併進此表，不另開標註表）
export const reviewScoreSchema = pgTable(
  'review_score',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => reviewTeamSchema.id, { onDelete: 'cascade' }),
    playerId: integer('player_id')
      .notNull()
      .references(() => reviewPlayerSchema.id, { onDelete: 'cascade' }),
    sampleId: integer('sample_id')
      .notNull()
      .references(() => reviewSampleSchema.id, { onDelete: 'cascade' }),
    correctness: integer('correctness').notNull(),
    completeness: integer('completeness').notNull(),
    clarity: integer('clarity').notNull(),
    creativity: integer('creativity').notNull(),
    comment: text('comment'), // 短評，選填，Zod schema 限 200 字
    submittedAt: timestamp('submitted_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => ({
    playerSampleIdx: uniqueIndex('review_score_player_sample_idx').on(
      table.playerId,
      table.sampleId,
    ),
  }),
);

// 每組最終共同撰寫的延伸創作答案（1 組 1 筆，last-write-wins）
export const reviewSubmissionSchema = pgTable('review_submission', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .unique()
    .references(() => reviewTeamSchema.id, { onDelete: 'cascade' }),
  content: text('content').default('').notNull(),
  lastEditedByPlayerId: integer('last_edited_by_player_id')
    .references(() => reviewPlayerSchema.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
});

// 創作回合結束後，組間互投最佳創意答案（禁投自己組，app 層驗證）
export const reviewVoteSchema = pgTable(
  'review_vote',
  {
    id: serial('id').primaryKey(),
    gameId: integer('game_id')
      .notNull()
      .references(() => reviewGameSchema.id, { onDelete: 'cascade' }),
    voterTeamId: integer('voter_team_id')
      .notNull()
      .references(() => reviewTeamSchema.id, { onDelete: 'cascade' }),
    votedForTeamId: integer('voted_for_team_id')
      .notNull()
      .references(() => reviewTeamSchema.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => ({
    oneVotePerTeamIdx: uniqueIndex('review_vote_game_voter_idx').on(
      table.gameId,
      table.voterTeamId,
    ),
  }),
);
```

- [ ] **Step 2: 型別檢查**

Run: `npm run check-types`
Expected: 無錯誤（所有 import 的 `pgEnum`/`pgTable`/`serial`/`integer`/`text`/`timestamp`/`uniqueIndex` 都已在檔案頂端 import，見 L1-16，不用新增 import）

- [ ] **Step 3: 產生 migration**

Run: `npm run db:generate`

- [ ] **Step 4: 檢查產生的 SQL，刪除不相關的 diff**

開啟新產生的 `migrations/xxxx_*.sql`，確認只包含這 8 張新表的 `CREATE TYPE` / `CREATE TABLE` 語句。若看到跟本次改動無關的既有表 `CREATE TABLE` / `ALTER TABLE`（已知 `migrations/meta/` snapshot 缺失問題），手動刪除那些語句，只保留 `review_*` 相關的部分。確認每條 SQL 後都有 `--> statement-breakpoint`。

- [ ] **Step 5: 本機驗證 migration 可套用**

Run: `npm run dev`（PGlite 本機開發模式會在下次 DB 互動時自動套用新 migration）並確認終端機沒有 migration 錯誤，或執行 `npm run db:studio` 確認 8 張新表都已建立。

- [ ] **Step 6: Commit**

```bash
git add src/models/Schema.ts migrations/
git commit -m "$(cat <<'EOF'
新增小組協作批閱創作題資料表

review_set/review_sample/review_game/review_team/review_player/
review_score/review_submission/review_vote 共 8 張表，獨立於既有
live_game 系列，僅共用 realtimeAdapter 的即時同步機制。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 小組分配純函式（TDD）

**Files:**
- Create: `src/services/review/teamAssignment.ts`
- Test: `src/services/review/teamAssignment.test.ts`

**Interfaces:**
- Produces: `assignTeamsRoundRobin(playerIds: number[], teamSize: number): number[][]`（Task 8 的 `startTeamForming` action 會呼叫）

- [ ] **Step 1: 寫失敗測試**

```ts
// src/services/review/teamAssignment.test.ts
import { describe, expect, it } from 'vitest';

import { assignTeamsRoundRobin } from './teamAssignment';

describe('assignTeamsRoundRobin', () => {
  it('10 人、teamSize=4 時分成 3 組，人數 4/3/3', () => {
    const playerIds = Array.from({ length: 10 }, (_, i) => i + 1); // [1..10]
    const teams = assignTeamsRoundRobin(playerIds, 4);
    expect(teams).toHaveLength(3);
    expect(teams.map(t => t.length)).toEqual([4, 3, 3]);
  });

  it('round-robin 依序發放，第 1 組拿 1,4,7,10', () => {
    const playerIds = Array.from({ length: 10 }, (_, i) => i + 1);
    const teams = assignTeamsRoundRobin(playerIds, 4);
    expect(teams[0]).toEqual([1, 4, 7, 10]);
    expect(teams[1]).toEqual([2, 5, 8]);
    expect(teams[2]).toEqual([3, 6, 9]);
  });

  it('人數剛好整除 teamSize 時每組人數相等', () => {
    const playerIds = Array.from({ length: 8 }, (_, i) => i + 1);
    const teams = assignTeamsRoundRobin(playerIds, 4);
    expect(teams).toHaveLength(2);
    expect(teams.map(t => t.length)).toEqual([4, 4]);
  });

  it('人數少於 teamSize 時只分成 1 組', () => {
    const teams = assignTeamsRoundRobin([1, 2], 4);
    expect(teams).toHaveLength(1);
    expect(teams[0]).toEqual([1, 2]);
  });

  it('沒有玩家時回傳空陣列', () => {
    expect(assignTeamsRoundRobin([], 4)).toEqual([]);
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `npx vitest run src/services/review/teamAssignment.test.ts`
Expected: FAIL，錯誤訊息為找不到 `./teamAssignment` 模組

- [ ] **Step 3: 寫最小實作**

```ts
// src/services/review/teamAssignment.ts
// 系統隨機分組：round-robin 發牌式分配，人數自然平均（例如 10 人分 4 人一組
// 會產生 4/3/3，而不是 4/4/2 這種不平均的結果）

export function assignTeamsRoundRobin(
  playerIds: number[],
  teamSize: number,
): number[][] {
  if (playerIds.length === 0) {
    return [];
  }
  const numTeams = Math.max(1, Math.ceil(playerIds.length / teamSize));
  const teams: number[][] = Array.from({ length: numTeams }, () => []);
  playerIds.forEach((id, i) => {
    teams[i % numTeams]!.push(id);
  });
  return teams;
}
```

- [ ] **Step 4: 確認測試通過**

Run: `npx vitest run src/services/review/teamAssignment.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: Commit**

```bash
git add src/services/review/teamAssignment.ts src/services/review/teamAssignment.test.ts
git commit -m "$(cat <<'EOF'
新增協作批閱小組 round-robin 分配純函式

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 計分純函式（TDD）

**Files:**
- Create: `src/services/review/scoring.ts`
- Test: `src/services/review/scoring.test.ts`

**Interfaces:**
- Consumes: 無（純函式，不依賴前面 task）
- Produces: `RubricScores` type、`distributeAccuracyPoints(sampleCount: number): number[]`、
  `calcAccuracyScore(teamAvg: RubricScores, ref: RubricScores, pointsForSample: number): number`、
  `calcSpeedBonus(elapsedSec: number, totalDurationSec: number): number`、
  `calcVoteBonus(votesReceived: number): number`、
  `calcTeamTotalScore(params: { accuracyScores: number[]; speedBonus: number; voteBonus: number }): number`
  （Task 8 的 `finishGame` action 會呼叫全部 5 個函式）

- [ ] **Step 1: 寫失敗測試**

```ts
// src/services/review/scoring.test.ts
import { describe, expect, it } from 'vitest';

import {
  calcAccuracyScore,
  calcSpeedBonus,
  calcTeamTotalScore,
  calcVoteBonus,
  distributeAccuracyPoints,
} from './scoring';

const PERFECT: { correctness: number; completeness: number; clarity: number; creativity: number } = {
  correctness: 5,
  completeness: 5,
  clarity: 5,
  creativity: 5,
};

describe('distributeAccuracyPoints', () => {
  it('3 則範例答案，1000 分平分後餘數給前面：334/333/333', () => {
    expect(distributeAccuracyPoints(3)).toEqual([334, 333, 333]);
  });

  it('4 則範例答案整除：250/250/250/250', () => {
    expect(distributeAccuracyPoints(4)).toEqual([250, 250, 250, 250]);
  });

  it('0 則回傳空陣列', () => {
    expect(distributeAccuracyPoints(0)).toEqual([]);
  });
});

describe('calcAccuracyScore', () => {
  it('team 平均分跟標準分完全一致時拿滿分', () => {
    expect(calcAccuracyScore(PERFECT, PERFECT, 250)).toBe(250);
  });

  it('每個維度都差 1 分時，每維度扣 20% → 拿 80%', () => {
    const teamAvg = { correctness: 4, completeness: 4, clarity: 4, creativity: 4 };
    expect(calcAccuracyScore(teamAvg, PERFECT, 250)).toBe(200);
  });

  it('差距達 5 分以上時該維度歸零，四維度都差 5 分 → 整體 0 分', () => {
    const teamAvg = { correctness: 0, completeness: 0, clarity: 0, creativity: 0 };
    expect(calcAccuracyScore(teamAvg, PERFECT, 250)).toBe(0);
  });

  it('只有部分維度有落差時按比例計算', () => {
    // correctness 完全命中(100%)，其餘三維度差 1 分(80%)：(100+80+80+80)/4=85% * 250 = 212.5 → 四捨五入 213
    const teamAvg = { correctness: 5, completeness: 4, clarity: 4, creativity: 4 };
    expect(calcAccuracyScore(teamAvg, PERFECT, 250)).toBe(213);
  });
});

describe('calcSpeedBonus', () => {
  it('一開始就完成（elapsedSec=0）拿滿額 1000', () => {
    expect(calcSpeedBonus(0, 600)).toBe(1000);
  });

  it('用掉一半時間完成，拿 750（1000*(1-0.5*0.5)）', () => {
    expect(calcSpeedBonus(300, 600)).toBe(750);
  });

  it('即使快超時完成也保底 500', () => {
    expect(calcSpeedBonus(599, 600)).toBe(500);
  });

  it('超過或等於總時長（沒在時限內完成）拿 0', () => {
    expect(calcSpeedBonus(600, 600)).toBe(0);
    expect(calcSpeedBonus(700, 600)).toBe(0);
  });
});

describe('calcVoteBonus', () => {
  it('0 票拿 0 分', () => {
    expect(calcVoteBonus(0)).toBe(0);
  });

  it('每票 100 分，線性累加', () => {
    expect(calcVoteBonus(3)).toBe(300);
  });
});

describe('calcTeamTotalScore', () => {
  it('加總所有範例答案的準確度分 + 速度加成 + 投票加成', () => {
    const total = calcTeamTotalScore({
      accuracyScores: [250, 200, 180],
      speedBonus: 750,
      voteBonus: 200,
    });
    expect(total).toBe(250 + 200 + 180 + 750 + 200);
  });

  it('全部為 0 時總分為 0', () => {
    expect(calcTeamTotalScore({ accuracyScores: [], speedBonus: 0, voteBonus: 0 })).toBe(0);
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `npx vitest run src/services/review/scoring.test.ts`
Expected: FAIL，找不到 `./scoring` 模組

- [ ] **Step 3: 寫最小實作**

```ts
// src/services/review/scoring.ts
// 協作批閱計分邏輯：準確度分 + 速度加成 + 投票加成三段獨立可測試的純函式
// 重要：所有計分必須在 server 端執行（Server Action / API Route 內）

export type RubricScores = {
  correctness: number;
  completeness: number;
  clarity: number;
  creativity: number;
};

const ACCURACY_POOL_TOTAL = 1000; // 所有範例答案的準確度分總額
const ACCURACY_PENALTY_PER_POINT = 20; // 每差 1 分扣 20%（滿分 100%，差 5 分以上歸零）

/**
 * 把準確度總分平分給每則範例答案，餘數分給前面幾則（比照
 * questionActions.ts 的 distributePoints 邏輯：Math.floor + 餘數依序 +1）
 */
export function distributeAccuracyPoints(sampleCount: number): number[] {
  if (sampleCount === 0) {
    return [];
  }
  const base = Math.floor(ACCURACY_POOL_TOTAL / sampleCount);
  const remainder = ACCURACY_POOL_TOTAL - base * sampleCount;
  return Array.from({ length: sampleCount }, (_, i) => (i < remainder ? base + 1 : base));
}

function dimensionAccuracyPct(avg: number, ref: number): number {
  const diff = Math.abs(avg - ref);
  return Math.max(0, 100 - diff * ACCURACY_PENALTY_PER_POINT);
}

/**
 * 單則範例答案的準確度分：team 平均分跟老師標準分的 4 維度差距，
 * 換算成百分比後乘上這則答案的配分。
 */
export function calcAccuracyScore(
  teamAvg: RubricScores,
  ref: RubricScores,
  pointsForSample: number,
): number {
  const dims: (keyof RubricScores)[] = ['correctness', 'completeness', 'clarity', 'creativity'];
  const avgPct = dims.reduce((sum, k) => sum + dimensionAccuracyPct(teamAvg[k], ref[k]), 0) / dims.length;
  return Math.round((avgPct / 100) * pointsForSample);
}

/**
 * 速度加成：整組全員都完成評分才算「該組完成」，用完成時的剩餘時間比例
 * 計算，公式跟 Live Mode 的 calcLiveScore 同款（500 保底、最高 1000）。
 * 沒在時限內完成（elapsedSec >= totalDurationSec）拿 0。
 */
export function calcSpeedBonus(elapsedSec: number, totalDurationSec: number): number {
  if (elapsedSec >= totalDurationSec) {
    return 0;
  }
  const ratio = Math.max(0, elapsedSec) / totalDurationSec;
  const raw = 1000 * (1 - ratio * 0.5);
  return Math.max(500, Math.round(raw));
}

/** 投票加成：每收到一票（不含自己組）+100 分 */
export function calcVoteBonus(votesReceived: number): number {
  return votesReceived * 100;
}

/** 加總三段分數 */
export function calcTeamTotalScore(params: {
  accuracyScores: number[];
  speedBonus: number;
  voteBonus: number;
}): number {
  const accuracyTotal = params.accuracyScores.reduce((a, b) => a + b, 0);
  return accuracyTotal + params.speedBonus + params.voteBonus;
}
```

- [ ] **Step 4: 確認測試通過**

Run: `npx vitest run src/services/review/scoring.test.ts`
Expected: PASS（14 tests）

- [ ] **Step 5: Commit**

```bash
git add src/services/review/scoring.ts src/services/review/scoring.test.ts
git commit -m "$(cat <<'EOF'
新增協作批閱三段式計分純函式

準確度分（貼近老師標準分）+ 速度加成 + 投票加成，公式與量級比照
既有 Live Mode calcLiveScore/distributePoints。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 共用型別

**Files:**
- Create: `src/services/review/types.ts`

**Interfaces:**
- Consumes: `RubricScores`（Task 3 `scoring.ts`）
- Produces: `ReviewGameStatus`、`ReviewSampleForClient`、`ReviewHostState`、`ReviewTeamState`（Task 6 reviewStore、Task 9-13 API routes、Task 14 hooks 都依賴這些型別）

**重要邊界**：`ReviewTeamState.samples` 只給 `id`/`content`/`orderIndex`，**絕不含老師的標準分**——學生評分時不能看到答案卡，標準分只在老師端 `ReviewHostState.resultsDetail`（`results` 階段才有值）才出現。

- [ ] **Step 1: 寫型別檔**

```ts
// src/services/review/types.ts
import type { RubricScores } from './scoring';

export type ReviewGameStatus =
  | 'lobby'
  | 'team_forming'
  | 'reviewing'
  | 'creating'
  | 'voting'
  | 'results'
  | 'ended';

// 學生端看到的範例答案：不含老師標準分
export type ReviewSampleForClient = {
  id: number;
  content: string;
  orderIndex: number;
};

export type ReviewTeamSummary = {
  id: number;
  teamName: string;
  memberCount: number;
  score: number;
};

// 老師結算後（results 階段）每組的明細，用來畫「分數 vs 標準分」對照
export type ReviewTeamResultDetail = {
  teamId: number;
  samples: {
    sampleId: number;
    sampleContent: string;
    teamAvg: RubricScores;
    ref: RubricScores;
    accuracyScore: number;
  }[];
  accuracyScore: number; // 逐則加總（= review_team.accuracy_score）
  speedBonus: number;
  voteBonus: number;
  submission: string | null;
  votesReceived: number;
};

export type ReviewHostState = {
  game: {
    id: number;
    status: ReviewGameStatus;
    gamePin: string;
    title: string;
    phaseStartedAt: string | null;
    phaseDurationSec: number | null;
  };
  teams: (ReviewTeamSummary & {
    scoredSampleCount: number; // 至少 1 人評過分的範例答案數
    memberReadyCount: number; // 全部範例答案都評完分的成員數
    hasSubmission: boolean;
    votesReceived: number;
  })[];
  totalSamples: number;
  joinedPlayerCount: number; // lobby 階段顯示已加入人數
  // 只有 status === 'results' 才會有值
  resultsDetail: ReviewTeamResultDetail[] | null;
};

export type ReviewTeamState = {
  game: {
    id: number;
    status: ReviewGameStatus;
    phaseStartedAt: string | null;
    phaseDurationSec: number | null;
  };
  topicPrompt: string; // 給小組的延伸創作指示，creating 階段顯示用
  me: { id: number; nickname: string; teamId: number | null; teamName: string | null };
  teammates: { id: number; nickname: string }[];
  samples: ReviewSampleForClient[];
  myScores: Record<number, RubricScores & { comment: string | null }>; // key: sampleId
  teammateScores: Record<
    number,
    (RubricScores & { comment: string | null; playerId: number; nickname: string })[]
  >; // key: sampleId，不含自己
  submission: { content: string; updatedAt: string } | null;
  hasVoted: boolean;
  // voting 階段才有值；匿名（不含 teamName），避免人情票
  votingCandidates: { teamId: number; content: string }[] | null;
  finalTeamRank: { rank: number; score: number } | null; // results 階段才有值
};
```

- [ ] **Step 2: 型別檢查**

Run: `npm run check-types`
Expected: 無錯誤

- [ ] **Step 3: Commit**

```bash
git add src/services/review/types.ts
git commit -m "$(cat <<'EOF'
新增協作批閱共用型別

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 即時同步（realtimeAdapter + Ably）

**Files:**
- Create: `src/services/review/realtimeAdapter.ts`
- Create: `src/services/review/ablyServer.ts`
- Create: `src/services/review/ablyAdapter.ts`

**Interfaces:**
- Consumes: `ReviewHostState`、`ReviewTeamState`（Task 4）
- Produces: `reviewRealtime: ReviewRealtimeAdapter` 單例（Task 14 hooks 用）、`publishTick(gameId): Promise<void>`（Task 8/9/10/11/12/13 mutation 完都要呼叫）

這三支檔案是 `src/services/live/realtimeAdapter.ts` / `ablyServer.ts` / `ablyAdapter.ts` 的逐一對應複製，只改三處：channel 前綴 `live:` → `review:`、方法名 `subscribePlayerState` → `subscribeTeamState`、型別來源改 import `./types`。**不寫測試**（這是純粹的 infra 複製，Live Mode 原版也沒有針對這層寫單元測試，行為靠手動驗證）。

- [ ] **Step 1: 建立 `ablyServer.ts`**

```ts
// src/services/review/ablyServer.ts
// 協作批閱 server-side Ably：發 tick 通知 + 發 token 給 client
// 設計跟 src/services/live/ablyServer.ts 完全一致：只發近乎空的 tick，
// client 收到後自己 fetch 對應 REST（單 channel、無隱私洩漏、與既有 state endpoints 共存）
import Ably from 'ably';

let ablyRest: Ably.Rest | null = null;

function getAbly(): Ably.Rest {
  if (!ablyRest) {
    const key = process.env.ABLY_API_KEY;
    if (!key) {
      throw new Error('ABLY_API_KEY 未設定');
    }
    ablyRest = new Ably.Rest(key);
  }
  return ablyRest;
}

export function isAblyEnabled(): boolean {
  return !!process.env.ABLY_API_KEY;
}

// 發 tick 到 review:{gameId}，讓訂閱的 host / team 重抓自己的 state
export async function publishTick(gameId: number): Promise<void> {
  if (!isAblyEnabled()) {
    return;
  }
  try {
    const channel = getAbly().channels.get(`review:${gameId}`);
    await channel.publish('tick', { ts: Date.now() });
  } catch (err) {
    console.warn('[review/ablyServer] publishTick failed', { gameId, err });
  }
}

export async function createAblyTokenRequest(params: {
  gameId: number;
  clientId: string;
}): Promise<Ably.TokenRequest> {
  const ably = getAbly();
  return ably.auth.createTokenRequest({
    clientId: params.clientId,
    capability: JSON.stringify({
      [`review:${params.gameId}`]: ['subscribe'],
    }),
    ttl: 2 * 60 * 60 * 1000,
  });
}
```

- [ ] **Step 2: 建立 `realtimeAdapter.ts`**

```ts
// src/services/review/realtimeAdapter.ts
import { AblyRealtimeAdapter } from './ablyAdapter';
import type { ReviewHostState, ReviewTeamState } from './types';

export type Unsubscribe = () => void;

export type SubscribeHostOptions = {
  intervalMs?: number; // default 1500
  onError?: (err: unknown) => void;
};

export type SubscribeTeamOptions = {
  intervalMs?: number; // default 2000
  onError?: (err: unknown) => void;
};

export type ReviewRealtimeAdapter = {
  subscribeHostState: (
    gameId: number,
    cb: (state: ReviewHostState) => void,
    opts?: SubscribeHostOptions,
  ) => Unsubscribe;
  subscribeTeamState: (
    gameId: number,
    playerId: number,
    playerToken: string,
    cb: (state: ReviewTeamState) => void,
    opts?: SubscribeTeamOptions,
  ) => Unsubscribe;
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export class PollingRealtimeAdapter implements ReviewRealtimeAdapter {
  subscribeHostState(
    gameId: number,
    cb: (state: ReviewHostState) => void,
    opts?: SubscribeHostOptions,
  ): Unsubscribe {
    const intervalMs = opts?.intervalMs ?? 1500;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) {
        return;
      }
      try {
        const state = await fetchJson<ReviewHostState>(`/api/review/${gameId}/host-state`);
        if (!cancelled) {
          cb(state);
        }
      } catch (err) {
        opts?.onError?.(err);
      } finally {
        if (!cancelled) {
          timer = setTimeout(tick, intervalMs);
        }
      }
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }

  subscribeTeamState(
    gameId: number,
    playerId: number,
    playerToken: string,
    cb: (state: ReviewTeamState) => void,
    opts?: SubscribeTeamOptions,
  ): Unsubscribe {
    const intervalMs = opts?.intervalMs ?? 2000;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const url = `/api/review/${gameId}/team-state?playerId=${playerId}&token=${encodeURIComponent(playerToken)}`;

    const tick = async () => {
      if (cancelled) {
        return;
      }
      try {
        const state = await fetchJson<ReviewTeamState>(url);
        if (!cancelled) {
          cb(state);
        }
      } catch (err) {
        opts?.onError?.(err);
      } finally {
        if (!cancelled) {
          timer = setTimeout(tick, intervalMs);
        }
      }
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }
}

function selectAdapter(): ReviewRealtimeAdapter {
  if (process.env.NEXT_PUBLIC_LIVE_REALTIME === 'ably') {
    return new AblyRealtimeAdapter();
  }
  return new PollingRealtimeAdapter();
}

export const reviewRealtime: ReviewRealtimeAdapter = selectAdapter();
```

- [ ] **Step 3: 建立 `ablyAdapter.ts`**

```ts
// src/services/review/ablyAdapter.ts
'use client';

import type * as AblyTypes from 'ably';

import type {
  ReviewRealtimeAdapter,
  SubscribeHostOptions,
  SubscribeTeamOptions,
  Unsubscribe,
} from './realtimeAdapter';
import type { ReviewHostState, ReviewTeamState } from './types';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

async function createRealtime(
  authParams: Record<string, string>,
): Promise<AblyTypes.Realtime> {
  const { default: Ably } = await import('ably');
  return new Ably.Realtime({
    authUrl: '/api/review/ably-auth',
    authParams,
    authMethod: 'GET',
  });
}

export class AblyRealtimeAdapter implements ReviewRealtimeAdapter {
  subscribeHostState(
    gameId: number,
    cb: (state: ReviewHostState) => void,
    opts?: SubscribeHostOptions,
  ): Unsubscribe {
    let cancelled = false;
    let realtime: AblyTypes.Realtime | null = null;
    const url = `/api/review/${gameId}/host-state`;

    const fetchAndCb = async () => {
      try {
        const state = await fetchJson<ReviewHostState>(url);
        if (!cancelled) {
          cb(state);
        }
      } catch (err) {
        opts?.onError?.(err);
      }
    };

    (async () => {
      await fetchAndCb();
      if (cancelled) {
        return;
      }
      try {
        realtime = await createRealtime({ role: 'host', gameId: String(gameId) });
        const channel = realtime.channels.get(`review:${gameId}`);
        await channel.subscribe('tick', () => {
          void fetchAndCb();
        });
      } catch (err) {
        opts?.onError?.(err);
      }
    })();

    return () => {
      cancelled = true;
      if (realtime) {
        realtime.close();
        realtime = null;
      }
    };
  }

  subscribeTeamState(
    gameId: number,
    playerId: number,
    playerToken: string,
    cb: (state: ReviewTeamState) => void,
    opts?: SubscribeTeamOptions,
  ): Unsubscribe {
    let cancelled = false;
    let realtime: AblyTypes.Realtime | null = null;
    const url = `/api/review/${gameId}/team-state?playerId=${playerId}&token=${encodeURIComponent(playerToken)}`;

    const fetchAndCb = async () => {
      try {
        const state = await fetchJson<ReviewTeamState>(url);
        if (!cancelled) {
          cb(state);
        }
      } catch (err) {
        opts?.onError?.(err);
      }
    };

    (async () => {
      await fetchAndCb();
      if (cancelled) {
        return;
      }
      try {
        realtime = await createRealtime({
          role: 'player',
          gameId: String(gameId),
          playerId: String(playerId),
          playerToken,
        });
        const channel = realtime.channels.get(`review:${gameId}`);
        await channel.subscribe('tick', () => {
          void fetchAndCb();
        });
      } catch (err) {
        opts?.onError?.(err);
      }
    })();

    return () => {
      cancelled = true;
      if (realtime) {
        realtime.close();
        realtime = null;
      }
    };
  }
}
```

- [ ] **Step 4: 型別檢查**

Run: `npm run check-types`
Expected: 無錯誤

- [ ] **Step 5: Commit**

```bash
git add src/services/review/realtimeAdapter.ts src/services/review/ablyServer.ts src/services/review/ablyAdapter.ts
git commit -m "$(cat <<'EOF'
新增協作批閱即時同步層，複用 Live Mode 的 tick-only 設計

channel 前綴改 review:{gameId}，其餘機制（Polling 預設 / Ably flag
啟用、tick 不帶 payload、無 key 時 no-op）與 Live Mode 完全一致。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 資料存取層 `reviewStore.ts`

**Files:**
- Create: `src/services/review/reviewStore.ts`

**Interfaces:**
- Consumes: schema（Task 1）、`RubricScores`/`calcAccuracyScore`/`distributeAccuracyPoints`（Task 3）、`ReviewGameStatus`/`ReviewHostState`/`ReviewTeamState`/`ReviewSampleForClient`/`ReviewTeamResultDetail`（Task 4）、`publishTick`（Task 5）
- Produces: `getReviewSamples`、`findGameByPin`、`isNicknameTaken`、`verifyPlayerToken`、`getHostState`、`getTeamState`、`upsertScore`、`upsertSubmission`、`castVote`（Task 8 actions 與 Task 9-13 API routes 都會呼叫這些）

不寫自動化測試（跟 `liveStore.ts` 同慣例，資料層靠 Task 17 的手動驗證流程覆蓋）。

- [ ] **Step 1: 建立完整檔案**

```ts
// src/services/review/reviewStore.ts
// 協作批閱統一資料存取層：把 DB query 集中在此，API Route / Server Action 呼叫即可。

import { and, asc, count, desc, eq, inArray, ne } from 'drizzle-orm';

import { db } from '@/libs/DB';
import {
  reviewGameSchema,
  reviewPlayerSchema,
  reviewSampleSchema,
  reviewScoreSchema,
  reviewSetSchema,
  reviewSubmissionSchema,
  reviewTeamSchema,
  reviewVoteSchema,
} from '@/models/Schema';

import { publishTick } from './ablyServer';
import { calcAccuracyScore, distributeAccuracyPoints } from './scoring';
import type {
  ReviewGameStatus,
  ReviewHostState,
  ReviewSampleForClient,
  ReviewTeamResultDetail,
  ReviewTeamState,
} from './types';
import type { RubricScores } from './scoring';

export type ReviewSampleWithRef = {
  id: number;
  content: string;
  orderIndex: number;
  refCorrectness: number;
  refCompleteness: number;
  refClarity: number;
  refCreativity: number;
};

// 取得某題組的範例答案（含老師標準分，內部用；學生端回應前一定要 strip 成 ReviewSampleForClient）
export async function getReviewSamples(reviewSetId: number): Promise<ReviewSampleWithRef[]> {
  return db
    .select({
      id: reviewSampleSchema.id,
      content: reviewSampleSchema.content,
      orderIndex: reviewSampleSchema.orderIndex,
      refCorrectness: reviewSampleSchema.refCorrectness,
      refCompleteness: reviewSampleSchema.refCompleteness,
      refClarity: reviewSampleSchema.refClarity,
      refCreativity: reviewSampleSchema.refCreativity,
    })
    .from(reviewSampleSchema)
    .where(eq(reviewSampleSchema.reviewSetId, reviewSetId))
    .orderBy(asc(reviewSampleSchema.orderIndex));
}

export async function findGameByPin(
  pin: string,
): Promise<{ id: number; reviewSetId: number; status: ReviewGameStatus } | null> {
  const [row] = await db
    .select({
      id: reviewGameSchema.id,
      reviewSetId: reviewGameSchema.reviewSetId,
      status: reviewGameSchema.status,
    })
    .from(reviewGameSchema)
    .where(eq(reviewGameSchema.gamePin, pin))
    .limit(1);
  return row ?? null;
}

export async function isNicknameTaken(gameId: number, nickname: string): Promise<boolean> {
  const [row] = await db
    .select({ id: reviewPlayerSchema.id })
    .from(reviewPlayerSchema)
    .where(and(eq(reviewPlayerSchema.gameId, gameId), eq(reviewPlayerSchema.nickname, nickname)))
    .limit(1);
  return !!row;
}

export async function verifyPlayerToken(
  gameId: number,
  playerToken: string,
): Promise<{ playerId: number } | null> {
  const [row] = await db
    .select({ id: reviewPlayerSchema.id })
    .from(reviewPlayerSchema)
    .where(and(eq(reviewPlayerSchema.gameId, gameId), eq(reviewPlayerSchema.playerToken, playerToken)))
    .limit(1);
  return row ? { playerId: row.id } : null;
}

// 每組的進度統計：一次把 game 底下所有 team 相關列都撈出來在記憶體分組，
// 避免每組各下好幾條 query（N+1）
async function getTeamsWithProgress(
  gameId: number,
  sampleCount: number,
): Promise<ReviewHostState['teams']> {
  const teams = await db.select().from(reviewTeamSchema).where(eq(reviewTeamSchema.gameId, gameId));
  if (teams.length === 0) {
    return [];
  }
  const teamIds = teams.map(t => t.id);

  const players = await db
    .select({ id: reviewPlayerSchema.id, teamId: reviewPlayerSchema.teamId })
    .from(reviewPlayerSchema)
    .where(inArray(reviewPlayerSchema.teamId, teamIds));
  const scores = await db
    .select({
      teamId: reviewScoreSchema.teamId,
      playerId: reviewScoreSchema.playerId,
      sampleId: reviewScoreSchema.sampleId,
    })
    .from(reviewScoreSchema)
    .where(inArray(reviewScoreSchema.teamId, teamIds));
  const submissions = await db
    .select({ teamId: reviewSubmissionSchema.teamId, content: reviewSubmissionSchema.content })
    .from(reviewSubmissionSchema)
    .where(inArray(reviewSubmissionSchema.teamId, teamIds));
  const votes = await db
    .select({ votedForTeamId: reviewVoteSchema.votedForTeamId })
    .from(reviewVoteSchema)
    .where(inArray(reviewVoteSchema.votedForTeamId, teamIds));

  return teams.map((team) => {
    const teamPlayers = players.filter(p => p.teamId === team.id);
    const teamScores = scores.filter(s => s.teamId === team.id);
    const scoredSampleIds = new Set(teamScores.map(s => s.sampleId));

    const doneSampleCountByPlayer = new Map<number, number>();
    for (const s of teamScores) {
      doneSampleCountByPlayer.set(s.playerId, (doneSampleCountByPlayer.get(s.playerId) ?? 0) + 1);
    }
    const memberReadyCount = sampleCount === 0
      ? 0
      : teamPlayers.filter(p => (doneSampleCountByPlayer.get(p.id) ?? 0) >= sampleCount).length;

    const submission = submissions.find(s => s.teamId === team.id);
    const votesReceived = votes.filter(v => v.votedForTeamId === team.id).length;

    return {
      id: team.id,
      teamName: team.teamName,
      memberCount: teamPlayers.length,
      score: team.score,
      scoredSampleCount: scoredSampleIds.size,
      memberReadyCount,
      hasSubmission: !!submission && submission.content.trim().length > 0,
      votesReceived,
    };
  });
}

// results 階段的每組明細：分數 vs 標準分逐則對照，供老師報表使用
async function getResultsDetail(
  gameId: number,
  samples: ReviewSampleWithRef[],
): Promise<ReviewTeamResultDetail[]> {
  const teams = await db.select().from(reviewTeamSchema).where(eq(reviewTeamSchema.gameId, gameId));
  if (teams.length === 0) {
    return [];
  }
  const teamIds = teams.map(t => t.id);

  const scores = await db.select().from(reviewScoreSchema).where(inArray(reviewScoreSchema.teamId, teamIds));
  const submissions = await db
    .select()
    .from(reviewSubmissionSchema)
    .where(inArray(reviewSubmissionSchema.teamId, teamIds));
  const voteRows = await db
    .select()
    .from(reviewVoteSchema)
    .where(inArray(reviewVoteSchema.votedForTeamId, teamIds));
  const accuracyPoints = distributeAccuracyPoints(samples.length);

  return teams.map((team) => {
    const teamScores = scores.filter(s => s.teamId === team.id);
    const sampleDetails = samples.map((sample, i) => {
      const sampleScores = teamScores.filter(s => s.sampleId === sample.id);
      const avg: RubricScores = sampleScores.length === 0
        ? { correctness: 0, completeness: 0, clarity: 0, creativity: 0 }
        : {
            correctness: sampleScores.reduce((a, s) => a + s.correctness, 0) / sampleScores.length,
            completeness: sampleScores.reduce((a, s) => a + s.completeness, 0) / sampleScores.length,
            clarity: sampleScores.reduce((a, s) => a + s.clarity, 0) / sampleScores.length,
            creativity: sampleScores.reduce((a, s) => a + s.creativity, 0) / sampleScores.length,
          };
      const ref: RubricScores = {
        correctness: sample.refCorrectness,
        completeness: sample.refCompleteness,
        clarity: sample.refClarity,
        creativity: sample.refCreativity,
      };
      return {
        sampleId: sample.id,
        sampleContent: sample.content,
        teamAvg: avg,
        ref,
        accuracyScore: calcAccuracyScore(avg, ref, accuracyPoints[i]!),
      };
    });
    const submission = submissions.find(s => s.teamId === team.id);
    const votesReceived = voteRows.filter(v => v.votedForTeamId === team.id).length;

    return {
      teamId: team.id,
      samples: sampleDetails,
      accuracyScore: team.accuracyScore,
      speedBonus: team.speedBonus,
      voteBonus: team.voteBonus,
      submission: submission?.content ?? null,
      votesReceived,
    };
  });
}

export async function getHostState(gameId: number): Promise<ReviewHostState | null> {
  const [game] = await db.select().from(reviewGameSchema).where(eq(reviewGameSchema.id, gameId)).limit(1);
  if (!game) {
    return null;
  }
  const [reviewSet] = await db
    .select()
    .from(reviewSetSchema)
    .where(eq(reviewSetSchema.id, game.reviewSetId))
    .limit(1);
  if (!reviewSet) {
    return null;
  }

  const samples = await getReviewSamples(game.reviewSetId);
  const teams = await getTeamsWithProgress(gameId, samples.length);

  const [{ value: joinedPlayerCount }] = await db
    .select({ value: count() })
    .from(reviewPlayerSchema)
    .where(eq(reviewPlayerSchema.gameId, gameId));

  const resultsDetail = game.status === 'results' ? await getResultsDetail(gameId, samples) : null;

  return {
    game: {
      id: game.id,
      status: game.status,
      gamePin: game.gamePin,
      title: reviewSet.title,
      phaseStartedAt: game.phaseStartedAt ? game.phaseStartedAt.toISOString() : null,
      phaseDurationSec: game.phaseDurationSec,
    },
    teams,
    totalSamples: samples.length,
    joinedPlayerCount,
    resultsDetail,
  };
}

export async function getTeamState(gameId: number, playerId: number): Promise<ReviewTeamState | null> {
  const [game] = await db.select().from(reviewGameSchema).where(eq(reviewGameSchema.id, gameId)).limit(1);
  if (!game) {
    return null;
  }
  const [me] = await db
    .select()
    .from(reviewPlayerSchema)
    .where(and(eq(reviewPlayerSchema.id, playerId), eq(reviewPlayerSchema.gameId, gameId)))
    .limit(1);
  if (!me) {
    return null;
  }

  const [reviewSet] = await db
    .select({ topicPrompt: reviewSetSchema.topicPrompt })
    .from(reviewSetSchema)
    .where(eq(reviewSetSchema.id, game.reviewSetId))
    .limit(1);
  if (!reviewSet) {
    return null;
  }

  const samplesRaw = await getReviewSamples(game.reviewSetId);
  const samples: ReviewSampleForClient[] = samplesRaw.map(s => ({
    id: s.id,
    content: s.content,
    orderIndex: s.orderIndex,
  }));

  let teammates: { id: number; nickname: string }[] = [];
  let myScores: ReviewTeamState['myScores'] = {};
  let teammateScores: ReviewTeamState['teammateScores'] = {};
  let submission: ReviewTeamState['submission'] = null;
  let hasVoted = false;
  let votingCandidates: ReviewTeamState['votingCandidates'] = null;
  let finalTeamRank: ReviewTeamState['finalTeamRank'] = null;
  let teamName: string | null = null;

  if (me.teamId) {
    const [team] = await db
      .select({ teamName: reviewTeamSchema.teamName })
      .from(reviewTeamSchema)
      .where(eq(reviewTeamSchema.id, me.teamId))
      .limit(1);
    teamName = team?.teamName ?? null;

    const teamMembers = await db
      .select({ id: reviewPlayerSchema.id, nickname: reviewPlayerSchema.nickname })
      .from(reviewPlayerSchema)
      .where(eq(reviewPlayerSchema.teamId, me.teamId));
    teammates = teamMembers.filter(p => p.id !== me.id);

    const teamScores = await db
      .select()
      .from(reviewScoreSchema)
      .where(eq(reviewScoreSchema.teamId, me.teamId));
    for (const s of teamScores) {
      const entry = {
        correctness: s.correctness,
        completeness: s.completeness,
        clarity: s.clarity,
        creativity: s.creativity,
        comment: s.comment,
      };
      if (s.playerId === me.id) {
        myScores[s.sampleId] = entry;
      } else {
        const nickname = teamMembers.find(m => m.id === s.playerId)?.nickname ?? '組員';
        teammateScores[s.sampleId] = [
          ...(teammateScores[s.sampleId] ?? []),
          { ...entry, playerId: s.playerId, nickname },
        ];
      }
    }

    const [sub] = await db
      .select()
      .from(reviewSubmissionSchema)
      .where(eq(reviewSubmissionSchema.teamId, me.teamId))
      .limit(1);
    if (sub) {
      submission = { content: sub.content, updatedAt: sub.updatedAt.toISOString() };
    }

    const [myVote] = await db
      .select()
      .from(reviewVoteSchema)
      .where(and(eq(reviewVoteSchema.gameId, gameId), eq(reviewVoteSchema.voterTeamId, me.teamId)))
      .limit(1);
    hasVoted = !!myVote;

    if (game.status === 'voting') {
      const otherSubmissions = await db
        .select({ teamId: reviewSubmissionSchema.teamId, content: reviewSubmissionSchema.content })
        .from(reviewSubmissionSchema)
        .innerJoin(reviewTeamSchema, eq(reviewTeamSchema.id, reviewSubmissionSchema.teamId))
        .where(and(
          eq(reviewTeamSchema.gameId, gameId),
          ne(reviewSubmissionSchema.teamId, me.teamId),
        ));
      votingCandidates = otherSubmissions
        .filter(s => s.content.trim().length > 0)
        .map(s => ({ teamId: s.teamId, content: s.content }));
    }

    if (game.status === 'results') {
      const allTeams = await db
        .select({ id: reviewTeamSchema.id, score: reviewTeamSchema.score })
        .from(reviewTeamSchema)
        .where(eq(reviewTeamSchema.gameId, gameId))
        .orderBy(desc(reviewTeamSchema.score));
      const idx = allTeams.findIndex(t => t.id === me.teamId);
      if (idx >= 0) {
        finalTeamRank = { rank: idx + 1, score: allTeams[idx]!.score };
      }
    }
  }

  return {
    game: {
      id: game.id,
      status: game.status,
      phaseStartedAt: game.phaseStartedAt ? game.phaseStartedAt.toISOString() : null,
      phaseDurationSec: game.phaseDurationSec,
    },
    topicPrompt: reviewSet.topicPrompt,
    me: { id: me.id, nickname: me.nickname, teamId: me.teamId, teamName },
    teammates,
    samples,
    myScores,
    teammateScores,
    submission,
    hasVoted,
    votingCandidates,
    finalTeamRank,
  };
}

export async function upsertScore(params: {
  gameId: number;
  playerId: number;
  sampleId: number;
  scores: RubricScores;
  comment: string | null;
}): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const { gameId, playerId, sampleId, scores, comment } = params;

  const [player] = await db
    .select()
    .from(reviewPlayerSchema)
    .where(and(eq(reviewPlayerSchema.id, playerId), eq(reviewPlayerSchema.gameId, gameId)))
    .limit(1);
  if (!player || !player.teamId) {
    return { ok: false, error: 'NOT_ON_TEAM', status: 403 };
  }

  const [game] = await db
    .select({ status: reviewGameSchema.status })
    .from(reviewGameSchema)
    .where(eq(reviewGameSchema.id, gameId))
    .limit(1);
  if (!game || game.status !== 'reviewing') {
    return { ok: false, error: 'NOT_REVIEWING_PHASE', status: 409 };
  }

  const [sample] = await db
    .select({ id: reviewSampleSchema.id })
    .from(reviewSampleSchema)
    .where(eq(reviewSampleSchema.id, sampleId))
    .limit(1);
  if (!sample) {
    return { ok: false, error: 'SAMPLE_NOT_FOUND', status: 404 };
  }

  await db
    .insert(reviewScoreSchema)
    .values({
      teamId: player.teamId,
      playerId,
      sampleId,
      correctness: scores.correctness,
      completeness: scores.completeness,
      clarity: scores.clarity,
      creativity: scores.creativity,
      comment,
      submittedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [reviewScoreSchema.playerId, reviewScoreSchema.sampleId],
      set: {
        correctness: scores.correctness,
        completeness: scores.completeness,
        clarity: scores.clarity,
        creativity: scores.creativity,
        comment,
        submittedAt: new Date(),
      },
    });

  await publishTick(gameId);
  return { ok: true };
}

export async function upsertSubmission(params: {
  gameId: number;
  playerId: number;
  content: string;
}): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const { gameId, playerId, content } = params;

  const [player] = await db
    .select()
    .from(reviewPlayerSchema)
    .where(and(eq(reviewPlayerSchema.id, playerId), eq(reviewPlayerSchema.gameId, gameId)))
    .limit(1);
  if (!player || !player.teamId) {
    return { ok: false, error: 'NOT_ON_TEAM', status: 403 };
  }

  const [game] = await db
    .select({ status: reviewGameSchema.status })
    .from(reviewGameSchema)
    .where(eq(reviewGameSchema.id, gameId))
    .limit(1);
  if (!game || game.status !== 'creating') {
    return { ok: false, error: 'NOT_CREATING_PHASE', status: 409 };
  }

  await db
    .insert(reviewSubmissionSchema)
    .values({ teamId: player.teamId, content, lastEditedByPlayerId: playerId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: reviewSubmissionSchema.teamId,
      set: { content, lastEditedByPlayerId: playerId, updatedAt: new Date() },
    });

  await publishTick(gameId);
  return { ok: true };
}

export async function castVote(params: {
  gameId: number;
  playerId: number;
  votedForTeamId: number;
}): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const { gameId, playerId, votedForTeamId } = params;

  const [player] = await db
    .select()
    .from(reviewPlayerSchema)
    .where(and(eq(reviewPlayerSchema.id, playerId), eq(reviewPlayerSchema.gameId, gameId)))
    .limit(1);
  if (!player || !player.teamId) {
    return { ok: false, error: 'NOT_ON_TEAM', status: 403 };
  }
  if (player.teamId === votedForTeamId) {
    return { ok: false, error: 'CANNOT_VOTE_OWN_TEAM', status: 400 };
  }

  const [game] = await db
    .select({ status: reviewGameSchema.status })
    .from(reviewGameSchema)
    .where(eq(reviewGameSchema.id, gameId))
    .limit(1);
  if (!game || game.status !== 'voting') {
    return { ok: false, error: 'NOT_VOTING_PHASE', status: 409 };
  }

  const [targetTeam] = await db
    .select({ id: reviewTeamSchema.id })
    .from(reviewTeamSchema)
    .where(and(eq(reviewTeamSchema.id, votedForTeamId), eq(reviewTeamSchema.gameId, gameId)))
    .limit(1);
  if (!targetTeam) {
    return { ok: false, error: 'TEAM_NOT_FOUND', status: 404 };
  }

  try {
    await db.insert(reviewVoteSchema).values({ gameId, voterTeamId: player.teamId, votedForTeamId });
  } catch {
    return { ok: false, error: 'ALREADY_VOTED', status: 409 };
  }

  await publishTick(gameId);
  return { ok: true };
}
```

- [ ] **Step 2: 型別檢查**

Run: `npm run check-types`
Expected: 無錯誤

- [ ] **Step 3: Commit**

```bash
git add src/services/review/reviewStore.ts
git commit -m "$(cat <<'EOF'
新增協作批閱資料存取層 reviewStore.ts

host/team state 讀取、評分/共創/投票寫入，架構比照 liveStore.ts；
學生端 team-state 絕不回傳老師標準分，只有 results 階段的
resultsDetail 才會揭露。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 老師建立/編輯題組 `reviewSetActions.ts`

**Files:**
- Create: `src/actions/reviewSetActions.ts`

**Interfaces:**
- Consumes: `reviewSetSchema`/`reviewSampleSchema`（Task 1）
- Produces: `createReviewSet(input: ReviewSetInput)`、`updateReviewSet(reviewSetId: number, input: ReviewSetInput)`、`deleteReviewSet(reviewSetId: number)`、`ReviewSetInput` type（Task 15 `ReviewSetEditor.tsx` 會呼叫這三個）

- [ ] **Step 1: 建立完整檔案**

```ts
// src/actions/reviewSetActions.ts
'use server';

import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { reviewSampleSchema, reviewSetSchema } from '@/models/Schema';

const RubricRefSchema = z.object({
  correctness: z.number().int().min(0).max(5),
  completeness: z.number().int().min(0).max(5),
  clarity: z.number().int().min(0).max(5),
  creativity: z.number().int().min(0).max(5),
});

const SampleInputSchema = z.object({
  content: z.string().trim().min(1, '範例答案內容不可為空').max(3000, '範例答案最多 3000 字'),
  ref: RubricRefSchema,
});

const ReviewSetInputSchema = z.object({
  title: z.string().trim().min(1, '請輸入標題').max(100, '標題最多 100 字'),
  topicPrompt: z.string().trim().min(1, '請輸入延伸創作指示').max(1000, '指示最多 1000 字'),
  teamSize: z.number().int().min(2).max(8),
  reviewDurationSec: z.number().int().min(60).max(3600),
  createDurationSec: z.number().int().min(60).max(3600),
  samples: z.array(SampleInputSchema).min(1, '至少要有 1 則範例答案').max(10, '最多 10 則範例答案'),
});
export type ReviewSetInput = z.infer<typeof ReviewSetInputSchema>;

async function verifyOwnership(reviewSetId: number, userId: string) {
  const [row] = await db
    .select({ id: reviewSetSchema.id })
    .from(reviewSetSchema)
    .where(and(eq(reviewSetSchema.id, reviewSetId), eq(reviewSetSchema.ownerId, userId)))
    .limit(1);
  if (!row) {
    throw new Error('找不到題組或沒有權限');
  }
}

export async function createReviewSet(input: ReviewSetInput) {
  const { userId } = await auth();
  if (!userId) {
    return { error: 'Unauthorized' as const };
  }

  const parsed = ReviewSetInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? '資料格式錯誤' };
  }
  const data = parsed.data;

  const reviewSetId = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(reviewSetSchema)
      .values({
        ownerId: userId,
        title: data.title,
        topicPrompt: data.topicPrompt,
        teamSize: data.teamSize,
        reviewDurationSec: data.reviewDurationSec,
        createDurationSec: data.createDurationSec,
      })
      .returning();
    if (!inserted) {
      throw new Error('建立題組失敗');
    }
    await tx.insert(reviewSampleSchema).values(
      data.samples.map((s, i) => ({
        reviewSetId: inserted.id,
        content: s.content,
        orderIndex: i,
        refCorrectness: s.ref.correctness,
        refCompleteness: s.ref.completeness,
        refClarity: s.ref.clarity,
        refCreativity: s.ref.creativity,
      })),
    );
    return inserted.id;
  });

  revalidatePath('/dashboard/review');
  return { ok: true as const, reviewSetId };
}

export async function updateReviewSet(reviewSetId: number, input: ReviewSetInput) {
  const { userId } = await auth();
  if (!userId) {
    return { error: 'Unauthorized' as const };
  }
  await verifyOwnership(reviewSetId, userId);

  const parsed = ReviewSetInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? '資料格式錯誤' };
  }
  const data = parsed.data;

  await db.transaction(async (tx) => {
    await tx
      .update(reviewSetSchema)
      .set({
        title: data.title,
        topicPrompt: data.topicPrompt,
        teamSize: data.teamSize,
        reviewDurationSec: data.reviewDurationSec,
        createDurationSec: data.createDurationSec,
      })
      .where(eq(reviewSetSchema.id, reviewSetId));

    // 範例答案採「整批砍掉重建」而非逐筆 diff：欄位少、老師編輯頻率低，
    // 換取實作簡單遠比省幾條 SQL 划算
    await tx.delete(reviewSampleSchema).where(eq(reviewSampleSchema.reviewSetId, reviewSetId));
    await tx.insert(reviewSampleSchema).values(
      data.samples.map((s, i) => ({
        reviewSetId,
        content: s.content,
        orderIndex: i,
        refCorrectness: s.ref.correctness,
        refCompleteness: s.ref.completeness,
        refClarity: s.ref.clarity,
        refCreativity: s.ref.creativity,
      })),
    );
  });

  revalidatePath('/dashboard/review');
  revalidatePath(`/dashboard/review/${reviewSetId}/edit`);
  return { ok: true as const };
}

export async function deleteReviewSet(reviewSetId: number) {
  const { userId } = await auth();
  if (!userId) {
    return { error: 'Unauthorized' as const };
  }
  await verifyOwnership(reviewSetId, userId);

  // review_sample / review_game 系列表都設了 onDelete: 'cascade'，刪這筆就夠了
  await db.delete(reviewSetSchema).where(eq(reviewSetSchema.id, reviewSetId));

  revalidatePath('/dashboard/review');
  return { ok: true as const };
}
```

- [ ] **Step 2: 型別檢查**

Run: `npm run check-types`
Expected: 無錯誤

- [ ] **Step 3: Commit**

```bash
git add src/actions/reviewSetActions.ts
git commit -m "$(cat <<'EOF'
新增協作批閱題組建立/編輯/刪除 Server Actions

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: 場次流程控制 `reviewActions.ts`

**Files:**
- Create: `src/actions/reviewActions.ts`

**Interfaces:**
- Consumes: schema（Task 1）、`assignTeamsRoundRobin`（Task 2）、`calcAccuracyScore`/`calcSpeedBonus`/`calcVoteBonus`/`calcTeamTotalScore`/`distributeAccuracyPoints`（Task 3）、`getReviewSamples`（Task 6）、`publishTick`（Task 5）
- Produces: `createReviewGame`、`startTeamForming`、`startReviewing`、`startCreating`、`startVoting`、`finishGame`、`endGame`（Task 16 `useReviewHostGame` hook 會呼叫全部 7 個）

**重要邊界**：所有階段轉換都是老師手動觸發（見 plan 開頭「資料流總覽」），這裡**不做**伺服器端自動推進計時器——`phaseDurationSec` 只是寫進 DB 給前端算倒數用。

- [ ] **Step 1: 建立完整檔案**

```ts
// src/actions/reviewActions.ts
'use server';

import { auth } from '@clerk/nextjs/server';
import { and, count, eq, inArray } from 'drizzle-orm';

import { db } from '@/libs/DB';
import {
  reviewGameSchema,
  reviewPlayerSchema,
  reviewScoreSchema,
  reviewSetSchema,
  reviewTeamSchema,
  reviewVoteSchema,
} from '@/models/Schema';
import { publishTick } from '@/services/review/ablyServer';
import {
  calcAccuracyScore,
  calcSpeedBonus,
  calcTeamTotalScore,
  calcVoteBonus,
  distributeAccuracyPoints,
} from '@/services/review/scoring';
import type { RubricScores } from '@/services/review/scoring';
import { assignTeamsRoundRobin } from '@/services/review/teamAssignment';
import { getReviewSamples } from '@/services/review/reviewStore';

// 生成 6 碼大寫英數 game pin（與 liveActions.ts 同邏輯）
function generatePin(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function generateUniquePin(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const pin = generatePin();
    const [existing] = await db
      .select({ id: reviewGameSchema.id })
      .from(reviewGameSchema)
      .where(eq(reviewGameSchema.gamePin, pin))
      .limit(1);
    if (!existing) {
      return pin;
    }
  }
  return generatePin() + Math.random().toString(36).slice(2, 3).toUpperCase();
}

async function loadOwnedReviewGame(gameId: number, userId: string) {
  const [game] = await db
    .select()
    .from(reviewGameSchema)
    .where(and(eq(reviewGameSchema.id, gameId), eq(reviewGameSchema.hostUserId, userId)))
    .limit(1);
  return game ?? null;
}

export async function createReviewGame(reviewSetId: number) {
  const { userId } = await auth();
  if (!userId) {
    return { error: 'Unauthorized' as const };
  }

  const [reviewSet] = await db
    .select()
    .from(reviewSetSchema)
    .where(and(eq(reviewSetSchema.id, reviewSetId), eq(reviewSetSchema.ownerId, userId)))
    .limit(1);
  if (!reviewSet) {
    return { error: '找不到題組或沒有權限' };
  }

  const samples = await getReviewSamples(reviewSetId);
  if (samples.length === 0) {
    return { error: '這個題組還沒有範例答案，請先編輯新增' };
  }

  const gamePin = await generateUniquePin();
  const [inserted] = await db
    .insert(reviewGameSchema)
    .values({ reviewSetId, hostUserId: userId, gamePin })
    .returning();
  if (!inserted) {
    return { error: '建立場次失敗' };
  }

  return { ok: true as const, gameId: inserted.id, gamePin: inserted.gamePin };
}

export async function startTeamForming(gameId: number) {
  const { userId } = await auth();
  if (!userId) {
    return { error: 'Unauthorized' as const };
  }
  const game = await loadOwnedReviewGame(gameId, userId);
  if (!game) {
    return { error: 'GAME_NOT_FOUND' };
  }
  if (game.status !== 'lobby') {
    return { error: 'ALREADY_STARTED' };
  }

  const [reviewSet] = await db
    .select({ teamSize: reviewSetSchema.teamSize })
    .from(reviewSetSchema)
    .where(eq(reviewSetSchema.id, game.reviewSetId))
    .limit(1);
  if (!reviewSet) {
    return { error: 'REVIEW_SET_NOT_FOUND' };
  }

  const players = await db
    .select({ id: reviewPlayerSchema.id })
    .from(reviewPlayerSchema)
    .where(eq(reviewPlayerSchema.gameId, gameId));
  if (players.length === 0) {
    return { error: 'NO_PLAYERS' };
  }

  const teamGroups = assignTeamsRoundRobin(players.map(p => p.id), reviewSet.teamSize);

  await db.transaction(async (tx) => {
    for (const [i, memberIds] of teamGroups.entries()) {
      const [team] = await tx
        .insert(reviewTeamSchema)
        .values({ gameId, teamName: `第 ${i + 1} 組` })
        .returning();
      if (!team) {
        continue;
      }
      await tx
        .update(reviewPlayerSchema)
        .set({ teamId: team.id })
        .where(inArray(reviewPlayerSchema.id, memberIds));
    }
    await tx
      .update(reviewGameSchema)
      .set({ status: 'team_forming' })
      .where(eq(reviewGameSchema.id, gameId));
  });

  await publishTick(gameId);
  return { ok: true as const };
}

export async function startReviewing(gameId: number) {
  const { userId } = await auth();
  if (!userId) {
    return { error: 'Unauthorized' as const };
  }
  const game = await loadOwnedReviewGame(gameId, userId);
  if (!game) {
    return { error: 'GAME_NOT_FOUND' };
  }
  if (game.status !== 'team_forming') {
    return { error: 'WRONG_PHASE' };
  }

  const [reviewSet] = await db
    .select({ reviewDurationSec: reviewSetSchema.reviewDurationSec })
    .from(reviewSetSchema)
    .where(eq(reviewSetSchema.id, game.reviewSetId))
    .limit(1);
  if (!reviewSet) {
    return { error: 'REVIEW_SET_NOT_FOUND' };
  }

  const now = new Date();
  await db
    .update(reviewGameSchema)
    .set({
      status: 'reviewing',
      phaseStartedAt: now,
      phaseDurationSec: reviewSet.reviewDurationSec,
      reviewingStartedAt: now,
    })
    .where(eq(reviewGameSchema.id, gameId));

  await publishTick(gameId);
  return { ok: true as const };
}

export async function startCreating(gameId: number) {
  const { userId } = await auth();
  if (!userId) {
    return { error: 'Unauthorized' as const };
  }
  const game = await loadOwnedReviewGame(gameId, userId);
  if (!game) {
    return { error: 'GAME_NOT_FOUND' };
  }
  if (game.status !== 'reviewing') {
    return { error: 'WRONG_PHASE' };
  }

  const [reviewSet] = await db
    .select({ createDurationSec: reviewSetSchema.createDurationSec })
    .from(reviewSetSchema)
    .where(eq(reviewSetSchema.id, game.reviewSetId))
    .limit(1);
  if (!reviewSet) {
    return { error: 'REVIEW_SET_NOT_FOUND' };
  }

  const now = new Date();
  await db
    .update(reviewGameSchema)
    .set({
      status: 'creating',
      phaseStartedAt: now,
      phaseDurationSec: reviewSet.createDurationSec,
      reviewingEndedAt: now, // 關閉 reviewing 時間窗，供速度加成計算
    })
    .where(eq(reviewGameSchema.id, gameId));

  await publishTick(gameId);
  return { ok: true as const };
}

export async function startVoting(gameId: number) {
  const { userId } = await auth();
  if (!userId) {
    return { error: 'Unauthorized' as const };
  }
  const game = await loadOwnedReviewGame(gameId, userId);
  if (!game) {
    return { error: 'GAME_NOT_FOUND' };
  }
  if (game.status !== 'creating') {
    return { error: 'WRONG_PHASE' };
  }

  await db
    .update(reviewGameSchema)
    .set({ status: 'voting', phaseStartedAt: null, phaseDurationSec: null })
    .where(eq(reviewGameSchema.id, gameId));

  await publishTick(gameId);
  return { ok: true as const };
}

export async function finishGame(gameId: number) {
  const { userId } = await auth();
  if (!userId) {
    return { error: 'Unauthorized' as const };
  }
  const game = await loadOwnedReviewGame(gameId, userId);
  if (!game) {
    return { error: 'GAME_NOT_FOUND' };
  }
  if (game.status !== 'voting') {
    return { error: 'WRONG_PHASE' };
  }

  const samples = await getReviewSamples(game.reviewSetId);
  const accuracyPoints = distributeAccuracyPoints(samples.length);
  const teams = await db.select().from(reviewTeamSchema).where(eq(reviewTeamSchema.gameId, gameId));

  await db.transaction(async (tx) => {
    for (const team of teams) {
      const members = await tx
        .select({ id: reviewPlayerSchema.id })
        .from(reviewPlayerSchema)
        .where(eq(reviewPlayerSchema.teamId, team.id));
      const scores = await tx
        .select()
        .from(reviewScoreSchema)
        .where(eq(reviewScoreSchema.teamId, team.id));

      let accuracyTotal = 0;
      for (const [i, sample] of samples.entries()) {
        const sampleScores = scores.filter(s => s.sampleId === sample.id);
        if (sampleScores.length === 0) {
          continue;
        }
        const avg: RubricScores = {
          correctness: sampleScores.reduce((a, s) => a + s.correctness, 0) / sampleScores.length,
          completeness: sampleScores.reduce((a, s) => a + s.completeness, 0) / sampleScores.length,
          clarity: sampleScores.reduce((a, s) => a + s.clarity, 0) / sampleScores.length,
          creativity: sampleScores.reduce((a, s) => a + s.creativity, 0) / sampleScores.length,
        };
        const ref: RubricScores = {
          correctness: sample.refCorrectness,
          completeness: sample.refCompleteness,
          clarity: sample.refClarity,
          creativity: sample.refCreativity,
        };
        accuracyTotal += calcAccuracyScore(avg, ref, accuracyPoints[i]!);
      }

      // 速度加成：全員對全部範例答案都交齊才算「該組完成」
      const fullyCompleted
        = members.length > 0 && samples.length > 0 && scores.length >= members.length * samples.length;
      let speedBonus = 0;
      if (fullyCompleted && game.reviewingStartedAt && game.reviewingEndedAt && scores.length > 0) {
        const lastSubmittedAt = scores.reduce(
          (max, s) => (s.submittedAt > max ? s.submittedAt : max),
          scores[0]!.submittedAt,
        );
        const elapsedSec = (lastSubmittedAt.getTime() - game.reviewingStartedAt.getTime()) / 1000;
        const totalDurationSec = (game.reviewingEndedAt.getTime() - game.reviewingStartedAt.getTime()) / 1000;
        speedBonus = calcSpeedBonus(elapsedSec, totalDurationSec);
      }

      const [{ value: votesReceived }] = await tx
        .select({ value: count() })
        .from(reviewVoteSchema)
        .where(eq(reviewVoteSchema.votedForTeamId, team.id));
      const voteBonus = calcVoteBonus(votesReceived);

      const total = calcTeamTotalScore({
        accuracyScores: [accuracyTotal],
        speedBonus,
        voteBonus,
      });

      await tx
        .update(reviewTeamSchema)
        .set({ accuracyScore: accuracyTotal, speedBonus, voteBonus, score: total })
        .where(eq(reviewTeamSchema.id, team.id));
    }

    await tx.update(reviewGameSchema).set({ status: 'results' }).where(eq(reviewGameSchema.id, gameId));
  });

  await publishTick(gameId);
  return { ok: true as const };
}

export async function endGame(gameId: number) {
  const { userId } = await auth();
  if (!userId) {
    return { error: 'Unauthorized' as const };
  }
  const game = await loadOwnedReviewGame(gameId, userId);
  if (!game) {
    return { error: 'GAME_NOT_FOUND' };
  }

  await db
    .update(reviewGameSchema)
    .set({ status: 'ended', endedAt: new Date() })
    .where(eq(reviewGameSchema.id, gameId));

  await publishTick(gameId);
  return { ok: true as const };
}
```

- [ ] **Step 2: 型別檢查**

Run: `npm run check-types`
Expected: 無錯誤

- [ ] **Step 3: Commit**

```bash
git add src/actions/reviewActions.ts
git commit -m "$(cat <<'EOF'
新增協作批閱場次流程控制 Server Actions

lobby/team_forming/reviewing/creating/voting/results/ended 七段狀態
機，全部由老師手動觸發；finishGame 結算三段式分數並寫回 review_team。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Middleware 白名單 + `ably-auth` Route

**Files:**
- Modify: `src/middleware.ts`
- Create: `src/app/api/review/ably-auth/route.ts`

**Interfaces:**
- Consumes: `createAblyTokenRequest`/`isAblyEnabled`（Task 5）、`verifyPlayerToken`（Task 6）、`reviewGameSchema`（Task 1）

- [ ] **Step 1: 修改 `src/middleware.ts` 的 `isPublicApiRoute`**

在 L42-48（Live Mode 的三條白名單）之後加入協作批閱的學生端點：

```ts
  // Live Mode：學生加入、輪詢狀態、提交答案（皆以 playerToken 驗證）
  '/api/live/join',
  '/:locale/api/live/join',
  '/api/live/(.*)/player-state',
  '/:locale/api/live/(.*)/player-state',
  '/api/live/(.*)/answer',
  '/:locale/api/live/(.*)/answer',
  // 協作批閱：學生加入、輪詢組狀態、評分/共創/投票/心跳（皆以 playerToken 驗證）
  '/api/review/join',
  '/:locale/api/review/join',
  '/api/review/(.*)/team-state',
  '/:locale/api/review/(.*)/team-state',
  '/api/review/(.*)/score',
  '/:locale/api/review/(.*)/score',
  '/api/review/(.*)/submission',
  '/:locale/api/review/(.*)/submission',
  '/api/review/(.*)/vote',
  '/:locale/api/review/(.*)/vote',
  '/api/review/(.*)/heartbeat',
  '/:locale/api/review/(.*)/heartbeat',
```

- [ ] **Step 2: 修改 `isOptionalAuthRoute`**

```ts
const isOptionalAuthRoute = createRouteMatcher([
  '/api/live/ably-auth',
  '/:locale/api/live/ably-auth',
  '/api/review/ably-auth',
  '/:locale/api/review/ably-auth',
]);
```

- [ ] **Step 3: 建立 `ably-auth` route**

```ts
// src/app/api/review/ably-auth/route.ts
// 協作批閱 Ably token 端點：host 角色驗 Clerk userId，player 角色驗 playerToken
import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { reviewGameSchema } from '@/models/Schema';
import { createAblyTokenRequest, isAblyEnabled } from '@/services/review/ablyServer';
import { verifyPlayerToken } from '@/services/review/reviewStore';

export const runtime = 'nodejs';

const HostQuery = z.object({
  role: z.literal('host'),
  gameId: z.string().regex(/^\d+$/),
});

const PlayerQuery = z.object({
  role: z.literal('player'),
  gameId: z.string().regex(/^\d+$/),
  playerId: z.string().regex(/^\d+$/),
  playerToken: z.string().min(1),
});

export async function GET(request: Request) {
  if (!isAblyEnabled()) {
    return NextResponse.json({ error: 'Ably 未啟用（ABLY_API_KEY 未設定）' }, { status: 503 });
  }

  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());

  if (params.role === 'host') {
    const parsed = HostQuery.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }
    const gameId = Number(parsed.data.gameId);
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }
    const [game] = await db
      .select({ hostUserId: reviewGameSchema.hostUserId })
      .from(reviewGameSchema)
      .where(eq(reviewGameSchema.id, gameId))
      .limit(1);
    if (!game || game.hostUserId !== userId) {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }
    const tokenRequest = await createAblyTokenRequest({ gameId, clientId: `host:${userId}:${gameId}` });
    return NextResponse.json(tokenRequest);
  }

  if (params.role === 'player') {
    const parsed = PlayerQuery.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }
    const gameId = Number(parsed.data.gameId);
    const playerId = Number(parsed.data.playerId);
    const verified = await verifyPlayerToken(gameId, parsed.data.playerToken);
    if (!verified || verified.playerId !== playerId) {
      return NextResponse.json({ error: '身分驗證失敗' }, { status: 403 });
    }
    const tokenRequest = await createAblyTokenRequest({ gameId, clientId: `player:${gameId}:${playerId}` });
    return NextResponse.json(tokenRequest);
  }

  return NextResponse.json({ error: 'role 必須為 host 或 player' }, { status: 400 });
}
```

- [ ] **Step 4: 型別檢查**

Run: `npm run check-types`
Expected: 無錯誤

- [ ] **Step 5: Commit**

```bash
git add src/middleware.ts src/app/api/review/ably-auth/route.ts
git commit -m "$(cat <<'EOF'
新增協作批閱 middleware 白名單與 Ably token 端點

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: `POST /api/review/join`

**Files:**
- Create: `src/app/api/review/join/route.ts`

**Interfaces:**
- Consumes: `findGameByPin`/`isNicknameTaken`（Task 6）、`publishTick`（Task 5）

- [ ] **Step 1: 建立檔案**

```ts
// src/app/api/review/join/route.ts
import { nanoid } from 'nanoid';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { reviewPlayerSchema } from '@/models/Schema';
import { publishTick } from '@/services/review/ablyServer';
import { findGameByPin, isNicknameTaken } from '@/services/review/reviewStore';

export const runtime = 'nodejs';

const BodySchema = z.object({
  pin: z.string().trim().toUpperCase().length(6, '房間碼需 6 碼'),
  nickname: z.string().trim().min(1, '請輸入暱稱').max(30, '暱稱最多 30 字'),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? '資料格式錯誤' }, { status: 400 });
  }

  const game = await findGameByPin(parsed.data.pin);
  if (!game) {
    return NextResponse.json({ error: '找不到這個活動，請確認房間碼' }, { status: 404 });
  }
  if (game.status !== 'lobby') {
    return NextResponse.json({ error: '活動已開始，請等待老師開新場次' }, { status: 403 });
  }

  if (await isNicknameTaken(game.id, parsed.data.nickname)) {
    return NextResponse.json({ error: '這個暱稱已被使用' }, { status: 409 });
  }

  const playerToken = nanoid(32);
  try {
    const [inserted] = await db
      .insert(reviewPlayerSchema)
      .values({ gameId: game.id, nickname: parsed.data.nickname, playerToken })
      .returning();
    if (!inserted) {
      return NextResponse.json({ error: '加入失敗，請重試' }, { status: 500 });
    }

    await publishTick(game.id);

    return NextResponse.json({ gameId: game.id, playerId: inserted.id, playerToken });
  } catch {
    return NextResponse.json({ error: '這個暱稱已被使用' }, { status: 409 });
  }
}
```

- [ ] **Step 2: 型別檢查**

Run: `npm run check-types`
Expected: 無錯誤

- [ ] **Step 3: 手動驗證**

Run: `npm run dev`，另開終端機：

```bash
curl -X POST http://localhost:3000/api/review/join \
  -H "Content-Type: application/json" \
  -d '{"pin":"ABCDEF","nickname":"測試學生"}'
```

Expected: 因為 `ABCDEF` 這個 pin 還不存在，回傳 `{"error":"找不到這個活動，請確認房間碼"}`，HTTP 404（先確認端點本身能正常回應，完整流程留到 Task 17 用真實建立的場次驗證）

- [ ] **Step 4: Commit**

```bash
git add src/app/api/review/join/route.ts
git commit -m "$(cat <<'EOF'
新增協作批閱學生加入端點

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: `GET /api/review/[gameId]/host-state`

**Files:**
- Create: `src/app/api/review/[gameId]/host-state/route.ts`

**Interfaces:**
- Consumes: `getHostState`（Task 6）

- [ ] **Step 1: 建立檔案**

```ts
// src/app/api/review/[gameId]/host-state/route.ts
import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { reviewGameSchema } from '@/models/Schema';
import { getHostState } from '@/services/review/reviewStore';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: { gameId: string } },
) {
  const gameId = Number(params.gameId);
  if (!Number.isFinite(gameId) || gameId <= 0) {
    return NextResponse.json({ error: 'Bad gameId' }, { status: 400 });
  }

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [game] = await db
    .select({ hostUserId: reviewGameSchema.hostUserId })
    .from(reviewGameSchema)
    .where(eq(reviewGameSchema.id, gameId))
    .limit(1);
  if (!game) {
    return NextResponse.json({ error: '找不到這個活動' }, { status: 404 });
  }
  if (game.hostUserId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const state = await getHostState(gameId);
  if (!state) {
    return NextResponse.json({ error: '找不到這個活動' }, { status: 404 });
  }

  return NextResponse.json(state);
}
```

- [ ] **Step 2: 型別檢查**

Run: `npm run check-types`
Expected: 無錯誤

- [ ] **Step 3: Commit**

```bash
git add src/app/api/review/[gameId]/host-state/route.ts
git commit -m "$(cat <<'EOF'
新增協作批閱老師主控台 state 端點

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: `GET /api/review/[gameId]/team-state`

**Files:**
- Create: `src/app/api/review/[gameId]/team-state/route.ts`

**Interfaces:**
- Consumes: `getTeamState`/`verifyPlayerToken`（Task 6）

- [ ] **Step 1: 建立檔案**

```ts
// src/app/api/review/[gameId]/team-state/route.ts
import { NextResponse } from 'next/server';

import { getTeamState, verifyPlayerToken } from '@/services/review/reviewStore';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: { gameId: string } },
) {
  const gameId = Number(params.gameId);
  if (!Number.isFinite(gameId) || gameId <= 0) {
    return NextResponse.json({ error: 'Bad gameId' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const playerId = Number(searchParams.get('playerId') ?? '');
  const token = searchParams.get('token') ?? '';
  if (!Number.isFinite(playerId) || playerId <= 0 || !token) {
    return NextResponse.json({ error: '缺少身分資訊' }, { status: 400 });
  }

  const verified = await verifyPlayerToken(gameId, token);
  if (!verified || verified.playerId !== playerId) {
    return NextResponse.json({ error: '身分驗證失敗' }, { status: 401 });
  }

  const state = await getTeamState(gameId, playerId);
  if (!state) {
    return NextResponse.json({ error: '找不到這個活動' }, { status: 404 });
  }

  return NextResponse.json(state);
}
```

- [ ] **Step 2: 型別檢查**

Run: `npm run check-types`
Expected: 無錯誤

- [ ] **Step 3: Commit**

```bash
git add src/app/api/review/[gameId]/team-state/route.ts
git commit -m "$(cat <<'EOF'
新增協作批閱學生小組 state 端點

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: 學生寫入端點（score / submission / vote / heartbeat）

**Files:**
- Create: `src/app/api/review/[gameId]/score/route.ts`
- Create: `src/app/api/review/[gameId]/submission/route.ts`
- Create: `src/app/api/review/[gameId]/vote/route.ts`
- Create: `src/app/api/review/[gameId]/heartbeat/route.ts`

**Interfaces:**
- Consumes: `verifyPlayerToken`/`upsertScore`/`upsertSubmission`/`castVote`（Task 6）

- [ ] **Step 1: 建立 `score/route.ts`**

```ts
// src/app/api/review/[gameId]/score/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { upsertScore, verifyPlayerToken } from '@/services/review/reviewStore';

export const runtime = 'nodejs';

const BodySchema = z.object({
  playerId: z.number().int().positive(),
  playerToken: z.string().min(1),
  sampleId: z.number().int().positive(),
  correctness: z.number().int().min(0).max(5),
  completeness: z.number().int().min(0).max(5),
  clarity: z.number().int().min(0).max(5),
  creativity: z.number().int().min(0).max(5),
  comment: z.string().trim().max(200, '短評最多 200 字').nullable().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: { gameId: string } },
) {
  const gameId = Number(params.gameId);
  if (!Number.isFinite(gameId) || gameId <= 0) {
    return NextResponse.json({ error: 'Bad gameId' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? '資料格式錯誤' }, { status: 400 });
  }

  const verified = await verifyPlayerToken(gameId, parsed.data.playerToken);
  if (!verified || verified.playerId !== parsed.data.playerId) {
    return NextResponse.json({ error: '身分驗證失敗' }, { status: 401 });
  }

  const result = await upsertScore({
    gameId,
    playerId: parsed.data.playerId,
    sampleId: parsed.data.sampleId,
    scores: {
      correctness: parsed.data.correctness,
      completeness: parsed.data.completeness,
      clarity: parsed.data.clarity,
      creativity: parsed.data.creativity,
    },
    comment: parsed.data.comment ?? null,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: 建立 `submission/route.ts`**

```ts
// src/app/api/review/[gameId]/submission/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { upsertSubmission, verifyPlayerToken } from '@/services/review/reviewStore';

export const runtime = 'nodejs';

const BodySchema = z.object({
  playerId: z.number().int().positive(),
  playerToken: z.string().min(1),
  content: z.string().trim().max(2000, '創作答案最多 2000 字'),
});

export async function POST(
  request: Request,
  { params }: { params: { gameId: string } },
) {
  const gameId = Number(params.gameId);
  if (!Number.isFinite(gameId) || gameId <= 0) {
    return NextResponse.json({ error: 'Bad gameId' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? '資料格式錯誤' }, { status: 400 });
  }

  const verified = await verifyPlayerToken(gameId, parsed.data.playerToken);
  if (!verified || verified.playerId !== parsed.data.playerId) {
    return NextResponse.json({ error: '身分驗證失敗' }, { status: 401 });
  }

  const result = await upsertSubmission({
    gameId,
    playerId: parsed.data.playerId,
    content: parsed.data.content,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: 建立 `vote/route.ts`**

```ts
// src/app/api/review/[gameId]/vote/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { castVote, verifyPlayerToken } from '@/services/review/reviewStore';

export const runtime = 'nodejs';

const BodySchema = z.object({
  playerId: z.number().int().positive(),
  playerToken: z.string().min(1),
  votedForTeamId: z.number().int().positive(),
});

export async function POST(
  request: Request,
  { params }: { params: { gameId: string } },
) {
  const gameId = Number(params.gameId);
  if (!Number.isFinite(gameId) || gameId <= 0) {
    return NextResponse.json({ error: 'Bad gameId' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? '資料格式錯誤' }, { status: 400 });
  }

  const verified = await verifyPlayerToken(gameId, parsed.data.playerToken);
  if (!verified || verified.playerId !== parsed.data.playerId) {
    return NextResponse.json({ error: '身分驗證失敗' }, { status: 401 });
  }

  const result = await castVote({
    gameId,
    playerId: parsed.data.playerId,
    votedForTeamId: parsed.data.votedForTeamId,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: 建立 `heartbeat/route.ts`**

```ts
// src/app/api/review/[gameId]/heartbeat/route.ts
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { reviewPlayerSchema } from '@/models/Schema';

export const runtime = 'nodejs';

// 學生端每 5s 打一次，更新 review_player.last_seen_at（跟 Live Mode heartbeat 同款）
export async function POST(
  request: Request,
  { params }: { params: { gameId: string } },
) {
  const playerToken = request.headers.get('x-player-token');
  if (!playerToken) {
    return NextResponse.json({ error: 'missing_token' }, { status: 401 });
  }

  const gameId = Number(params.gameId);
  if (!Number.isFinite(gameId) || gameId <= 0) {
    return NextResponse.json({ error: 'invalid_game' }, { status: 400 });
  }

  const result = await db
    .update(reviewPlayerSchema)
    .set({ lastSeenAt: new Date() })
    .where(and(eq(reviewPlayerSchema.gameId, gameId), eq(reviewPlayerSchema.playerToken, playerToken)))
    .returning();

  if (result.length === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: 型別檢查**

Run: `npm run check-types`
Expected: 無錯誤

- [ ] **Step 6: Commit**

```bash
git add src/app/api/review/[gameId]/score/route.ts src/app/api/review/[gameId]/submission/route.ts src/app/api/review/[gameId]/vote/route.ts src/app/api/review/[gameId]/heartbeat/route.ts
git commit -m "$(cat <<'EOF'
新增協作批閱學生端評分/共創/投票/心跳端點

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: 成果 CSV 匯出

**Files:**
- Create: `src/app/api/review/[gameId]/export-csv/route.ts`

**Interfaces:**
- Consumes: `getHostState`（Task 6，需 `resultsDetail`）

- [ ] **Step 1: 建立檔案**

```ts
// src/app/api/review/[gameId]/export-csv/route.ts
import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { reviewGameSchema } from '@/models/Schema';
import { getHostState } from '@/services/review/reviewStore';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: { gameId: string } },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  const gameId = Number(params.gameId);
  if (!Number.isFinite(gameId) || gameId <= 0) {
    return NextResponse.json({ error: '無效的活動 ID' }, { status: 400 });
  }

  const [game] = await db
    .select({ hostUserId: reviewGameSchema.hostUserId })
    .from(reviewGameSchema)
    .where(eq(reviewGameSchema.id, gameId))
    .limit(1);
  if (!game || game.hostUserId !== userId) {
    return NextResponse.json({ error: '找不到活動或無權限' }, { status: 404 });
  }

  const state = await getHostState(gameId);
  if (!state || !state.resultsDetail) {
    return NextResponse.json({ error: '活動尚未結算，無法匯出' }, { status: 409 });
  }

  const header = ['組別', '總分', '準確度分', '速度加成', '投票加成', '收到票數', '創作答案'];
  const rows = state.resultsDetail.map((detail) => {
    const team = state.teams.find(t => t.id === detail.teamId);
    return [
      team?.teamName ?? `組別 ${detail.teamId}`,
      String(team?.score ?? 0),
      String(detail.accuracyScore),
      String(detail.speedBonus),
      String(detail.voteBonus),
      String(detail.votesReceived),
      detail.submission ?? '（未提交）',
    ];
  });

  const csvContent = [header, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const bom = '﻿';
  const filename = `協作批閱_${gameId}_成績.csv`;

  return new Response(bom + csvContent, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
```

- [ ] **Step 2: 型別檢查**

Run: `npm run check-types`
Expected: 無錯誤

- [ ] **Step 3: Commit**

```bash
git add src/app/api/review/[gameId]/export-csv/route.ts
git commit -m "$(cat <<'EOF'
新增協作批閱成果 CSV 匯出端點

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Client Hooks

**Files:**
- Create: `src/services/review/reviewPlayerSession.ts`
- Create: `src/hooks/useReviewHeartbeat.ts`
- Create: `src/hooks/useReviewHostGame.ts`
- Create: `src/hooks/useReviewTeamGame.ts`

**Interfaces:**
- Consumes: `reviewRealtime`（Task 5）、`ReviewHostState`/`ReviewTeamState`（Task 4）、`startTeamForming`/`startReviewing`/`startCreating`/`startVoting`/`finishGame`/`endGame`（Task 8）
- Produces: `savePlayerSession`/`loadPlayerSession`、`useReviewHeartbeat(gameId, playerToken, enabled)`、`useReviewHostGame(gameId)`、`useReviewTeamGame(gameId, playerId, playerToken)`（Task 16、17 的 Room 容器元件都依賴這些）

- [ ] **Step 1: 建立 `reviewPlayerSession.ts`**

```ts
// src/services/review/reviewPlayerSession.ts
// 學生本機身分持久化：playerId + playerToken 存在 localStorage
// key 格式：review_player_<gameId>

const KEY = (gameId: number) => `review_player_${gameId}`;

export function savePlayerSession(gameId: number, playerId: number, playerToken: string) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(KEY(gameId), JSON.stringify({ playerId, playerToken }));
}

export function loadPlayerSession(
  gameId: number,
): { playerId: number; playerToken: string } | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const raw = window.localStorage.getItem(KEY(gameId));
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { playerId: number; playerToken: string };
    if (parsed.playerId && parsed.playerToken) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: 建立 `useReviewHeartbeat.ts`**

```ts
// src/hooks/useReviewHeartbeat.ts
'use client';

import { useEffect } from 'react';

const HEARTBEAT_INTERVAL_MS = 5 * 1000;

export function useReviewHeartbeat(gameId: number, playerToken: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    const tick = async () => {
      if (cancelled) {
        return;
      }
      try {
        await fetch(`/api/review/${gameId}/heartbeat`, {
          method: 'POST',
          headers: { 'x-player-token': playerToken },
        });
      } catch {
        // 網路 fail 吞掉；下次 tick 自動重試
      }
    };
    tick();
    const id = setInterval(tick, HEARTBEAT_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [gameId, playerToken, enabled]);
}
```

- [ ] **Step 3: 建立 `useReviewHostGame.ts`**

```ts
// src/hooks/useReviewHostGame.ts
'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  endGame as endGameAction,
  finishGame as finishGameAction,
  startCreating as startCreatingAction,
  startReviewing as startReviewingAction,
  startTeamForming as startTeamFormingAction,
  startVoting as startVotingAction,
} from '@/actions/reviewActions';
import { reviewRealtime } from '@/services/review/realtimeAdapter';
import type { ReviewHostState } from '@/services/review/types';

export function useReviewHostGame(gameId: number) {
  const [state, setState] = useState<ReviewHostState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const unsub = reviewRealtime.subscribeHostState(
      gameId,
      (s) => {
        setState(s);
        setError(null);
      },
      {
        intervalMs: 1500,
        onError: (err) => {
          setError(err instanceof Error ? err.message : 'network error');
        },
      },
    );
    return unsub;
  }, [gameId]);

  const runAction = useCallback(async <T>(fn: () => Promise<T>): Promise<T> => {
    setPending(true);
    try {
      return await fn();
    } finally {
      setPending(false);
    }
  }, []);

  const startTeamForming = useCallback(
    () => runAction(() => startTeamFormingAction(gameId)),
    [gameId, runAction],
  );
  const startReviewing = useCallback(
    () => runAction(() => startReviewingAction(gameId)),
    [gameId, runAction],
  );
  const startCreating = useCallback(
    () => runAction(() => startCreatingAction(gameId)),
    [gameId, runAction],
  );
  const startVoting = useCallback(
    () => runAction(() => startVotingAction(gameId)),
    [gameId, runAction],
  );
  const finish = useCallback(
    () => runAction(() => finishGameAction(gameId)),
    [gameId, runAction],
  );
  const end = useCallback(
    () => runAction(() => endGameAction(gameId)),
    [gameId, runAction],
  );

  return {
    state,
    error,
    pending,
    actions: { startTeamForming, startReviewing, startCreating, startVoting, finish, end },
  };
}
```

- [ ] **Step 4: 建立 `useReviewTeamGame.ts`**

```ts
// src/hooks/useReviewTeamGame.ts
'use client';

import { useCallback, useEffect, useState } from 'react';

import { reviewRealtime } from '@/services/review/realtimeAdapter';
import type { RubricScores } from '@/services/review/scoring';
import type { ReviewTeamState } from '@/services/review/types';

type ActionResult = { ok: true } | { ok: false; error: string };

async function postJson(url: string, body: unknown): Promise<ActionResult> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'network error' };
  }
}

export function useReviewTeamGame(gameId: number, playerId: number, playerToken: string) {
  const [state, setState] = useState<ReviewTeamState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [, setConsecutiveFailures] = useState(0);
  const [isReconnecting, setIsReconnecting] = useState(false);

  useEffect(() => {
    if (!gameId || !playerId || !playerToken) {
      return;
    }
    const unsub = reviewRealtime.subscribeTeamState(
      gameId,
      playerId,
      playerToken,
      (s) => {
        setState(s);
        setError(null);
        setConsecutiveFailures(0);
        setIsReconnecting(false);
      },
      {
        intervalMs: 2000,
        onError: (err) => {
          setError(err instanceof Error ? err.message : 'network error');
          setConsecutiveFailures((c) => {
            const next = c + 1;
            if (next >= 2) {
              setIsReconnecting(true);
            }
            return next;
          });
        },
      },
    );
    return unsub;
  }, [gameId, playerId, playerToken]);

  const submitScore = useCallback(
    async (sampleId: number, scores: RubricScores, comment: string | null): Promise<ActionResult> => {
      setSubmitting(true);
      try {
        return await postJson(`/api/review/${gameId}/score`, {
          playerId,
          playerToken,
          sampleId,
          ...scores,
          comment,
        });
      } finally {
        setSubmitting(false);
      }
    },
    [gameId, playerId, playerToken],
  );

  const submitSubmission = useCallback(
    async (content: string): Promise<ActionResult> => {
      setSubmitting(true);
      try {
        return await postJson(`/api/review/${gameId}/submission`, { playerId, playerToken, content });
      } finally {
        setSubmitting(false);
      }
    },
    [gameId, playerId, playerToken],
  );

  const submitVote = useCallback(
    async (votedForTeamId: number): Promise<ActionResult> => {
      setSubmitting(true);
      try {
        return await postJson(`/api/review/${gameId}/vote`, { playerId, playerToken, votedForTeamId });
      } finally {
        setSubmitting(false);
      }
    },
    [gameId, playerId, playerToken],
  );

  return { state, error, submitting, isReconnecting, submitScore, submitSubmission, submitVote };
}
```

- [ ] **Step 5: 型別檢查**

Run: `npm run check-types`
Expected: 無錯誤

- [ ] **Step 6: Commit**

```bash
git add src/services/review/reviewPlayerSession.ts src/hooks/useReviewHeartbeat.ts src/hooks/useReviewHostGame.ts src/hooks/useReviewTeamGame.ts
git commit -m "$(cat <<'EOF'
新增協作批閱前端 hooks

老師端 useReviewHostGame、學生端 useReviewTeamGame + 心跳，架構比照
既有 Live Mode hooks。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: 老師端 UI（建立題組 + 主控台 + 成果報表）

**Files:**
- Create: `src/features/review/ReviewSetEditor.tsx`
- Create: `src/app/[locale]/(auth)/dashboard/review/page.tsx`
- Create: `src/app/[locale]/(auth)/dashboard/review/StartReviewGameButton.tsx`
- Create: `src/app/[locale]/(auth)/dashboard/review/new/page.tsx`
- Create: `src/app/[locale]/(auth)/dashboard/review/[reviewSetId]/edit/page.tsx`
- Create: `src/features/review/ReviewHostLobby.tsx`
- Create: `src/features/review/ReviewHostProgress.tsx`
- Create: `src/features/review/ReviewHostResults.tsx`
- Create: `src/app/[locale]/(auth)/dashboard/review/host/[gameId]/ReviewHostRoom.tsx`
- Create: `src/app/[locale]/(auth)/dashboard/review/host/[gameId]/page.tsx`

**Interfaces:**
- Consumes: `createReviewSet`/`updateReviewSet`/`ReviewSetInput`（Task 7）、`createReviewGame`（Task 8）、`useReviewHostGame`（Task 15）、`ReviewHostState`（Task 4）
- 注意：專案沒有 Shadcn `Textarea` 元件（只有 `button.tsx`/`input.tsx`），多行輸入一律用原生 `<textarea>` 配 `QuestionForm.tsx:371` 那組 Tailwind class，不要 import 不存在的元件

- [ ] **Step 1: 建立 `ReviewSetEditor.tsx`**

```tsx
// src/features/review/ReviewSetEditor.tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { createReviewSet, updateReviewSet } from '@/actions/reviewSetActions';
import type { ReviewSetInput } from '@/actions/reviewSetActions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const TEXTAREA_CLASS = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

type SampleForm = {
  content: string;
  ref: { correctness: number; completeness: number; clarity: number; creativity: number };
};

type Props = {
  reviewSetId?: number;
  initial?: ReviewSetInput;
};

const EMPTY_SAMPLE: SampleForm = {
  content: '',
  ref: { correctness: 3, completeness: 3, clarity: 3, creativity: 3 },
};

const DIMENSION_LABEL: Record<keyof SampleForm['ref'], string> = {
  correctness: '正確性',
  completeness: '完整性',
  clarity: '清晰度',
  creativity: '創意',
};

export function ReviewSetEditor({ reviewSetId, initial }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [topicPrompt, setTopicPrompt] = useState(initial?.topicPrompt ?? '');
  const [teamSize, setTeamSize] = useState(initial?.teamSize ?? 4);
  const [reviewDurationSec, setReviewDurationSec] = useState(initial?.reviewDurationSec ?? 600);
  const [createDurationSec, setCreateDurationSec] = useState(initial?.createDurationSec ?? 300);
  const [samples, setSamples] = useState<SampleForm[]>(initial?.samples ?? [EMPTY_SAMPLE]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const updateSample = (i: number, patch: Partial<SampleForm>) => {
    setSamples(prev => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };
  const updateSampleRef = (i: number, key: keyof SampleForm['ref'], value: number) => {
    setSamples(prev => prev.map((s, idx) => (idx === i ? { ...s, ref: { ...s.ref, [key]: value } } : s)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const input: ReviewSetInput = {
      title,
      topicPrompt,
      teamSize,
      reviewDurationSec,
      createDurationSec,
      samples,
    };
    const result = reviewSetId
      ? await updateReviewSet(reviewSetId, input)
      : await createReviewSet(input);
    setSaving(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    router.push('/dashboard/review');
  };

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div className="space-y-2">
        {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
        <label className="text-sm font-medium" htmlFor="title">標題</label>
        <Input id="title" value={title} onChange={e => setTitle(e.target.value)} required />
      </div>

      <div className="space-y-2">
        {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
        <label className="text-sm font-medium" htmlFor="topicPrompt">給小組的延伸創作指示</label>
        <textarea
          id="topicPrompt"
          value={topicPrompt}
          onChange={e => setTopicPrompt(e.target.value)}
          rows={3}
          className={TEXTAREA_CLASS}
          required
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label className="text-sm font-medium" htmlFor="teamSize">小組人數</label>
          <Input
            id="teamSize"
            type="number"
            min={2}
            max={8}
            value={teamSize}
            onChange={e => setTeamSize(Number(e.target.value))}
          />
        </div>
        <div className="space-y-2">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label className="text-sm font-medium" htmlFor="reviewDurationSec">評分回合秒數</label>
          <Input
            id="reviewDurationSec"
            type="number"
            min={60}
            max={3600}
            value={reviewDurationSec}
            onChange={e => setReviewDurationSec(Number(e.target.value))}
          />
        </div>
        <div className="space-y-2">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label className="text-sm font-medium" htmlFor="createDurationSec">共創回合秒數</label>
          <Input
            id="createDurationSec"
            type="number"
            min={60}
            max={3600}
            value={createDurationSec}
            onChange={e => setCreateDurationSec(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">範例答案（最多 10 則）</h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={samples.length >= 10}
            onClick={() => setSamples(prev => [...prev, EMPTY_SAMPLE])}
          >
            + 新增範例答案
          </Button>
        </div>

        {samples.map((sample, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <div key={i} className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                範例答案 #
                {i + 1}
              </span>
              {samples.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSamples(prev => prev.filter((_, idx) => idx !== i))}
                >
                  刪除
                </Button>
              )}
            </div>
            <textarea
              value={sample.content}
              onChange={e => updateSample(i, { content: e.target.value })}
              rows={4}
              placeholder="貼上這則範例答案的內容"
              className={TEXTAREA_CLASS}
              required
            />
            <div className="grid grid-cols-4 gap-3">
              {(Object.keys(DIMENSION_LABEL) as (keyof SampleForm['ref'])[]).map(key => (
                <div key={key} className="space-y-1">
                  {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                  <label className="text-xs text-muted-foreground">
                    {DIMENSION_LABEL[key]}
                    （0-5）
                  </label>
                  <Input
                    type="number"
                    min={0}
                    max={5}
                    value={sample.ref[key]}
                    onChange={e => updateSampleRef(i, key, Number(e.target.value))}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      <Button type="submit" disabled={saving}>
        {saving ? '儲存中⋯' : '儲存'}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: 建立題組列表頁 + 開始直播按鈕**

```tsx
// src/app/[locale]/(auth)/dashboard/review/StartReviewGameButton.tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { createReviewGame } from '@/actions/reviewActions';
import { Button } from '@/components/ui/button';

export function StartReviewGameButton({ reviewSetId }: { reviewSetId: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setPending(true);
    setError(null);
    const result = await createReviewGame(reviewSetId);
    setPending(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    router.push(`/dashboard/review/host/${result.gameId}`);
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={handleClick} disabled={pending}>
        {pending ? '建立中⋯' : '開始直播'}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
```

```tsx
// src/app/[locale]/(auth)/dashboard/review/page.tsx
import { auth } from '@clerk/nextjs/server';
import { desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { db } from '@/libs/DB';
import { reviewSetSchema } from '@/models/Schema';

import { StartReviewGameButton } from './StartReviewGameButton';

export default async function ReviewSetListPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect('/sign-in');
  }

  const reviewSets = await db
    .select()
    .from(reviewSetSchema)
    .where(eq(reviewSetSchema.ownerId, userId))
    .orderBy(desc(reviewSetSchema.createdAt));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">小組協作批閱創作題</h1>
        <Button asChild>
          <Link href="/dashboard/review/new">建立新題組</Link>
        </Button>
      </div>

      {reviewSets.length === 0 && (
        <p className="mt-8 text-sm text-muted-foreground">還沒有任何題組，建立第一份吧！</p>
      )}

      <ul className="mt-6 space-y-3">
        {reviewSets.map(rs => (
          <li key={rs.id} className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <p className="font-medium">{rs.title}</p>
              <p className="text-xs text-muted-foreground">
                每組
                {rs.teamSize}
                人
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" asChild>
                <Link href={`/dashboard/review/${rs.id}/edit`}>編輯</Link>
              </Button>
              <StartReviewGameButton reviewSetId={rs.id} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: 建立新增/編輯頁**

```tsx
// src/app/[locale]/(auth)/dashboard/review/new/page.tsx
import { ReviewSetEditor } from '@/features/review/ReviewSetEditor';

export default function NewReviewSetPage() {
  return <ReviewSetEditor />;
}
```

```tsx
// src/app/[locale]/(auth)/dashboard/review/[reviewSetId]/edit/page.tsx
import { auth } from '@clerk/nextjs/server';
import { asc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';

import type { ReviewSetInput } from '@/actions/reviewSetActions';
import { ReviewSetEditor } from '@/features/review/ReviewSetEditor';
import { db } from '@/libs/DB';
import { reviewSampleSchema, reviewSetSchema } from '@/models/Schema';

export default async function EditReviewSetPage({
  params,
}: {
  params: { reviewSetId: string; locale: string };
}) {
  const { userId } = await auth();
  if (!userId) {
    return notFound();
  }

  const reviewSetId = Number(params.reviewSetId);
  if (!Number.isFinite(reviewSetId) || reviewSetId <= 0) {
    return notFound();
  }

  const [reviewSet] = await db
    .select()
    .from(reviewSetSchema)
    .where(eq(reviewSetSchema.id, reviewSetId))
    .limit(1);
  if (!reviewSet || reviewSet.ownerId !== userId) {
    return notFound();
  }

  const samples = await db
    .select()
    .from(reviewSampleSchema)
    .where(eq(reviewSampleSchema.reviewSetId, reviewSetId))
    .orderBy(asc(reviewSampleSchema.orderIndex));

  const initial: ReviewSetInput = {
    title: reviewSet.title,
    topicPrompt: reviewSet.topicPrompt,
    teamSize: reviewSet.teamSize,
    reviewDurationSec: reviewSet.reviewDurationSec,
    createDurationSec: reviewSet.createDurationSec,
    samples: samples.map(s => ({
      content: s.content,
      ref: {
        correctness: s.refCorrectness,
        completeness: s.refCompleteness,
        clarity: s.refClarity,
        creativity: s.refCreativity,
      },
    })),
  };

  return <ReviewSetEditor reviewSetId={reviewSetId} initial={initial} />;
}
```

- [ ] **Step 4: 建立主控台三個階段元件**

```tsx
// src/features/review/ReviewHostLobby.tsx
'use client';

import { Button } from '@/components/ui/button';
import type { ReviewHostState } from '@/services/review/types';

type Props = {
  state: ReviewHostState;
  onStartTeamForming: () => void;
  onEnd: () => void;
  pending: boolean;
};

export function ReviewHostLobby({ state, onStartTeamForming, onEnd, pending }: Props) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <p className="text-sm text-muted-foreground">房間碼</p>
      <p className="font-mono text-5xl font-bold tracking-widest">{state.game.gamePin}</p>
      <p className="mt-6 text-sm text-muted-foreground">
        已加入
        {' '}
        {state.joinedPlayerCount}
        {' '}
        人
      </p>
      <div className="mt-8 flex justify-center gap-3">
        <Button variant="outline" onClick={onEnd} disabled={pending}>
          結束活動
        </Button>
        <Button onClick={onStartTeamForming} disabled={pending || state.joinedPlayerCount === 0}>
          開始分組
        </Button>
      </div>
    </div>
  );
}
```

```tsx
// src/features/review/ReviewHostProgress.tsx
'use client';

import { Button } from '@/components/ui/button';
import type { ReviewHostState } from '@/services/review/types';

type Props = {
  state: ReviewHostState;
  onStartReviewing: () => void;
  onStartCreating: () => void;
  onStartVoting: () => void;
  onFinish: () => void;
  pending: boolean;
};

const PHASE_LABEL: Record<string, string> = {
  team_forming: '分組完成，等待老師開始評分回合',
  reviewing: '評分回合進行中',
  creating: '共創回合進行中',
  voting: '投票回合進行中',
};

export function ReviewHostProgress({
  state,
  onStartReviewing,
  onStartCreating,
  onStartVoting,
  onFinish,
  pending,
}: Props) {
  const { status } = state.game;

  const nextButton = ({
    team_forming: { label: '開始評分回合', onClick: onStartReviewing },
    reviewing: { label: '進入共創回合', onClick: onStartCreating },
    creating: { label: '進入投票回合', onClick: onStartVoting },
    voting: { label: '結算並顯示排行榜', onClick: onFinish },
  } as Record<string, { label: string; onClick: () => void } | undefined>)[status];

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-xl font-bold">{PHASE_LABEL[status] ?? status}</h1>

      <ul className="mt-6 space-y-3">
        {state.teams.map(team => (
          <li key={team.id} className="rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium">{team.teamName}</span>
              <span className="text-xs text-muted-foreground">
                {team.memberCount}
                {' '}
                人
              </span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              評分進度：
              {team.scoredSampleCount}
              /
              {state.totalSamples}
              {' '}
              則已有人評分，
              {team.memberReadyCount}
              /
              {team.memberCount}
              {' '}
              人全部評完
            </p>
            {(status === 'creating' || status === 'voting') && (
              <p className="mt-1 text-sm text-muted-foreground">
                共創答案：
                {team.hasSubmission ? '已提交' : '尚未提交'}
              </p>
            )}
            {status === 'voting' && (
              <p className="mt-1 text-sm text-muted-foreground">
                已收到
                {' '}
                {team.votesReceived}
                {' '}
                票
              </p>
            )}
          </li>
        ))}
      </ul>

      {nextButton && (
        <div className="mt-6 text-right">
          <Button onClick={nextButton.onClick} disabled={pending}>
            {nextButton.label}
          </Button>
        </div>
      )}
    </div>
  );
}
```

```tsx
// src/features/review/ReviewHostResults.tsx
type Props = {
  gameId: number;
  state: import('@/services/review/types').ReviewHostState;
};

export function ReviewHostResults({ gameId, state }: Props) {
  const ranked = [...state.teams].sort((a, b) => b.score - a.score);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">排行榜</h1>
        <a href={`/api/review/${gameId}/export-csv`} className="text-sm text-primary hover:underline">
          匯出 CSV
        </a>
      </div>

      <ol className="mt-6 space-y-3">
        {ranked.map((team, i) => {
          const detail = state.resultsDetail?.find(d => d.teamId === team.id);
          return (
            <li key={team.id} className="rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  #
                  {i + 1}
                  {' '}
                  {team.teamName}
                </span>
                <span className="text-lg font-bold">{team.score}</span>
              </div>
              {detail && (
                <div className="mt-2 text-xs text-muted-foreground">
                  <p>
                    準確度分
                    {detail.accuracyScore}
                    {' '}
                    · 速度加成
                    {detail.speedBonus}
                    {' '}
                    · 投票加成
                    {detail.voteBonus}
                    {' '}
                    （
                    {detail.votesReceived}
                    票）
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-foreground">
                    {detail.submission ?? '（未提交創作答案）'}
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
```

- [ ] **Step 5: 建立主控台容器 + host page**

```tsx
// src/app/[locale]/(auth)/dashboard/review/host/[gameId]/ReviewHostRoom.tsx
'use client';

import Link from 'next/link';

import { ReviewHostLobby } from '@/features/review/ReviewHostLobby';
import { ReviewHostProgress } from '@/features/review/ReviewHostProgress';
import { ReviewHostResults } from '@/features/review/ReviewHostResults';
import { useReviewHostGame } from '@/hooks/useReviewHostGame';

type Props = {
  gameId: number;
  title: string;
};

export function ReviewHostRoom({ gameId, title }: Props) {
  const { state, error, pending, actions } = useReviewHostGame(gameId);

  if (error && !state) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <p className="text-sm text-muted-foreground">載入中⋯</p>
      </div>
    );
  }

  const { status } = state.game;

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-5xl px-4 pt-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <Link href="/dashboard/review" className="hover:text-foreground">← 返回</Link>
          <span className="truncate">{title}</span>
        </div>
      </div>

      {status === 'lobby' && (
        <ReviewHostLobby
          state={state}
          onStartTeamForming={actions.startTeamForming}
          onEnd={actions.end}
          pending={pending}
        />
      )}

      {(status === 'team_forming' || status === 'reviewing' || status === 'creating' || status === 'voting') && (
        <ReviewHostProgress
          state={state}
          onStartReviewing={actions.startReviewing}
          onStartCreating={actions.startCreating}
          onStartVoting={actions.startVoting}
          onFinish={actions.finish}
          pending={pending}
        />
      )}

      {(status === 'results' || status === 'ended') && (
        <ReviewHostResults gameId={gameId} state={state} />
      )}
    </div>
  );
}
```

```tsx
// src/app/[locale]/(auth)/dashboard/review/host/[gameId]/page.tsx
import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { db } from '@/libs/DB';
import { reviewGameSchema, reviewSetSchema } from '@/models/Schema';

import { ReviewHostRoom } from './ReviewHostRoom';

export default async function ReviewHostPage({
  params,
}: {
  params: { gameId: string; locale: string };
}) {
  const { userId } = await auth();
  if (!userId) {
    return notFound();
  }

  const gameId = Number(params.gameId);
  if (!Number.isFinite(gameId) || gameId <= 0) {
    return notFound();
  }

  const [game] = await db
    .select({
      id: reviewGameSchema.id,
      hostUserId: reviewGameSchema.hostUserId,
      reviewSetId: reviewGameSchema.reviewSetId,
    })
    .from(reviewGameSchema)
    .where(eq(reviewGameSchema.id, gameId))
    .limit(1);

  if (!game || game.hostUserId !== userId) {
    return (
      <div className="mx-auto max-w-md space-y-4 px-6 py-20 text-center">
        <h1 className="text-xl font-bold">找不到活動或沒有權限</h1>
        <Link href="/dashboard/review" className="text-sm text-primary hover:underline">
          ← 返回題組列表
        </Link>
      </div>
    );
  }

  const [reviewSet] = await db
    .select({ title: reviewSetSchema.title })
    .from(reviewSetSchema)
    .where(eq(reviewSetSchema.id, game.reviewSetId))
    .limit(1);

  return <ReviewHostRoom gameId={game.id} title={reviewSet?.title ?? '協作批閱'} />;
}
```

- [ ] **Step 6: 型別檢查 + lint**

Run: `npm run check-types && npx eslint src/features/review src/app/[locale]/\(auth\)/dashboard/review --fix`
Expected: 無錯誤

- [ ] **Step 7: 手動驗證**

Run: `npm run dev`，登入後開啟 `/dashboard/review` → 建立一份題組（至少 1 則範例答案）→ 確認存檔後回到列表頁看得到 → 點「開始直播」→ 確認導到 host 頁看得到房間碼

- [ ] **Step 8: Commit**

```bash
git add src/features/review src/app/[locale]/\(auth\)/dashboard/review
git commit -m "$(cat <<'EOF'
新增協作批閱老師端 UI：建立題組、主控台、成果報表

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: 學生端 UI（加入 + 分組等待 + 評分 + 共創 + 投票 + 結果）

**Files:**
- Create: `src/features/review/ReviewPlayerJoin.tsx`
- Create: `src/app/[locale]/review/join/page.tsx`
- Create: `src/features/review/ReviewPlayerReview.tsx`
- Create: `src/features/review/ReviewPlayerCreate.tsx`
- Create: `src/features/review/ReviewPlayerVote.tsx`
- Create: `src/features/review/ReviewTeamResult.tsx`
- Create: `src/app/[locale]/review/play/[gameId]/ReviewPlayRoom.tsx`
- Create: `src/app/[locale]/review/play/[gameId]/page.tsx`

**Interfaces:**
- Consumes: `savePlayerSession`/`loadPlayerSession`（Task 15）、`useReviewHeartbeat`/`useReviewTeamGame`（Task 15）、`ReviewTeamState`/`RubricScores`（Task 4/3）

- [ ] **Step 1: 建立 `ReviewPlayerJoin.tsx` + join page**

```tsx
// src/features/review/ReviewPlayerJoin.tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { savePlayerSession } from '@/services/review/reviewPlayerSession';

type Props = {
  initialPin?: string;
};

export function ReviewPlayerJoin({ initialPin = '' }: Props) {
  const router = useRouter();
  const [pin, setPin] = useState(initialPin);
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/review/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pin.trim().toUpperCase(), nickname: nickname.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        gameId?: number;
        playerId?: number;
        playerToken?: string;
      };
      if (!res.ok || !data.gameId || !data.playerId || !data.playerToken) {
        setError(data.error ?? '加入失敗');
        return;
      }
      savePlayerSession(data.gameId, data.playerId, data.playerToken);
      router.push(`/review/play/${data.gameId}`);
    } catch {
      setError('網路錯誤，請重試');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-6">
      <div className="space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">加入協作批閱活動</h1>
          <p className="mt-2 text-sm text-muted-foreground">輸入 6 碼房間碼與你的暱稱</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
            <label htmlFor="pin" className="text-sm font-medium">房間碼</label>
            <Input
              id="pin"
              value={pin}
              onChange={e => setPin(e.target.value.toUpperCase())}
              maxLength={6}
              autoComplete="off"
              className="h-14 text-center font-mono text-2xl tracking-widest"
              placeholder="A1B2C3"
              required
            />
          </div>
          <div className="space-y-2">
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
            <label htmlFor="nickname" className="text-sm font-medium">你的暱稱</label>
            <Input
              id="nickname"
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              maxLength={30}
              placeholder="Alice"
              required
            />
          </div>
          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {submitting ? '加入中⋯' : '加入'}
          </Button>
        </form>
      </div>
    </div>
  );
}
```

```tsx
// src/app/[locale]/review/join/page.tsx
import { ReviewPlayerJoin } from '@/features/review/ReviewPlayerJoin';

export const metadata = {
  title: '加入協作批閱活動 | QuizFlow',
};

export default function ReviewJoinPage({
  searchParams,
}: {
  searchParams: { pin?: string };
}) {
  const pin = (searchParams.pin ?? '').trim().toUpperCase().slice(0, 6);
  return <ReviewPlayerJoin initialPin={pin} />;
}
```

- [ ] **Step 2: 建立評分回合元件 `ReviewPlayerReview.tsx`**

```tsx
// src/features/review/ReviewPlayerReview.tsx
'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { RubricScores } from '@/services/review/scoring';
import type { ReviewTeamState } from '@/services/review/types';

const TEXTAREA_CLASS = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

const DIMENSION_LABEL: Record<keyof RubricScores, string> = {
  correctness: '正確性',
  completeness: '完整性',
  clarity: '清晰度',
  creativity: '創意',
};

type ScoreDraft = RubricScores & { comment: string };

type Props = {
  state: ReviewTeamState;
  onSubmitScore: (
    sampleId: number,
    scores: RubricScores,
    comment: string | null,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  submitting: boolean;
};

export function ReviewPlayerReview({ state, onSubmitScore, submitting }: Props) {
  const [drafts, setDrafts] = useState<Record<number, ScoreDraft>>({});
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());

  const getDraft = (sampleId: number): ScoreDraft => {
    const draft = drafts[sampleId];
    if (draft) {
      return draft;
    }
    const existing = state.myScores[sampleId];
    return existing
      ? { ...existing, comment: existing.comment ?? '' }
      : { correctness: 3, completeness: 3, clarity: 3, creativity: 3, comment: '' };
  };

  const updateDraft = (sampleId: number, patch: Partial<ScoreDraft>) => {
    setDrafts(prev => ({ ...prev, [sampleId]: { ...getDraft(sampleId), ...patch } }));
  };

  const handleSubmit = async (sampleId: number) => {
    const draft = getDraft(sampleId);
    const result = await onSubmitScore(
      sampleId,
      {
        correctness: draft.correctness,
        completeness: draft.completeness,
        clarity: draft.clarity,
        creativity: draft.creativity,
      },
      draft.comment.trim() || null,
    );
    if (result.ok) {
      setSavedIds(prev => new Set(prev).add(sampleId));
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">
      <h1 className="text-lg font-bold">評分範例答案</h1>

      {state.samples.map((sample) => {
        const draft = getDraft(sample.id);
        const alreadySaved = !!state.myScores[sample.id] || savedIds.has(sample.id);
        const teammates = state.teammateScores[sample.id] ?? [];

        return (
          <div key={sample.id} className="space-y-3 rounded-lg border p-4">
            <p className="whitespace-pre-wrap text-sm">{sample.content}</p>

            <div className="grid grid-cols-4 gap-2">
              {(Object.keys(DIMENSION_LABEL) as (keyof RubricScores)[]).map(key => (
                <div key={key} className="space-y-1">
                  {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                  <label className="text-xs text-muted-foreground">{DIMENSION_LABEL[key]}</label>
                  <Input
                    type="number"
                    min={0}
                    max={5}
                    value={draft[key]}
                    onChange={e =>
                      updateDraft(sample.id, { [key]: Number(e.target.value) } as Partial<ScoreDraft>)}
                  />
                </div>
              ))}
            </div>

            <textarea
              value={draft.comment}
              onChange={e => updateDraft(sample.id, { comment: e.target.value })}
              rows={2}
              maxLength={200}
              placeholder="短評（選填，最多 200 字）"
              className={TEXTAREA_CLASS}
            />

            <div className="flex items-center justify-between">
              <Button size="sm" onClick={() => handleSubmit(sample.id)} disabled={submitting}>
                {alreadySaved ? '更新評分' : '送出評分'}
              </Button>
              {alreadySaved && <span className="text-xs text-emerald-600">已送出</span>}
            </div>

            {teammates.length > 0 && (
              <div className="border-t pt-2 text-xs text-muted-foreground">
                <p className="mb-1">組員評分：</p>
                <ul className="space-y-1">
                  {teammates.map(t => (
                    <li key={t.playerId}>
                      {t.nickname}
                      ：正
                      {t.correctness}
                      /完
                      {t.completeness}
                      /清
                      {t.clarity}
                      /創
                      {t.creativity}
                      {t.comment && ` — ${t.comment}`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: 建立共創回合元件 `ReviewPlayerCreate.tsx`**

```tsx
// src/features/review/ReviewPlayerCreate.tsx
'use client';

import { useEffect, useRef, useState } from 'react';

const TEXTAREA_CLASS = 'w-full rounded-md border border-input bg-background px-3 py-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
const AUTOSAVE_DEBOUNCE_MS = 1500;

type Props = {
  topicPrompt: string;
  initialContent: string;
  onSave: (content: string) => Promise<{ ok: true } | { ok: false; error: string }>;
};

export function ReviewPlayerCreate({ topicPrompt, initialContent, onSave }: Props) {
  const [content, setContent] = useState(initialContent);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (value: string) => {
    setContent(value);
    setStatus('idle');
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(async () => {
      setStatus('saving');
      const result = await onSave(value);
      setStatus(result.ok ? 'saved' : 'idle');
    }, AUTOSAVE_DEBOUNCE_MS);
  };

  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <h1 className="text-lg font-bold">共同創作延伸答案</h1>
      <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{topicPrompt}</p>
      <p className="text-xs text-muted-foreground">
        ⚠️ 組員可能同時在編輯，晚存檔的版本會蓋過先存的版本，建議討論好由一人主要輸入
      </p>
      <textarea
        value={content}
        onChange={e => handleChange(e.target.value)}
        rows={10}
        placeholder="在這裡跟組員一起寫下延伸想法⋯"
        className={TEXTAREA_CLASS}
      />
      <p className="text-xs text-muted-foreground">
        {status === 'saving' ? '儲存中⋯' : status === 'saved' ? '已儲存' : ' '}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: 建立投票回合元件 `ReviewPlayerVote.tsx` + 結果元件 `ReviewTeamResult.tsx`**

```tsx
// src/features/review/ReviewPlayerVote.tsx
'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import type { ReviewTeamState } from '@/services/review/types';

type Props = {
  state: ReviewTeamState;
  onVote: (votedForTeamId: number) => Promise<{ ok: true } | { ok: false; error: string }>;
  submitting: boolean;
};

export function ReviewPlayerVote({ state, onVote, submitting }: Props) {
  const [error, setError] = useState<string | null>(null);

  if (state.hasVoted) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-lg font-bold">✅ 已投票</p>
        <p className="mt-2 text-sm text-muted-foreground">等待其他組完成投票⋯</p>
      </div>
    );
  }

  const candidates = state.votingCandidates ?? [];
  if (candidates.length === 0) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-sm text-muted-foreground">目前沒有其他組可以投票</p>
      </div>
    );
  }

  const handleVote = async (teamId: number) => {
    setError(null);
    const result = await onVote(teamId);
    if (!result.ok) {
      setError(result.error);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <h1 className="text-lg font-bold">投給你覺得最有創意的答案</h1>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {candidates.map(c => (
        <div key={c.teamId} className="space-y-2 rounded-lg border p-4">
          <p className="whitespace-pre-wrap text-sm">{c.content}</p>
          <Button size="sm" onClick={() => handleVote(c.teamId)} disabled={submitting}>
            投給這組
          </Button>
        </div>
      ))}
    </div>
  );
}
```

```tsx
// src/features/review/ReviewTeamResult.tsx
import type { ReviewTeamState } from '@/services/review/types';

export function ReviewTeamResult({ state }: { state: ReviewTeamState }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <p className="text-4xl">🏆</p>
      <h1 className="mt-4 text-xl font-bold">{state.me.teamName}</h1>
      {state.finalTeamRank && (
        <>
          <p className="mt-2 text-3xl font-bold">
            第
            {state.finalTeamRank.rank}
            名
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {state.finalTeamRank.score}
            {' '}
            分
          </p>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: 建立容器 `ReviewPlayRoom.tsx` + play page**

```tsx
// src/app/[locale]/review/play/[gameId]/ReviewPlayRoom.tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ReviewPlayerCreate } from '@/features/review/ReviewPlayerCreate';
import { ReviewPlayerReview } from '@/features/review/ReviewPlayerReview';
import { ReviewPlayerVote } from '@/features/review/ReviewPlayerVote';
import { ReviewTeamResult } from '@/features/review/ReviewTeamResult';
import { useReviewHeartbeat } from '@/hooks/useReviewHeartbeat';
import { useReviewTeamGame } from '@/hooks/useReviewTeamGame';
import { loadPlayerSession } from '@/services/review/reviewPlayerSession';

type Props = {
  gameId: number;
};

export function ReviewPlayRoom({ gameId }: Props) {
  const router = useRouter();
  const [session, setSession] = useState<{ playerId: number; playerToken: string } | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    const saved = loadPlayerSession(gameId);
    if (!saved) {
      router.replace('/review/join');
      return;
    }
    setSession(saved);
  }, [gameId, router]);

  return hydrated && session
    ? (
        <ReviewRoomInner gameId={gameId} playerId={session.playerId} playerToken={session.playerToken} />
      )
    : (
        <div className="mx-auto max-w-md py-20 text-center">
          <p className="text-sm text-muted-foreground">載入中⋯</p>
        </div>
      );
}

function ReviewRoomInner({
  gameId,
  playerId,
  playerToken,
}: {
  gameId: number;
  playerId: number;
  playerToken: string;
}) {
  const {
    state,
    error,
    submitting,
    isReconnecting,
    submitScore,
    submitSubmission,
    submitVote,
  } = useReviewTeamGame(gameId, playerId, playerToken);

  useReviewHeartbeat(gameId, playerToken, state?.game.status !== 'ended');

  const banner = isReconnecting
    ? (
        <div className="sticky top-0 z-50 bg-red-500 px-4 py-2 text-center text-sm font-medium text-white">
          ⚠️ 網路斷線中⋯ 正在重新連線
        </div>
      )
    : null;

  if (error && !state) {
    return (
      <>
        {banner}
        <div className="mx-auto max-w-md py-20 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <Link href="/review/join" className="mt-4 inline-block text-xs text-primary hover:underline">
            重新加入
          </Link>
        </div>
      </>
    );
  }

  if (!state) {
    return (
      <>
        {banner}
        <div className="mx-auto max-w-md py-20 text-center">
          <p className="text-sm text-muted-foreground">連線中⋯</p>
        </div>
      </>
    );
  }

  const { status } = state.game;

  if (status === 'lobby') {
    return (
      <>
        {banner}
        <div className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-6 text-center">
          <div className="space-y-3">
            <div className="text-4xl">⏳</div>
            <h1 className="text-xl font-bold">等待老師開始⋯</h1>
            <p className="text-sm text-muted-foreground">
              你的暱稱：
              <strong>{state.me.nickname}</strong>
            </p>
          </div>
        </div>
      </>
    );
  }

  if (status === 'team_forming') {
    return (
      <>
        {banner}
        <div className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-6 text-center">
          <div className="space-y-3">
            <div className="text-4xl">👥</div>
            <h1 className="text-xl font-bold">
              你被分到「
              {state.me.teamName}
              」
            </h1>
            <p className="text-sm text-muted-foreground">
              組員：
              {state.teammates.map(t => t.nickname).join('、') || '（只有你）'}
            </p>
            <p className="text-sm text-muted-foreground">等待老師開始評分回合⋯</p>
          </div>
        </div>
      </>
    );
  }

  if (status === 'reviewing') {
    return (
      <>
        {banner}
        <ReviewPlayerReview state={state} onSubmitScore={submitScore} submitting={submitting} />
      </>
    );
  }

  if (status === 'creating') {
    return (
      <>
        {banner}
        <ReviewPlayerCreate
          topicPrompt={state.topicPrompt}
          initialContent={state.submission?.content ?? ''}
          onSave={submitSubmission}
        />
      </>
    );
  }

  if (status === 'voting') {
    return (
      <>
        {banner}
        <ReviewPlayerVote state={state} onVote={submitVote} submitting={submitting} />
      </>
    );
  }

  return (
    <>
      {banner}
      <ReviewTeamResult state={state} />
    </>
  );
}
```

```tsx
// src/app/[locale]/review/play/[gameId]/page.tsx
import { ReviewPlayRoom } from './ReviewPlayRoom';

export const metadata = {
  title: '協作批閱活動 | QuizFlow',
};

export default function ReviewPlayPage({
  params,
}: {
  params: { gameId: string; locale: string };
}) {
  const gameId = Number(params.gameId);
  if (!Number.isFinite(gameId) || gameId <= 0) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <p className="text-sm text-destructive">網址格式錯誤</p>
      </div>
    );
  }
  return <ReviewPlayRoom gameId={gameId} />;
}
```

- [ ] **Step 6: 型別檢查 + lint**

Run: `npm run check-types && npx eslint src/features/review src/app/\[locale\]/review --fix`
Expected: 無錯誤

- [ ] **Step 7: 端到端手動驗證（完整跑一輪）**

Run: `npm run dev`，開兩個以上瀏覽器分頁模擬多位學生：

1. 老師分頁：`/dashboard/review` 建立題組（2 則範例答案）→「開始直播」，記下房間碼
2. 學生分頁 A、B：`/review/join` 輸入房間碼 + 不同暱稱加入
3. 老師分頁：確認看到 2 人已加入 →「開始分組」→ 確認學生分頁都看到「你被分到第 1 組」
4. 老師分頁：「開始評分回合」→ 學生分頁 A 對兩則範例答案打分 + 留短評 → 確認學生分頁 B 即時（1.5-2 秒內）看到 A 的分數更新
5. 老師分頁：「進入共創回合」→ 學生分頁 A 打幾個字 → 等 debounce 存檔後，學生分頁 B 重新整理應該看到 A 打的內容
6. 老師分頁：「進入投票回合」（若只有 1 組會顯示「沒有其他組可以投票」，屬預期行為）
7. 老師分頁：「結算並顯示排行榜」→ 確認排行榜分數拆解合理、CSV 可下載、學生分頁顯示名次
8. 關閉學生分頁 A（模擬斷線）→ 確認學生分頁 B 不受影響繼續運作

- [ ] **Step 8: Commit**

```bash
git add src/features/review src/app/\[locale\]/review
git commit -m "$(cat <<'EOF'
新增協作批閱學生端 UI：加入、分組等待、評分、共創、投票、結果

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage**：8 張表（Task 1）、round-robin 分組（Task 2）、三段計分（Task 3）、tick-only 即時同步（Task 5）、老師手動控場狀態機（Task 8）、學生端絕不看到標準分（Task 4/6 的型別邊界）、v1 無自由聊天（短評/標註取代，Task 13 score route + Task 16 UI）、CSV 匯出（Task 14）、middleware 白名單分工（Task 9）都各自對應到任務，spec 的「不在本 spec 範圍」清單（學生自組隊、AI 生成範例答案、jigsaw 分配、匯入題庫、Playwright E2E）本計畫同樣不處理。
- **型別一致性**：`RubricScores`（Task 3）→ `ReviewTeamState.myScores`/`teammateScores`（Task 4）→ `reviewStore.ts` 讀寫（Task 6）→ hooks（Task 15）→ UI（Task 16/17）全程用同一組欄位名稱（`correctness`/`completeness`/`clarity`/`creativity`），未出現改名分岔。`ReviewTeamResultDetail.accuracyScore`/`speedBonus`/`voteBonus` 對應 `review_team` 表同名欄位，避免 UI 顯示層重算公式。
- **已知簡化**（跟 spec 一致，非計畫遺漏）：階段轉換全靠老師手動觸發，不做伺服器自動推進計時器；共創答案 last-write-wins；voting 階段只有 1 組時允許跳過投票直接進 results。

