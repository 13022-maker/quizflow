# 小組協作批閱：隊長投票送出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「小組協作批閱創作題」creating 階段從單一共用文字框（last-write-wins）
改成每人獨立草稿 + 組員即時多數決投隊長 + 隊長挑基底微調後明確送出，
老師強制推進階段時對未送出的組自動補送出。

**Architecture:** 新增兩張表（`review_draft` 存每人獨立草稿、
`review_leader_vote` 存組內互投），`review_team` 加 `leader_id`，
`review_submission` 加 `submitted_at`/`auto_submitted` 把語意從「共用草稿」
收斂成「這組的最終答案」。純計算邏輯（計票、逾時內容 fallback）拆成獨立
可單元測試的檔案；DB 存取集中在既有 `reviewStore.ts`；API Route 沿用現有
`playerToken` 驗身分模式（不是 Clerk `auth()`，學生端不用登入）。

**Tech Stack:** Next.js 14 App Router、TypeScript strict、Drizzle ORM +
PostgreSQL（PGlite 本機開發）、Zod、Vitest。

**Spec:** `docs/superpowers/specs/2026-09-30-team-leader-submission-design.md`

## Global Constraints

- 所有 UI 文字、錯誤訊息、程式碼註解一律繁體中文；變數/函式/路由/檔名一律英文
- 所有 API Route 最頂端加 `export const runtime = 'nodejs'`，回應一律用 `NextResponse.json()`
- 學生端 API Route 用 `playerToken` 驗身分（`verifyPlayerToken`），**不是** Clerk `auth()`；老師端 Server Action 用 Clerk `auth()` + `loadOwnedReviewGame` 驗 `hostUserId`
- 修改 `src/models/Schema.ts` 後必須執行 `npm run db:generate`，並**手動檢查產生的 SQL**、砍掉不屬於本次改動的 diff（已知 `migrations/meta/` snapshot 脫鉤問題，見 CLAUDE.md）
- 新增的學生端 API Route 必須加進 `src/middleware.ts` 的 `isPublicApiRoute`（含 `/api/...` 與 `/:locale/api/...` 兩個變體），否則 Clerk middleware 會擋掉未登入學生的請求
- 純計算邏輯（無 DB/fetch 依賴）一律先寫失敗測試再實作（TDD），期望值 hand-derived；DB 存取層/UI 這個專案的既有慣例是不寫自動化測試，改用手動多分頁驗證（比照 `2026-09-26-team-review-create-design.md` 的「測試方式」段）
- 每個 task 結束後執行 `npm run check-types` 確認沒有新增型別錯誤

---

## Task 1: 隊長計票純函式 `pickLeader`

**Files:**
- Create: `src/services/review/leaderElection.ts`
- Test: `src/services/review/leaderElection.test.ts`

**Interfaces:**
- Produces: `pickLeader(votes: LeaderVote[], members: LeaderCandidate[]): number | null`
  - `LeaderVote = { voterPlayerId: number; votedForPlayerId: number }`
  - `LeaderCandidate = { id: number; joinedAt: Date }`
  - 回傳目前應該是隊長的 `playerId`；`members` 為空陣列時回傳 `null`

- [ ] **Step 1: 寫失敗測試**

```ts
// src/services/review/leaderElection.test.ts
import { describe, expect, it } from 'vitest';

import { pickLeader } from './leaderElection';

describe('pickLeader', () => {
  it('得票最高者當選', () => {
    const members = [
      { id: 1, joinedAt: new Date('2026-01-01T00:00:00Z') },
      { id: 2, joinedAt: new Date('2026-01-01T00:00:01Z') },
      { id: 3, joinedAt: new Date('2026-01-01T00:00:02Z') },
    ];
    const votes = [
      { voterPlayerId: 1, votedForPlayerId: 2 },
      { voterPlayerId: 2, votedForPlayerId: 2 },
      { voterPlayerId: 3, votedForPlayerId: 3 },
    ];

    expect(pickLeader(votes, members)).toBe(2);
  });

  it('平票時取最早加入的成員', () => {
    const members = [
      { id: 1, joinedAt: new Date('2026-01-01T00:00:02Z') }, // 最晚加入
      { id: 2, joinedAt: new Date('2026-01-01T00:00:00Z') }, // 最早加入
      { id: 3, joinedAt: new Date('2026-01-01T00:00:01Z') },
    ];
    const votes = [
      { voterPlayerId: 1, votedForPlayerId: 1 },
      { voterPlayerId: 2, votedForPlayerId: 2 },
      { voterPlayerId: 3, votedForPlayerId: 3 },
    ]; // 1、2、3 各得 1 票，平手

    expect(pickLeader(votes, members)).toBe(2); // id=2 最早加入
  });

  it('沒有任何人投票時，預設最早加入的成員當隊長', () => {
    const members = [
      { id: 5, joinedAt: new Date('2026-01-01T00:00:01Z') },
      { id: 6, joinedAt: new Date('2026-01-01T00:00:00Z') },
    ];

    expect(pickLeader([], members)).toBe(6);
  });

  it('只有 1 位成員時，該成員永遠是隊長', () => {
    const members = [{ id: 9, joinedAt: new Date('2026-01-01T00:00:00Z') }];

    expect(pickLeader([], members)).toBe(9);
    expect(pickLeader([{ voterPlayerId: 9, votedForPlayerId: 9 }], members)).toBe(9);
  });

  it('沒有任何成員時回傳 null', () => {
    expect(pickLeader([], [])).toBeNull();
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run src/services/review/leaderElection.test.ts`
Expected: FAIL（`leaderElection.ts` 尚不存在，`Cannot find module './leaderElection'`）

- [ ] **Step 3: 寫最小實作**

```ts
// src/services/review/leaderElection.ts
// 組內隊長即時多數決：不設「投票視窗關閉」關卡，每次投票後即時重新計算，
// 平票或尚無人投票時，取最早加入該組的成員當預設隊長，確保任何時候都有人
// 能整合送出最終答案。

export type LeaderVote = { voterPlayerId: number; votedForPlayerId: number };
export type LeaderCandidate = { id: number; joinedAt: Date };

export function pickLeader(votes: LeaderVote[], members: LeaderCandidate[]): number | null {
  if (members.length === 0) {
    return null;
  }

  const sortedByJoinOrder = [...members].sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
  const tally = new Map<number, number>();
  for (const vote of votes) {
    tally.set(vote.votedForPlayerId, (tally.get(vote.votedForPlayerId) ?? 0) + 1);
  }

  let leaderId = sortedByJoinOrder[0]!.id;
  let highestCount = -1;
  for (const member of sortedByJoinOrder) {
    const memberCount = tally.get(member.id) ?? 0;
    if (memberCount > highestCount) {
      highestCount = memberCount;
      leaderId = member.id;
    }
  }
  return leaderId;
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run src/services/review/leaderElection.test.ts`
Expected: PASS（5 個測試全過）

- [ ] **Step 5: Commit**

```bash
git add src/services/review/leaderElection.ts src/services/review/leaderElection.test.ts
git commit -m "feat(review): 新增隊長即時多數決計票純函式 pickLeader"
```

---

## Task 2: 逾時自動送出內容 fallback 純函式 `resolveFallbackContent`

**Files:**
- Create: `src/services/review/submissionFallback.ts`
- Test: `src/services/review/submissionFallback.test.ts`

**Interfaces:**
- Produces: `resolveFallbackContent(params: { existingSubmissionContent: string | null; leaderDraftContent: string | null }): string`

- [ ] **Step 1: 寫失敗測試**

```ts
// src/services/review/submissionFallback.test.ts
import { describe, expect, it } from 'vitest';

import { resolveFallbackContent } from './submissionFallback';

describe('resolveFallbackContent', () => {
  it('已有最終答案內容（即使是空字串）就直接用它，不退回草稿', () => {
    expect(resolveFallbackContent({
      existingSubmissionContent: '',
      leaderDraftContent: '隊長的草稿',
    })).toBe('');
  });

  it('已有最終答案內容時優先使用', () => {
    expect(resolveFallbackContent({
      existingSubmissionContent: '隊長整理好的最終答案',
      leaderDraftContent: '隊長的草稿',
    })).toBe('隊長整理好的最終答案');
  });

  it('沒有最終答案（整筆不存在）時退用隊長自己的草稿', () => {
    expect(resolveFallbackContent({
      existingSubmissionContent: null,
      leaderDraftContent: '隊長的草稿',
    })).toBe('隊長的草稿');
  });

  it('最終答案和隊長草稿都不存在時，落成空字串', () => {
    expect(resolveFallbackContent({
      existingSubmissionContent: null,
      leaderDraftContent: null,
    })).toBe('');
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run src/services/review/submissionFallback.test.ts`
Expected: FAIL（`submissionFallback.ts` 尚不存在）

- [ ] **Step 3: 寫最小實作**

```ts
// src/services/review/submissionFallback.ts
// 老師把階段從 creating 推進到 voting 時，若隊長還沒按下「確認送出」，
// 用這個函式決定要自動補送出什麼內容：優先用隊長目前最終答案文字框裡的
// 內容（即使是空字串也算數，代表隊長連基底都還沒選但至少開過那個欄位）；
// 如果那份最終答案整筆都不存在，才退而使用隊長自己的獨立草稿；兩者都沒有
// 就送出空字串。

export function resolveFallbackContent(params: {
  existingSubmissionContent: string | null;
  leaderDraftContent: string | null;
}): string {
  if (params.existingSubmissionContent !== null) {
    return params.existingSubmissionContent;
  }
  if (params.leaderDraftContent !== null) {
    return params.leaderDraftContent;
  }
  return '';
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run src/services/review/submissionFallback.test.ts`
Expected: PASS（4 個測試全過）

- [ ] **Step 5: Commit**

```bash
git add src/services/review/submissionFallback.ts src/services/review/submissionFallback.test.ts
git commit -m "feat(review): 新增逾時自動送出內容 fallback 純函式"
```

---

## Task 3: `contributors.ts` 改成依草稿字數統計（取代原本的編輯次數）

現有 `summarizeContributors` 統計 `review_submission_edit` 的編輯事件次數。
改成「每人一筆獨立草稿」之後，每個組員在 `review_draft` 永遠最多 1 筆記錄
（DB unique 約束），所以不再需要聚合次數，直接依字數排序即可，函式因此
變得更簡單。這是**破壞性改動**：`Contributor.editCount` 改名
`Contributor.charCount`，語意從「存檔次數」變成「目前草稿字數」。

**Files:**
- Modify: `src/services/review/contributors.ts`
- Modify: `src/services/review/contributors.test.ts`

**Interfaces:**
- Produces: `Contributor = { playerId: number; nickname: string; charCount: number }`
- Produces: `summarizeContributors(draftRows: { playerId: number; charCount: number }[], players: { id: number; nickname: string }[]): Contributor[]`
- Consumed by: Task 6（`reviewStore.ts` 的 `getTeamsWithProgress`/`getResultsDetail`）、
  Task 7（`types.ts` 的 `Contributor` 型別引用處）、Task 8（host UI 顯示文字）

- [ ] **Step 1: 改寫測試（先讓它反映新行為，此時會 FAIL 因為實作還沒改）**

```ts
// src/services/review/contributors.test.ts
import { describe, expect, it } from 'vitest';

import { summarizeContributors } from './contributors';

describe('summarizeContributors', () => {
  it('依字數由多到少排序', () => {
    const players = [
      { id: 1, nickname: '小明' },
      { id: 2, nickname: '小華' },
    ];
    const draftRows = [
      { playerId: 1, charCount: 30 },
      { playerId: 2, charCount: 80 },
    ];

    const result = summarizeContributors(draftRows, players);

    expect(result).toEqual([
      { playerId: 2, nickname: '小華', charCount: 80 },
      { playerId: 1, nickname: '小明', charCount: 30 },
    ]);
  });

  it('草稿是空字串（字數 0）的組員仍會出現在結果裡', () => {
    const players = [{ id: 1, nickname: '小明' }];
    const draftRows = [{ playerId: 1, charCount: 0 }];

    expect(summarizeContributors(draftRows, players)).toEqual([
      { playerId: 1, nickname: '小明', charCount: 0 },
    ]);
  });

  it('完全沒動過草稿欄的組員不會出現在結果裡（沒有 draft row）', () => {
    const players = [
      { id: 1, nickname: '小明' },
      { id: 2, nickname: '小華' },
    ];
    const draftRows = [{ playerId: 1, charCount: 10 }];

    expect(summarizeContributors(draftRows, players)).toEqual([
      { playerId: 1, nickname: '小明', charCount: 10 },
    ]);
  });

  it('沒有任何草稿記錄時回傳空陣列', () => {
    expect(summarizeContributors([], [{ id: 1, nickname: '小明' }])).toEqual([]);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run src/services/review/contributors.test.ts`
Expected: FAIL（型別不符：`summarizeContributors` 還在吃 `{ playerId }[]` 且輸出 `editCount`）

- [ ] **Step 3: 改寫實作**

```ts
// src/services/review/contributors.ts
// 共創階段「誰有動手」摘要：依每人獨立草稿目前的字數呈現，不比對內容差異。
// review_draft 對每個 (teamId, playerId) 只會有 1 筆記錄，不需要聚合次數。
export type Contributor = { playerId: number; nickname: string; charCount: number };

export function summarizeContributors(
  draftRows: { playerId: number; charCount: number }[],
  players: { id: number; nickname: string }[],
): Contributor[] {
  const nicknameById = new Map(players.map(p => [p.id, p.nickname]));

  return draftRows
    .map(row => ({
      playerId: row.playerId,
      nickname: nicknameById.get(row.playerId) ?? '',
      charCount: row.charCount,
    }))
    .sort((a, b) => b.charCount - a.charCount);
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run src/services/review/contributors.test.ts`
Expected: PASS（4 個測試全過）

- [ ] **Step 5: Commit**

```bash
git add src/services/review/contributors.ts src/services/review/contributors.test.ts
git commit -m "refactor(review): 貢獻度統計改依草稿字數，不再算編輯次數"
```

---

## Task 4: Schema 異動（新表 + 欄位）與 migration

**Files:**
- Modify: `src/models/Schema.ts:558-570`（`reviewTeamSchema` 加欄位）
- Modify: `src/models/Schema.ts:624-635`（`reviewSubmissionSchema` 加欄位）
- Modify: `src/models/Schema.ts`（在 `reviewSubmissionEditSchema` 之後、`reviewVoteSchema` 之前，新增 `reviewDraftSchema` 與 `reviewLeaderVoteSchema`）
- Create: `migrations/20260930_review_leader_submission.sql`（由 `npm run db:generate` 產生後手動檢查/整理命名）
- Create: `migrations/meta/20260930_review_leader_submission_snapshot.json`（同上，工具產生）

**Interfaces:**
- Produces: `reviewDraftSchema`（欄位：`id`、`teamId`、`playerId`、`content`、`updatedAt`；unique `(teamId, playerId)`）
- Produces: `reviewLeaderVoteSchema`（欄位：`id`、`teamId`、`voterPlayerId`、`votedForPlayerId`、`updatedAt`；unique `(teamId, voterPlayerId)`）
- Produces: `reviewTeamSchema.leaderId`（nullable，FK → `reviewPlayerSchema.id`，`onDelete: 'set null'`）
- Produces: `reviewSubmissionSchema.submittedAt`（nullable timestamp）、`reviewSubmissionSchema.autoSubmitted`（boolean，預設 `false`）
- Consumed by: Task 6（reviewStore.ts）、Task 8（reviewActions.ts）

- [ ] **Step 1: 修改 `reviewTeamSchema`，加 `leaderId`**

在 `src/models/Schema.ts:558-570`，把：

```ts
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
```

改成（新增 `leaderId` 欄位，其餘不變）：

```ts
export const reviewTeamSchema = pgTable('review_team', {
  id: serial('id').primaryKey(),
  gameId: integer('game_id')
    .notNull()
    .references(() => reviewGameSchema.id, { onDelete: 'cascade' }),
  teamName: text('team_name').notNull(), // 「第 1 組」
  // 目前當選的隊長，只存現況不記錄異動歷史；team_forming 分組完成時預設填
  // 最早加入該組的成員，之後隨組內即時多數決投票結果更新
  leaderId: integer('leader_id')
    .references(() => reviewPlayerSchema.id, { onDelete: 'set null' }),
  // 三段分數各自存欄位（而非只存加總），讓 results 報表可以直接讀，不用在
  // 顯示層重算一次公式（避免兩處公式分岔）；score 永遠等於三者加總
  accuracyScore: integer('accuracy_score').default(0).notNull(),
  speedBonus: integer('speed_bonus').default(0).notNull(),
  voteBonus: integer('vote_bonus').default(0).notNull(),
  score: integer('score').default(0).notNull(),
});
```

- [ ] **Step 2: 修改 `reviewSubmissionSchema`，加 `submittedAt` / `autoSubmitted`**

在 `src/models/Schema.ts:624-635`，把：

```ts
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
```

改成：

```ts
// 每組最終的延伸創作答案（1 組 1 筆）。只有目前隊長能寫入，submittedAt
// 非 null 代表已鎖定，不能再改
export const reviewSubmissionSchema = pgTable('review_submission', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .unique()
    .references(() => reviewTeamSchema.id, { onDelete: 'cascade' }),
  content: text('content').default('').notNull(),
  lastEditedByPlayerId: integer('last_edited_by_player_id')
    .references(() => reviewPlayerSchema.id, { onDelete: 'set null' }),
  submittedAt: timestamp('submitted_at', { mode: 'date' }), // null = 隊長尚未明確送出
  autoSubmitted: boolean('auto_submitted').default(false).notNull(), // true = 老師推進階段時系統代送
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
});
```

- [ ] **Step 3: 新增 `reviewDraftSchema` 與 `reviewLeaderVoteSchema`**

在 `src/models/Schema.ts` 裡 `reviewSubmissionEditSchema` 定義結束
（`});` 之後）、`reviewVoteSchema` 定義開始之前，插入：

```ts
// 每位組員自己的獨立草稿（取代原本「1 組 1 筆」的共用文字框，互不覆蓋）
export const reviewDraftSchema = pgTable(
  'review_draft',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => reviewTeamSchema.id, { onDelete: 'cascade' }),
    playerId: integer('player_id')
      .notNull()
      .references(() => reviewPlayerSchema.id, { onDelete: 'cascade' }),
    content: text('content').default('').notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => ({
    teamPlayerIdx: uniqueIndex('review_draft_team_player_idx').on(table.teamId, table.playerId),
  }),
);

// 組內互投隊長，可改投（同一 voter 再投一次會覆蓋原本的票）
export const reviewLeaderVoteSchema = pgTable(
  'review_leader_vote',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => reviewTeamSchema.id, { onDelete: 'cascade' }),
    voterPlayerId: integer('voter_player_id')
      .notNull()
      .references(() => reviewPlayerSchema.id, { onDelete: 'cascade' }),
    votedForPlayerId: integer('voted_for_player_id')
      .notNull()
      .references(() => reviewPlayerSchema.id, { onDelete: 'cascade' }),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => ({
    teamVoterIdx: uniqueIndex('review_leader_vote_team_voter_idx').on(table.teamId, table.voterPlayerId),
  }),
);
```

- [ ] **Step 4: 產生 migration**

Run: `npm run db:generate`

這會在 `migrations/` 產生一個新的編號檔案（例如
`migrations/0036_xxx.sql`，實際編號依 drizzle-kit 當下狀態而定）跟對應的
`migrations/meta/0036_xxx_snapshot.json`。

- [ ] **Step 5: 手動檢查產生的 SQL，只保留本次改動**

打開產生的 `.sql` 檔，確認裡面**只有**這 4 件事：
1. `ALTER TABLE "review_team" ADD COLUMN "leader_id" integer;` + FK constraint
2. `ALTER TABLE "review_submission" ADD COLUMN "submitted_at" timestamp;`
   + `ADD COLUMN "auto_submitted" boolean DEFAULT false NOT NULL;`
3. `CREATE TABLE "review_draft" (...)` + FK constraints + unique index
4. `CREATE TABLE "review_leader_vote" (...)` + FK constraints + unique index

如果看到其他不相關的表（因為 CLAUDE.md 記錄的「Drizzle migration snapshot
脫鉤」已知問題），把那些 `CREATE TABLE`/`ALTER TABLE` 區塊連同對應的
`--> statement-breakpoint` 一起刪掉，只留這次真的要做的 4 件事。

確認每一條 SQL 陳述式之間都有 `--> statement-breakpoint`（CLAUDE.md
「Drizzle migration breakpoint 規則」，少了會在 PG/PGlite 炸 42601）。

把檔案改名成 `migrations/20260930_review_leader_submission.sql`（比照
`migrations/20260930_review_submission_edit.sql` 同一天已有一個 migration
的先例），對應的 snapshot 也改名成
`migrations/meta/20260930_review_leader_submission_snapshot.json`。

- [ ] **Step 6: 跑型別檢查確認 Schema 改動没有打壞既有程式碼**

Run: `npm run check-types`
Expected: 現有呼叫 `reviewSubmissionSchema`/`reviewTeamSchema` 的地方
（`reviewStore.ts`、`reviewActions.ts`）此時還沒加新欄位的邏輯，`check-types`
應該仍然 PASS（新欄位都是可選的，不會讓既有 insert/select 出錯）

- [ ] **Step 7: Commit**

```bash
git add src/models/Schema.ts migrations/20260930_review_leader_submission.sql migrations/meta/20260930_review_leader_submission_snapshot.json
git commit -m "feat(review): schema 加隊長投票與獨立草稿相關表/欄位"
```

---

## Task 5: `types.ts` 型別擴充

**Files:**
- Modify: `src/services/review/types.ts`

**Interfaces:**
- Consumes: `Contributor`（Task 3 產出，`{ playerId, nickname, charCount }`）
- Produces: `ReviewTeamState` 新增 `leaderId`、`myDraft`、`teammateDrafts`、`myLeaderVote`，`submission` 欄位擴充 `submittedAt`/`autoSubmitted`
- Produces: `ReviewHostState.teams[]` 新增 `leaderId`、`autoSubmitted`
- Produces: `ReviewTeamResultDetail` 新增 `leaderId`、`autoSubmitted`
- Consumed by: Task 6（`reviewStore.ts` 回傳值要符合這些型別）、
  Task 11（`ReviewPlayerCreate.tsx` 讀取這些欄位）、
  Task 12（host UI 讀取這些欄位）

- [ ] **Step 1: 修改 `ReviewTeamResultDetail`**

把：

```ts
export type ReviewTeamResultDetail = {
  teamId: number;
  members: ReviewTeamMember[];
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
  contributors: Contributor[]; // 共創階段誰有動手，只算次數不比對內容
  votesReceived: number;
};
```

改成：

```ts
export type ReviewTeamResultDetail = {
  teamId: number;
  members: ReviewTeamMember[];
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
  leaderId: number | null; // 最終送出時的隊長
  autoSubmitted: boolean; // true = 老師推進階段時系統代送，非隊長主動按送出
  contributors: Contributor[]; // 共創階段誰有動手，依草稿字數呈現
  votesReceived: number;
};
```

- [ ] **Step 2: 修改 `ReviewHostState.teams` 的 inline 型別**

把：

```ts
  teams: (ReviewTeamSummary & {
    scoredSampleCount: number; // 至少 1 人評過分的範例答案數
    memberReadyCount: number; // 全部範例答案都評完分的成員數
    hasSubmission: boolean;
    contributors: Contributor[]; // 共創階段誰有動手，只算次數不比對內容
    votesReceived: number;
  })[];
```

改成：

```ts
  teams: (ReviewTeamSummary & {
    scoredSampleCount: number; // 至少 1 人評過分的範例答案數
    memberReadyCount: number; // 全部範例答案都評完分的成員數
    hasSubmission: boolean;
    leaderId: number | null; // 目前當選（或預設）的隊長
    autoSubmitted: boolean; // true = 該組是系統逾時代送，不是隊長主動送出
    contributors: Contributor[]; // 共創階段誰有動手，依草稿字數呈現
    votesReceived: number;
  })[];
```

- [ ] **Step 3: 修改 `ReviewTeamState`**

把：

```ts
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

改成（新增 `leaderId`/`myDraft`/`teammateDrafts`/`myLeaderVote`，
`submission` 加 `submittedAt`/`autoSubmitted`）：

```ts
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
  leaderId: number | null; // 目前組內當選（或預設）的隊長 playerId
  myDraft: string; // 自己的獨立草稿內容
  teammateDrafts: { playerId: number; nickname: string; content: string; updatedAt: string }[]; // 不含自己
  myLeaderVote: number | null; // 我目前投給誰（null = 還沒投）
  submission: { content: string; updatedAt: string; submittedAt: string | null; autoSubmitted: boolean } | null;
  hasVoted: boolean;
  // voting 階段才有值；匿名（不含 teamName），避免人情票
  votingCandidates: { teamId: number; content: string }[] | null;
  finalTeamRank: { rank: number; score: number } | null; // results 階段才有值
};
```

- [ ] **Step 4: 型別檢查**

Run: `npm run check-types`
Expected: 這一步之後 `reviewStore.ts` 尚未補齊新欄位，預期會出現
`Property 'leaderId' is missing`（或類似）的錯誤——這是正常的，Task 6
會補上實作讓它通過。**不用在這個 task 修掉**，只是先確認錯誤訊息是預期
的那幾個型別缺漏，不是別的問題。

- [ ] **Step 5: Commit**

```bash
git add src/services/review/types.ts
git commit -m "feat(review): types 擴充隊長/草稿/送出狀態欄位"
```

---

## Task 6: `reviewStore.ts` 新增草稿/投票/送出的 DB 存取函式

**Files:**
- Modify: `src/services/review/reviewStore.ts`

**Interfaces:**
- Consumes: `pickLeader`（Task 1）、`resolveFallbackContent`（Task 2）、
  `reviewDraftSchema`/`reviewLeaderVoteSchema`/`reviewTeamSchema.leaderId`/
  `reviewSubmissionSchema.submittedAt`/`.autoSubmitted`（Task 4）
- Produces:
  - `upsertDraft(params: { gameId: number; playerId: number; content: string }): Promise<{ ok: true } | { ok: false; error: string; status?: number }>`
  - `upsertLeaderVote(params: { gameId: number; voterPlayerId: number; votedForPlayerId: number }): Promise<{ ok: true } | { ok: false; error: string; status?: number }>`
  - `submitFinalAnswer(params: { gameId: number; playerId: number }): Promise<{ ok: true } | { ok: false; error: string; status?: number }>`
  - `autoSubmitPendingTeams(gameId: number): Promise<void>`
  - 修改既有 `upsertSubmission` 加上「只有隊長能寫」與「已送出就鎖定」兩道檢查
- Consumed by: Task 9（API routes）、Task 8（`autoSubmitPendingTeams` 給
  `reviewActions.ts` 的 `startVoting` 呼叫）

- [ ] **Step 1: 加 import**

在 `src/services/review/reviewStore.ts:7-17` 的 import 區塊，把：

```ts
import {
  reviewGameSchema,
  reviewPlayerSchema,
  reviewSampleSchema,
  reviewScoreSchema,
  reviewSetSchema,
  reviewSubmissionEditSchema,
  reviewSubmissionSchema,
  reviewTeamSchema,
  reviewVoteSchema,
} from '@/models/Schema';

import { publishTick } from './ablyServer';
import { summarizeContributors } from './contributors';
```

改成：

```ts
import {
  reviewDraftSchema,
  reviewGameSchema,
  reviewLeaderVoteSchema,
  reviewPlayerSchema,
  reviewSampleSchema,
  reviewScoreSchema,
  reviewSetSchema,
  reviewSubmissionEditSchema,
  reviewSubmissionSchema,
  reviewTeamSchema,
  reviewVoteSchema,
} from '@/models/Schema';

import { publishTick } from './ablyServer';
import { summarizeContributors } from './contributors';
import { pickLeader } from './leaderElection';
import { resolveFallbackContent } from './submissionFallback';
```

- [ ] **Step 2: 修改 `upsertSubmission`，加隊長權限檢查與送出鎖定**

在 `src/services/review/reviewStore.ts:491-528`，把整個函式：

```ts
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
  // 只記錄「誰存過檔」，供老師事後看貢獻度，不記內容差異
  await db.insert(reviewSubmissionEditSchema).values({ teamId: player.teamId, playerId });

  await publishTick(gameId);
  return { ok: true };
}
```

改成：

```ts
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

  const [team] = await db
    .select({ leaderId: reviewTeamSchema.leaderId })
    .from(reviewTeamSchema)
    .where(eq(reviewTeamSchema.id, player.teamId))
    .limit(1);
  if (!team || team.leaderId !== playerId) {
    return { ok: false, error: 'NOT_TEAM_LEADER', status: 403 };
  }

  const [game] = await db
    .select({ status: reviewGameSchema.status })
    .from(reviewGameSchema)
    .where(eq(reviewGameSchema.id, gameId))
    .limit(1);
  if (!game || game.status !== 'creating') {
    return { ok: false, error: 'NOT_CREATING_PHASE', status: 409 };
  }

  const [existing] = await db
    .select({ submittedAt: reviewSubmissionSchema.submittedAt })
    .from(reviewSubmissionSchema)
    .where(eq(reviewSubmissionSchema.teamId, player.teamId))
    .limit(1);
  if (existing?.submittedAt) {
    return { ok: false, error: 'ALREADY_SUBMITTED', status: 409 };
  }

  await db
    .insert(reviewSubmissionSchema)
    .values({ teamId: player.teamId, content, lastEditedByPlayerId: playerId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: reviewSubmissionSchema.teamId,
      set: { content, lastEditedByPlayerId: playerId, updatedAt: new Date() },
    });
  // 只記錄「誰存過檔」，供老師事後看貢獻度，不記內容差異
  await db.insert(reviewSubmissionEditSchema).values({ teamId: player.teamId, playerId });

  await publishTick(gameId);
  return { ok: true };
}
```

- [ ] **Step 3: 新增 `upsertDraft`**

緊接在修改後的 `upsertSubmission` 函式之後，新增：

```ts
export async function upsertDraft(params: {
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
    .insert(reviewDraftSchema)
    .values({ teamId: player.teamId, playerId, content, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [reviewDraftSchema.teamId, reviewDraftSchema.playerId],
      set: { content, updatedAt: new Date() },
    });

  await publishTick(gameId);
  return { ok: true };
}
```

- [ ] **Step 4: 新增 `upsertLeaderVote`**

緊接在 `upsertDraft` 之後，新增：

```ts
export async function upsertLeaderVote(params: {
  gameId: number;
  voterPlayerId: number;
  votedForPlayerId: number;
}): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const { gameId, voterPlayerId, votedForPlayerId } = params;

  const [voter] = await db
    .select()
    .from(reviewPlayerSchema)
    .where(and(eq(reviewPlayerSchema.id, voterPlayerId), eq(reviewPlayerSchema.gameId, gameId)))
    .limit(1);
  if (!voter || !voter.teamId) {
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

  const teamMembers = await db
    .select({ id: reviewPlayerSchema.id, joinedAt: reviewPlayerSchema.joinedAt })
    .from(reviewPlayerSchema)
    .where(eq(reviewPlayerSchema.teamId, voter.teamId));
  const target = teamMembers.find(m => m.id === votedForPlayerId);
  if (!target) {
    return { ok: false, error: 'TARGET_NOT_ON_TEAM', status: 400 };
  }

  await db
    .insert(reviewLeaderVoteSchema)
    .values({ teamId: voter.teamId, voterPlayerId, votedForPlayerId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [reviewLeaderVoteSchema.teamId, reviewLeaderVoteSchema.voterPlayerId],
      set: { votedForPlayerId, updatedAt: new Date() },
    });

  const votes = await db
    .select({
      voterPlayerId: reviewLeaderVoteSchema.voterPlayerId,
      votedForPlayerId: reviewLeaderVoteSchema.votedForPlayerId,
    })
    .from(reviewLeaderVoteSchema)
    .where(eq(reviewLeaderVoteSchema.teamId, voter.teamId));
  const newLeaderId = pickLeader(votes, teamMembers);
  if (newLeaderId !== null) {
    await db.update(reviewTeamSchema).set({ leaderId: newLeaderId }).where(eq(reviewTeamSchema.id, voter.teamId));
  }

  await publishTick(gameId);
  return { ok: true };
}
```

- [ ] **Step 5: 新增 `submitFinalAnswer`**

緊接在 `upsertLeaderVote` 之後，新增：

```ts
export async function submitFinalAnswer(params: {
  gameId: number;
  playerId: number;
}): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const { gameId, playerId } = params;

  const [player] = await db
    .select()
    .from(reviewPlayerSchema)
    .where(and(eq(reviewPlayerSchema.id, playerId), eq(reviewPlayerSchema.gameId, gameId)))
    .limit(1);
  if (!player || !player.teamId) {
    return { ok: false, error: 'NOT_ON_TEAM', status: 403 };
  }

  const [team] = await db
    .select({ leaderId: reviewTeamSchema.leaderId })
    .from(reviewTeamSchema)
    .where(eq(reviewTeamSchema.id, player.teamId))
    .limit(1);
  if (!team || team.leaderId !== playerId) {
    return { ok: false, error: 'NOT_TEAM_LEADER', status: 403 };
  }

  const [game] = await db
    .select({ status: reviewGameSchema.status })
    .from(reviewGameSchema)
    .where(eq(reviewGameSchema.id, gameId))
    .limit(1);
  if (!game || game.status !== 'creating') {
    return { ok: false, error: 'NOT_CREATING_PHASE', status: 409 };
  }

  const [existing] = await db
    .select()
    .from(reviewSubmissionSchema)
    .where(eq(reviewSubmissionSchema.teamId, player.teamId))
    .limit(1);
  if (existing?.submittedAt) {
    return { ok: false, error: 'ALREADY_SUBMITTED', status: 409 };
  }

  await db
    .insert(reviewSubmissionSchema)
    .values({
      teamId: player.teamId,
      content: existing?.content ?? '',
      lastEditedByPlayerId: playerId,
      submittedAt: new Date(),
      autoSubmitted: false,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: reviewSubmissionSchema.teamId,
      set: { submittedAt: new Date(), autoSubmitted: false },
    });

  await publishTick(gameId);
  return { ok: true };
}
```

- [ ] **Step 6: 新增 `autoSubmitPendingTeams`**

緊接在 `submitFinalAnswer` 之後，新增：

```ts
// 老師把階段從 creating 推進到 voting 前呼叫：對每一組檢查是否已明確送出，
// 沒有的話依 resolveFallbackContent 規則自動補送出（見
// docs/superpowers/specs/2026-09-30-team-leader-submission-design.md）
export async function autoSubmitPendingTeams(gameId: number): Promise<void> {
  const teams = await db
    .select({ id: reviewTeamSchema.id, leaderId: reviewTeamSchema.leaderId })
    .from(reviewTeamSchema)
    .where(eq(reviewTeamSchema.gameId, gameId));
  if (teams.length === 0) {
    return;
  }
  const teamIds = teams.map(t => t.id);

  const submissions = await db
    .select()
    .from(reviewSubmissionSchema)
    .where(inArray(reviewSubmissionSchema.teamId, teamIds));
  const drafts = await db
    .select()
    .from(reviewDraftSchema)
    .where(inArray(reviewDraftSchema.teamId, teamIds));

  for (const team of teams) {
    const submission = submissions.find(s => s.teamId === team.id);
    if (submission?.submittedAt) {
      continue;
    }
    const leaderDraft = team.leaderId
      ? drafts.find(d => d.teamId === team.id && d.playerId === team.leaderId)
      : undefined;
    const content = resolveFallbackContent({
      existingSubmissionContent: submission?.content ?? null,
      leaderDraftContent: leaderDraft?.content ?? null,
    });

    await db
      .insert(reviewSubmissionSchema)
      .values({
        teamId: team.id,
        content,
        lastEditedByPlayerId: team.leaderId,
        submittedAt: new Date(),
        autoSubmitted: true,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: reviewSubmissionSchema.teamId,
        set: { content, submittedAt: new Date(), autoSubmitted: true, updatedAt: new Date() },
      });
  }
}
```

- [ ] **Step 7: 型別檢查**

Run: `npm run check-types`
Expected: 這幾個新函式本身型別要 PASS；`getTeamsWithProgress`/
`getResultsDetail`/`getTeamState` 因為還沒補 Task 5 新增的欄位，預期仍有
缺漏欄位的錯誤——留給 Task 7 處理，這步只確認新函式自己沒寫錯。

- [ ] **Step 8: Commit**

```bash
git add src/services/review/reviewStore.ts
git commit -m "feat(review): 新增草稿/隊長投票/明確送出/逾時代送的 DB 存取函式"
```

---

## Task 7: `reviewStore.ts` 既有查詢補上隊長/草稿相關欄位

**Files:**
- Modify: `src/services/review/reviewStore.ts:96-163`（`getTeamsWithProgress`）
- Modify: `src/services/review/reviewStore.ts:166-238`（`getResultsDetail`）
- Modify: `src/services/review/reviewStore.ts:285-424`（`getTeamState`）

**Interfaces:**
- Consumes: `reviewDraftSchema`/`reviewLeaderVoteSchema`（Task 4）、
  `summarizeContributors`（Task 3，新簽名）、`ReviewTeamState`/
  `ReviewHostState`/`ReviewTeamResultDetail`（Task 5，新欄位）
- Produces: 這三個既有函式的回傳值符合 Task 5 定義的新型別

- [ ] **Step 1: `getTeamsWithProgress` 換掉 contributors 資料來源、補 leaderId/autoSubmitted**

在 `src/services/review/reviewStore.ts:120-163`，把：

```ts
  const submissions = await db
    .select({ teamId: reviewSubmissionSchema.teamId, content: reviewSubmissionSchema.content })
    .from(reviewSubmissionSchema)
    .where(inArray(reviewSubmissionSchema.teamId, teamIds));
  const votes = await db
    .select({ votedForTeamId: reviewVoteSchema.votedForTeamId })
    .from(reviewVoteSchema)
    .where(inArray(reviewVoteSchema.votedForTeamId, teamIds));
  const edits = await db
    .select({ teamId: reviewSubmissionEditSchema.teamId, playerId: reviewSubmissionEditSchema.playerId })
    .from(reviewSubmissionEditSchema)
    .where(inArray(reviewSubmissionEditSchema.teamId, teamIds));

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
    const teamEdits = edits.filter(e => e.teamId === team.id);

    return {
      id: team.id,
      teamName: team.teamName,
      memberCount: teamPlayers.length,
      members: teamPlayers.map(p => ({ id: p.id, nickname: p.nickname })),
      score: team.score,
      scoredSampleCount: scoredSampleIds.size,
      memberReadyCount,
      hasSubmission: !!submission && submission.content.trim().length > 0,
      contributors: summarizeContributors(teamEdits, teamPlayers.map(p => ({ id: p.id, nickname: p.nickname }))),
      votesReceived,
    };
  });
}
```

改成：

```ts
  const submissions = await db
    .select({
      teamId: reviewSubmissionSchema.teamId,
      content: reviewSubmissionSchema.content,
      autoSubmitted: reviewSubmissionSchema.autoSubmitted,
    })
    .from(reviewSubmissionSchema)
    .where(inArray(reviewSubmissionSchema.teamId, teamIds));
  const votes = await db
    .select({ votedForTeamId: reviewVoteSchema.votedForTeamId })
    .from(reviewVoteSchema)
    .where(inArray(reviewVoteSchema.votedForTeamId, teamIds));
  const drafts = await db
    .select({ teamId: reviewDraftSchema.teamId, playerId: reviewDraftSchema.playerId, content: reviewDraftSchema.content })
    .from(reviewDraftSchema)
    .where(inArray(reviewDraftSchema.teamId, teamIds));

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
    const teamDrafts = drafts
      .filter(d => d.teamId === team.id)
      .map(d => ({ playerId: d.playerId, charCount: d.content.length }));

    return {
      id: team.id,
      teamName: team.teamName,
      memberCount: teamPlayers.length,
      members: teamPlayers.map(p => ({ id: p.id, nickname: p.nickname })),
      score: team.score,
      scoredSampleCount: scoredSampleIds.size,
      memberReadyCount,
      hasSubmission: !!submission && submission.content.trim().length > 0,
      leaderId: team.leaderId,
      autoSubmitted: submission?.autoSubmitted ?? false,
      contributors: summarizeContributors(teamDrafts, teamPlayers.map(p => ({ id: p.id, nickname: p.nickname }))),
      votesReceived,
    };
  });
}
```

同時把這個函式前面已經不再需要的
`reviewSubmissionEditSchema` 查詢（原本 L128-131 的 `edits`）一併刪除
（上面的替換已經沒有留它）。

- [ ] **Step 2: `getResultsDetail` 比照修改**

在 `src/services/review/reviewStore.ts:181-236`，把：

```ts
  const submissions = await db
    .select()
    .from(reviewSubmissionSchema)
    .where(inArray(reviewSubmissionSchema.teamId, teamIds));
  const voteRows = await db
    .select()
    .from(reviewVoteSchema)
    .where(inArray(reviewVoteSchema.votedForTeamId, teamIds));
  const edits = await db
    .select({ teamId: reviewSubmissionEditSchema.teamId, playerId: reviewSubmissionEditSchema.playerId })
    .from(reviewSubmissionEditSchema)
    .where(inArray(reviewSubmissionEditSchema.teamId, teamIds));
  const accuracyPoints = distributeAccuracyPoints(samples.length);
```

改成：

```ts
  const submissions = await db
    .select()
    .from(reviewSubmissionSchema)
    .where(inArray(reviewSubmissionSchema.teamId, teamIds));
  const voteRows = await db
    .select()
    .from(reviewVoteSchema)
    .where(inArray(reviewVoteSchema.votedForTeamId, teamIds));
  const drafts = await db
    .select({ teamId: reviewDraftSchema.teamId, playerId: reviewDraftSchema.playerId, content: reviewDraftSchema.content })
    .from(reviewDraftSchema)
    .where(inArray(reviewDraftSchema.teamId, teamIds));
  const accuracyPoints = distributeAccuracyPoints(samples.length);
```

然後把函式最後的 return 區塊，把：

```ts
    const submission = submissions.find(s => s.teamId === team.id);
    const votesReceived = voteRows.filter(v => v.votedForTeamId === team.id).length;
    const teamPlayers = players.filter(p => p.teamId === team.id);
    const teamEdits = edits.filter(e => e.teamId === team.id);

    return {
      teamId: team.id,
      members: teamPlayers.map(p => ({ id: p.id, nickname: p.nickname })),
      samples: sampleDetails,
      accuracyScore: team.accuracyScore,
      speedBonus: team.speedBonus,
      voteBonus: team.voteBonus,
      submission: submission?.content ?? null,
      contributors: summarizeContributors(teamEdits, teamPlayers.map(p => ({ id: p.id, nickname: p.nickname }))),
      votesReceived,
    };
  });
}
```

改成：

```ts
    const submission = submissions.find(s => s.teamId === team.id);
    const votesReceived = voteRows.filter(v => v.votedForTeamId === team.id).length;
    const teamPlayers = players.filter(p => p.teamId === team.id);
    const teamDrafts = drafts
      .filter(d => d.teamId === team.id)
      .map(d => ({ playerId: d.playerId, charCount: d.content.length }));

    return {
      teamId: team.id,
      members: teamPlayers.map(p => ({ id: p.id, nickname: p.nickname })),
      samples: sampleDetails,
      accuracyScore: team.accuracyScore,
      speedBonus: team.speedBonus,
      voteBonus: team.voteBonus,
      submission: submission?.content ?? null,
      leaderId: team.leaderId,
      autoSubmitted: submission?.autoSubmitted ?? false,
      contributors: summarizeContributors(teamDrafts, teamPlayers.map(p => ({ id: p.id, nickname: p.nickname }))),
      votesReceived,
    };
  });
}
```

- [ ] **Step 3: `getTeamState` 補 leaderId / myDraft / teammateDrafts / myLeaderVote / submission 擴充欄位**

在 `src/services/review/reviewStore.ts:316-323`，把宣告區塊：

```ts
  let teammates: { id: number; nickname: string }[] = [];
  const myScores: ReviewTeamState['myScores'] = {};
  const teammateScores: ReviewTeamState['teammateScores'] = {};
  let submission: ReviewTeamState['submission'] = null;
  let hasVoted = false;
  let votingCandidates: ReviewTeamState['votingCandidates'] = null;
  let finalTeamRank: ReviewTeamState['finalTeamRank'] = null;
  let teamName: string | null = null;
```

改成：

```ts
  let teammates: { id: number; nickname: string }[] = [];
  const myScores: ReviewTeamState['myScores'] = {};
  const teammateScores: ReviewTeamState['teammateScores'] = {};
  let leaderId: number | null = null;
  let myDraft = '';
  let teammateDrafts: ReviewTeamState['teammateDrafts'] = [];
  let myLeaderVote: number | null = null;
  let submission: ReviewTeamState['submission'] = null;
  let hasVoted = false;
  let votingCandidates: ReviewTeamState['votingCandidates'] = null;
  let finalTeamRank: ReviewTeamState['finalTeamRank'] = null;
  let teamName: string | null = null;
```

在 `src/services/review/reviewStore.ts:325-331`，把：

```ts
  if (me.teamId) {
    const [team] = await db
      .select({ teamName: reviewTeamSchema.teamName })
      .from(reviewTeamSchema)
      .where(eq(reviewTeamSchema.id, me.teamId))
      .limit(1);
    teamName = team?.teamName ?? null;
```

改成：

```ts
  if (me.teamId) {
    const [team] = await db
      .select({ teamName: reviewTeamSchema.teamName, leaderId: reviewTeamSchema.leaderId })
      .from(reviewTeamSchema)
      .where(eq(reviewTeamSchema.id, me.teamId))
      .limit(1);
    teamName = team?.teamName ?? null;
    leaderId = team?.leaderId ?? null;
```

在同一個 `if (me.teamId)` 區塊內，緊接在既有的 `teammates = teamMembers.filter(...)`
那一行之後（`src/services/review/reviewStore.ts:337` 附近），插入草稿與
投票查詢：

```ts
    teammates = teamMembers.filter(p => p.id !== me.id);

    const teamDrafts = await db
      .select({ playerId: reviewDraftSchema.playerId, content: reviewDraftSchema.content, updatedAt: reviewDraftSchema.updatedAt })
      .from(reviewDraftSchema)
      .where(eq(reviewDraftSchema.teamId, me.teamId));
    myDraft = teamDrafts.find(d => d.playerId === me.id)?.content ?? '';
    teammateDrafts = teamDrafts
      .filter(d => d.playerId !== me.id)
      .map(d => ({
        playerId: d.playerId,
        nickname: teamMembers.find(m => m.id === d.playerId)?.nickname ?? '組員',
        content: d.content,
        updatedAt: d.updatedAt.toISOString(),
      }));

    const [myVoteRow] = await db
      .select({ votedForPlayerId: reviewLeaderVoteSchema.votedForPlayerId })
      .from(reviewLeaderVoteSchema)
      .where(and(eq(reviewLeaderVoteSchema.teamId, me.teamId), eq(reviewLeaderVoteSchema.voterPlayerId, me.id)))
      .limit(1);
    myLeaderVote = myVoteRow?.votedForPlayerId ?? null;
```

最後把 `submission` 的組裝（`src/services/review/reviewStore.ts:362-369`），
把：

```ts
    const [sub] = await db
      .select()
      .from(reviewSubmissionSchema)
      .where(eq(reviewSubmissionSchema.teamId, me.teamId))
      .limit(1);
    if (sub) {
      submission = { content: sub.content, updatedAt: sub.updatedAt.toISOString() };
    }
```

改成：

```ts
    const [sub] = await db
      .select()
      .from(reviewSubmissionSchema)
      .where(eq(reviewSubmissionSchema.teamId, me.teamId))
      .limit(1);
    if (sub) {
      submission = {
        content: sub.content,
        updatedAt: sub.updatedAt.toISOString(),
        submittedAt: sub.submittedAt ? sub.submittedAt.toISOString() : null,
        autoSubmitted: sub.autoSubmitted,
      };
    }
```

最後把函式結尾的 return 物件（`src/services/review/reviewStore.ts:406-423`），
把：

```ts
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
```

改成：

```ts
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
    leaderId,
    myDraft,
    teammateDrafts,
    myLeaderVote,
    submission,
    hasVoted,
    votingCandidates,
    finalTeamRank,
  };
}
```

- [ ] **Step 4: 移除不再使用的 `reviewSubmissionEditSchema` import（如果整份檔案已經沒有其他地方用到）**

Run: `grep -n "reviewSubmissionEditSchema" src/services/review/reviewStore.ts`

如果結果只剩 `upsertSubmission` 裡 `await db.insert(reviewSubmissionEditSchema)...`
那一行（沒有其他 select 查詢在用），保留 import；只有在完全沒有任何用法時
才把 import 刪掉。**預期結果**：`upsertSubmission` 仍在寫入這張表（隊長送出
紀錄），所以 import 要保留，不要刪。

- [ ] **Step 5: 型別檢查與現有測試**

Run: `npm run check-types && npx vitest run src/services/review`
Expected: `check-types` PASS（Task 5 的型別缺漏此時應該都補齊了）；
`vitest run` 底下所有 `src/services/review/*.test.ts` PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/review/reviewStore.ts
git commit -m "feat(review): getTeamState/getHostState 補上隊長與獨立草稿資料"
```

---

## Task 8: `reviewActions.ts` 預設隊長 + 逾時自動送出掛鉤

**Files:**
- Modify: `src/actions/reviewActions.ts:95-159`（`startTeamForming`）
- Modify: `src/actions/reviewActions.ts:235-255`（`startVoting`）

**Interfaces:**
- Consumes: `autoSubmitPendingTeams`（Task 6，從 `@/services/review/reviewStore` 匯入）

- [ ] **Step 1: `startTeamForming` 依加入順序分組、新組預設隊長為該組最早加入者**

在 `src/actions/reviewActions.ts:127-135`，把：

```ts
  const players = await db
    .select({ id: reviewPlayerSchema.id })
    .from(reviewPlayerSchema)
    .where(eq(reviewPlayerSchema.gameId, gameId));
  if (players.length === 0) {
    return { error: 'NO_PLAYERS' };
  }

  const teamGroups = assignTeamsRoundRobin(players.map(p => p.id), teamSize);
```

改成（加 `.orderBy(asc(reviewPlayerSchema.id))`，`id` 遞增即加入順序，
確保 round-robin 分配結果具決定性，`memberIds[0]` 才等於「該組最早加入的
成員」）：

```ts
  const players = await db
    .select({ id: reviewPlayerSchema.id })
    .from(reviewPlayerSchema)
    .where(eq(reviewPlayerSchema.gameId, gameId))
    .orderBy(asc(reviewPlayerSchema.id));
  if (players.length === 0) {
    return { error: 'NO_PLAYERS' };
  }

  const teamGroups = assignTeamsRoundRobin(players.map(p => p.id), teamSize);
```

在 `src/actions/reviewActions.ts:5`，把 drizzle-orm import 加上 `asc`：

```ts
import { and, count, eq, inArray } from 'drizzle-orm';
```

改成：

```ts
import { and, asc, count, eq, inArray } from 'drizzle-orm';
```

在 `src/actions/reviewActions.ts:138-145`，把建立 team 的部分：

```ts
    for (const [i, memberIds] of teamGroups.entries()) {
      const [team] = await tx
        .insert(reviewTeamSchema)
        .values({ gameId, teamName: `第 ${i + 1} 組` })
        .returning();
      if (!team) {
        continue;
      }
```

改成（`memberIds[0]` 是 round-robin 第一輪分配進這組的玩家，也就是這組
最早加入的成員，設為預設隊長）：

```ts
    for (const [i, memberIds] of teamGroups.entries()) {
      const [team] = await tx
        .insert(reviewTeamSchema)
        .values({ gameId, teamName: `第 ${i + 1} 組`, leaderId: memberIds[0] ?? null })
        .returning();
      if (!team) {
        continue;
      }
```

- [ ] **Step 2: `startVoting` 呼叫 `autoSubmitPendingTeams`**

在 `src/actions/reviewActions.ts:17`（import 區塊），加入：

```ts
import { getReviewSamples } from '@/services/review/reviewStore';
```

改成：

```ts
import { autoSubmitPendingTeams, getReviewSamples } from '@/services/review/reviewStore';
```

在 `src/actions/reviewActions.ts:235-255`，把：

```ts
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
```

改成：

```ts
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

  // 隊長還沒按「確認送出」的組，用目前內容自動代送，避免老師卡在這一步
  await autoSubmitPendingTeams(gameId);

  await db
    .update(reviewGameSchema)
    .set({ status: 'voting', phaseStartedAt: null, phaseDurationSec: null })
    .where(eq(reviewGameSchema.id, gameId));

  await publishTick(gameId);
  return { ok: true as const };
}
```

- [ ] **Step 3: 型別檢查**

Run: `npm run check-types`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/actions/reviewActions.ts
git commit -m "feat(review): 分組時指定預設隊長、進投票階段前自動代送未送出的組"
```

---

## Task 9: 新增 3 支學生端 API Route（draft / leader-vote / submit-final）

**Files:**
- Create: `src/app/api/review/[gameId]/draft/route.ts`
- Create: `src/app/api/review/[gameId]/leader-vote/route.ts`
- Create: `src/app/api/review/[gameId]/submit-final/route.ts`

**Interfaces:**
- Consumes: `upsertDraft`/`upsertLeaderVote`/`submitFinalAnswer`/
  `verifyPlayerToken`（Task 6，`@/services/review/reviewStore`）

- [ ] **Step 1: `draft/route.ts`**

```ts
// src/app/api/review/[gameId]/draft/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { upsertDraft, verifyPlayerToken } from '@/services/review/reviewStore';

export const runtime = 'nodejs';

const BodySchema = z.object({
  playerId: z.number().int().positive(),
  playerToken: z.string().min(1),
  content: z.string().trim().max(2000, '草稿最多 2000 字'),
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

  const result = await upsertDraft({
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

- [ ] **Step 2: `leader-vote/route.ts`**

```ts
// src/app/api/review/[gameId]/leader-vote/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { upsertLeaderVote, verifyPlayerToken } from '@/services/review/reviewStore';

export const runtime = 'nodejs';

const BodySchema = z.object({
  playerId: z.number().int().positive(),
  playerToken: z.string().min(1),
  votedForPlayerId: z.number().int().positive(),
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

  const result = await upsertLeaderVote({
    gameId,
    voterPlayerId: parsed.data.playerId,
    votedForPlayerId: parsed.data.votedForPlayerId,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: `submit-final/route.ts`**

```ts
// src/app/api/review/[gameId]/submit-final/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { submitFinalAnswer, verifyPlayerToken } from '@/services/review/reviewStore';

export const runtime = 'nodejs';

const BodySchema = z.object({
  playerId: z.number().int().positive(),
  playerToken: z.string().min(1),
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

  const result = await submitFinalAnswer({ gameId, playerId: parsed.data.playerId });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: 型別檢查**

Run: `npm run check-types`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/review/\[gameId\]/draft/route.ts src/app/api/review/\[gameId\]/leader-vote/route.ts src/app/api/review/\[gameId\]/submit-final/route.ts
git commit -m "feat(review): 新增草稿/隊長投票/明確送出三支學生端 API Route"
```

---

## Task 10: Middleware 註冊新的公開學生端路由

**Files:**
- Modify: `src/middleware.ts:50-61`

**Interfaces:**
（無新函式，只是 matcher 清單異動）

- [ ] **Step 1: 把 3 支新 route 加進 `isPublicApiRoute`**

在 `src/middleware.ts:50-61`，把：

```ts
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

改成：

```ts
  '/api/review/join',
  '/:locale/api/review/join',
  '/api/review/(.*)/team-state',
  '/:locale/api/review/(.*)/team-state',
  '/api/review/(.*)/score',
  '/:locale/api/review/(.*)/score',
  '/api/review/(.*)/submission',
  '/:locale/api/review/(.*)/submission',
  '/api/review/(.*)/draft',
  '/:locale/api/review/(.*)/draft',
  '/api/review/(.*)/leader-vote',
  '/:locale/api/review/(.*)/leader-vote',
  '/api/review/(.*)/submit-final',
  '/:locale/api/review/(.*)/submit-final',
  '/api/review/(.*)/vote',
  '/:locale/api/review/(.*)/vote',
  '/api/review/(.*)/heartbeat',
  '/:locale/api/review/(.*)/heartbeat',
```

- [ ] **Step 2: 型別檢查**

Run: `npm run check-types`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(review): middleware 放行草稿/隊長投票/明確送出三支學生端路由"
```

---

## Task 11: `useReviewTeamGame.ts` 加三個提交動作

**Files:**
- Modify: `src/hooks/useReviewTeamGame.ts`

**Interfaces:**
- Produces: hook 回傳值新增 `submitDraft(content: string): Promise<ActionResult>`、
  `submitLeaderVote(votedForPlayerId: number): Promise<ActionResult>`、
  `submitFinalAnswer(): Promise<ActionResult>`
  （`ActionResult = { ok: true } | { ok: false; error: string }`，沿用檔案內既有型別）
- Consumed by: Task 12（`ReviewPlayerCreate.tsx`）、
  Task 13（`ReviewPlayRoom.tsx` 把這幾個函式往下傳）

> 注意：檔案裡已經有一個 `submitSubmission` 對應舊的 `/api/review/[gameId]/submission`
> route，這次不用改名也不用刪除——修改後的 `upsertSubmission`（Task 6）依然
> 是「隊長挑基底後微調」用的那個 API，語意自然接上，只是現在多了權限檢查。

- [ ] **Step 1: 在既有 `submitSubmission` 之後加三個新的 `useCallback`**

在 `src/hooks/useReviewTeamGame.ts`，找到：

```ts
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
```

緊接在它之後，插入：

```ts
  const submitDraft = useCallback(
    async (content: string): Promise<ActionResult> => {
      setSubmitting(true);
      try {
        return await postJson(`/api/review/${gameId}/draft`, { playerId, playerToken, content });
      } finally {
        setSubmitting(false);
      }
    },
    [gameId, playerId, playerToken],
  );

  const submitLeaderVote = useCallback(
    async (votedForPlayerId: number): Promise<ActionResult> => {
      setSubmitting(true);
      try {
        return await postJson(`/api/review/${gameId}/leader-vote`, { playerId, playerToken, votedForPlayerId });
      } finally {
        setSubmitting(false);
      }
    },
    [gameId, playerId, playerToken],
  );

  const submitFinalAnswer = useCallback(
    async (): Promise<ActionResult> => {
      setSubmitting(true);
      try {
        return await postJson(`/api/review/${gameId}/submit-final`, { playerId, playerToken });
      } finally {
        setSubmitting(false);
      }
    },
    [gameId, playerId, playerToken],
  );
```

- [ ] **Step 2: 把新函式加進回傳值**

找到檔案結尾：

```ts
  return { state, error, submitting, isReconnecting, submitScore, submitSubmission, submitVote };
}
```

改成：

```ts
  return {
    state,
    error,
    submitting,
    isReconnecting,
    submitScore,
    submitSubmission,
    submitVote,
    submitDraft,
    submitLeaderVote,
    submitFinalAnswer,
  };
}
```

- [ ] **Step 3: 型別檢查**

Run: `npm run check-types`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useReviewTeamGame.ts
git commit -m "feat(review): hook 補上草稿/隊長投票/明確送出三個提交動作"
```

---

## Task 12: `ReviewPlayerCreate.tsx` 重構成三塊（我的草稿／隊員草稿一覽／隊長整合送出）

**Files:**
- Modify: `src/features/review/ReviewPlayerCreate.tsx`（整份重寫）

**Interfaces:**
- Consumes: `ReviewTeamState`（Task 5 新增的 `leaderId`/`myDraft`/
  `teammateDrafts`/`myLeaderVote`/`submission.submittedAt`/`.autoSubmitted`）、
  `submitDraft`/`submitLeaderVote`/`submitFinalAnswer`/`submitSubmission`
  （Task 11）
- Produces: `Props` 從 `{ topicPrompt, initialContent, onSave }` 改成
  `{ state: ReviewTeamState; onSaveDraft; onVoteLeader; onSaveFinalAnswer; onSubmitFinal }`
  （由 Task 13 的 `ReviewPlayRoom.tsx` 負責組裝這些 prop）

- [ ] **Step 1: 整份改寫元件**

把 `src/features/review/ReviewPlayerCreate.tsx`（現有 57 行）整份取代成：

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';

import type { ReviewTeamState } from '@/services/review/types';

const TEXTAREA_CLASS = 'w-full rounded-md border border-input bg-background px-3 py-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
const AUTOSAVE_DEBOUNCE_MS = 1500;

type ActionResult = { ok: true } | { ok: false; error: string };

type Props = {
  state: ReviewTeamState;
  onSaveDraft: (content: string) => Promise<ActionResult>;
  onVoteLeader: (votedForPlayerId: number) => Promise<ActionResult>;
  onSaveFinalAnswer: (content: string) => Promise<ActionResult>;
  onSubmitFinal: () => Promise<ActionResult>;
};

// 沿用原本的 debounce autosave 邏輯，包成通用元件給「我的草稿」跟「隊長的
// 最終答案」共用，兩者除了文案跟 disabled 狀態以外行為一致
function useAutosaveTextarea(initialValue: string, onSave: (value: string) => Promise<ActionResult>) {
  const [value, setValue] = useState(initialValue);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (next: string) => {
    setValue(next);
    setStatus('idle');
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(async () => {
      setStatus('saving');
      const result = await onSave(next);
      setStatus(result.ok ? 'saved' : 'idle');
    }, AUTOSAVE_DEBOUNCE_MS);
  };

  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
  }, []);

  return { value, setValue, status, handleChange };
}

export function ReviewPlayerCreate({ state, onSaveDraft, onVoteLeader, onSaveFinalAnswer, onSubmitFinal }: Props) {
  const isLeader = state.leaderId === state.me.id;
  const isSubmitted = state.submission?.submittedAt != null;

  const myDraftBox = useAutosaveTextarea(state.myDraft, onSaveDraft);
  const finalAnswerBox = useAutosaveTextarea(state.submission?.content ?? '', onSaveFinalAnswer);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'submitting' | 'error'>('idle');

  const allMembers = [
    { id: state.me.id, nickname: state.me.nickname, content: myDraftBox.value },
    ...state.teammates.map((t) => {
      const draft = state.teammateDrafts.find(d => d.playerId === t.id);
      return { id: t.id, nickname: t.nickname, content: draft?.content ?? '' };
    }),
  ];

  const handleAdoptDraft = (content: string) => {
    finalAnswerBox.setValue(content);
    finalAnswerBox.handleChange(content);
  };

  const handleSubmitFinal = async () => {
    setSubmitStatus('submitting');
    const result = await onSubmitFinal();
    setSubmitStatus(result.ok ? 'idle' : 'error');
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-lg font-bold">共同創作延伸答案</h1>
        <p className="mt-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground">{state.topicPrompt}</p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">我的草稿</h2>
        <textarea
          value={myDraftBox.value}
          onChange={e => myDraftBox.handleChange(e.target.value)}
          rows={6}
          placeholder="先寫下你自己的延伸想法⋯"
          className={TEXTAREA_CLASS}
        />
        <p className="text-xs text-muted-foreground">
          {myDraftBox.status === 'saving' ? '儲存中⋯' : myDraftBox.status === 'saved' ? '已儲存' : ' '}
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">投給隊長</h2>
        <p className="text-xs text-muted-foreground">
          目前隊長：
          {allMembers.find(m => m.id === state.leaderId)?.nickname ?? '（尚未決定）'}
        </p>
        <div className="flex flex-wrap gap-2">
          {allMembers.map(m => (
            <button
              key={m.id}
              type="button"
              onClick={() => onVoteLeader(m.id)}
              className={`rounded-full border px-3 py-1 text-xs ${
                state.myLeaderVote === m.id ? 'border-primary bg-primary/10 text-primary' : 'border-input'
              }`}
            >
              {m.nickname}
              {m.id === state.me.id ? '（我）' : ''}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-lg border p-3">
        <h2 className="text-sm font-semibold">隊員草稿一覽</h2>
        {allMembers.map(m => (
          <div key={m.id} className="rounded-md bg-muted p-2 text-sm">
            <p className="text-xs font-medium text-muted-foreground">
              {m.nickname}
              {m.id === state.leaderId ? '（隊長）' : ''}
            </p>
            <p className="mt-1 whitespace-pre-wrap">{m.content || '（尚未撰寫）'}</p>
          </div>
        ))}
      </section>

      {isLeader
        ? (
            <section className="space-y-2 rounded-lg border border-primary p-3">
              <h2 className="text-sm font-semibold">整合送出（隊長專屬）</h2>
              <div className="flex flex-wrap gap-2">
                {allMembers.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={isSubmitted}
                    onClick={() => handleAdoptDraft(m.content)}
                    className="rounded-md border border-input px-2 py-1 text-xs disabled:opacity-50"
                  >
                    採用
                    {m.nickname}
                    的草稿
                  </button>
                ))}
              </div>
              <textarea
                value={finalAnswerBox.value}
                onChange={e => finalAnswerBox.handleChange(e.target.value)}
                rows={8}
                disabled={isSubmitted}
                placeholder="挑一份草稿當基底，微調後送出⋯"
                className={TEXTAREA_CLASS}
              />
              <p className="text-xs text-muted-foreground">
                {finalAnswerBox.status === 'saving' ? '儲存中⋯' : finalAnswerBox.status === 'saved' ? '已儲存' : ' '}
              </p>
              {isSubmitted
                ? <p className="text-sm font-medium text-emerald-600">✅ 已送出，等待老師進入下一階段</p>
                : (
                    <button
                      type="button"
                      onClick={handleSubmitFinal}
                      disabled={submitStatus === 'submitting'}
                      className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                    >
                      確認送出
                    </button>
                  )}
              {submitStatus === 'error' && <p className="text-xs text-destructive">送出失敗，請再試一次</p>}
            </section>
          )
        : (
            <section className="rounded-lg border p-3 text-sm text-muted-foreground">
              {isSubmitted
                ? '✅ 已送出，等待老師進入下一階段'
                : `隊長 ${allMembers.find(m => m.id === state.leaderId)?.nickname ?? ''} 正在整理最終答案⋯`}
            </section>
          )}
    </div>
  );
}
```

- [ ] **Step 2: 型別檢查**

Run: `npm run check-types`
Expected: 這一步 `ReviewPlayerCreate` 本身型別會 PASS，但呼叫它的
`ReviewPlayRoom.tsx`（還沒更新）會出現 props 不符的錯誤——留給 Task 13 處理。

- [ ] **Step 3: Commit**

```bash
git add src/features/review/ReviewPlayerCreate.tsx
git commit -m "feat(review): ReviewPlayerCreate 改成獨立草稿+隊長整合送出三段式畫面"
```

---

## Task 13: `ReviewPlayRoom.tsx` 接上新的 hook 動作與元件 props

**Files:**
- Modify: `src/app/[locale]/review/play/[gameId]/ReviewPlayRoom.tsx`

**Interfaces:**
- Consumes: `submitDraft`/`submitLeaderVote`/`submitFinalAnswer`（Task 11）、
  新版 `ReviewPlayerCreate` props（Task 12）

- [ ] **Step 1: 從 hook 解構新增的三個函式**

把：

```tsx
  const {
    state,
    error,
    submitting,
    isReconnecting,
    submitScore,
    submitSubmission,
    submitVote,
  } = useReviewTeamGame(gameId, playerId, playerToken);
```

改成：

```tsx
  const {
    state,
    error,
    submitting,
    isReconnecting,
    submitScore,
    submitSubmission,
    submitVote,
    submitDraft,
    submitLeaderVote,
    submitFinalAnswer,
  } = useReviewTeamGame(gameId, playerId, playerToken);
```

- [ ] **Step 2: 更新 `creating` 分支傳入新 props**

把：

```tsx
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
```

改成：

```tsx
  if (status === 'creating') {
    return (
      <>
        {banner}
        <ReviewPlayerCreate
          state={state}
          onSaveDraft={submitDraft}
          onVoteLeader={submitLeaderVote}
          onSaveFinalAnswer={submitSubmission}
          onSubmitFinal={submitFinalAnswer}
        />
      </>
    );
  }
```

- [ ] **Step 2: 型別檢查**

Run: `npm run check-types`
Expected: PASS（`ReviewPlayerCreate` 的 props 現在跟 Task 12 的新簽名一致）

- [ ] **Step 3: Commit**

```bash
git add src/app/\[locale\]/review/play/\[gameId\]/ReviewPlayRoom.tsx
git commit -m "feat(review): ReviewPlayRoom 接上草稿/隊長投票/明確送出動作"
```

---

## Task 14: 老師端顯示改用 charCount + 隊長/自動送出標記

**Files:**
- Modify: `src/features/review/ReviewHostProgress.tsx:78-80`
- Modify: `src/features/review/ReviewHostResults.tsx:60-64`
- Modify: `src/app/api/review/[gameId]/export-csv/route.ts:50`

**Interfaces:**
- Consumes: `ReviewHostState.teams[].leaderId`/`.autoSubmitted`、
  `ReviewTeamResultDetail.leaderId`/`.autoSubmitted`、
  `Contributor.charCount`（Task 5、Task 3）

- [ ] **Step 1: `ReviewHostProgress.tsx` 顯示改字數 + 加隊長標記**

把：

```tsx
            <p className="mt-1 text-sm text-muted-foreground">
              已動手：
              {team.contributors.length === 0
                ? '尚無人存檔'
                : team.contributors.map(c => `${c.nickname}(${c.editCount}次)`).join('、')}
            </p>
```

改成：

```tsx
            <p className="mt-1 text-sm text-muted-foreground">
              目前隊長：
              {team.members.find(m => m.id === team.leaderId)?.nickname ?? '（尚未決定）'}
              {team.autoSubmitted ? '（系統自動送出）' : ''}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              已動手：
              {team.contributors.length === 0
                ? '尚無人寫草稿'
                : team.contributors.map(c => `${c.nickname}(${c.charCount}字)`).join('、')}
            </p>
```

- [ ] **Step 2: `ReviewHostResults.tsx` 顯示改字數 + 加隊長/自動送出標記**

把：

```tsx
                  <p className="mt-1">
                    共創已動手：
                    {detail.contributors.length === 0
                      ? '無記錄'
                      : detail.contributors.map(c => `${c.nickname}(${c.editCount}次)`).join('、')}
                  </p>
```

改成：

```tsx
                  <p className="mt-1">
                    隊長：
                    {detail.members.find(m => m.id === detail.leaderId)?.nickname ?? '（無）'}
                    {detail.autoSubmitted ? '（系統自動送出）' : ''}
                  </p>
                  <p className="mt-1">
                    共創已動手：
                    {detail.contributors.length === 0
                      ? '無記錄'
                      : detail.contributors.map(c => `${c.nickname}(${c.charCount}字)`).join('、')}
                  </p>
```

- [ ] **Step 3: `export-csv/route.ts` 欄位跟著改**

把：

```ts
  const header = ['組別', '組員', '總分', '準確度分', '速度加成', '投票加成', '收到票數', '共創已動手', '創作答案'];
  const rows = state.resultsDetail.map((detail) => {
    const team = state.teams.find(t => t.id === detail.teamId);
    return [
      team?.teamName ?? `組別 ${detail.teamId}`,
      detail.members.map(m => m.nickname).join('、'),
      String(team?.score ?? 0),
      String(detail.accuracyScore),
      String(detail.speedBonus),
      String(detail.voteBonus),
      String(detail.votesReceived),
      detail.contributors.map(c => `${c.nickname}(${c.editCount}次)`).join('、') || '無記錄',
      detail.submission ?? '（未提交）',
    ];
  });
```

改成：

```ts
  const header = ['組別', '組員', '隊長', '總分', '準確度分', '速度加成', '投票加成', '收到票數', '共創已動手', '創作答案'];
  const rows = state.resultsDetail.map((detail) => {
    const team = state.teams.find(t => t.id === detail.teamId);
    const leaderNickname = detail.members.find(m => m.id === detail.leaderId)?.nickname ?? '';
    return [
      team?.teamName ?? `組別 ${detail.teamId}`,
      detail.members.map(m => m.nickname).join('、'),
      leaderNickname + (detail.autoSubmitted ? '（系統自動送出）' : ''),
      String(team?.score ?? 0),
      String(detail.accuracyScore),
      String(detail.speedBonus),
      String(detail.voteBonus),
      String(detail.votesReceived),
      detail.contributors.map(c => `${c.nickname}(${c.charCount}字)`).join('、') || '無記錄',
      detail.submission ?? '（未提交）',
    ];
  });
```

- [ ] **Step 4: 型別檢查 + 完整測試**

Run: `npm run check-types && npm run lint && npm run test`
Expected: 三個指令都 PASS，0 failures

- [ ] **Step 5: Commit**

```bash
git add src/features/review/ReviewHostProgress.tsx src/features/review/ReviewHostResults.tsx src/app/api/review/\[gameId\]/export-csv/route.ts
git commit -m "feat(review): 老師端顯示改用草稿字數，加上隊長與自動送出標記"
```

---

## Task 15: 建置驗證 + 手動多分頁端到端驗證

**Files:**
（無程式碼異動，純驗證）

- [ ] **Step 1: 全量自動化驗證**

Run: `npm run check-types && npm run lint && npm run test && npm run build`
Expected: 四個指令全部 0 error / 0 failures。**這一步是宣稱完成前的硬性
門檻**（CLAUDE.md「verification-before-completion」skill 觸發條件），不能
只看前三個就喊完成——`npm run build` 才會抓到 `'use server'` 檔案匯出限制
之類 typecheck/vitest 都測不出來的問題（已知坑，見記憶
`feedback_use_server_export_restriction.md`）。

- [ ] **Step 2: 本機起 dev server 手動驗證**

Run: `npm run dev`

用多個瀏覽器分頁模擬 3-4 位學生，走一次完整流程：

1. 老師建立/開啟一個既有的協作批閱題組場次，開場、學生用房間碼加入
2. 老師按「開始分組」→ 確認每組 `review_team.leader_id` 自動填成該組
   最早加入的成員（可從老師端「目前隊長」欄位確認）
3. 老師「開始評分回合」→「進入共創回合」
4. creating 階段：
   - 分頁 A 投給分頁 B 當隊長 → 確認所有分頁「目前隊長」即時變成 B
   - 分頁 A、B、C 在「我的草稿」各自打不同內容 → 確認三份互不覆蓋，
     「隊員草稿一覽」都看得到彼此的草稿
   - 只有隊長 B 的畫面看得到「整合送出（隊長專屬）」區塊，A、C 看到的是
     「隊長 B 正在整理最終答案⋯」
   - B 點某人的「採用 X 的草稿」→ 確認最終答案文字框被換成那份內容，
     微調後按「確認送出」→ A、C 畫面變成「已送出，等待老師進入下一階段」，
     B 自己的文字框跟按鈕都變成 disabled
5. 另外開一組，故意不讓隊長按送出，老師直接按「進入投票回合」→ 回到
   老師端確認該組顯示「系統自動送出」標記，內容是隊長當下文字框裡的值
6. 走完 voting → results，確認老師端「共創已動手」欄位顯示的是字數
   （不是次數），「隊長」「是否自動送出」欄位正確，CSV 匯出內容一致

- [ ] **Step 3: 如果手動驗證發現問題**

回到對應的 Task 修正程式碼，修完重新跑 Step 1 的四個指令確認沒有新增
失敗，再重新走一次 Step 2 相關的那幾個步驟（不用整套重跑，只重跑受影響
的階段）。

- [ ] **Step 4: 確認沒有殘留的除錯用程式碼或註解**

Run: `git diff main --stat` 檢查這個 branch 改動的檔案清單，跟這份計畫
Task 1-14 列出的檔案逐一核對，確認沒有多出計畫外的檔案異動。
