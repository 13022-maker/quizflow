# Live Mode 聽力題支援 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 Live Mode 支援 `listening`（聽力題）題型：音檔在學生手機自動播放、播完才顯示選項、依音檔長度自動延長作答時間，老師端顯示播放提示。

**Architecture:** 沿用聽力題既有的「本質是 `single_choice` + `audioUrl`」資料結構與批改邏輯，只在 Live Mode 這層新增「依音檔長度延長倒數」的計時邏輯（一個共用 helper，三個呼叫點都要套用才不會前後端計時對不上），以及題目建立/生成/重生音檔三個入口都要順手偵測並存下 `audioDurationSec`。

**Tech Stack:** Next.js App Router Server Actions、Drizzle ORM + PostgreSQL、Vitest。

## Global Constraints

- UI 文字、錯誤訊息、程式碼註解一律使用**繁體中文**；變數/函式/檔案名稱一律用英文（camelCase / kebab-case）
- 所有寫入操作走 Server Action，先驗證 `orgId`/`userId`，用 Zod 做嚴格輸入驗證
- 新增/修改 API Route 一律在最頂端加 `export const runtime = 'nodejs'`，回應一律用 `NextResponse.json()`
- 修改 `src/models/Schema.ts` 後必須執行 `npm run db:generate` 並 commit migration；**產生後務必打開檢查 SQL 內容**，只留下本次新增欄位的 `ALTER TABLE`（已知 `migrations/meta/` 缺 0015-0017 snapshot，`db:generate` 可能把不相關的 diff 也塞進來）
- 判對/計分邏輯必須在 server 端執行，client 只送選項 id（Live Mode 既有規則）
- 每個任務做完先跑對應測試，全綠再進下一個任務

---

## 檔案總覽

| 檔案 | 動作 | 職責 |
|------|------|------|
| `src/models/Schema.ts` | 修改 | `question` 表加 `audioDurationSec` 欄位 |
| `migrations/00XX_xxx.sql` | 新增（自動生成） | 對應的 ALTER TABLE |
| `src/services/live/questionDuration.ts` | 新增 | `getEffectiveQuestionDuration` 計時 helper |
| `src/services/live/questionDuration.test.ts` | 新增 | helper 單元測試 |
| `src/services/live/types.ts` | 修改 | `LiveQuestionType` 加 `listening`；`LiveQuestionForHost`/`LiveQuestionForPlayer` 加音檔欄位 |
| `src/services/live/scoring.ts` | 修改 | `LIVE_SUPPORTED_TYPES`、`gradeAnswer` 支援 `listening` |
| `src/services/live/scoring.test.ts` | 新增 | 批改邏輯單元測試 |
| `src/services/live/liveStore.ts` | 修改 | `getLiveQuestions` 選新欄位；`getHostState`/`getPlayerState`/自動推進都套用延長時間 |
| `src/actions/liveActions.ts` | 修改 | `startGame`/`nextQuestion` 寫入 `nextTransitionAt` 時套用延長時間 |
| `src/lib/audioDuration.ts` | 新增 | `probeAudioDuration`：client 端探測音檔秒數 |
| `src/lib/audioDuration.test.ts` | 新增 | helper 單元測試 |
| `src/actions/questionActions.ts` | 修改 | `QuestionInputSchema` 加 `audioDurationSec`，create/update 寫入 DB |
| `src/features/quiz/QuestionForm.tsx` | 修改 | 手動上傳音檔後偵測時長並存入表單 |
| `src/components/quiz/AIQuizModal.tsx` | 修改 | TTS 生成音檔後偵測時長 |
| `src/features/quiz/QuizEditor.tsx` | 修改 | `AIGeneratedQuestion` 型別加欄位；`onAudioRegenerated` 簽名加時長參數 |
| `src/app/api/quizzes/[id]/questions/route.ts` | 修改 | 批次匯入時把 `audioDurationSec` 一起寫進 DB |
| `src/features/quiz/QuestionCard.tsx` | 修改 | 重新生成音檔時偵測時長，透過 `onAudioRegenerated` 往上傳 |
| `src/features/live/LivePlayerQuestion.tsx` | 修改 | 學生端音檔自動播放、播完才顯示選項、手動播放 fallback、中途加入判斷 |
| `src/features/live/LiveQuestionScreen.tsx` | 修改 | 老師端顯示「🎧 播放中」提示 |

---

### Task 1: Schema 新增 `audioDurationSec` 欄位

**Files:**
- Modify: `src/models/Schema.ts:189-190`
- Create: `migrations/00XX_xxx.sql`（`npm run db:generate` 自動產生）

**Interfaces:**
- Produces: `questionSchema.audioDurationSec`（`integer`, nullable）— 之後所有 task 都靠 `InferSelectModel<typeof questionSchema>` 自動拿到這個欄位的型別

- [ ] **Step 1: 修改 Schema**

在 `src/models/Schema.ts` 的 `questionSchema` 內，緊接 `audioUrl` 欄位後面加一行：

```ts
  audioUrl: text('audio_url'), // 聽力題音檔網址（Vercel Blob）
  audioDurationSec: integer('audio_duration_sec'), // 音檔秒數，上傳/生成時前端偵測寫入，nullable（Live Mode 用來延長作答時間）
  audioTranscript: text('audio_transcript'), // 音檔逐字稿（老師可選填，供 AI 出題 / 輔助）
```

- [ ] **Step 2: 產生 migration**

```bash
npm run db:generate
```

- [ ] **Step 3: 檢查產生的 SQL**

打開 `migrations/` 底下新產生的檔案（檔名類似 `0038_xxx.sql`），確認**只有**這一行（可能沒有 breakpoint marker，單一 statement 不需要）：

```sql
ALTER TABLE "question" ADD COLUMN "audio_duration_sec" integer;
```

若看到其他不相關的 `CREATE TABLE` / `ALTER TABLE`（已知 snapshot 脫鉤問題），手動刪除那些多出來的敘述，只留下這一行。

- [ ] **Step 4: 跑 migration（本機）**

```bash
npm run db:migrate
```

Expected: 無錯誤，`question` 表多出 `audio_duration_sec` 欄位。

- [ ] **Step 5: Commit**

```bash
git add src/models/Schema.ts migrations/
git commit -m "聽力題 Live Mode：question 表新增 audioDurationSec 欄位"
```

---

### Task 2: `getEffectiveQuestionDuration` 計時 helper

**Files:**
- Create: `src/services/live/questionDuration.ts`
- Test: `src/services/live/questionDuration.test.ts`

**Interfaces:**
- Consumes: 無（純函式）
- Produces:
  - `LISTENING_FALLBACK_SEC: number`
  - `getEffectiveQuestionDuration(question: { type: string; audioDurationSec?: number | null }, baseDurationSec: number): number`
  - 後續 Task 4、5 都會 import 這兩個 symbol

- [ ] **Step 1: 寫失敗的測試**

建立 `src/services/live/questionDuration.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { getEffectiveQuestionDuration, LISTENING_FALLBACK_SEC } from './questionDuration';

describe('getEffectiveQuestionDuration', () => {
  it('非聽力題型不受影響，直接回傳基礎時長', () => {
    expect(
      getEffectiveQuestionDuration({ type: 'single_choice', audioDurationSec: 30 }, 20),
    ).toBe(20);
  });

  it('聽力題有偵測到音檔長度時，基礎時長 + 音檔秒數', () => {
    expect(
      getEffectiveQuestionDuration({ type: 'listening', audioDurationSec: 18 }, 20),
    ).toBe(38);
  });

  it('聽力題沒偵測到音檔長度（null）時，套用固定 15 秒寬限', () => {
    expect(
      getEffectiveQuestionDuration({ type: 'listening', audioDurationSec: null }, 20),
    ).toBe(20 + LISTENING_FALLBACK_SEC);
  });

  it('聽力題 audioDurationSec 欄位缺省（undefined）時，同樣套用寬限', () => {
    expect(
      getEffectiveQuestionDuration({ type: 'listening' }, 25),
    ).toBe(25 + LISTENING_FALLBACK_SEC);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
npx vitest run src/services/live/questionDuration.test.ts
```

Expected: FAIL（`./questionDuration` 模組不存在）

- [ ] **Step 3: 寫實作**

建立 `src/services/live/questionDuration.ts`：

```ts
// Live Mode 計時邏輯：算出某題實際該倒數幾秒。
// 聽力題要先播完音檔才能作答，固定的 game.questionDuration 不夠用，
// 這裡把音檔長度也算進去，讓「聽 + 答」都在同一個倒數視窗內做得完。

// 聽力題偵測不到音檔長度時的寬限秒數（上傳中斷、舊題目、瀏覽器不支援皆走這條）
export const LISTENING_FALLBACK_SEC = 15;

/**
 * 算出某題在 Live Mode 實際的作答時長。
 * 聽力題 = 老師設定的基礎時長 + 音檔長度（沒偵測到就 +15s 寬限）；
 * 其他題型不受影響，直接回傳基礎時長。
 */
export function getEffectiveQuestionDuration(
  question: { type: string; audioDurationSec?: number | null },
  baseDurationSec: number,
): number {
  if (question.type !== 'listening') {
    return baseDurationSec;
  }
  return baseDurationSec + (question.audioDurationSec ?? LISTENING_FALLBACK_SEC);
}
```

- [ ] **Step 4: 跑測試確認通過**

```bash
npx vitest run src/services/live/questionDuration.test.ts
```

Expected: PASS（4 個測試全過）

- [ ] **Step 5: Commit**

```bash
git add src/services/live/questionDuration.ts src/services/live/questionDuration.test.ts
git commit -m "聽力題 Live Mode：新增 getEffectiveQuestionDuration 計時 helper"
```

---

### Task 3: Live Mode 型別 + 批改邏輯支援 `listening`

**Files:**
- Modify: `src/services/live/types.ts`
- Modify: `src/services/live/scoring.ts`
- Test: `src/services/live/scoring.test.ts`

**Interfaces:**
- Consumes: 無
- Produces:
  - `LiveQuestionType` 聯集加入 `'listening'`
  - `LiveQuestionForHost.audioUrl: string | null`、`.audioDurationSec: number | null`
  - `LiveQuestionForPlayer.audioUrl: string | null`、`.audioDurationSec: number | null`
  - `LIVE_SUPPORTED_TYPES` 含 `'listening'`
  - `gradeAnswer('listening', ...)` 與 `single_choice` 同邏輯
  - 後續 Task 4 直接使用這些型別與 `isLiveSupportedType`/`gradeAnswer`

- [ ] **Step 1: 寫失敗的測試**

建立 `src/services/live/scoring.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { gradeAnswer, isLiveSupportedType, LIVE_SUPPORTED_TYPES } from './scoring';

describe('LIVE_SUPPORTED_TYPES / isLiveSupportedType', () => {
  it('listening 是支援題型', () => {
    expect(LIVE_SUPPORTED_TYPES).toContain('listening');
    expect(isLiveSupportedType('listening')).toBe(true);
  });

  it('ranking / short_answer / cloze 仍不支援', () => {
    expect(isLiveSupportedType('ranking')).toBe(false);
    expect(isLiveSupportedType('short_answer')).toBe(false);
    expect(isLiveSupportedType('cloze')).toBe(false);
  });
});

describe('gradeAnswer - listening', () => {
  it('選對唯一正解時回傳 true', () => {
    expect(gradeAnswer('listening', ['b'], 'b')).toBe(true);
  });

  it('選錯時回傳 false', () => {
    expect(gradeAnswer('listening', ['b'], 'a')).toBe(false);
  });

  it('selectedOptionId 是陣列（誤送多選格式）時回傳 false', () => {
    expect(gradeAnswer('listening', ['b'], ['b'])).toBe(false);
  });

  it('沒有正解時回傳 false', () => {
    expect(gradeAnswer('listening', [], 'b')).toBe(false);
    expect(gradeAnswer('listening', null, 'b')).toBe(false);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
npx vitest run src/services/live/scoring.test.ts
```

Expected: FAIL（目前 `gradeAnswer` 的 `listening` case 落到 `default: return false`，`isLiveSupportedType('listening')` 回傳 `false`，第一組跟第二組測試都會失敗）

- [ ] **Step 3: 修改 types.ts**

在 `src/services/live/types.ts` 修改：

```ts
export type LiveQuestionType = 'single_choice' | 'multiple_choice' | 'true_false' | 'listening';
```

`LiveQuestionForHost` 加兩個欄位（緊接 `imageUrl` 後面）：

```ts
export type LiveQuestionForHost = {
  id: number;
  type: LiveQuestionType;
  body: string;
  imageUrl: string | null;
  audioUrl: string | null; // 聽力題音檔網址
  audioDurationSec: number | null; // 聽力題音檔秒數（Live Mode 計時用）
  options: LiveQuestionOption[];
  correctAnswers: string[];
};
```

`LiveQuestionForPlayer` 同樣加兩個欄位：

```ts
export type LiveQuestionForPlayer = {
  id: number;
  type: LiveQuestionType;
  body: string;
  imageUrl: string | null;
  audioUrl: string | null; // 聽力題音檔網址
  audioDurationSec: number | null; // 聽力題音檔秒數（判斷「音檔播完才顯示選項」用）
  options: LiveQuestionOption[];
};
```

- [ ] **Step 4: 修改 scoring.ts**

在 `src/services/live/scoring.ts` 的 `gradeAnswer` switch，`single_choice` case 加入 `listening`：

```ts
  switch (questionType) {
    case 'single_choice':
    case 'true_false':
    case 'listening': {
      if (typeof selectedOptionId !== 'string') {
        return false;
      }
      return correctAnswers[0] === selectedOptionId;
    }
```

`LIVE_SUPPORTED_TYPES` 加入 `'listening'`：

```ts
export const LIVE_SUPPORTED_TYPES: LiveQuestionType[] = [
  'single_choice',
  'multiple_choice',
  'true_false',
  'listening',
];
```

- [ ] **Step 5: 跑測試確認通過**

```bash
npx vitest run src/services/live/scoring.test.ts
```

Expected: PASS（8 個測試全過）

- [ ] **Step 6: 型別檢查**

```bash
npm run check-types
```

Expected: 目前應該仍會報錯（`liveStore.ts` 裡 `getLiveQuestions`/`getHostState`/`getPlayerState` 建構 `LiveQuestionForHost`/`Player` 物件時少了新欄位）—— 這是預期的，下個 task 會修。先確認錯誤訊息確實只出在 `liveStore.ts`，不是其他地方。

- [ ] **Step 7: Commit**

```bash
git add src/services/live/types.ts src/services/live/scoring.ts src/services/live/scoring.test.ts
git commit -m "聽力題 Live Mode：型別與批改邏輯加入 listening 支援"
```

---

### Task 4: `liveStore.ts` 整合延長時間邏輯

**Files:**
- Modify: `src/services/live/liveStore.ts`

**Interfaces:**
- Consumes: `getEffectiveQuestionDuration`（Task 2）、擴充後的 `LiveQuestionForHost`/`LiveQuestionForPlayer`（Task 3）
- Produces: `getLiveQuestions` 回傳的每筆物件含 `audioUrl`/`audioDurationSec`；`getHostState`/`getPlayerState` 回傳的 `game.questionDuration` 已是延長後的值；自動推進的 `nextTransitionAt` 一律套用延長後的時長

- [ ] **Step 1: import helper**

在 `src/services/live/liveStore.ts` 檔案開頭 import 區塊加入：

```ts
import { getEffectiveQuestionDuration } from './questionDuration';
```

- [ ] **Step 2: `getLiveQuestions` 選取新欄位**

修改 `getLiveQuestions` 的 select 與 map（原本在 `liveStore.ts` 的 `getLiveQuestions` 函式內）：

```ts
export async function getLiveQuestions(quizId: number): Promise<LiveQuestionForHost[]> {
  const rows = await db
    .select({
      id: questionSchema.id,
      type: questionSchema.type,
      body: questionSchema.body,
      imageUrl: questionSchema.imageUrl,
      audioUrl: questionSchema.audioUrl,
      audioDurationSec: questionSchema.audioDurationSec,
      options: questionSchema.options,
      correctAnswers: questionSchema.correctAnswers,
      position: questionSchema.position,
    })
    .from(questionSchema)
    .where(eq(questionSchema.quizId, quizId))
    .orderBy(asc(questionSchema.position));

  return rows
    .filter(r => isLiveSupportedType(r.type))
    .map(r => ({
      id: r.id,
      type: r.type as 'single_choice' | 'multiple_choice' | 'true_false' | 'listening',
      body: r.body,
      imageUrl: r.imageUrl,
      audioUrl: r.audioUrl,
      audioDurationSec: r.audioDurationSec,
      options: (r.options ?? []) as { id: string; text: string }[],
      correctAnswers: (r.correctAnswers ?? []) as string[],
    }));
}
```

- [ ] **Step 3: `loadGameWithAutoAdvance` self-heal 分支套用延長時間**

找到 `loadGameWithAutoAdvance` 內、self-heal 的 `if (!game.nextTransitionAt)` 區塊，`game.status === 'playing'` 分支原本是：

```ts
    if (game.status === 'playing' && game.questionStartedAt) {
      // 從 questionStartedAt 反推：題目開始時間 + 題目時長 + 5s 緩衝
      const transitionAt = new Date(
        game.questionStartedAt.getTime() + (game.questionDuration + PLAY_PHASE_BUFFER_SEC) * 1000,
      );
```

改成先查出當前題目、套用延長時間：

```ts
    if (game.status === 'playing' && game.questionStartedAt) {
      // 從 questionStartedAt 反推：題目開始時間 + (延長後)題目時長 + 5s 緩衝
      const questionsForHeal = await getLiveQuestions(game.quizId);
      const currentQForHeal = questionsForHeal[game.currentQuestionIndex];
      const effectiveDurationForHeal = currentQForHeal
        ? getEffectiveQuestionDuration(currentQForHeal, game.questionDuration)
        : game.questionDuration;
      const transitionAt = new Date(
        game.questionStartedAt.getTime() + (effectiveDurationForHeal + PLAY_PHASE_BUFFER_SEC) * 1000,
      );
```

（`showing_result` 分支不用改：那個分支本來就不依賴題目時長，是固定 `RESULT_PHASE_DURATION_SEC`。）

- [ ] **Step 4: `maybeAutoAdvance` 的「showing_result → 下一題」分支套用延長時間**

找到 `maybeAutoAdvance` 內 `else if (game.status === 'showing_result')` 分支，原本：

```ts
  } else if (game.status === 'showing_result') {
    // showing_result → 下一題 OR finished（用 supportedCount 判斷）
    const supportedCount = (await getLiveQuestions(game.quizId)).length;
    const nextIdx = game.currentQuestionIndex + 1;
```

改成把 `getLiveQuestions` 的結果留著重用：

```ts
  } else if (game.status === 'showing_result') {
    // showing_result → 下一題 OR finished（用 questions.length 判斷）
    const questionsForAdvance = await getLiveQuestions(game.quizId);
    const supportedCount = questionsForAdvance.length;
    const nextIdx = game.currentQuestionIndex + 1;
```

再找到同一分支內「切到下一題」的區塊，原本：

```ts
    } else {
      const startedAt = new Date(nowMs);
      const transitionAt = new Date(nowMs + (game.questionDuration + PLAY_PHASE_BUFFER_SEC) * 1000);
      const updated = await db
        .update(liveGameSchema)
        .set({
          status: 'playing',
          currentQuestionIndex: nextIdx,
          questionStartedAt: startedAt,
          nextTransitionAt: transitionAt,
        })
```

改成：

```ts
    } else {
      const startedAt = new Date(nowMs);
      const nextQForAdvance = questionsForAdvance[nextIdx];
      const effectiveDurationForAdvance = nextQForAdvance
        ? getEffectiveQuestionDuration(nextQForAdvance, game.questionDuration)
        : game.questionDuration;
      const transitionAt = new Date(nowMs + (effectiveDurationForAdvance + PLAY_PHASE_BUFFER_SEC) * 1000);
      const updated = await db
        .update(liveGameSchema)
        .set({
          status: 'playing',
          currentQuestionIndex: nextIdx,
          questionStartedAt: startedAt,
          nextTransitionAt: transitionAt,
        })
```

- [ ] **Step 5: `getHostState` 回傳延長後的 `questionDuration`**

找到 `getHostState` 的 `return` 區塊，原本：

```ts
  return {
    game: {
      id: game.id,
      quizId: game.quizId,
      title: game.title,
      gamePin: game.gamePin,
      status: game.status,
      currentQuestionIndex: game.currentQuestionIndex,
      questionStartedAt: game.questionStartedAt ? game.questionStartedAt.toISOString() : null,
      questionDuration: game.questionDuration,
      totalQuestions: questions.length,
    },
```

改成：

```ts
  return {
    game: {
      id: game.id,
      quizId: game.quizId,
      title: game.title,
      gamePin: game.gamePin,
      status: game.status,
      currentQuestionIndex: game.currentQuestionIndex,
      questionStartedAt: game.questionStartedAt ? game.questionStartedAt.toISOString() : null,
      questionDuration: currentQuestion
        ? getEffectiveQuestionDuration(currentQuestion, game.questionDuration)
        : game.questionDuration,
      totalQuestions: questions.length,
    },
```

- [ ] **Step 6: `getPlayerState` 回傳延長後的 `questionDuration`**

找到 `getPlayerState` 的 `return` 區塊，原本：

```ts
  return {
    game: {
      id: game.id,
      title: game.title,
      status: game.status,
      currentQuestionIndex: game.currentQuestionIndex,
      questionStartedAt: game.questionStartedAt ? game.questionStartedAt.toISOString() : null,
      questionDuration: game.questionDuration,
      totalQuestions: questions.length,
    },
```

改成（用函式前面已經查好的 `current` 變數，它是 `LiveQuestionForHost | null`，含 `audioDurationSec`）：

```ts
  return {
    game: {
      id: game.id,
      title: game.title,
      status: game.status,
      currentQuestionIndex: game.currentQuestionIndex,
      questionStartedAt: game.questionStartedAt ? game.questionStartedAt.toISOString() : null,
      questionDuration: current
        ? getEffectiveQuestionDuration(current, game.questionDuration)
        : game.questionDuration,
      totalQuestions: questions.length,
    },
```

同函式內建構 `currentQuestion: LiveQuestionForPlayer` 的地方，補上新欄位：

```ts
  if (current) {
    currentQuestion = {
      id: current.id,
      type: current.type,
      body: current.body,
      imageUrl: current.imageUrl,
      audioUrl: current.audioUrl,
      audioDurationSec: current.audioDurationSec,
      options: current.options,
    };
  }
```

- [ ] **Step 7: 型別檢查**

```bash
npm run check-types
```

Expected: 通過，無錯誤。

- [ ] **Step 8: 跑既有測試確保沒壞掉**

```bash
npm run test
```

Expected: 全部通過（本 task 沒有新增自動化測試——`liveStore.ts` 依賴真實 DB，跟既有 Live Mode 程式碼一樣走手動驗證，見 Task 11 之後的整體驗證清單）。

- [ ] **Step 9: Commit**

```bash
git add src/services/live/liveStore.ts
git commit -m "聽力題 Live Mode：liveStore 依音檔長度延長作答時間"
```

---

### Task 5: `liveActions.ts` 開局/切題套用延長時間

**Files:**
- Modify: `src/actions/liveActions.ts`

**Interfaces:**
- Consumes: `getEffectiveQuestionDuration`（Task 2）、`getLiveQuestions`（Task 4，來自 `liveStore.ts`）
- Produces: `startGame`/`nextQuestion` 寫入的 `nextTransitionAt` 與 Task 4 的 `getHostState`/`getPlayerState`/自動推進邏輯算出的時間點一致

- [ ] **Step 1: import**

在 `src/actions/liveActions.ts` 檔案開頭 import 區塊加入：

```ts
import { getLiveQuestions } from '@/services/live/liveStore';
import { getEffectiveQuestionDuration } from '@/services/live/questionDuration';
```

- [ ] **Step 2: `startGame` 套用延長時間**

原本：

```ts
export async function startGame(gameId: number) {
  const { userId } = await auth();
  if (!userId) {
    return { error: 'Unauthorized' as const };
  }
  const game = await loadOwnedGame(gameId, userId);
  if (!game) {
    return { error: 'GAME_NOT_FOUND' };
  }
  if (game.status !== 'waiting') {
    return { error: 'ALREADY_STARTED' };
  }

  // 用 JS Date：跟 questionStartedAt 同 pattern，可靠寫入 timestamp 欄位
  const now = new Date();
  await db
    .update(liveGameSchema)
    .set({
      status: 'playing',
      currentQuestionIndex: 0,
      questionStartedAt: now,
      nextTransitionAt: new Date(now.getTime() + (game.questionDuration + PLAY_PHASE_BUFFER_SEC) * 1000),
    })
    .where(eq(liveGameSchema.id, game.id));

  await publishTick(game.id);
  return { ok: true as const };
}
```

改成：

```ts
export async function startGame(gameId: number) {
  const { userId } = await auth();
  if (!userId) {
    return { error: 'Unauthorized' as const };
  }
  const game = await loadOwnedGame(gameId, userId);
  if (!game) {
    return { error: 'GAME_NOT_FOUND' };
  }
  if (game.status !== 'waiting') {
    return { error: 'ALREADY_STARTED' };
  }

  // 第一題若是聽力題，作答時間要加上音檔長度
  const questions = await getLiveQuestions(game.quizId);
  const firstQuestion = questions[0];
  const effectiveDuration = firstQuestion
    ? getEffectiveQuestionDuration(firstQuestion, game.questionDuration)
    : game.questionDuration;

  // 用 JS Date：跟 questionStartedAt 同 pattern，可靠寫入 timestamp 欄位
  const now = new Date();
  await db
    .update(liveGameSchema)
    .set({
      status: 'playing',
      currentQuestionIndex: 0,
      questionStartedAt: now,
      nextTransitionAt: new Date(now.getTime() + (effectiveDuration + PLAY_PHASE_BUFFER_SEC) * 1000),
    })
    .where(eq(liveGameSchema.id, game.id));

  await publishTick(game.id);
  return { ok: true as const };
}
```

- [ ] **Step 3: `nextQuestion` 套用延長時間**

原本：

```ts
export async function nextQuestion(gameId: number) {
  const { userId } = await auth();
  if (!userId) {
    return { error: 'Unauthorized' as const };
  }
  const game = await loadOwnedGame(gameId, userId);
  if (!game) {
    return { error: 'GAME_NOT_FOUND' };
  }

  // 取支援題型數量
  const rows = await db
    .select({ type: questionSchema.type })
    .from(questionSchema)
    .where(eq(questionSchema.quizId, game.quizId))
    .orderBy(asc(questionSchema.position));
  const supportedCount = rows.filter(r => isLiveSupportedType(r.type)).length;

  const nextIdx = game.currentQuestionIndex + 1;
  if (nextIdx >= supportedCount) {
    // 已經是最後一題 → 結束
    await db
      .update(liveGameSchema)
      .set({ status: 'finished', endedAt: new Date(), nextTransitionAt: null })
      .where(eq(liveGameSchema.id, game.id));
    await publishTick(game.id);
    return { ok: true as const, finished: true };
  }

  const nowQ = new Date();
  await db
    .update(liveGameSchema)
    .set({
      status: 'playing',
      currentQuestionIndex: nextIdx,
      questionStartedAt: nowQ,
      nextTransitionAt: new Date(nowQ.getTime() + (game.questionDuration + PLAY_PHASE_BUFFER_SEC) * 1000),
    })
    .where(eq(liveGameSchema.id, game.id));

  await publishTick(game.id);
  return { ok: true as const, finished: false };
}
```

改成：

```ts
export async function nextQuestion(gameId: number) {
  const { userId } = await auth();
  if (!userId) {
    return { error: 'Unauthorized' as const };
  }
  const game = await loadOwnedGame(gameId, userId);
  if (!game) {
    return { error: 'GAME_NOT_FOUND' };
  }

  // 取支援題型清單（含音檔長度，換題時要用來算延長後的作答時間）
  const questions = await getLiveQuestions(game.quizId);
  const supportedCount = questions.length;

  const nextIdx = game.currentQuestionIndex + 1;
  if (nextIdx >= supportedCount) {
    // 已經是最後一題 → 結束
    await db
      .update(liveGameSchema)
      .set({ status: 'finished', endedAt: new Date(), nextTransitionAt: null })
      .where(eq(liveGameSchema.id, game.id));
    await publishTick(game.id);
    return { ok: true as const, finished: true };
  }

  const nextQuestionRow = questions[nextIdx];
  const effectiveDuration = nextQuestionRow
    ? getEffectiveQuestionDuration(nextQuestionRow, game.questionDuration)
    : game.questionDuration;

  const nowQ = new Date();
  await db
    .update(liveGameSchema)
    .set({
      status: 'playing',
      currentQuestionIndex: nextIdx,
      questionStartedAt: nowQ,
      nextTransitionAt: new Date(nowQ.getTime() + (effectiveDuration + PLAY_PHASE_BUFFER_SEC) * 1000),
    })
    .where(eq(liveGameSchema.id, game.id));

  await publishTick(game.id);
  return { ok: true as const, finished: false };
}
```

- [ ] **Step 4: 型別檢查**

```bash
npm run check-types
```

Expected: 通過。`questionSchema`/`asc` 這兩個 import 仍有在 `createLiveGame` 用到，不用移除。

- [ ] **Step 5: Commit**

```bash
git add src/actions/liveActions.ts
git commit -m "聽力題 Live Mode：liveActions 開局/切題套用延長時間"
```

---

### Task 6: `probeAudioDuration` 音檔時長偵測 helper

**Files:**
- Create: `src/lib/audioDuration.ts`
- Test: `src/lib/audioDuration.test.ts`

**Interfaces:**
- Consumes: 無
- Produces: `probeAudioDuration(url: string): Promise<number | null>`（後續 Task 8、9、10 都會 import）

- [ ] **Step 1: 寫失敗的測試**

建立 `src/lib/audioDuration.test.ts`：

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { probeAudioDuration } from './audioDuration';

describe('probeAudioDuration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('loadedmetadata 觸發時回傳四捨五入後的秒數', async () => {
    const listeners: Record<string, () => void> = {};
    const fakeAudio = {
      addEventListener: (event: string, cb: () => void) => {
        listeners[event] = cb;
      },
      set src(_v: string) {},
      duration: 18.6,
    } as unknown as HTMLAudioElement;
    vi.spyOn(document, 'createElement').mockReturnValue(fakeAudio);

    const promise = probeAudioDuration('blob:fake-url');
    listeners.loadedmetadata?.();

    await expect(promise).resolves.toBe(19);
  });

  it('error 事件觸發時回傳 null', async () => {
    const listeners: Record<string, () => void> = {};
    const fakeAudio = {
      addEventListener: (event: string, cb: () => void) => {
        listeners[event] = cb;
      },
      set src(_v: string) {},
    } as unknown as HTMLAudioElement;
    vi.spyOn(document, 'createElement').mockReturnValue(fakeAudio);

    const promise = probeAudioDuration('blob:fake-url');
    listeners.error?.();

    await expect(promise).resolves.toBeNull();
  });

  it('8 秒內都沒觸發任何事件時，逾時回傳 null', async () => {
    vi.useFakeTimers();
    const fakeAudio = {
      addEventListener: () => {},
      set src(_v: string) {},
    } as unknown as HTMLAudioElement;
    vi.spyOn(document, 'createElement').mockReturnValue(fakeAudio);

    const promise = probeAudioDuration('blob:fake-url');
    vi.advanceTimersByTime(8000);

    await expect(promise).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
npx vitest run src/lib/audioDuration.test.ts
```

Expected: FAIL（`./audioDuration` 模組不存在）

- [ ] **Step 3: 寫實作**

建立 `src/lib/audioDuration.ts`：

```ts
'use client';

// 探測音檔長度（秒），四捨五入成整數；失敗（跨域、不支援、逾時）回傳 null，
// 不阻擋儲存流程 —— null 會讓 Live Mode 走 LISTENING_FALLBACK_SEC 寬限
// （見 src/services/live/questionDuration.ts）。
export function probeAudioDuration(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    const timeout = setTimeout(() => resolve(null), 8000);
    audio.addEventListener('loadedmetadata', () => {
      clearTimeout(timeout);
      resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration) : null);
    });
    audio.addEventListener('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });
    audio.src = url;
  });
}
```

- [ ] **Step 4: 跑測試確認通過**

```bash
npx vitest run src/lib/audioDuration.test.ts
```

Expected: PASS（3 個測試全過）

- [ ] **Step 5: Commit**

```bash
git add src/lib/audioDuration.ts src/lib/audioDuration.test.ts
git commit -m "聽力題 Live Mode：新增 probeAudioDuration 音檔時長偵測 helper"
```

---

### Task 7: `questionActions.ts` 支援 `audioDurationSec` 讀寫

**Files:**
- Modify: `src/actions/questionActions.ts`

**Interfaces:**
- Consumes: `questionSchema.audioDurationSec`（Task 1）
- Produces: `QuestionInput` 型別含 `audioDurationSec?: number`；`createQuestion`/`updateQuestion` 會把它寫進 DB（後續 Task 8 的 `QuestionForm.tsx` 靠這個把偵測到的秒數存下來）

- [ ] **Step 1: 修改 `QuestionInputSchema`**

在 `src/actions/questionActions.ts` 的 `QuestionInputSchema`，`audioUrl` 後面加一個欄位：

```ts
const QuestionInputSchema = z.object({
  type: z.enum(['single_choice', 'multiple_choice', 'true_false', 'short_answer', 'ranking', 'listening', 'cloze']),
  body: z.string().min(1, '請輸入題目內容'),
  imageUrl: z.string().url().optional().or(z.literal('')), // 題目圖片網址
  audioUrl: z.string().url().optional().or(z.literal('')), // 聽力題音檔網址
  audioDurationSec: z.number().int().nonnegative().optional(), // 聽力題音檔秒數（前端探測後帶入）
  audioTranscript: z.string().optional(), // 音檔逐字稿
  options: z
    .array(z.object({ id: z.string(), text: z.string().min(1, '請輸入選項內容') }))
    .optional(),
  correctAnswers: z.array(z.string()).optional(),
  referenceAnswer: z.string().optional(), // 簡答題參考答案 / 評分要點
  points: z.coerce.number().min(1).default(1),
}).superRefine((data, ctx) => {
  // 克漏字題若沒有任何 [[ ]] 標記（沒標記或標記打錯），無法批改，擋在存檔前
  if (data.type === 'cloze' && extractClozeAnswers(data.body).length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['body'],
      message: '克漏字題至少需要一個空格，請用 [[詞彙]] 標記要挖空的重點',
    });
  }
});
```

- [ ] **Step 2: `createQuestion` 寫入欄位**

在 `db.insert(questionSchema).values({...})` 內，`audioUrl` 那行後面加：

```ts
    audioUrl: parsed.data.audioUrl || null,
    audioDurationSec: parsed.data.audioDurationSec ?? null,
    audioTranscript: parsed.data.audioTranscript || null,
```

- [ ] **Step 3: `updateQuestion` 寫入欄位**

在 `db.update(questionSchema).set({...})` 內，同樣位置加：

```ts
      audioUrl: parsed.data.audioUrl || null,
      audioDurationSec: parsed.data.audioDurationSec ?? null,
      audioTranscript: parsed.data.audioTranscript || null,
```

- [ ] **Step 4: 型別檢查**

```bash
npm run check-types
```

Expected: 通過。

- [ ] **Step 5: Commit**

```bash
git add src/actions/questionActions.ts
git commit -m "聽力題 Live Mode：questionActions 支援讀寫 audioDurationSec"
```

---

### Task 8: `QuestionForm.tsx` 手動上傳音檔時偵測時長

**Files:**
- Modify: `src/features/quiz/QuestionForm.tsx`

**Interfaces:**
- Consumes: `probeAudioDuration`（Task 6）、`QuestionInput.audioDurationSec`（Task 7）
- Produces: 老師手動上傳聽力題音檔後，`audioDurationSec` 會隨表單一起送到 `createQuestion`/`updateQuestion`

- [ ] **Step 1: import helper**

在 `src/features/quiz/QuestionForm.tsx` 檔案開頭 import 區塊加入：

```ts
import { probeAudioDuration } from '@/lib/audioDuration';
```

- [ ] **Step 2: `QuestionSchema` 加欄位**

`audioUrl` 後面加：

```ts
const QuestionSchema = z.object({
  type: z.enum(['single_choice', 'multiple_choice', 'true_false', 'short_answer', 'ranking', 'listening', 'cloze']),
  body: z.string().min(1, '請輸入題目內容'),
  imageUrl: z.string().optional(), // 題目圖片網址
  audioUrl: z.string().optional(), // 聽力題音檔網址
  audioDurationSec: z.number().optional(), // 聽力題音檔秒數（Live Mode 計時用）
  audioTranscript: z.string().optional(), // 音檔逐字稿（選填）
  options: z
    .array(z.object({ id: z.string(), text: z.string().min(1, '請輸入選項內容') }))
    .optional(),
  correctAnswers: z.array(z.string()).optional(),
  referenceAnswer: z.string().optional(),
  points: z.coerce.number().min(1).default(1),
}).superRefine((data, ctx) => {
  if (data.type === 'cloze' && extractClozeAnswers(data.body).length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['body'],
      message: '克漏字題至少需要一個空格，請用 [[詞彙]] 標記要挖空的重點',
    });
  }
});
```

- [ ] **Step 3: `handleAudioSelect` 上傳成功後偵測時長**

原本：

```ts
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? '上傳失敗');
      }
      form.setValue('audioUrl', data.url, { shouldDirty: true });
    } catch (err) {
      setAudioUploadError(err instanceof Error ? err.message : '上傳失敗');
    } finally {
      setAudioUploading(false);
      if (audioInputRef.current) {
        audioInputRef.current.value = '';
      }
    }
  };
```

改成：

```ts
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? '上傳失敗');
      }
      form.setValue('audioUrl', data.url, { shouldDirty: true });
      // 偵測音檔秒數，存下來給 Live Mode 用來延長作答時間；偵測失敗也不阻擋存檔
      const durationSec = await probeAudioDuration(data.url);
      form.setValue('audioDurationSec', durationSec ?? undefined, { shouldDirty: true });
    } catch (err) {
      setAudioUploadError(err instanceof Error ? err.message : '上傳失敗');
    } finally {
      setAudioUploading(false);
      if (audioInputRef.current) {
        audioInputRef.current.value = '';
      }
    }
  };
```

- [ ] **Step 4: 移除音檔時同步清空秒數**

原本「移除音檔」按鈕：

```tsx
              {form.watch('audioUrl') && (
                <button
                  type="button"
                  onClick={() => form.setValue('audioUrl', '', { shouldDirty: true })}
                  className="text-xs text-destructive hover:underline"
                >
                  移除音檔
                </button>
              )}
```

改成：

```tsx
              {form.watch('audioUrl') && (
                <button
                  type="button"
                  onClick={() => {
                    form.setValue('audioUrl', '', { shouldDirty: true });
                    form.setValue('audioDurationSec', undefined, { shouldDirty: true });
                  }}
                  className="text-xs text-destructive hover:underline"
                >
                  移除音檔
                </button>
              )}
```

- [ ] **Step 5: 型別檢查**

```bash
npm run check-types
```

Expected: 通過。

- [ ] **Step 6: 手動驗證**

```bash
npm run dev
```

開一份測驗 → 新增聽力題 → 手動上傳一個音檔（例如 10 秒的 mp3）→ 存檔 → 用 Drizzle Studio（`npm run db:studio`）確認該題的 `audio_duration_sec` 欄位有存到接近 10 的整數。

- [ ] **Step 7: Commit**

```bash
git add src/features/quiz/QuestionForm.tsx
git commit -m "聽力題 Live Mode：QuestionForm 手動上傳音檔時偵測並存下時長"
```

---

### Task 9: AI TTS 批次匯入時偵測音檔時長

**Files:**
- Modify: `src/components/quiz/AIQuizModal.tsx`
- Modify: `src/features/quiz/QuizEditor.tsx`
- Modify: `src/app/api/quizzes/[id]/questions/route.ts`

**Interfaces:**
- Consumes: `probeAudioDuration`（Task 6）
- Produces: AI 出題流程生成的聽力題音檔，`audioDurationSec` 會跟著批次匯入寫進 DB

- [ ] **Step 1: `AIQuizModal.tsx` 型別加欄位**

在 `src/components/quiz/AIQuizModal.tsx` 的 `GeneratedQuestion` type，`audioUrl` 後面加：

```ts
type GeneratedQuestion = {
  type: QuestionType;
  question: string;
  options?: string[];
  answer: string | string[];
  explanation?: string;
  listeningText?: string; // 聽力題要念的口語化文字
  audioUrl?: string; // 聽力題 TTS 生成的音檔 URL
  audioDurationSec?: number; // 聽力題音檔秒數（Live Mode 計時用）
};
```

- [ ] **Step 2: `AIQuizModal.tsx` import helper**

檔案開頭 import 區塊加入：

```ts
import { probeAudioDuration } from '@/lib/audioDuration';
```

- [ ] **Step 3: TTS 生成成功後偵測時長**

原本：

```ts
              if (res.ok) {
                const ttsData = await res.json();
                q.audioUrl = ttsData.url;
                if (!q.listeningText) {
                  q.listeningText = ttsText;
                }
              }
```

改成：

```ts
              if (res.ok) {
                const ttsData = await res.json();
                q.audioUrl = ttsData.url;
                if (!q.listeningText) {
                  q.listeningText = ttsText;
                }
                // 偵測音檔秒數，存下來給 Live Mode 用來延長作答時間；偵測失敗也不阻擋匯入
                const durationSec = await probeAudioDuration(ttsData.url);
                if (durationSec !== null) {
                  q.audioDurationSec = durationSec;
                }
              }
```

- [ ] **Step 4: `QuizEditor.tsx` 型別加欄位**

在 `src/features/quiz/QuizEditor.tsx` 的 `AIGeneratedQuestion` type，`audioUrl` 後面加：

```ts
type AIGeneratedQuestion = {
  type: AIQuestionType;
  question: string;
  options?: string[];
  answer: string | string[];
  explanation?: string;
  listeningText?: string; // 聽力題口語化文字
  audioUrl?: string; // 聽力題 TTS 音檔 URL
  audioDurationSec?: number; // 聽力題音檔秒數（Live Mode 計時用）
};
```

（`handleAIImport` 本身不用改：它直接把整個 `aiQuestions` 陣列 `JSON.stringify` 送到 `/api/quizzes/[id]/questions`，欄位會自動帶過去。）

- [ ] **Step 5: `questions/route.ts` 型別 + 寫入 DB**

在 `src/app/api/quizzes/[id]/questions/route.ts` 的 `GeneratedQuestion` type，`audioUrl` 後面加：

```ts
type GeneratedQuestion = {
  type: FileQuestionType;
  question: string;
  options?: string[];
  answer: string | string[];
  explanation?: string;
  listeningText?: string; // 聽力題要念的口語化文字
  audioUrl?: string; // 聽力題已生成的音檔 URL
  audioDurationSec?: number; // 聽力題音檔秒數（Live Mode 計時用）
};
```

`rows.map()` 回傳的物件，`audioUrl` 那行後面加：

```ts
    return {
      quizId,
      type,
      body: q.question,
      options,
      correctAnswers: correctAnswers.length ? correctAnswers : null,
      audioUrl: q.audioUrl || null,
      audioDurationSec: q.audioDurationSec ?? null,
      audioTranscript: q.listeningText || null,
      points: 1,
      position: nextPosition++,
    };
```

- [ ] **Step 6: 型別檢查**

```bash
npm run check-types
```

Expected: 通過。

- [ ] **Step 7: 手動驗證**

```bash
npm run dev
```

用 AI 出題 Modal 選「聽力題」生成 1-2 題 → 匯入 → 用 Drizzle Studio 確認該題的 `audio_duration_sec` 有存到值。

- [ ] **Step 8: Commit**

```bash
git add src/components/quiz/AIQuizModal.tsx src/features/quiz/QuizEditor.tsx src/app/api/quizzes/\[id\]/questions/route.ts
git commit -m "聽力題 Live Mode：AI TTS 批次匯入時偵測並存下音檔時長"
```

---

### Task 10: 重新生成音檔時同步更新時長

**Files:**
- Modify: `src/features/quiz/QuestionCard.tsx`
- Modify: `src/features/quiz/QuizEditor.tsx`

**Interfaces:**
- Consumes: `probeAudioDuration`（Task 6）
- Produces: 老師點「🔄 重新生成音檔」時，`audioDurationSec` 會跟著新音檔一起更新，不會殘留舊音檔的秒數（若不做這個 task，重新生成音檔後 Live Mode 的延長時間會用到舊音檔的秒數，跟新音檔對不上）

- [ ] **Step 1: `QuestionCard.tsx` 擴充 `onAudioRegenerated` 簽名**

原本：

```ts
type Props = {
  question: Question;
  index: number;
  onEdit: () => void;
  onDelete: () => void;
  isDeleting: boolean;
  onAudioRegenerated?: (questionId: number, audioUrl: string) => void;
};
```

改成：

```ts
type Props = {
  question: Question;
  index: number;
  onEdit: () => void;
  onDelete: () => void;
  isDeleting: boolean;
  onAudioRegenerated?: (questionId: number, audioUrl: string, audioDurationSec: number | null) => void;
};
```

- [ ] **Step 2: `handleRegenerateTts` 偵測新音檔時長**

在 `src/features/quiz/QuestionCard.tsx` 加 import：

```ts
import { probeAudioDuration } from '@/lib/audioDuration';
```

原本：

```ts
      const { url } = await res.json();
      onAudioRegenerated?.(question.id, url);
```

改成：

```ts
      const { url } = await res.json();
      const durationSec = await probeAudioDuration(url);
      onAudioRegenerated?.(question.id, url, durationSec);
```

- [ ] **Step 3: `QuizEditor.tsx` 的 `onAudioRegenerated` 回呼補上第三個參數**

原本：

```tsx
                          onAudioRegenerated={async (questionId, audioUrl) => {
                            await updateQuestion(questionId, initialQuiz.id, {
                              type: question.type,
                              body: question.body,
                              options: question.options ?? undefined,
                              correctAnswers: question.correctAnswers ?? undefined,
                              points: question.points,
                              audioUrl,
                            });
                            router.refresh();
                          }}
```

改成：

```tsx
                          onAudioRegenerated={async (questionId, audioUrl, audioDurationSec) => {
                            await updateQuestion(questionId, initialQuiz.id, {
                              type: question.type,
                              body: question.body,
                              options: question.options ?? undefined,
                              correctAnswers: question.correctAnswers ?? undefined,
                              points: question.points,
                              audioUrl,
                              audioDurationSec: audioDurationSec ?? undefined,
                            });
                            router.refresh();
                          }}
```

- [ ] **Step 4: 型別檢查**

```bash
npm run check-types
```

Expected: 通過。

- [ ] **Step 5: 手動驗證**

開一份含聽力題的測驗 → 對某題按「🔄 重新生成音檔」→ 用 Drizzle Studio 確認 `audio_duration_sec` 有跟著新音檔更新（跟原本的值不同，或至少反映新音檔實際長度）。

- [ ] **Step 6: Commit**

```bash
git add src/features/quiz/QuestionCard.tsx src/features/quiz/QuizEditor.tsx
git commit -m "聽力題 Live Mode：重新生成音檔時同步更新 audioDurationSec"
```

---

### Task 11: Live Mode 播放 UI（學生端 + 老師端）

**Files:**
- Modify: `src/features/live/LivePlayerQuestion.tsx`
- Modify: `src/features/live/LiveQuestionScreen.tsx`

**Interfaces:**
- Consumes: `LiveQuestionForPlayer.audioUrl`/`.audioDurationSec`（Task 3）、`LISTENING_FALLBACK_SEC`（Task 2）
- Produces: 聽力題在 Live Mode 的完整播放體驗——學生端自動播放、播完才顯示選項、瀏覽器擋自動播放時的手動播放按鈕、中途加入判斷；老師端顯示播放中提示

- [ ] **Step 1: `LivePlayerQuestion.tsx` import**

檔案開頭 import 區塊加入：

```ts
import { LISTENING_FALLBACK_SEC } from '@/services/live/questionDuration';
```

- [ ] **Step 2: 加入音檔播放狀態**

在 `selectedSingle`/`selectedMulti` 那組 state 後面加：

```ts
  // 聽力題播放狀態：'pending' 尚未判斷、'playing' 播放中（選項隱藏）、
  // 'blocked' 被瀏覽器擋自動播放（顯示手動播放按鈕）、'ended' 播完/late-join 判定已播完（顯示選項）
  const [audioState, setAudioState] = useState<'pending' | 'playing' | 'blocked' | 'ended'>('pending');
```

- [ ] **Step 3: 換題時重新判斷音檔狀態**

原本：

```ts
  // 換題清空選擇
  const questionId = currentQuestion?.id ?? null;
  useEffect(() => {
    setSelectedSingle(null);
    setSelectedMulti(new Set());
  }, [questionId]);
```

改成：

```ts
  // 換題清空選擇 + 重新判斷聽力題播放狀態
  const questionId = currentQuestion?.id ?? null;
  useEffect(() => {
    setSelectedSingle(null);
    setSelectedMulti(new Set());

    if (currentQuestion?.type !== 'listening') {
      setAudioState('ended'); // 非聽力題視同「已播完」，選項直接顯示
      return;
    }

    // 中途加入 / reconnect：若加入時音檔理論上已經播完，不重播，直接顯示選項
    // （避免卡在「聆聽中」畫面卻永遠聽不到已經播完的聲音）
    if (game.questionStartedAt) {
      const elapsedMs = Date.now() - new Date(game.questionStartedAt).getTime();
      const audioLenMs = (currentQuestion.audioDurationSec ?? LISTENING_FALLBACK_SEC) * 1000;
      if (elapsedMs >= audioLenMs) {
        setAudioState('ended');
        return;
      }
    }

    setAudioState('playing');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionId]);
```

- [ ] **Step 4: render 音檔元素 + 依狀態隱藏選項**

原本題目卡片之後、選項清單之前是：

```tsx
      <div className="rounded-xl border bg-card p-4">
        <h2 className="text-lg font-semibold leading-relaxed">
          {currentQuestion.body}
        </h2>
        {currentQuestion.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentQuestion.imageUrl}
            alt=""
            className="mt-3 max-h-60 rounded-lg"
          />
        )}
      </div>

      {/* 選項 */}
      <PlayerOptionList
        question={currentQuestion}
        selectedSingle={selectedSingle}
        selectedMulti={selectedMulti}
        myAnswerIds={myAnswerIds(myAnswer?.selectedOptionId)}
        correctAnswers={isShowingResult ? correctAnswers : undefined}
        disabled={hasAnswered || isShowingResult || submitting}
        onSelectSingle={setSelectedSingle}
        onToggleMulti={handleToggleMulti}
      />
```

改成：

```tsx
      <div className="rounded-xl border bg-card p-4">
        <h2 className="text-lg font-semibold leading-relaxed">
          {currentQuestion.body}
        </h2>
        {currentQuestion.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentQuestion.imageUrl}
            alt=""
            className="mt-3 max-h-60 rounded-lg"
          />
        )}
        {currentQuestion.type === 'listening' && currentQuestion.audioUrl && !isShowingResult && (
          <div className="mt-3">
            {audioState === 'playing' && (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <audio
                autoPlay
                src={currentQuestion.audioUrl}
                onEnded={() => setAudioState('ended')}
                onPlay={() => setAudioState('playing')}
                onError={() => setAudioState('ended')}
                ref={(el) => {
                  // autoplay 被瀏覽器政策擋下時 play() 會 reject，退回手動播放按鈕
                  el?.play().catch(() => setAudioState('blocked'));
                }}
              />
            )}
            {audioState === 'playing' && (
              <p className="text-center text-sm text-muted-foreground">🎧 聆聽中…</p>
            )}
            {audioState === 'blocked' && (
              <div className="text-center">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <audio
                  id={`listening-audio-${currentQuestion.id}`}
                  src={currentQuestion.audioUrl}
                  onEnded={() => setAudioState('ended')}
                  className="hidden"
                />
                <Button
                  type="button"
                  onClick={() => {
                    const el = document.getElementById(`listening-audio-${currentQuestion.id}`) as HTMLAudioElement | null;
                    el?.play();
                    setAudioState('playing');
                  }}
                >
                  ▶️ 點我播放音檔
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 選項：聽力題要等音檔播完（或已判定播完）才顯示，避免用猜的搶快 */}
      {audioState !== 'playing' && audioState !== 'blocked' && (
        <PlayerOptionList
          question={currentQuestion}
          selectedSingle={selectedSingle}
          selectedMulti={selectedMulti}
          myAnswerIds={myAnswerIds(myAnswer?.selectedOptionId)}
          correctAnswers={isShowingResult ? correctAnswers : undefined}
          disabled={hasAnswered || isShowingResult || submitting}
          onSelectSingle={setSelectedSingle}
          onToggleMulti={handleToggleMulti}
        />
      )}
```

- [ ] **Step 5: 型別檢查**

```bash
npm run check-types
```

Expected: 通過。

- [ ] **Step 6: `LiveQuestionScreen.tsx` 加播放中提示**

在 `src/features/live/LiveQuestionScreen.tsx`，題目卡片內加提示，原本：

```tsx
      <div className="rounded-xl border bg-card p-6">
        <h2 className="text-xl font-semibold leading-relaxed">
          {currentQuestion.body}
        </h2>
        {currentQuestion.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentQuestion.imageUrl}
            alt=""
            className="mt-4 max-h-72 rounded-lg"
          />
        )}
      </div>
```

改成：

```tsx
      <div className="rounded-xl border bg-card p-6">
        <h2 className="text-xl font-semibold leading-relaxed">
          {currentQuestion.body}
        </h2>
        {currentQuestion.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentQuestion.imageUrl}
            alt=""
            className="mt-4 max-h-72 rounded-lg"
          />
        )}
        {currentQuestion.type === 'listening' && !isShowingResult && (
          <p className="mt-3 text-center text-sm text-muted-foreground">🎧 播放中（學生裝置各自播放）</p>
        )}
      </div>
```

- [ ] **Step 7: 型別檢查**

```bash
npm run check-types
```

Expected: 通過。

- [ ] **Step 8: Commit**

```bash
git add src/features/live/LivePlayerQuestion.tsx src/features/live/LiveQuestionScreen.tsx
git commit -m "聽力題 Live Mode：學生端自動播放 + 老師端播放提示"
```

---

### Task 12: 全專案驗證 + 手動 QA

**Files:** 無新增/修改，純驗證

**Interfaces:** 無

- [ ] **Step 1: 完整測試套件**

```bash
npm run test
```

Expected: 全部通過（包含 Task 2、3、6 新增的測試）。

- [ ] **Step 2: Lint**

```bash
npm run lint
```

Expected: 無錯誤（若有 auto-fixable 問題，跑 `npx eslint --fix` 後確認乾淨）。

- [ ] **Step 3: 型別檢查**

```bash
npm run check-types
```

Expected: 無錯誤。

- [ ] **Step 4: 手動 QA（依 spec 測試清單）**

```bash
npm run dev
```

1. 建立含聽力題的測驗（手動上傳音檔 + AI TTS 生成兩種來源都測）→ 確認 `audioDurationSec` 有正確存進 DB（`npm run db:studio` 查看）
2. Live Mode 開局，手機（或桌機縮視窗模擬）加入 → 確認音檔自動播放、選項延遲到播完才出現、倒數時間 = 老師設定時長 + 音檔秒數
3. 手動把某題 `audio_duration_sec` 改成 `NULL`（Drizzle Studio）→ 重開一場 Live Mode → 確認倒數變成「設定時長 + 15 秒」
4. 模擬自動播放被擋（例如 Chrome DevTools 裝置模擬 iOS Safari，或手動把 `<audio>` 的 `autoPlay` play() 失敗路徑）→ 確認出現「▶️ 點我播放音檔」按鈕，點擊後可正常播放且選項在播完後出現
5. 中途加入：題目播到一半才加入的學生 → 確認不會卡在「聆聽中」畫面，直接看到選項
6. 混合測驗（聽力題 + 選擇題交錯）→ 確認選擇題的倒數沒有被誤延長
7. 老師主控台：聽力題進行中畫面顯示「🎧 播放中」提示；答題中的斷線計數等既有功能不受影響

- [ ] **Step 5: 若有問題，回頭修對應 Task；全部通過後準備 PR**

依 CLAUDE.md 的 Agent 任務工作流：若這是從 GitHub issue 認領的任務，開 PR 時描述寫 `Closes #<N>`，不要自己 merge。

---

## Self-Review 紀錄

- **Spec coverage**：資料模型（Task 1）、計時邏輯與三個呼叫點（Task 2, 4, 5）、批改邏輯（Task 3）、音檔時長偵測三個入口——手動上傳（Task 8）、AI TTS 批次匯入（Task 9）、重新生成（Task 10，spec 邊界情況分析時發現的第三個入口，已補上）、學生端播放 UI 含中途加入判斷與自動播放 fallback（Task 11）、老師端提示（Task 11）——spec 的每一節都對應到至少一個 task。
- **Placeholder scan**：所有 step 都附完整程式碼，無 TBD/「依樣畫葫蘆」字樣。
- **Type consistency**：`getEffectiveQuestionDuration`（Task 2）→ Task 4、5 用同樣簽名呼叫；`probeAudioDuration`（Task 6）→ Task 8、9、10 用同樣回傳型別（`number | null`）處理；`onAudioRegenerated` 簽名在 Task 10 的 `QuestionCard.tsx`（定義處）與 `QuizEditor.tsx`（呼叫處）保持一致（三個參數）。
