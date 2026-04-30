# Live Mode Sub-A：斷線偵測 + 重連 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Live Mode 加 heartbeat 機制讓老師看到誰斷線、學生網路抖動時看到 reconnect banner，採純 REST 心跳實作以同時涵蓋 polling 與 Ably WS 兩種 transport。

**Architecture:** `live_player.last_seen_at` 新欄 + `POST /api/live/[gameId]/heartbeat` endpoint，player 每 5s ping，host buildHostState 依「現在 - last_seen_at > 15s」判 disconnected。Player 端 useLivePlayerGame 計連續 fetch 失敗次數，≥2 次顯示 reconnect banner。

**Tech Stack:** Drizzle ORM + Neon Postgres、Next.js App Router、既有 realtimeAdapter 抽象（polling default / Ably opt-in）。

**Spec:** `docs/superpowers/specs/2026-04-30-live-mode-disconnect-detection-design.md`

---

## File Structure

| 檔案 | 動作 | 責任 |
|------|------|------|
| `src/models/Schema.ts` | modify | livePlayerSchema 加 `lastSeenAt` 欄 |
| `migrations/00XX_<name>.sql` | create (auto-gen) | `ALTER TABLE live_player ADD COLUMN last_seen_at` |
| `src/services/live/types.ts` | modify | `LivePlayerSummary` 加 `disconnected: boolean` |
| `src/services/live/liveStore.ts` | modify | `getPlayers` 撈 `lastSeenAt` + 計算 disconnected |
| `src/app/api/live/[gameId]/heartbeat/route.ts` | create | 新 endpoint |
| `src/hooks/useLiveHeartbeat.ts` | create | 5s 間隔 POST heartbeat |
| `src/hooks/useLivePlayerGame.ts` | modify | 加 `consecutiveFailures` + `isReconnecting` 回傳 |
| `src/app/[locale]/live/play/[gameId]/LivePlayRoom.tsx` | modify | 呼叫 useLiveHeartbeat + 渲染 reconnect banner |
| `src/features/live/LiveHostLobby.tsx` | modify | 已加入玩家 summary 加離線計數 + per-player 灰底 |
| `src/features/live/LiveQuestionScreen.tsx` | modify | 「已答 N / M · 斷線 K」顯示 |
| `CLAUDE.md` | modify | 「下一步優先順序 #4」加 Sub-A 完成標記 |

每 Task 結束跑 `npm run check-types` + `npm run lint`，通過再 commit。

## 實作順序

依 spec「部署順序」段：先 schema migration（純加欄、零 downtime）→ server-side
heartbeat + disconnect 判定 → client heartbeat → UI 顯示。本 plan Task 1-9 編號即執行順序。

---

## Task 1: Schema 加 lastSeenAt + Drizzle migration

**Files:**
- Modify: `src/models/Schema.ts:418-442`（livePlayerSchema 區塊）
- Create: `migrations/00XX_<auto-name>.sql`（`npm run db:generate` 自動產出）

- [ ] **Step 1.1: 讀檔確認現狀**

```bash
sed -n '418,445p' src/models/Schema.ts
```
預期看到 livePlayerSchema 定義、最後一欄是 `joinedAt`。

- [ ] **Step 1.2: 加 lastSeenAt 欄**

把 `livePlayerSchema` 中 `joinedAt` 那行改成下面的形狀（在後面加一行）：

```ts
    joinedAt: timestamp('joined_at', { mode: 'date' }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { mode: 'date' }).defaultNow().notNull(),
```

- [ ] **Step 1.3: 產 migration**

```bash
npm run db:generate
```

預期：`migrations/` 下新增一個檔（檔名類似 `0031_<adjective>_<noun>.sql`）。

- [ ] **Step 1.4: 檢視 migration SQL，刪掉不屬於本次的 diff**

開新 migration 檔，預期只有：

```sql
ALTER TABLE "live_player" ADD COLUMN "last_seen_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
```

如果 Drizzle snapshot 脫鉤造成多塞 CREATE TABLE / 其他 ALTER（CLAUDE.md「Drizzle migration snapshot 脫鉤」段警示過），**手動刪掉不屬於本次的部分**，只留上面這條。

`--> statement-breakpoint` 是 Drizzle 強制規則（記憶 `feedback_drizzle_breakpoint_rule.md`），不能省。

- [ ] **Step 1.5: 跑型別檢查**

```bash
npm run check-types
```
預期 0 error。

- [ ] **Step 1.6: Commit**

```bash
git add src/models/Schema.ts migrations/
git commit -m "$(cat <<'EOF'
feat(live-mode): add live_player.last_seen_at column

Sub-A Task 1/9。新欄位用於 heartbeat 機制偵測 player 是否斷線，
DEFAULT now() 確保既有 row backfill 為當下時間（避免大規模誤判離線）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Types 加 disconnected + buildHostState 計算

**Files:**
- Modify: `src/services/live/types.ts:28-33`（LivePlayerSummary）
- Modify: `src/services/live/liveStore.ts:201-213`（getPlayers function）

- [ ] **Step 2.1: types.ts 加 disconnected 欄**

把 `src/services/live/types.ts` L28-33 的 `LivePlayerSummary` 改成：

```ts
export type LivePlayerSummary = {
  id: number;
  nickname: string;
  score: number;
  correctCount: number;
  disconnected: boolean; // 新增：(NOW() - last_seen_at) > 15s
};
```

- [ ] **Step 2.2: liveStore.ts 的 getPlayers 撈 lastSeenAt + 算 disconnected**

把 `src/services/live/liveStore.ts` L201-213 整個 `getPlayers` function 改成：

```ts
const DISCONNECT_THRESHOLD_MS = 15 * 1000;

// 取得玩家清單（照分數高→低，附 disconnected flag）
async function getPlayers(gameId: number): Promise<LivePlayerSummary[]> {
  const rows = await db
    .select({
      id: livePlayerSchema.id,
      nickname: livePlayerSchema.nickname,
      score: livePlayerSchema.score,
      correctCount: livePlayerSchema.correctCount,
      lastSeenAt: livePlayerSchema.lastSeenAt,
    })
    .from(livePlayerSchema)
    .where(eq(livePlayerSchema.gameId, gameId))
    .orderBy(desc(livePlayerSchema.score));
  const now = Date.now();
  return rows.map(r => ({
    id: r.id,
    nickname: r.nickname,
    score: r.score,
    correctCount: r.correctCount,
    disconnected: now - r.lastSeenAt.getTime() > DISCONNECT_THRESHOLD_MS,
  }));
}
```

`DISCONNECT_THRESHOLD_MS` 放在 file-level const（與既有 `PLAY_PHASE_BUFFER_SEC`、
`RESULT_PHASE_DURATION_SEC` 同樣 pattern，不另抽 module）。

- [ ] **Step 2.3: 跑型別檢查 + lint**

```bash
npm run check-types && npx eslint src/services/live/liveStore.ts src/services/live/types.ts
```
預期 0 error。如果型別錯誤大概率是 LivePlayerState 也用了 LivePlayerSummary 的某個分支沒帶 disconnected——別動 LivePlayerState 邏輯，看是 buildPlayerState 內哪裡需要補帶這欄就補。

- [ ] **Step 2.4: Commit**

```bash
git add src/services/live/types.ts src/services/live/liveStore.ts
git commit -m "$(cat <<'EOF'
feat(live-mode): compute disconnected flag in host state

Sub-A Task 2/9。LivePlayerSummary 加 disconnected: boolean，
getPlayers 撈 last_seen_at 後依 (NOW() - lastSeenAt) > 15s 計算。
LivePlayerState 維持不變（學生不需看到隊友斷線狀態）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 新 heartbeat endpoint

**Files:**
- Create: `src/app/api/live/[gameId]/heartbeat/route.ts`

- [ ] **Step 3.1: 建檔**

新檔 `src/app/api/live/[gameId]/heartbeat/route.ts` 內容：

```ts
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { livePlayerSchema } from '@/models/Schema';

export const runtime = 'nodejs';

// 學生端每 5s 打一次，更新 live_player.last_seen_at
// 安全：playerToken 是 server 產生的隨機字串，攻擊者拿到也只能更新時戳，無法改分或答題
export async function POST(
  _request: Request,
  { params }: { params: { gameId: string } },
) {
  const playerToken = _request.headers.get('x-player-token');
  if (!playerToken) {
    return NextResponse.json({ error: 'missing_token' }, { status: 401 });
  }

  const gameId = Number(params.gameId);
  if (!Number.isFinite(gameId) || gameId <= 0) {
    return NextResponse.json({ error: 'invalid_game' }, { status: 400 });
  }

  // 用 (gameId, playerToken) 雙 key update 防跨 game 偽造
  const result = await db
    .update(livePlayerSchema)
    .set({ lastSeenAt: new Date() })
    .where(
      and(
        eq(livePlayerSchema.gameId, gameId),
        eq(livePlayerSchema.playerToken, playerToken),
      ),
    )
    .returning({ id: livePlayerSchema.id });

  if (result.length === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3.2: 跑型別檢查 + lint**

```bash
npm run check-types && npx eslint 'src/app/api/live/[gameId]/heartbeat/route.ts'
```
預期 0 error。

- [ ] **Step 3.3: 手動驗證 endpoint**

`npm run dev` 啟動後，先用真實 player token 測（player 加入後從 localStorage 拿 token；
或直接 SQL 撈一筆 `SELECT player_token FROM live_player ORDER BY id DESC LIMIT 1`）：

```bash
curl -X POST http://localhost:3000/api/live/<gameId>/heartbeat \
  -H 'x-player-token: <playerToken>'
```

預期 `{"ok":true}`。錯 token 應回 404。

- [ ] **Step 3.4: Commit**

```bash
git add 'src/app/api/live/[gameId]/heartbeat/route.ts'
git commit -m "$(cat <<'EOF'
feat(live-mode): POST /api/live/[gameId]/heartbeat endpoint

Sub-A Task 3/9。學生端每 5s 打一次更新 last_seen_at，
auth 使用既有 x-player-token header pattern (與 /answer 一致)，
雙 key (gameId, playerToken) 防跨 game 偽造。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 新 useLiveHeartbeat hook

**Files:**
- Create: `src/hooks/useLiveHeartbeat.ts`

- [ ] **Step 4.1: 建檔**

新檔 `src/hooks/useLiveHeartbeat.ts` 內容：

```ts
'use client';

import { useEffect } from 'react';

const HEARTBEAT_INTERVAL_MS = 5 * 1000;

/**
 * 學生端心跳：每 5s POST /api/live/[gameId]/heartbeat 更新 last_seen_at
 * @param enabled false 時停止心跳（例如 game 已 finished）
 */
export function useLiveHeartbeat(
  gameId: number,
  playerToken: string,
  enabled: boolean,
) {
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
        await fetch(`/api/live/${gameId}/heartbeat`, {
          method: 'POST',
          headers: { 'x-player-token': playerToken },
        });
      } catch {
        // 網路 fail 吞掉；下次 tick 自動重試。reconnect banner 由 useLivePlayerGame 負責
      }
    };
    tick(); // 立即先打一次
    const id = setInterval(tick, HEARTBEAT_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [gameId, playerToken, enabled]);
}
```

- [ ] **Step 4.2: 跑型別檢查 + lint**

```bash
npm run check-types && npx eslint src/hooks/useLiveHeartbeat.ts
```
預期 0 error。

- [ ] **Step 4.3: Commit**

```bash
git add src/hooks/useLiveHeartbeat.ts
git commit -m "$(cat <<'EOF'
feat(live-mode): useLiveHeartbeat hook (5s interval REST)

Sub-A Task 4/9。學生端心跳 hook，enabled=false 時停止 (game finished)。
fetch 失敗吞掉 (UI banner 由 useLivePlayerGame 負責)。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: useLivePlayerGame 加 consecutiveFailures + isReconnecting

**Files:**
- Modify: `src/hooks/useLivePlayerGame.ts:17-76`（整個 hook function）

- [ ] **Step 5.1: 讀檔**

```bash
cat -n src/hooks/useLivePlayerGame.ts
```
確認 L25-39 是 useEffect 訂閱、L43-73 是 submit callback。

- [ ] **Step 5.2: 加 consecutiveFailures + isReconnecting state**

把 `src/hooks/useLivePlayerGame.ts` L17-76 整段改成：

```ts
export function useLivePlayerGame(
  gameId: number,
  playerId: number,
  playerToken: string,
) {
  const [state, setState] = useState<LivePlayerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const [isReconnecting, setIsReconnecting] = useState(false);

  useEffect(() => {
    if (!gameId || !playerId || !playerToken) {
      return;
    }
    const unsub = liveRealtime.subscribePlayerState(
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

  const submit = useCallback(
    async (
      questionId: number,
      selectedOptionId: string | string[],
    ): Promise<SubmitResult> => {
      setSubmitting(true);
      try {
        const res = await fetch(`/api/live/${gameId}/answer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playerId,
            playerToken,
            questionId,
            selectedOptionId,
          }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          return { ok: false, error: data.error ?? `HTTP ${res.status}` };
        }
        const data = (await res.json()) as { isCorrect: boolean; score: number };
        return { ok: true, isCorrect: data.isCorrect, score: data.score };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'network error' };
      } finally {
        setSubmitting(false);
      }
    },
    [gameId, playerId, playerToken],
  );

  return { state, error, submit, submitting, isReconnecting };
}
```

差異重點：
- 新加 `consecutiveFailures` / `isReconnecting` 兩個 state
- 訂閱 callback 成功時 reset 兩者
- onError 增 counter，>=2 設 isReconnecting=true
- return value 多一個 `isReconnecting`

- [ ] **Step 5.3: 跑型別檢查 + lint**

```bash
npm run check-types && npx eslint src/hooks/useLivePlayerGame.ts
```
預期 0 error。

- [ ] **Step 5.4: Commit**

```bash
git add src/hooks/useLivePlayerGame.ts
git commit -m "$(cat <<'EOF'
feat(live-mode): useLivePlayerGame returns isReconnecting flag

Sub-A Task 5/9。新增 consecutiveFailures counter + isReconnecting state，
fetch 連續失敗 ≥ 2 次設 true，下次成功 reset。
適用 polling/Ably 兩種 transport (realtimeAdapter onError 觸發頻率一致)。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: LivePlayRoom 接 heartbeat + reconnect banner

**Files:**
- Modify: `src/app/[locale]/live/play/[gameId]/LivePlayRoom.tsx:48-117`（LiveRoomInner function）

- [ ] **Step 6.1: 讀檔確認**

```bash
sed -n '48,120p' 'src/app/[locale]/live/play/[gameId]/LivePlayRoom.tsx'
```
確認 L57-61 是 useLivePlayerGame call、L63-115 是各狀態 render。

- [ ] **Step 6.2: import useLiveHeartbeat 並加掛**

把 `src/app/[locale]/live/play/[gameId]/LivePlayRoom.tsx` import 區既有那條改成：

```tsx
import { LiveLeaderboard } from '@/features/live/LiveLeaderboard';
import { LivePlayerQuestion } from '@/features/live/LivePlayerQuestion';
import { useLiveHeartbeat } from '@/hooks/useLiveHeartbeat';
import { useLivePlayerGame } from '@/hooks/useLivePlayerGame';
import { loadPlayerSession } from '@/services/live/playerSession';
```

把 L48-117 的 `LiveRoomInner` function 整個改成：

```tsx
function LiveRoomInner({
  gameId,
  playerId,
  playerToken,
}: {
  gameId: number;
  playerId: number;
  playerToken: string;
}) {
  const { state, error, submit, submitting, isReconnecting } = useLivePlayerGame(
    gameId,
    playerId,
    playerToken,
  );

  // 心跳：game 還沒結束才打 (status='finished' 後 player 斷線無意義)
  useLiveHeartbeat(gameId, playerToken, state?.game.status !== 'finished');

  // Reconnect banner：固定在頁面頂端，所有 state 分支共用
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
          <Link href="/live/join" className="mt-4 inline-block text-xs text-primary hover:underline">
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

  if (status === 'waiting') {
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

  if (status === 'finished') {
    return (
      <>
        {banner}
        <LiveLeaderboard
          players={state.leaderboard}
          highlightPlayerId={state.me.id}
        />
      </>
    );
  }

  return (
    <>
      {banner}
      <LivePlayerQuestion
        state={state}
        onSubmit={async (questionId, sel) => {
          await submit(questionId, sel);
        }}
        submitting={submitting || isReconnecting}
      />
    </>
  );
}
```

差異重點：
- import useLiveHeartbeat
- 解構 `isReconnecting` 從 hook 回傳
- 呼叫 `useLiveHeartbeat(gameId, playerToken, state?.game.status !== 'finished')`
- 抽出 `banner` JSX，每個 return 都包 fragment 並前置 banner
- 答題狀態的 `submitting` 增 `|| isReconnecting`，斷線時 disable 提交按鈕

- [ ] **Step 6.3: 跑型別檢查 + lint**

```bash
npm run check-types && npx eslint 'src/app/[locale]/live/play/[gameId]/LivePlayRoom.tsx'
```
預期 0 error。

- [ ] **Step 6.4: Commit**

```bash
git add 'src/app/[locale]/live/play/[gameId]/LivePlayRoom.tsx'
git commit -m "$(cat <<'EOF'
feat(live-mode): wire heartbeat + reconnect banner into player room

Sub-A Task 6/9。LiveRoomInner 接 useLiveHeartbeat (game 進行中持續打)、
依 isReconnecting 在頁頂渲染紅色 reconnect banner，
答題提交按鈕 disable 條件增 || isReconnecting 防斷線時誤送。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: LiveHostLobby 顯示斷線

**Files:**
- Modify: `src/features/live/LiveHostLobby.tsx:74-103`（已加入玩家 section）

- [ ] **Step 7.1: 讀檔確認**

```bash
sed -n '70,105p' src/features/live/LiveHostLobby.tsx
```
確認 L76-83 是「已加入玩家」section、L92-101 是 player list 渲染。

- [ ] **Step 7.2: 加 disconnectedCount 計算 + summary + per-player 灰底**

把 L74-103 整段改成：

```tsx
      <div className="rounded-xl border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            已加入玩家
            <span className="ml-2 text-base font-normal text-muted-foreground">
              （
              {state.players.length}
              ）
            </span>
            {(() => {
              const disconnectedCount = state.players.filter(p => p.disconnected).length;
              return disconnectedCount > 0 ? (
                <span className="ml-2 text-xs text-red-500">
                  其中
                  {' '}
                  {disconnectedCount}
                  {' '}
                  人離線
                </span>
              ) : null;
            })()}
          </h2>
        </div>
        {state.players.length === 0
          ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                等待玩家加入⋯
              </p>
            )
          : (
              <div className="flex flex-wrap gap-2">
                {state.players.map(p => (
                  <span
                    key={p.id}
                    className={p.disconnected
                      ? 'rounded-full bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground line-through'
                      : 'rounded-full bg-muted px-3 py-1.5 text-sm'}
                  >
                    {p.nickname}
                    {p.disconnected && (
                      <span className="ml-1 text-xs text-red-500">（離線）</span>
                    )}
                  </span>
                ))}
              </div>
            )}
      </div>
```

差異重點：
- h2 內加 IIFE 算 disconnectedCount，>0 才顯示「其中 X 人離線」紅字
- player chip className 依 `p.disconnected` 切換：灰底 + line-through + 後綴「（離線）」

- [ ] **Step 7.3: 跑型別檢查 + lint**

```bash
npm run check-types && npx eslint src/features/live/LiveHostLobby.tsx
```
預期 0 error。

- [ ] **Step 7.4: Commit**

```bash
git add src/features/live/LiveHostLobby.tsx
git commit -m "$(cat <<'EOF'
feat(live-mode): show disconnected players in host lobby

Sub-A Task 7/9。已加入玩家 summary 加紅字「其中 X 人離線」，
個別 player chip 斷線時改灰底 + line-through + 「（離線）」標記。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: LiveQuestionScreen 顯示答題中斷線數

**Files:**
- Modify: `src/features/live/LiveQuestionScreen.tsx:22-26`（destructure 後加 disconnectedCount const）
- Modify: `src/features/live/LiveQuestionScreen.tsx:53-61`（「N / M 人已答」span 後接 disconnect 顯示）

- [ ] **Step 8.1: 加 disconnectedCount const**

把 L22-26 既有的：

```tsx
  const { currentQuestion, game, answerStats, answeredCount, players } = state;
  const { remaining, percent } = useCountdown(
    game.questionStartedAt,
    game.questionDuration,
  );
```

改成（多一行 disconnectedCount 計算）：

```tsx
  const { currentQuestion, game, answerStats, answeredCount, players } = state;
  const disconnectedCount = players.filter(p => p.disconnected).length;
  const { remaining, percent } = useCountdown(
    game.questionStartedAt,
    game.questionDuration,
  );
```

- [ ] **Step 8.2: 「N / M 人已答」加斷線後綴**

把 L53-61 既有的：

```tsx
        <span>
          {answeredCount}
          {' '}
          /
          {' '}
          {players.length}
          {' '}
          人已答
        </span>
```

改成（後面增 disconnect 紅字 span）：

```tsx
        <span>
          {answeredCount}
          {' '}
          /
          {' '}
          {players.length}
          {' '}
          人已答
          {disconnectedCount > 0 && (
            <span className="ml-1 text-red-500">
              · 斷線
              {' '}
              {disconnectedCount}
            </span>
          )}
        </span>
```

注意：分母 `players.length`（總人數）**不變**，斷線玩家仍計入分母（spec 設計：避免 host 看到分母波動誤以為人少了）。

- [ ] **Step 8.3: 跑型別檢查 + lint**

```bash
npm run check-types && npx eslint src/features/live/LiveQuestionScreen.tsx
```
預期 0 error。

- [ ] **Step 8.4: Commit**

```bash
git add src/features/live/LiveQuestionScreen.tsx
git commit -m "$(cat <<'EOF'
feat(live-mode): show disconnect count in host question screen

Sub-A Task 8/9。「已答 N / M」進度後加紅字「· 斷線 K」，
分母 M 不變 (斷線玩家仍計入總人數)，避免 host 困惑為何總人數變少。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: 整合驗證 + CLAUDE.md TODO 更新

**Files:**
- Modify: `CLAUDE.md`（下一步優先順序 #4）

- [ ] **Step 9.1: 全 project 驗證**

```bash
npm run check-types && npm run lint 2>&1 | grep -E "live|hook|Schema" | head -20 && npm test 2>&1 | tail -5
```

預期：check-types 0 error、lint 對我改的檔 0 error / 0 warning、測試 32/32 pass（既有測試不應壞）。

- [ ] **Step 9.2: 手動整合驗證（dev server）**

`npm run dev` 後依 spec「測試方式」段 6 個 case 跑：

1. 開兩個 tab（host + player）→ player 加入 → Drizzle Studio 看 `live_player.last_seen_at` 每 5s 更新
2. player 關 tab → 等 15s → host lobby 看到「其中 1 人離線」+ 名字灰底 line-through
3. 開始遊戲 → player 切 airplane mode → 等 15s → host 答題進度看到「· 斷線 1」
4. player 用 Chrome devtools throttle network → offline → 4-10s 內出現紅色「⚠️ 網路斷線中⋯」 banner
5. 取消 throttle → banner 消失，answer button 重新可用
6. player offline 8 秒，期間 host 推進到下一題 → player 重連後看到下一題、上題 0 分

注意：這些都連 production DB（`.env.local` DATABASE_URL 已設、記憶
`feedback_dev_env_local_db.md`），測完用過的 live_game / live_player rows
保留就好（live_game 沒 cleanup 機制是另一個議題，本 plan 不處理）。

- [ ] **Step 9.3: 更新 CLAUDE.md 「下一步優先順序」第 4 條**

把 CLAUDE.md 既有的：

```
4. Live Mode v2：斷線重連（Ably Presence + Reactor Webhook + localStorage 身份恢復 + 老師端斷線狀態 UI）、支援 ranking / short_answer / listening 題型、UI 完整 i18n（目前中文硬寫在 components 裡）
```

改成：

```
4. Live Mode v2（拆 3 子專案）：
   - **Sub-A 斷線偵測 + 重連 UI** ✅ 2026-04-30 完成（純 heartbeat 架構，spec: `docs/superpowers/specs/2026-04-30-live-mode-disconnect-detection-design.md`、plan: `docs/superpowers/plans/2026-04-30-live-mode-disconnect-detection.md`）
   - **Sub-B 新題型支援**（ranking / short_answer / listening）— 未開
   - **Sub-C UI i18n migration** — 未開（與 #3 多語系擴展綁一起做）
```

- [ ] **Step 9.4: Commit CLAUDE.md**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(claude.md): mark Live Mode v2 Sub-A 斷線偵測完成

實作完成 Sub-A：heartbeat 機制 + host 端斷線顯示 + player 端 reconnect banner。
Sub-B (新題型) 與 Sub-C (i18n migration) 未開。

Spec: docs/superpowers/specs/2026-04-30-live-mode-disconnect-detection-design.md
Plan: docs/superpowers/plans/2026-04-30-live-mode-disconnect-detection.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 風險與回滾

每個 Task 單獨 commit，回滾單一 Task 用 `git revert <sha>`。

**Migration 回滾**：若 Task 1 部署後 Task 2-8 出問題，DB 上多一欄 `last_seen_at` 不
影響舊 code（DEFAULT now() 確保 NOT NULL 約束滿足）。要 rollback 整個 schema：

```sql
ALTER TABLE live_player DROP COLUMN last_seen_at;
```

**部署順序建議**：因為 Task 1 是 schema migration，Vercel deploy 時 migrate-pg
跑 migration 才能讓 Task 2-8 的 code 正常工作。建議部署整個 PR 一次到位
（Vercel 會在新 lambda 啟動時觸發 migrate；記憶 `feedback_drizzle_prod_migrate_timing.md`
提到要等 5-10 分鐘 cold start）。

## Out of Scope（提醒實作者勿擴張）

spec「不在本 spec 範圍」段已列。本 plan 不處理：

- (c) 斷線期間錯過題目的補答 / 暫停 / 計分政策
- Heartbeat endpoint rate limit
- Ably Presence / Reactor Webhook
- player UI 的「離線時長」計時
- host 看 player 個別斷線時長
- 同 playerToken 多 device 同時 heartbeat 的衝突
- TrialBanner / billing / Live Mode UI 的 i18n migration（Sub-C）
- Sub-B 新題型支援（ranking / short_answer / listening）
