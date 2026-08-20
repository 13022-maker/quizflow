# Live Mode Sub-B（part 1）：聽力題（listening）支援（2026-08-20）

> 本 spec 是 CLAUDE.md「下一步優先順序 #4 Live Mode v2」拆出來的 Sub-B 子專案，
> 只處理三種新題型中的 `listening`。`ranking`、`short_answer` 難度與架構影響
> 較大（尤其 short_answer 牽涉 AI 非同步批改跟 Live 節奏的衝突），留待各自
> 另開 spec。

## 背景

Live Mode 目前只支援 `single_choice` / `multiple_choice` / `true_false` 三種
題型（`src/services/live/scoring.ts` `LIVE_SUPPORTED_TYPES`）。非 Live 模式
（`QuizTaker.tsx`）的聽力題其實只是「`single_choice` 資料結構 + 一個
`audioUrl` 欄位」，批改邏輯也跟 `single_choice`/`true_false` 共用同一個
if 分支（`src/actions/responseActions.ts:169`）。這使得聽力題成為三個待補
題型裡風險最低、最適合先做的一個。

**核心設計挑戰**：Live Mode 是 Kahoot 式「固定時長、大家同時倒數搶快」，
但聽力題必須先聽完音檔才能作答。若不處理，音檔還沒播完、倒數已經先跑完，
或是學生沒聽就用猜的搶快，都會讓聽力題失去意義。

## Scope

本 spec 處理：
- 聽力題加入 `LIVE_SUPPORTED_TYPES`，沿用既有的單選批改邏輯
- 依音檔長度自動延長作答時間，讓「聽 + 答」在同一個倒數視窗內都做得完
- 學生端音檔自動播放、播完才顯示選項（避免用猜的搶快）、瀏覽器擋自動播放時的
  手動播放 fallback
- 音檔時長偵測（上傳 / AI TTS 生成時），新增 `audioDurationSec` 欄位

不處理：
- `ranking`、`short_answer` 兩種題型（各自另開 spec）
- 音檔轉錄稿（`audioTranscript`）在 Live Mode 的呈現（例如字幕）—— 目前非
  Live 模式也只把它當作老師編輯時的備註用途，Live Mode 維持不顯示
- 依方案（Free / Pro）限制聽力題可否用於 Live Mode —— 現有 Live Mode 本來
  就沒有依題型做方案分流，這次不新增

## 架構

### 型別 / 批改

`src/services/live/types.ts`：
```ts
export type LiveQuestionType = 'single_choice' | 'multiple_choice' | 'true_false' | 'listening';

export type LiveQuestionForHost = {
  id: number;
  type: LiveQuestionType;
  body: string;
  imageUrl: string | null;
  audioUrl: string | null; // 新增
  audioDurationSec: number | null; // 新增
  options: LiveQuestionOption[];
  correctAnswers: string[];
};

export type LiveQuestionForPlayer = {
  id: number;
  type: LiveQuestionType;
  body: string;
  imageUrl: string | null;
  audioUrl: string | null; // 新增
  audioDurationSec: number | null; // 新增：player 端要用來算「音檔播完才顯示選項」
  options: LiveQuestionOption[];
};
```

`src/services/live/scoring.ts`：
```ts
export const LIVE_SUPPORTED_TYPES: LiveQuestionType[] = [
  'single_choice',
  'multiple_choice',
  'true_false',
  'listening', // 新增
];

// gradeAnswer 的 switch：'single_choice' case 加上 'listening'
switch (questionType) {
  case 'single_choice':
  case 'true_false':
  case 'listening': { // 新增
    if (typeof selectedOptionId !== 'string') {
      return false;
    }
    return correctAnswers[0] === selectedOptionId;
  }
  // ...
}
```

`src/services/live/liveStore.ts` 的 `getLiveQuestions()`：select 多兩欄
（`audioUrl`、`audioDurationSec`），型別斷言的聯集加上 `'listening'`。

### 延長作答時間

新檔 `src/services/live/questionDuration.ts`：
```ts
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

這個 helper 有三個呼叫點，缺一個都會讓「server 何時自動切題」跟「前端倒數
顯示」兜不起來：

1. **`src/actions/liveActions.ts` `startGame` / `nextQuestion`**：目前寫入
   `nextTransitionAt` 時只用 `game.questionDuration`（見
   `liveActions.ts:158`、`:227`）。改為先用 `getLiveQuestions(quizId)` 取出
   即將開始那一題（`startGame` 是 index 0、`nextQuestion` 是 `nextIdx`），
   再用 `getEffectiveQuestionDuration(targetQuestion, game.questionDuration)`
   算出 `nextTransitionAt`。
2. **`src/services/live/liveStore.ts` `loadGameWithAutoAdvance` 的 self-heal
   分支**（`nextTransitionAt` 被 Next.js 編譯器吃掉變 null 時，從
   `questionStartedAt` 反推重建，見 `liveStore.ts:127-152`）：反推時同樣要
   先查出當前題目、套用 `getEffectiveQuestionDuration`，否則自癒出來的
   `nextTransitionAt` 會用錯（沒延長的）時長。
3. **`getHostState` / `getPlayerState` 回傳的 `game.questionDuration`
   欄位**：直接用 `getEffectiveQuestionDuration(currentQuestion,
   game.questionDuration)` 覆蓋掉原始值再回傳。前端 `useCountdown` hook
   完全不用改，因為它吃到的本來就已經是「這一題實際該倒數幾秒」。

`maybeAutoAdvance` 的 `showing_result → 下一題` 分支已經有
`getLiveQuestions(game.quizId)` 可重用（原本只是拿來算 `supportedCount`），
改用同一份陣列取出 `questions[nextIdx]` 算 `getEffectiveQuestionDuration`
即可，不用多一次 DB 查詢。

### 上傳 / AI 生成端：音檔時長偵測

新檔 `src/lib/audioDuration.ts`（client-only）：
```ts
'use client';

// 探測音檔長度（秒），四捨五入成整數；失敗（跨域、不支援、逾時）回傳 null，
// 不阻擋儲存流程 —— null 會讓 Live Mode 走 LISTENING_FALLBACK_SEC 寬限。
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

兩個呼叫點：
- `src/features/quiz/QuestionForm.tsx`：手動上傳音檔成功、`form.setValue('audioUrl', data.url, ...)`
  之後，接著 `probeAudioDuration(data.url)` 並 `form.setValue('audioDurationSec', sec, ...)`
- `src/components/quiz/AIQuizModal.tsx`：TTS 生成成功、`q.audioUrl = ttsData.url;`
  之後同樣探測並寫入 `q.audioDurationSec`

`src/actions/questionActions.ts` 的 `QuestionInputSchema` 加
`audioDurationSec: z.number().int().nonnegative().optional()`，create/update
都要寫入 DB。

### DB Schema 變動

`question` 表加一欄：
```ts
// src/models/Schema.ts questionSchema 內，緊接 audioUrl 後面
audioDurationSec: integer('audio_duration_sec'), // 音檔秒數，上傳/生成時前端偵測寫入，nullable
```

Migration（`npm run db:generate` 自動編號，預期 `0038_xxx.sql`）：
```sql
ALTER TABLE "question" ADD COLUMN "audio_duration_sec" integer;
--> statement-breakpoint
```
（`--> statement-breakpoint` 規則見記憶 `feedback_drizzle_breakpoint_rule.md`）

Nullable、無 DEFAULT：既有聽力題 backfill 為 `null`，Live Mode 端自動走
`LISTENING_FALLBACK_SEC` 寬限，不影響既有資料、不需要額外 backfill script。

> 產生 migration 後務必檢查 SQL 內容，只留下這欄的 `ALTER TABLE`——已知
> `migrations/meta/` 缺 0015-0017 snapshot 會讓 `db:generate` 把不相關的
> diff 也塞進來（記憶：CLAUDE.md「Drizzle migration snapshot 脫鉤」段落）。

## Client 端 UI

### 學生端（`src/features/live/LivePlayerQuestion.tsx`）

- 當 `currentQuestion.type === 'listening'` 且 `currentQuestion.audioUrl` 存在：
  render `<audio autoPlay src={audioUrl} />`（不給 `controls`，不能暫停/拖曳）
- 播放期間（`ended` 事件觸發前）畫面只顯示「🎧 聆聽中…」，選項清單隱藏；
  `onEnded` 才顯示選項
- `audio.play()` 若因瀏覽器 autoplay 政策被擋（常見於 iOS Safari，
  `NotAllowedError`）：catch 住，改顯示「▶️ 點我播放音檔」按鈕，點擊後
  手動觸發播放；倒數計時不受影響照常進行（已知取捨，不特別補償）
- 中途加入 / reconnect：mount 時若 `Date.now() - new Date(game.questionStartedAt).getTime()`
  已經超過 `audioDurationSec * 1000`（或 fallback 值），視為音檔理論上已
  播完，直接顯示選項、不再嘗試播放（避免卡在「聆聽中」畫面卻永遠聽不到已
  經播完的聲音）

### 老師端（`src/features/live/LiveQuestionScreen.tsx`）

- 不 render `<audio>` 元素、不出聲，`currentQuestion.type === 'listening'`
  時只在題目上方顯示「🎧 播放中」文字提示
- 倒數沿用 `state.game.questionDuration`（已經是 server 端算好的延長值），
  不需要额外邏輯

## 邊界情況

- **探測失敗**（跨域音檔、瀏覽器不支援、上傳中斷、8 秒逾時）→
  `audioDurationSec` 存 `null`，Live Mode 端套用 `LISTENING_FALLBACK_SEC`
  （+15 秒），不阻擋出題或開局流程
- **舊題目**（本次 migration 前建立的聽力題）→ 同樣走 fallback，不用回填
  舊資料；老師之後重新上傳/更換音檔會自動補上正確值
- **iOS Safari 擋自動播放** → 手動播放按鈕 fallback，倒數照常進行
- **多題型混合的測驗**（聽力題 + 選擇題交錯）→ `getEffectiveQuestionDuration`
  逐題計算，非聽力題完全不受影響
- **Free 方案** → 聽力題不受方案限制，維持現狀

## 風險與回滾

- DB schema 加欄需 migration，回滾用 `ALTER TABLE DROP COLUMN`。新欄位
  nullable 無 DEFAULT，即使新 code 有 bug 也不影響既有題型的既有功能。
  建議部署順序：先 migrate（零 downtime）→ 部署新 code → 用一場含聽力題
  的 Live Mode 手動驗證 → 視情況通知老師此功能上線。
- `getEffectiveQuestionDuration` 若算錯（例如某個呼叫點漏改），最壞情況
  是聽力題倒數跟老師預期時長不同，不會造成資料損毀或崩潰，屬於可觀察、
  可快速修正的風險。
- 音檔自動播放被瀏覽器擋掉是已知、無法完全消除的平台限制（涉及使用者
  手勢政策），fallback 按鈕已覆蓋，不追加更複雜的預先解鎖方案（過度工程）。

## 不在本 spec 範圍

- `ranking`、`short_answer` 題型（各自另開 spec，`short_answer` 需先拍板
  AI 非同步批改在 Live 節奏下的處理方式）
- 音檔轉錄稿 / 字幕呈現
- 依題型做 Live Mode 方案分流
- 老師端也播放音檔（例如教室共用投影/喇叭情境）——目前設計是純學生端
  自行播放，之後若有需求可另開 spec

## 測試方式

**單元測試**：
- `scoring.test.ts`：`isLiveSupportedType('listening')` 為 `true`；
  `gradeAnswer('listening', ...)` 走跟 `single_choice` 相同的比對邏輯
- `questionDuration.test.ts`：三種情境 —— 有 `audioDurationSec`（正確加總）、
  `null`（+15 fallback）、非聽力題型（不受影響，回傳原值）

**手動驗證**（Live Mode 既有測試覆蓋率低，本 spec 不擴大自動化範圍）：
1. 建立含聽力題的測驗（手動上傳音檔 + AI TTS 生成兩種來源都測）→ 確認
   `audioDurationSec` 有正確存進 DB
2. Live Mode 開局，手機加入 → 確認音檔自動播放、選項延遲到播完才出現、
   倒數時間 = 老師設定時長 + 音檔秒數
3. 模擬探測失敗（例如手動把某題 `audioDurationSec` 改成 `null`）→ 確認
   Live Mode 倒數變成「設定時長 + 15 秒」
4. iOS Safari（或桌機模擬手勢限制）→ 確認自動播放被擋時出現手動播放按鈕，
   點擊後可正常播放
5. 中途加入：題目播了一半才加入的學生 → 確認不會卡在「聆聽中」畫面
6. 混合測驗（聽力題 + 選擇題交錯）→ 確認選擇題倒數沒有被誤延長
