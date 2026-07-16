# AI Provider 分流與備援（免費走 Gemini、付費走 Claude）設計文件

- 日期：2026-07-16
- 起因：Anthropic API 額度歸零，所有 Claude-only 功能整頁炸 digest error
  （production log：`400 invalid_request_error: Your credit balance is too low`）
- 範圍：7 個 Claude 呼叫點 + 適性學習「AI 生成學科」友善錯誤

## 核心規則（統一套用）

```
付費（isProOrAbove()）且有 ANTHROPIC_API_KEY → Claude；Claude 失敗自動 fallback Gemini
免費 / 未登入 → 直接 Gemini
```

- 付費判定用既有 `isProOrAbove(userId)`（`src/libs/Plan.ts`，內部走 `auth()`，
  查 Paddle 訂閱 + 試用期；未登入回 false → 歸 free）。
- 使用者已確認三個決策：(1) Claude 失敗要自動 fallback Gemini；(2) 全部 7 個呼叫點都改；
  (3) AI 出題 modal 的「Claude Sonnet 4」按鈕照舊可選，免費用戶由 server 端靜默轉 Gemini。

## 新增共用 helper：`src/lib/ai/textModel.ts`

```ts
type GenerateAITextOptions = {
  prompt: string;          // 完整 prompt（單輪文字）
  claudeModel?: string;    // 預設 'claude-sonnet-4-6'
  maxTokens?: number;      // 預設 4096
  json?: boolean;          // true 時 Gemini 開 responseMimeType: 'application/json'
};

export async function generateAIText(opts: GenerateAITextOptions):
  Promise<{ text: string; usedModel: 'claude' | 'gemini' }>;

// 純函式，供單元測試：決定先走哪個 provider
export function resolveAIProvider(isPro: boolean, hasClaudeKey: boolean): 'claude' | 'gemini';
```

- Claude：`@anthropic-ai/sdk`（維持既有技術決策，不遷移 Vercel AI SDK）。
- Gemini：`@google/genai` `gemini-2.5-flash`（抄 `generate-questions/route.ts` 既有寫法，
  `thinkingBudget: 0`、`finishReason !== 'STOP'` 視為截斷觸發錯誤）。
- 流程：`resolveAIProvider` 決定首選 → Claude 首選時 try Claude、catch 後
  `console.warn` 並改跑 Gemini → Gemini 也失敗才 throw（讓呼叫端自己的錯誤處理接手）。
- helper 內部呼叫 `isProOrAbove()`；`GEMINI_API_KEY` 未設且需要 Gemini 時直接 throw。

## 7 個站點的改法

| # | 檔案 | 現況 | 改法 |
|---|------|------|------|
| 1 | `src/libs/adaptive/generate-subject.ts` | Claude Opus only，炸整頁 | 換 `generateAIText`（claudeModel: `claude-opus-4-8`, json: true） |
| 2 | `src/app/api/ai/generate-remedial/route.ts` | Claude Sonnet only | 換 helper |
| 3 | `src/app/api/ai/analyze-weak-points/route.ts` | Claude only | 換 helper |
| 4 | `src/app/api/ai/analyze-class-performance/route.ts` | Claude only | 換 helper |
| 5 | `src/lib/ai/gradeShortAnswer.ts` | Claude only，上層降級「待批改」 | 換 helper；學生端未登入自動走 Gemini；「待批改」最後防線不動 |
| 6 | `src/libs/adaptive/claude-provider.ts` | Claude，失敗→罐頭模板 | 對話歷史序列化成單一 prompt 走 helper；模板降級保留為最後防線 |
| 7 | `src/app/api/ai/generate-from-file/route.ts` | 使用者自選 gemini/claude | 選 claude 且非付費 → 靜默轉 gemini；付費選 claude 失敗 → fallback gemini |

不動：`generate-questions/route.ts`（已有 Gemini → OpenAI → Claude 三層備援鏈）。

## 友善錯誤（AI 生成學科頁）

`generate-subject` 的呼叫端（server action）包 try/catch：兩個 provider 都失敗時
回傳 `{ error: 'AI 服務暫時無法使用，請稍後再試' }`，前端 `NewSubjectForm` 顯示
紅字錯誤訊息，不再讓例外冒泡成整頁 Server Components digest error。

## 測試

- `resolveAIProvider` 純函式 vitest 單元測試（4 個組合）。
- `npm run lint`、`npm run check-types` 無錯。
- 手動：本機以免費/付費帳號各打一次弱點分析或生成學科，確認 `usedModel` log 正確；
  Anthropic 額度為 0 的當下，付費帳號應自動 fallback Gemini 且功能可用。

## 不做（YAGNI）

- 不做前端 Pro 徽章 / 鎖定（使用者選了靜默轉）。
- 不遷移 Vercel AI SDK（既有技術債決策）。
- 不動 `generate-questions` 備援鏈。
- 不做 per-feature 模型設定 UI。
