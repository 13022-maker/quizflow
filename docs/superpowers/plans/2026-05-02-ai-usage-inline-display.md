# AI 出題完成後 inline 顯示本月使用次數 — 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 出題完成後在 QuizEditor 既有 importSuccess banner 多顯示一行「本月已用 N / 10 次」（Free）或「本月第 N 次 · Pro 無上限」（Pro / Trial / VIP），低額時加紅字升級提示。

**Architecture:** 純函式 `formatAiUsageMessage` 處理文案分支（4 種情境），server action `getAiUsageRemainingForCurrentUser` 包裝既有 `getAiUsageRemaining` 讓 client 不用拿 userId，QuizEditor `handleAIImport` 結尾 await 取值塞進 banner。文案 hardcode 中文，與既有 QuizEditor 局部 pattern 一致。

**Tech Stack:** TypeScript / Next.js App Router (client component) / Drizzle (既有 ai_usage 表) / vitest（unit test）/ Clerk auth (server side)

**Spec:** `docs/superpowers/specs/2026-05-02-ai-usage-inline-display-design.md`

---

## Task 1：純函式 `formatAiUsageMessage` + vitest 4 分支

**Files:**
- Create: `src/lib/aiUsageMessage.ts`
- Create: `src/lib/aiUsageMessage.test.ts`

- [ ] **Step 1：寫 4 個失敗測試**

建立 `src/lib/aiUsageMessage.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { formatAiUsageMessage } from './aiUsageMessage';

describe('formatAiUsageMessage', () => {
  it('Pro / VIP（quota 999）回傳 Pro 文案、無警示', () => {
    const result = formatAiUsageMessage({ quota: 999, used: 5, remaining: 999 });

    expect(result.text).toBe('本月第 5 次 AI 出題 · Pro 無上限 ✨');
    expect(result.isWarning).toBe(false);
  });

  it('Free 充裕（剩 > 2 次）回傳一般文案、無警示', () => {
    const result = formatAiUsageMessage({ quota: 10, used: 3, remaining: 7 });

    expect(result.text).toBe('本月 3 / 10 次 · 還剩 7 次');
    expect(result.isWarning).toBe(false);
  });

  it('Free 低額（剩 = 2 次）回傳警示文案 + 升級提示', () => {
    const result = formatAiUsageMessage({ quota: 10, used: 8, remaining: 2 });

    expect(result.text).toBe('本月 8 / 10 次 · 只剩 2 次,升級 Pro 解鎖無限');
    expect(result.isWarning).toBe(true);
  });

  it('Free 低額（剩 = 1 次）回傳警示文案 + 升級提示', () => {
    const result = formatAiUsageMessage({ quota: 10, used: 9, remaining: 1 });

    expect(result.text).toBe('本月 9 / 10 次 · 只剩 1 次,升級 Pro 解鎖無限');
    expect(result.isWarning).toBe(true);
  });
});
```

- [ ] **Step 2：跑 test 確認失敗**

Run: `npx vitest run src/lib/aiUsageMessage.test.ts`
Expected: 4 個 FAIL，原因類似 `Cannot find module './aiUsageMessage'`

- [ ] **Step 3：寫 helper 實作**

建立 `src/lib/aiUsageMessage.ts`：

```ts
// AI 出題完成後在 QuizEditor importSuccess banner 顯示的本月用量訊息
// 規則:
//   - quota >= 999 (Pro / Trial / VIP) → 「本月第 N 次 AI 出題 · Pro 無上限 ✨」
//   - quota <  999 且 remaining >  2  → 「本月 N / Q 次 · 還剩 R 次」
//   - quota <  999 且 remaining <= 2  → 「本月 N / Q 次 · 只剩 R 次,升級 Pro 解鎖無限」(紅字)
// remaining === 0 不會走到此 helper(API route 已先擋下)

export type AiUsageInfo = {
  quota: number;
  used: number;
  remaining: number;
};

export type AiUsageMessage = {
  text: string;
  isWarning: boolean;
};

const PRO_THRESHOLD = 999;
const LOW_REMAINING_THRESHOLD = 2;

export function formatAiUsageMessage(usage: AiUsageInfo): AiUsageMessage {
  const { quota, used, remaining } = usage;

  if (quota >= PRO_THRESHOLD) {
    return {
      text: `本月第 ${used} 次 AI 出題 · Pro 無上限 ✨`,
      isWarning: false,
    };
  }

  if (remaining <= LOW_REMAINING_THRESHOLD) {
    return {
      text: `本月 ${used} / ${quota} 次 · 只剩 ${remaining} 次,升級 Pro 解鎖無限`,
      isWarning: true,
    };
  }

  return {
    text: `本月 ${used} / ${quota} 次 · 還剩 ${remaining} 次`,
    isWarning: false,
  };
}
```

- [ ] **Step 4：跑 test 確認通過**

Run: `npx vitest run src/lib/aiUsageMessage.test.ts`
Expected: 4 個 PASS

- [ ] **Step 5：commit**

```bash
git add src/lib/aiUsageMessage.ts src/lib/aiUsageMessage.test.ts
git commit -m "$(cat <<'EOF'
feat(ai-usage): formatAiUsageMessage helper + 4 分支 vitest

純函式產生 AI 出題完成後 banner 文案,Pro/Trial/VIP 一個分支、
Free 充裕一個分支、Free 低額警示一個分支(剩 ≤ 2 加紅字升級提示)。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2：新增 `getAiUsageRemainingForCurrentUser` server action

**Files:**
- Modify: `src/actions/aiUsageActions.ts`（檔尾新增 export）

- [ ] **Step 1：在檔案最末加新 server action**

打開 `src/actions/aiUsageActions.ts`，在檔案最末（L127 之後）追加：

```ts
/**
 * 從 Clerk auth 取得當前 userId,再查當月剩餘次數
 * 給 client component 用(它沒 userId 在手),內部複用 getAiUsageRemaining
 */
export async function getAiUsageRemainingForCurrentUser(): Promise<{
  quota: number;
  used: number;
  remaining: number;
} | null> {
  const { auth } = await import('@clerk/nextjs/server');
  const { userId } = await auth();
  if (!userId) {
    return null;
  }
  return getAiUsageRemaining(userId);
}
```

(動態 import `@clerk/nextjs/server` 對齊既有 `aiUsageActions.ts` 對 `vip` 模組的處理風格 L29)

- [ ] **Step 2：跑 type check**

Run: `npx tsc --noEmit -p .`
Expected: 0 errors

- [ ] **Step 3：commit**

```bash
git add src/actions/aiUsageActions.ts
git commit -m "$(cat <<'EOF'
feat(ai-usage): getAiUsageRemainingForCurrentUser wrapper

包裝 getAiUsageRemaining 讓 client component 不用自己拿 userId,
內部用 Clerk auth() 取得當前用戶。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3：QuizEditor 整合 — fetch usage + banner 加一行

**Files:**
- Modify: `src/features/quiz/QuizEditor.tsx`
  - L31 後新增 import
  - L179 後新增 state
  - L447-448 區塊插入 fetch usage
  - L998-1029 banner 加一行

- [ ] **Step 1：新增 import**

在 `src/features/quiz/QuizEditor.tsx` 第 31 行（`updateQuiz` import 那行）之後加一行 import，**並**在第 32 行 `import AIQuizModal` 之前加另一條 import 從 `@/lib/aiUsageMessage`。

最終 L31-33 區段應該長這樣：

```tsx
import { updateQuiz, updateQuizSettings } from '@/actions/quizActions';
import { getAiUsageRemainingForCurrentUser } from '@/actions/aiUsageActions';
import AIQuizModal from '@/components/quiz/AIQuizModal';
```

並在 import 區的最後（既有 `import` 區塊的尾端，第 21 行 `import { useEffect, useState, useTransition } from 'react';` 同類型 import 群組內，依 `simple-import-sort` 規則插入 `@/lib/aiUsageMessage`）：

```tsx
import { type AiUsageInfo, formatAiUsageMessage } from '@/lib/aiUsageMessage';
```

> 註：實作時跑 `npx eslint --fix src/features/quiz/QuizEditor.tsx` 讓 simple-import-sort 自動排序，避免踩過往的 import 順序坑（記憶 `feedback_eslint_import_sort.md`）。

- [ ] **Step 2：新增 state**

在 L179 `const [importSuccess, setImportSuccess] = useState(false);` 之後新加一行。

> 為何存 `AiUsageInfo` 而非 `AiUsageMessage`：對齊 React 最佳實踐
> `rerender-derived-state-no-effect` — 文案是純函式從 usage 算出來的,
> 在 render 時 derive 即可(`formatAiUsageMessage` 是 O(1) 字串組裝,
> 不需 useMemo)。未來如要改文案規則,只動 helper、不用清 state 快取。

```tsx
const [aiUsage, setAiUsage] = useState<AiUsageInfo | null>(null);
```

- [ ] **Step 3：handleAIImport 結尾加 fetch usage**

把 L446-448 區段：

```tsx
    setIsSubmitting(false);
    setImportSuccess(true);
    router.refresh(); // pending 由 useEffect 監聽 initialQuestions 變化後清
```

改成：

```tsx
    // 取本月 AI 出題使用次數,塞進 importSuccess banner 顯示
    // 失敗不影響題目匯入,只是不顯示 usage 那行
    try {
      const usage = await getAiUsageRemainingForCurrentUser();
      if (usage) {
        setAiUsage(usage);
      }
    } catch (err) {
      console.error('[handleAIImport] 取本月 AI 用量失敗', err);
    }

    setIsSubmitting(false);
    setImportSuccess(true);
    router.refresh(); // pending 由 useEffect 監聽 initialQuestions 變化後清
```

- [ ] **Step 4：banner 加一行 + 關閉時清掉 aiUsageMsg**

把 L998-1029 整段：

```tsx
      {/* ── 匯入成功引導 ── */}
      {importSuccess && questions.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 px-5 py-4">
          <span className="mt-0.5 text-lg">✅</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-green-800">
              {questions.length}
              {' '}
              題已匯入！接下來只要三步：
            </p>
            <ol className="mt-2 space-y-1 text-xs text-green-700">
              <li>1. 往下滑檢查題目，有問題可以點「編輯」修改</li>
              <li>
                2. 確認沒問題後，按上方的「
                <strong>發佈測驗</strong>
                」
              </li>
              <li>
                3. 點「
                <strong>分享</strong>
                」把連結傳給學生
              </li>
            </ol>
            <button
              type="button"
              onClick={() => setImportSuccess(false)}
              className="mt-2 text-xs text-green-600 hover:underline"
            >
              知道了，關閉提示
            </button>
          </div>
        </div>
      )}
```

改成（注意 `aiUsageMsg` 是 render 時 derive 出來的 const，**不是** state）：

```tsx
      {/* ── 匯入成功引導 ── */}
      {importSuccess && questions.length > 0 && (() => {
        // 在 render 時從 aiUsage derive 文案,符合 React 最佳實踐
        // 「rerender-derived-state-no-effect」: 能 derive 就不要存 state
        const aiUsageMsg = aiUsage ? formatAiUsageMessage(aiUsage) : null;
        return (
          <div className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 px-5 py-4">
            <span className="mt-0.5 text-lg">✅</span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-green-800">
                {questions.length}
                {' '}
                題已匯入！接下來只要三步：
              </p>
              <ol className="mt-2 space-y-1 text-xs text-green-700">
                <li>1. 往下滑檢查題目，有問題可以點「編輯」修改</li>
                <li>
                  2. 確認沒問題後，按上方的「
                  <strong>發佈測驗</strong>
                  」
                </li>
                <li>
                  3. 點「
                  <strong>分享</strong>
                  」把連結傳給學生
                </li>
              </ol>
              {aiUsageMsg && (
                <p
                  className={`mt-2 text-xs ${
                    aiUsageMsg.isWarning
                      ? 'font-medium text-red-600'
                      : 'text-green-700'
                  }`}
                >
                  {aiUsageMsg.isWarning
                    ? (
                        <>
                          {aiUsageMsg.text}
                          {' '}
                          <Link
                            href="/dashboard/billing"
                            className="underline hover:text-red-700"
                          >
                            升級 →
                          </Link>
                        </>
                      )
                    : aiUsageMsg.text}
                </p>
              )}
              <button
                type="button"
                onClick={() => {
                  setImportSuccess(false);
                  setAiUsage(null);
                }}
                className="mt-2 text-xs text-green-600 hover:underline"
              >
                知道了，關閉提示
              </button>
            </div>
          </div>
        );
      })()}
```

> 註：用 IIFE `(() => { ... })()` 是為了在 conditional render 內能宣告
> `const aiUsageMsg` 變數同時保持單行表達式。如果覺得 IIFE 不順眼,
> 替代寫法是把整段 banner 抽成 `renderImportSuccessBanner()` 區域 helper
> function 在 component body 內定義(注意:**不是** 抽 component,只是
> 把 JSX 包成 function 避免 IIFE),然後在 render 處呼叫
> `{importSuccess && questions.length > 0 && renderImportSuccessBanner()}`。
> 兩種寫法效果一樣,選 IIFE 是因為它保留 banner JSX 在原地、context 不跳。

> 註：`Link` 已在 L19 既有 import (`import Link from 'next/link';`)，無需新加。
> 註：警示版本把「升級 Pro 解鎖無限」中的「升級」做成連向 `/dashboard/billing` 的 underline link；非警示版本只顯示純文字。文案中「,升級 Pro 解鎖無限」由 `formatAiUsageMessage` 產出，連結是 banner 額外加的視覺。

- [ ] **Step 5：跑 type check 跟 lint**

Run: `npx tsc --noEmit -p . && npx eslint --fix src/features/quiz/QuizEditor.tsx`
Expected: 0 errors，eslint 自動修正 import 順序

- [ ] **Step 6：啟 dev server 手動驗證 4 情境**

Run: `npm run dev`

依序驗證以下 4 個情境（用瀏覽器到 `/dashboard/quizzes/<id>/edit`，按「✨ AI 出題」做一次 AI 出題）：

1. **Free 帳號 + 本月剩很多次（例如 0/10 → 1/10）**：
   - banner 第三行：「本月 1 / 10 次 · 還剩 9 次」（綠字）
   - 沒升級連結
2. **Free 帳號 + 本月剩 ≤ 2 次**（要先消耗到 8 次以上才能驗，可用 admin / DB 工具預先把 `ai_usage.count` 設成 8 再做一次出題 → 9 / 10）：
   - banner 第三行：「本月 9 / 10 次 · 只剩 1 次,升級 Pro 解鎖無限 升級 →」（紅字 + 升級連結）
   - 點「升級 →」要跳 `/dashboard/billing`
3. **Pro / Trial 帳號**（用試用中老師或已訂閱 Pro 老師）：
   - banner 第三行：「本月第 N 次 AI 出題 · Pro 無上限 ✨」（綠字）
   - 沒升級連結
4. **故意斷網或讓 server action throw**（chrome devtools network → Offline，或暫時把 server action 改成直接 throw）：
   - 題目仍正常匯入、banner 仍顯示「N 題已匯入」三步驟
   - banner 沒第三行
   - console 有 `[handleAIImport] 取本月 AI 用量失敗` log
   - 驗完恢復網路 / 還原 server action

> 視覺驗證：每個情境截圖（或描述）回報，避免只跑 type check 就 declare 完成。

- [ ] **Step 7：commit**

```bash
git add src/features/quiz/QuizEditor.tsx
git commit -m "$(cat <<'EOF'
feat(ai-usage): AI 出題完成後 banner 顯示本月使用次數

QuizEditor importSuccess banner 加一行條件文案,Free 顯示
「本月 N / 10 次」、剩 ≤ 2 次紅字 + 升級連結;Pro / Trial 顯示
「本月第 N 次 · Pro 無上限」。fetch 失敗不影響題目匯入。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec 覆蓋檢查：**

| Spec 章節 | 對應 Task |
|---|---|
| 資料流（route increment → client fetch usage → banner） | Task 2（wrapper）+ Task 3 Step 3 |
| 顯示邏輯（4 分支文案表） | Task 1（4 個 vitest 案例 + helper 實作） |
| Banner 整合（importSuccess 加一行） | Task 3 Step 4 |
| 變更檔案範圍（2 新檔 + 1 修改） | Task 1 / Task 2 / Task 3 |
| 文案 hardcode 中文 | Task 1 helper 直接 hardcode |
| 升級連結指向 `/dashboard/billing` | Task 3 Step 4 banner JSX |
| 錯誤處理（getAiUsageRemaining throw → console.error） | Task 3 Step 3 try/catch |
| 邊角：跨 route aggregate / race / Trial 過期 | 已由既有 `getAiUsageRemaining` 處理,本 plan 不需改 |
| Unit test 4 分支 | Task 1 Step 1（Pro / Free 充裕 / Free 剩 2 / Free 剩 1） |
| 手動驗證 | Task 3 Step 6（4 情境） |

**Placeholder scan：** 通過 — 每個 step 都有完整 code / command / expected output。

**Type / 命名一致性：**
- `AiUsageInfo` / `AiUsageMessage` 在 Task 1 helper 跟 Task 3 import / state 都一致
- `formatAiUsageMessage` 簽名（`AiUsageInfo → AiUsageMessage`）跨 task 一致
- `getAiUsageRemainingForCurrentUser` 回傳 `{ quota, used, remaining } | null`，Task 3 已處理 null case
