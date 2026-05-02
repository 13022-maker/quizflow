# AI 出題完成後顯示本月使用次數（2026-05-02）

## 背景

老師完成 AI 出題後，目前 QuizEditor 只顯示「✅ 已新增 N 題」的 success
banner，沒任何「本月用了幾次」的資訊。Free 老師（10 次/月）只能跑去
`/dashboard/billing` 才看得到剩餘額度，使用感斷裂；Pro 老師（無上限）
完全沒有任何使用回饋。

需求：在 AI 出題完成的那個瞬間，順手在既有 success banner 多顯示
「本月已用 N 次」這類訊息，提升用量透明度。

## 為什麼不顯示 USD / Token

設計階段討論過四種方向（USD / 次數 / token / 條件呈現），最終選次數
為主、依方案分支文案，理由：

1. **0 schema 改動**：`ai_usage.count` 已經在記了
2. **0 計價維護**：不用 hardcode Claude / Gemini / OpenAI 三家不斷變動的單價
3. **跨 9 條 AI route 不用每條改**：所有計次都統一在
   `aiUsageActions.checkAndIncrementAiUsage`，本 spec 不動 route 層
4. **對齊現有 UX**：與 `AiQuotaBanner` / `billing` 頁的次數展示一致
5. **避免老師困惑**：Free 老師看到 USD 不知所措、Pro 老師看到 USD 想退訂

USD / token 級別的成本可視化，未來真要做給 admin 用的成本 dashboard
時再另開 spec、再加 `ai_usage.tokenIn / tokenOut` 等欄位。

## 設計

### 資料流

```
AI 出題完成（API route 已 increment ai_usage.count）
    ↓
AIQuizModal 把生成題目交給 QuizEditor.handleAIImport
    ↓
handleAIImport 完成題目寫入 / 標題覆寫後
    ↓
呼叫既有 server action getAiUsageRemaining(userId) 純讀取當月計數
    ↓
把 { quota, used, remaining } 丟給 formatAiUsageMessage 產生文案
    ↓
塞進既有 importSuccess banner 多顯示一行
```

關鍵：`getAiUsageRemaining` 是已存在的 server action（`src/actions/
aiUsageActions.ts:95`），本 spec 不動它的邏輯，只是新增一個 caller。

### 顯示邏輯（共用 helper）

新檔 `src/lib/aiUsageMessage.ts` 匯出純函式：

```ts
export type AiUsageInfo = { quota: number; used: number; remaining: number };

export type AiUsageMessage = {
  text: string;          // 主文案
  isWarning: boolean;    // 是否為紅字提醒（用於 className 切換）
};

export function formatAiUsageMessage(usage: AiUsageInfo): AiUsageMessage;
```

行為（用回傳值描述，文案實際走 i18n key）：

| 條件 | text 大致長相 | isWarning |
|---|---|---|
| `quota >= 999` | 「Pro 無上限,盡情創作 ✨」(不顯示計數,因 `getAiUsageRemaining` Pro 分支不查 DB short-circuit 回 used: 0) | false |
| `quota < 999` 且 `remaining > 2` | 「本月 {used} / {quota} 次 · 還剩 {remaining} 次」 | false |
| `quota < 999` 且 `remaining <= 2` | 「本月 {used} / {quota} 次 · 只剩 {remaining} 次，升級 Pro 解鎖無限」（連結指向 `/dashboard/billing`） | true |
| `quota < 999` 且 `remaining === 0` | 不會走到（route 層已擋下，handleAIImport 不會被呼叫） | — |

VIP / Trial 中的老師走 `quota >= 999` 分支，文案與 Pro 一致（既有
`getAiUsageRemaining` 已用 `isProOrAbove` 對 trial 回傳 `quota: 999`）。

### Banner 整合

`QuizEditor.tsx` 既有 `importSuccess` 狀態（`setImportSuccess(true)`，
搭配 `useEffect` 監聽 `initialQuestions` 變化清掉），目前只渲染一行
「✅ 已新增 N 題」。

改動：
1. 在 `handleAIImport` 結尾、`setImportSuccess(true)` 之前 await 取
   `getAiUsageRemaining`，存進新 state `aiUsageMsg: AiUsageMessage | null`
2. Banner 渲染時若 `aiUsageMsg` 存在，在原訊息下面多渲染一行
3. `isWarning` 為 true 時加紅字 / 升級連結 className

### 變更檔案範圍

- **新檔**
  - `src/lib/aiUsageMessage.ts`（純函式 + type）
  - `src/lib/aiUsageMessage.test.ts`（vitest unit test 4 分支）
- **修改**
  - `src/features/quiz/QuizEditor.tsx`（`handleAIImport` 加 fetch、banner 加一行）

預估改動：~80 行（含註解、test）。

### 文案策略：hardcode 中文，不走 i18n

雖然 CLAUDE.md 全域規則寫「新增任何翻譯 key 必須同時更新 zh + en」，
但 `QuizEditor.tsx` 目前完全沒用 `useTranslations`（importSuccess banner
本身就是 hardcode 「題已匯入！接下來只要三步」），相關元件
（`AIQuizModal` / `AIGenerateDialog` / `AiQuotaBanner`）也都 0 i18n call。

為了**對齊既有局部 pattern**、避免在這個檔案內首開 i18n / hardcode 的
混血先例，本 spec 文案直接 hardcode 在 `aiUsageMessage.ts` 內。

未來如果要做整個 QuizEditor 的 i18n migration，再一次性把 importSuccess
banner、本次 usage 訊息、其他 hardcode 文字一起搬到 `zh.json` / `en.json`
（這已列在 CLAUDE.md「下一步優先順序 #4 Sub-C UI i18n migration」）。

## 測試

### Unit test（`src/lib/aiUsageMessage.test.ts`）

4 個案例對應 4 分支：

1. Pro / VIP（`quota: 999, used: 0, remaining: 999`）→ Pro 固定文案「Pro 無上限,盡情創作 ✨」、`isWarning: false`（used 用 0 反映 `getAiUsageRemaining` Pro 分支實際回傳值）
2. Free 充裕（`quota: 10, used: 3, remaining: 7`）→ Free 文案、`isWarning: false`
3. Free 低額（`quota: 10, used: 8, remaining: 2`）→ Free 警示文案、`isWarning: true`
4. Free 1 次（`quota: 10, used: 9, remaining: 1`）→ Free 警示文案、`isWarning: true`

### 手動驗證

- Free 帳號：跑一次 AI 出題，確認 banner 多一行「本月 N / 10 次」
- Pro 帳號：跑一次 AI 出題，確認 banner 多一行「Pro 無上限,盡情創作 ✨」
- Free 額度剩 2 次：確認紅字 + 升級提示
- 故意把 `getAiUsageRemaining` 拋錯：確認題目仍順利匯入、banner 不顯示 usage 行

不寫 E2E（Playwright）：純文字加減，QuizEditor 已有 importSuccess 結構。

## 邊角情境

- **同月跨 route**：`getAiUsageRemaining` 看的是 `(ownerId, yearMonth)`
  aggregate count，跨 generate-questions / generate-from-file / generate-vocab
  / generate-flashcards 等 route 全部統一加總，無需特別處理
- **錯誤路徑**：`getAiUsageRemaining` throw → `try/catch` 內 `console.error`，
  `aiUsageMsg` 留 null、banner 跳過該行；題目匯入結果不受影響
- **Race condition**：route 已先 increment 後才回傳題目給 client，因此
  client 拿到題目時 DB count 一定是最新的，不需 retry
- **Trial 過期當下**：trial 過期後 `isProOrAbove` 回 false，下次 AI 出題自動
  走 Free 分支顯示「本月 N / 10 次」，無需特別偵測

## 不做的事（YAGNI 明列）

- 不顯示「本次 1 次」（永遠是 1，冗）
- 不顯示 USD / token 數
- 不改 `ai_usage` schema（不加 token / cost 欄位）
- 不另開 toast / modal（避免打斷老師檢視新增題目）
- 不在 AIQuizModal 內顯示（呈現位置選 QuizEditor banner，貼近題目入庫的時間點）
- 不做 admin 級別的本月跨用戶總成本（未來成本 dashboard 另開 spec）
- 不做 i18n 之外的本地化（幣別 / 時區等）
