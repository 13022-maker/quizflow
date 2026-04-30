# Live Mode Sub-A：斷線偵測 + 重連 UI（2026-04-30）

> 本 spec 是 CLAUDE.md「下一步優先順序 #4 Live Mode v2」拆出來的子專案 A。
> Sub-B（新題型 ranking / short_answer / listening）、Sub-C（i18n migration）由後續另開 spec。

## 背景

QuizFlow Live Mode 已 GA：6 碼 PIN 加入、Kahoot 式計分、即時排行榜，
production 啟用 Ably WS（free tier）+ polling fallback。

**已實作（CLAUDE.md「斷線重連」清單裡其實做了一個）**：
- ✅ **localStorage 身份持久化**：`src/services/live/playerSession.ts` save on join、
  `LivePlayRoom` mount 時 `loadPlayerSession`，**player F5 / 重開 tab 都能回到原本 game**
- ✅ Polling（host 1.5s、player 2s）+ Ably tick channel opt-in
- ✅ 70 player 壓測通過（記憶 `live_mode_polling_perf_70.md`）

**未實作的真正缺口**：
1. 老師看不到誰斷線——`live_player` 表沒 `last_seen_at` 欄位；host 端 player list 從 DB 全列、灰名分不出來
2. 學生網路抖動時，`useLivePlayerGame` 的 fetch 失敗只顯示 generic error，沒有「reconnecting」UI；學生不知道是自己斷還是壞掉

## Scope

本 spec 只處理：
- **(a) 老師端斷線狀態 UI**：lobby 與答題中清楚標示誰離線
- **(b) 學生端 reconnect UX**：抖動時看到正確狀態，自動重試

**不處理**（Sub-A 之外的議題）：
- (c) 斷線期間錯過題目的補答 / 暫停 / 計分政策——保留現有「沒答 = 0 分」行為
- 不引入 Ably Presence、Reactor Webhook
- 不重做 realtime adapter；polling/Ably 都套同一套斷線邏輯

## 架構

**核心思路**：純心跳（heartbeat）。Player 每 5 秒打一個極輕的 REST endpoint
更新 `live_player.last_seen_at`，host 從 DB 讀並依「現在 - last_seen_at > 15s」
判定 disconnected。Player 端則靠 fetch 連續失敗計數驅動 reconnect banner。

**為什麼 heartbeat 而非 Ably Presence**：
- Polling/Ably 兩種 transport 套同一套邏輯（記憶 `ably_upgrade_pending.md`：production 是 Ably WS but 仍可能退 polling）
- 不增加 Ably 訊息量（heartbeat 走 REST），不踩 free tier 邊界
- Presence 本質是 connection-bound，70 player 1 場 + presence enter/leave events
  會接近 free tier 200 concurrent 上限；本 spec 推遲到付費方案上線後再評估

## DB Schema 變動

`live_player` 表加一欄：

```ts
// src/models/Schema.ts livePlayerSchema 內
lastSeenAt: timestamp('last_seen_at', { mode: 'date' })
  .defaultNow()
  .notNull(),
```

新 migration（檔名由 `npm run db:generate` 自動編號，預期 `0031_xxx.sql`）：

```sql
ALTER TABLE "live_player" ADD COLUMN "last_seen_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
```

（`--> statement-breakpoint` 是 Drizzle 規則，記憶 `feedback_drizzle_breakpoint_rule.md`）

**不加 index**：disconnect 計算純依「全 game player rows 比對 NOW()」，沒有獨立查詢
條件能用上 index；DB 端做 timestamp 比較極快。

**migration 安全性**：`DEFAULT now()` 確保既有 row backfill 為當下 timestamp，所有
原本還在 game 中的 player 視為「剛剛還在」（合理 fallback，避免大規模誤判離線）。

## 新 Endpoint

`POST /api/live/[gameId]/heartbeat`

```ts
// src/app/api/live/[gameId]/heartbeat/route.ts
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { gameId: string } }) {
  const playerToken = req.headers.get('x-player-token');
  if (!playerToken) {
    return NextResponse.json({ error: 'missing_token' }, { status: 401 });
  }

  const gameId = Number(params.gameId);
  if (Number.isNaN(gameId)) {
    return NextResponse.json({ error: 'invalid_game' }, { status: 400 });
  }

  // 用 playerToken + gameId 雙 key update（防跨 game 偽造）
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

**為什麼 token + gameId 雙 key 而非只 token**：playerToken 表上是 UNIQUE
（`live_player_token_idx`），其實只 token 就夠。但加 gameId 限制能防一些低概率
誤用（例如 client side 載錯 game 的 token 還能誤打到別 game）。性能無差異。

**安全考量**：playerToken 是 server 產生的隨機字串，從 `/api/live/join` response 拿到
後存 client localStorage（既有 pattern）。攻擊者拿到 token 也只能更新 last_seen_at——
無法改 score、無法答題（answer endpoint 另有檢查）、無法干擾 host。可接受。

## Server-side disconnect 判定

`GET /api/live/[gameId]/host-state` 既有邏輯不動，但 `LiveHostState.players` 每筆
加 `disconnected: boolean` 欄位：

```ts
// src/services/live/types.ts
export type LivePlayerSummary = {
  id: number;
  nickname: string;
  score: number;
  correctCount: number;
  disconnected: boolean; // 新增
};

// src/services/live/liveStore.ts buildHostState 內
const DISCONNECT_THRESHOLD_MS = 15 * 1000;
const now = Date.now();

const players = playerRows.map(p => ({
  id: p.id,
  nickname: p.nickname,
  score: p.score,
  correctCount: p.correctCount,
  disconnected: now - p.lastSeenAt.getTime() > DISCONNECT_THRESHOLD_MS,
}));
```

`LivePlayerState`（學生端 state）**不加** `disconnected` 欄位——學生只看自己畫面，
不需要知道隊友是否在線。

**為什麼閾值是 15 秒**：5 秒 heartbeat × 3 容忍 = 15 秒，可吃 2 次 missed
heartbeat（單次網路 jitter 不誤判）。教室場景下老師看到「離線」 tag 出現平均
~10 秒延遲，可接受。

## Client：Player 端

### 心跳 hook

新檔 `src/hooks/useLiveHeartbeat.ts`：

```ts
'use client';

import { useEffect } from 'react';

const HEARTBEAT_INTERVAL_MS = 5 * 1000;

export function useLiveHeartbeat(
  gameId: number,
  playerToken: string,
  enabled: boolean, // status !== 'finished' 才打
) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const tick = async () => {
      try {
        await fetch(`/api/live/${gameId}/heartbeat`, {
          method: 'POST',
          headers: { 'x-player-token': playerToken },
        });
      } catch {
        // 網路 fail：吞掉，下次 tick 會重試；reconnect banner 由 useLivePlayerGame 自己負責
      }
    };
    tick(); // 立即先打一次
    const id = setInterval(tick, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [gameId, playerToken, enabled]);
}
```

`LiveRoomInner`（`src/app/[locale]/live/play/[gameId]/LivePlayRoom.tsx`）內呼叫：

```tsx
useLiveHeartbeat(gameId, playerToken, state?.game.status !== 'finished');
```

### Reconnect banner

修 `src/hooks/useLivePlayerGame.ts`：既有 hook 跑 polling/Ably state fetch，加一個
`consecutiveFailures` counter，新欄位 `isReconnecting: boolean`：

```ts
// 既有 polling fetch 內
try {
  const res = await fetch(...);
  if (res.ok) {
    setConsecutiveFailures(0);
    setIsReconnecting(false);
    setState(await res.json());
  } else {
    incrementFailure();
  }
} catch {
  incrementFailure();
}

function incrementFailure() {
  setConsecutiveFailures(c => {
    const next = c + 1;
    if (next >= 2) setIsReconnecting(true);
    return next;
  });
}
```

`LiveRoomInner` 收到 `isReconnecting === true` → 在頁面頂端 render 紅色 banner：

```tsx
{isReconnecting && (
  <div className="sticky top-0 z-50 bg-red-500 px-4 py-2 text-center text-sm font-medium text-white">
    ⚠️ 網路斷線中⋯ 正在重新連線
  </div>
)}
```

answer button disabled state 連動：`submitting || isReconnecting`。

## Client：Host 端

修 `src/features/live/LiveHostLobby.tsx`（lobby 等待狀態）：

- 既有「已加入玩家 N」下方加：`{disconnectedCount > 0 && <small>（其中 {disconnectedCount} 人離線）</small>}`
- player list 每筆 row：disconnected 加 `bg-muted/40 text-muted-foreground` 灰底，
  暱稱右邊加 `<span className="text-xs text-red-500">離線</span>`

修 `src/features/live/LiveQuestionScreen.tsx`（host 答題中畫面，destructure 出
`players` 後可直接 `players.filter(p => p.disconnected).length` 算 disconnectedCount）：

- 既有「已答 N / M」加：`{disconnectedCount > 0 && <span> · 斷線 {disconnectedCount}</span>}`
- 答題進度條的 M（total）邏輯**不變**——斷線玩家仍算分母（避免 host 困惑「為什麼總人數變少」）

`LiveHostRoom.tsx` 是 page wrapper 依 `state.game.status` 切換 lobby / question
view，**本 spec 不動**（state shape 變了會自動傳到子元件）。

排行榜（finished）狀態 **不顯示**離線標記（遊戲結束、無意義）。

## Heartbeat lifecycle 細節

| 場景 | 行為 |
|------|------|
| Player 進 LiveRoomInner | 立即第 0 秒打一次 heartbeat、之後每 5s |
| status 從 `playing` → `finished` | hook unmount，停止 heartbeat |
| Player 切到別 tab（Page visibility hidden） | 不停 heartbeat（瀏覽器 throttle setInterval 但仍會跑，最壞 1min 一次，足夠維持「在線」） |
| Player 關 tab / 導航走 | useEffect cleanup 清 interval；下次 tick 自然不會打 |
| Player 真的離線（網路斷） | fetch throw，吞掉。15s 後 host 端看到「離線」 |

## 風險與回滾

- DB schema 加欄需 migration，回滾要 `ALTER TABLE DROP COLUMN`。新 column 可
  null-safe（有 DEFAULT），即使新 code 出 bug 仍不影響舊功能。建議部署順序：
  先 migrate（純加欄、零 downtime）→ 部署新 code → 驗證 heartbeat 流量正常 → 推 host UI。

- Heartbeat endpoint 若被 DDoS：每 player token 可被擋掉，加 rate limit 是後續工作。
  本 spec **不加** rate limit；70 player 場每秒 14 次寫入 Neon 仍輕鬆。

- DB 寫入頻率：70 player × 12 次/min = 840 writes/min。Neon 每月免費 quota 充裕。

- 斷線期間錯過題目仍 0 分（policy 不變，明列「已知行為」）。

## 不在本 spec 範圍

- (c) 斷線期間錯過題目的補答 / 暫停機制
- Heartbeat endpoint rate limit
- Ably Presence / Reactor Webhook（推遲到付費方案 + Sub-A 證明 heartbeat 不夠用時）
- player UI 的「離線時長」顯示（spec 簡化：banner 只說「斷線中」，不秀計時器）
- host 看 player 個別斷線時長
- 同一 playerToken 在不同 device / tab 同時 heartbeat 的衝突處理（理論上 last write wins，實務罕見）
- TrialBanner / billing / Live Mode UI 的 i18n migration（拖到 Sub-C 與 #3 一起做）

## 測試方式

無自動化測試（Live Mode 既有測試覆蓋率低，本 spec 不擴）。手動驗證：

1. **Heartbeat 基本流**：開兩個視窗（host + player）→ 進 lobby → 觀察 Neon
   `live_player.last_seen_at` 是否每 5s 更新一次（用 Drizzle Studio 或 Neon SQL）
2. **Host 看 lobby 離線**：player 視窗關 tab → 等 15s → host lobby 該 player 變灰底 +「離線」 tag
3. **Host 看答題中離線**：開始遊戲 → player 切 airplane mode → 等 15s → host 答題進度
   區看到「斷線 1」
4. **Player reconnect banner**：player 用 Chrome devtools throttle network 設 offline
   → 4-10 秒內出現「⚠️ 網路斷線中⋯ 正在重新連線」 → 取消 throttle → banner 消失
5. **斷線期間錯過題目**：player offline 8 秒，這段期間 host 推進到下一題 → player
   重連後看到下一題、上題自動 0 分（policy 確認）
6. **Migration safety**：在 Neon preview branch 跑 migration → 既有 live_game 場
   的 player rows 應自動 backfill `last_seen_at = NOW()`，不影響進行中的場
