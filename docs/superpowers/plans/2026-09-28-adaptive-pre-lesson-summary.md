# 適性學習課前重點摘要講義 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 老師在「建立新練習」表單選定學科後，可以點「查看課前重點摘要」按鈕，看到一份 AI
根據該學科知識點圖譜生成的重點摘要講義（本課概述＋知識點重點＋教學建議），確認範圍/難度後
再決定要不要建立練習。

**Architecture:** 新增一張以 `subjectId` 字串為 key 的快取表 `adaptive_subject_summary`（內建
學科與自建學科統一存這張表，因為內建學科沒有 DB row）。新增 `generate-summary.ts` 負責 AI 生成
（結構化 JSON → zod 驗證 → 失敗重試一次 → 組成 Markdown），`adaptiveActions.ts` 加兩個 server
action（讀快取或生成、強制重新生成），`SubjectCombobox.tsx` 加按鈕觸發一個新 Modal 元件顯示
結果（沿用既有 `marked` 套件渲染 Markdown）。

**Tech Stack:** Next.js 14 App Router、TypeScript、Drizzle ORM + PostgreSQL、Zod、Vitest、
`marked`（既有依賴，不需新增套件）。

**Spec:** `docs/superpowers/specs/2026-09-28-adaptive-pre-lesson-summary-design.md`

## Global Constraints

- UI 文字、錯誤訊息、程式碼註解一律使用繁體中文；變數/函式/檔案名稱一律用英文（camelCase）。
- 所有寫入操作走 Server Action，先驗證登入（`auth()`）。
- 修改 `src/models/Schema.ts` 後必須執行 `npm run db:generate` 並檢查/清理產生的 migration SQL
  （已知 migration snapshot 脫鉤問題：可能夾帶不相關的既有內容，要手動刪除）。
- 這個 AI 生成功能要計入現有 AI 用量限制（`checkAndIncrementAiUsage`，Free 每月 10 次、Pro
  無限）。
- 只做老師端功能，不動學生端作答流程、不動既有「建立新練習」表單送出行為。
- 內建學科（cpp/python/calculus）沒有 DB row，摘要快取表以 `subjectId` 字串（`'cpp'` 或
  `'db:123'`）為 key，不能依賴 `adaptive_subject.id` 外鍵。

---

## Task 1: Schema — 新增 `adaptive_subject_summary` 快取表

**Files:**
- Modify: `src/models/Schema.ts`（在 `adaptiveSubjectSchema` 定義結尾之後新增）
- Create: migration（由 `npm run db:generate` 產生，檔名由 drizzle-kit 自動命名）

**Interfaces:**
- Produces: `adaptiveSubjectSummarySchema`（Drizzle pgTable），欄位 `subjectId: text`
  (primary key)、`markdown: text` (not null)、`generatedAt: timestamp` (default now, not null)。
  後續任務（Task 3）會 import 這個 export 來讀寫。

- [ ] **Step 1: 在 `src/models/Schema.ts` 加入新表定義**

找到 `adaptiveSubjectSchema` 定義結尾（該區塊最後一行是 `);`，緊接在
`statusCheck: check(...)` 的 `}),\n);` 之後），在後面加入：

```ts

// 課前重點摘要講義快取：以 subjectId 字串為 key。內建學科（'cpp' 等，程式碼常數、無 DB row）
// 與自建學科（'db:<id>'）統一存這張表，不動 adaptive_subject 表。
export const adaptiveSubjectSummarySchema = pgTable('adaptive_subject_summary', {
  subjectId: text('subject_id').primaryKey(),
  markdown: text('markdown').notNull(),
  generatedAt: timestamp('generated_at', { mode: 'date' }).defaultNow().notNull(),
});
```

- [ ] **Step 2: 產生 migration**

Run: `npm run db:generate`

檢查輸出的新 migration 檔案（`migrations/00XX_xxx.sql`），確認**只包含**
`CREATE TABLE "adaptive_subject_summary" (...)`。若因 CLAUDE.md 已知的 snapshot 脫鉤問題，
夾帶了其他不相關的 `CREATE TABLE` / `ALTER TABLE`，手動刪除那些不屬於本次改動的敘述，只留下
這張新表的建表語句，並確認每條 SQL 後面都有 `--> statement-breakpoint`（PGlite/PG 需要這個
分隔符，缺少會導致 `42601` 語法錯誤）。

- [ ] **Step 3: 執行 migration 並確認型別檢查通過**

Run: `npm run db:migrate && npm run check-types`
Expected: 兩個指令都成功結束，無錯誤輸出。

- [ ] **Step 4: Commit**

```bash
git add src/models/Schema.ts migrations/
git commit -m "$(cat <<'EOF'
feat(adaptive): 新增課前重點摘要講義快取表

以 subjectId 字串為 key，內建學科（無 DB row）與自建學科統一存
這張表，之後生成的摘要講義都快取在這裡。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: AI 生成邏輯 `src/libs/adaptive/generate-summary.ts`

**Files:**
- Create: `src/libs/adaptive/generate-summary.ts`
- Create: `src/libs/adaptive/generate-summary.test.ts`

**Interfaces:**
- Consumes: `extractJson` from `./generate-subject`（既有 export，簽名
  `(text: string) => unknown`）；`generateAIText`, `isPaidSubscriberSafe` from
  `@/lib/ai/textModel`；`Subject` type from `./subjects`（`{ id, name, graph: { nodes:
  { id, name, prerequisites }[] }, itemBank, tutor }`）。
- Produces: `buildUserPrompt(subject: Subject): string`、
  `renderMarkdown(subjectName: string, data: SummaryOutput): string`（皆 export，供測試與
  `generateSubjectSummary` 內部使用）、
  `generateSubjectSummary(subject: Subject): Promise<string>`（Task 3 會 import 這個）。

- [ ] **Step 1: 寫失敗的測試（`buildUserPrompt` 與 `renderMarkdown`）**

建立 `src/libs/adaptive/generate-summary.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { buildUserPrompt, renderMarkdown } from './generate-summary';

describe('buildUserPrompt', () => {
  it('列出學科名稱與依序排列的知識點', () => {
    const prompt = buildUserPrompt({
      id: 'cpp',
      name: 'C++ 程式設計',
      graph: {
        nodes: [
          { id: 'k-var', name: '變數與資料型別', prerequisites: [] },
          { id: 'k-loop', name: '迴圈控制', prerequisites: ['k-var'] },
        ],
      },
      itemBank: { items: [] },
      tutor: { lessonExampleRule: '', formatRule: '' },
    });

    expect(prompt).toContain('C++ 程式設計');
    expect(prompt.indexOf('變數與資料型別')).toBeLessThan(prompt.indexOf('迴圈控制'));
  });
});

describe('renderMarkdown', () => {
  it('組出標題／概述／知識點條列，有教學建議時附加該節', () => {
    const markdown = renderMarkdown('C++ 程式設計', {
      overview: '學生理解迴圈的執行流程。',
      keyPoints: [
        { concept: 'for 迴圈', note: '初始化/條件/遞增三部件的執行順序' },
      ],
      teachingTips: ['學生容易混淆 for/while 使用時機'],
    });

    expect(markdown).toContain('# C++ 程式設計 課前重點');
    expect(markdown).toContain('## 本課概述');
    expect(markdown).toContain('學生理解迴圈的執行流程。');
    expect(markdown).toContain('## 知識點重點');
    expect(markdown).toContain('- **for 迴圈**：初始化/條件/遞增三部件的執行順序');
    expect(markdown).toContain('## 教學建議');
    expect(markdown).toContain('- 學生容易混淆 for/while 使用時機');
  });

  it('教學建議為空陣列時，不輸出「教學建議」該節', () => {
    const markdown = renderMarkdown('C++ 程式設計', {
      overview: '概述',
      keyPoints: [{ concept: 'for 迴圈', note: '重點' }],
      teachingTips: [],
    });

    expect(markdown).not.toContain('## 教學建議');
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run src/libs/adaptive/generate-summary.test.ts`
Expected: FAIL（`generate-summary` 模組不存在）

- [ ] **Step 3: 寫最小實作**

建立 `src/libs/adaptive/generate-summary.ts`：

```ts
/**
 * AI 生成課前重點摘要講義：根據學科知識點圖譜，為老師生成一份 Markdown 全文，
 * 幫老師上課前快速掌握這個單元要教什麼、學生容易卡在哪。
 * 驗證模式仿 generate-subject.ts：結構化 JSON → zod 驗證 → 失敗重試一次。
 */
import { z } from 'zod';

import { generateAIText, isPaidSubscriberSafe } from '@/lib/ai/textModel';

import { extractJson } from './generate-subject';
import type { Subject } from './subjects';

const summaryOutputSchema = z.object({
  overview: z.string().min(1).max(200),
  keyPoints: z.array(z.object({
    concept: z.string().min(1).max(30),
    note: z.string().min(1).max(200),
  })).min(1),
  teachingTips: z.array(z.string().min(1)).max(5),
});

export type SummaryOutput = z.infer<typeof summaryOutputSchema>;

const SYSTEM_PROMPT = `你是台灣中學／大學教學設計專家，要為老師生成「課前重點摘要講義」，
幫老師在上課前快速掌握這個學科單元要教什麼、學生容易卡在哪。

輸出要求：只輸出一個 JSON 物件（不要 Markdown 圍欄、不要任何說明文字），結構如下：
{
  "overview": "本課概述，1-2句話說明這個單元學生要學會什麼",
  "keyPoints": [
    { "concept": "知識點名稱（對應輸入的知識點）", "note": "這個知識點的重點說明，1句話" }
  ],
  "teachingTips": ["教學建議或學生常見錯誤提醒，可以是空陣列"]
}`;

/** 組使用者 prompt：學科名稱 + 依教學順序排列的知識點清單 */
export function buildUserPrompt(subject: Subject): string {
  const pointList = subject.graph.nodes.map(n => `- ${n.name}`).join('\n');
  return `學科：${subject.name}\n涵蓋知識點（依教學順序排列）：\n${pointList}\n\n請針對以上知識點生成課前重點摘要。`;
}

/** 把結構化生成結果組成 Markdown 全文；教學建議為空陣列時不輸出該節 */
export function renderMarkdown(subjectName: string, data: SummaryOutput): string {
  const points = data.keyPoints.map(p => `- **${p.concept}**：${p.note}`).join('\n');
  const tips = data.teachingTips.length > 0
    ? `\n\n## 教學建議\n${data.teachingTips.map(t => `- ${t}`).join('\n')}`
    : '';
  return `# ${subjectName} 課前重點\n\n## 本課概述\n${data.overview}\n\n## 知識點重點\n${points}${tips}`;
}

/** 生成課前重點摘要講義（Markdown 全文）。格式驗證失敗重試一次，兩次都失敗才丟錯。 */
export async function generateSubjectSummary(subject: Subject): Promise<string> {
  const forceGemini = !(await isPaidSubscriberSafe());
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const retryNote = lastError
      ? `\n\n【上次生成有以下問題，請修正後重新生成】\n${lastError}`
      : '';
    const { text } = await generateAIText({
      prompt: buildUserPrompt(subject) + retryNote,
      system: SYSTEM_PROMPT,
      json: true,
      forceGemini,
    });
    try {
      const parsed = summaryOutputSchema.parse(extractJson(text));
      return renderMarkdown(subject.name, parsed);
    } catch (error) {
      lastError = (error as Error).message;
    }
  }
  throw new Error(`AI 生成的摘要格式驗證失敗：${lastError}`);
}
```

同時確認 `src/libs/adaptive/generate-subject.ts` 裡的 `extractJson` 已經是
`export function extractJson`（現況已是如此，不需要修改該檔案）。

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run src/libs/adaptive/generate-summary.test.ts`
Expected: PASS（3 個測試全過）

- [ ] **Step 5: Lint 與型別檢查**

Run: `npm run lint && npm run check-types`
Expected: 兩者皆無錯誤。

- [ ] **Step 6: Commit**

```bash
git add src/libs/adaptive/generate-summary.ts src/libs/adaptive/generate-summary.test.ts
git commit -m "$(cat <<'EOF'
feat(adaptive): 新增課前重點摘要講義 AI 生成邏輯

沿用 generate-subject.ts 的「結構化 JSON→zod 驗證→失敗重試一次」
模式，輸出本課概述＋知識點重點＋教學建議組成的 Markdown 全文。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Server Actions — `getOrGenerateAdaptiveSummary` / `regenerateAdaptiveSummary`

**Files:**
- Modify: `src/actions/adaptiveActions.ts`

**Interfaces:**
- Consumes: `generateSubjectSummary(subject: Subject): Promise<string>` (Task 2)；
  `adaptiveSubjectSummarySchema` (Task 1)；既有 `assertSubjectUsable(subjectId: string, userId:
  string): Promise<void>`（檔案內 private function，直接呼叫）；既有
  `checkAndIncrementAiUsage(userId: string): Promise<{ allowed: true; remaining: number } |
  { allowed: false; reason: string; remaining: number }>`（`@/actions/aiUsageActions`，檔案已
  import）；`resolveSubject(subjectId: string): Promise<Subject>`（`@/libs/adaptive/service`，
  新 import）；`friendlyAIGenerationError(err: unknown): string`（`@/libs/adaptive/generate-subject`，
  該檔案已 import 其他成員，這次補上這個具名 import）。
- Produces: `getOrGenerateAdaptiveSummary(subjectId: string): Promise<{ markdown: string } |
  { error: string }>`、`regenerateAdaptiveSummary(subjectId: string): Promise<{ markdown:
  string } | { error: string }>`（Task 5 的 UI 會呼叫這兩個）。

- [ ] **Step 1: 在 `src/actions/adaptiveActions.ts` 補上新 import**

找到檔案頂端現有的 import 區塊（第 14-27 行附近），把：

```ts
import { friendlyAIGenerationError, generateSubject, generateSubjectSchema, toSubject } from '@/libs/adaptive/generate-subject';
```

改成：

```ts
import { friendlyAIGenerationError, generateSubject, generateSubjectSchema, toSubject } from '@/libs/adaptive/generate-subject';
import { generateSubjectSummary } from '@/libs/adaptive/generate-summary';
```

再把：

```ts
import { DB_SUBJECT_PREFIX, getAdaptiveService } from '@/libs/adaptive/service';
```

改成：

```ts
import { DB_SUBJECT_PREFIX, getAdaptiveService, resolveSubject } from '@/libs/adaptive/service';
```

最後把：

```ts
import { adaptivePracticeSchema, adaptiveSubjectSchema, questionSchema, quizSchema } from '@/models/Schema';
```

改成：

```ts
import { adaptivePracticeSchema, adaptiveSubjectSchema, adaptiveSubjectSummarySchema, questionSchema, quizSchema } from '@/models/Schema';
```

- [ ] **Step 2: 加入兩個新 server action**

在檔案裡 `assertSubjectUsable` 函式定義之後（該函式結尾是一個單獨的 `}`，緊接在
`createAdaptivePractice` 定義之前），插入：

```ts
/** 生成並快取課前重點摘要（quota 檢查在呼叫端做，這裡只負責生成+寫入） */
async function generateAndCacheSummary(
  subjectId: string,
  userId: string,
): Promise<{ markdown: string } | { error: string }> {
  const usage = await checkAndIncrementAiUsage(userId);
  if (!usage.allowed) {
    return { error: usage.reason };
  }
  try {
    const subject = await resolveSubject(subjectId);
    const markdown = await generateSubjectSummary(subject);
    await db
      .insert(adaptiveSubjectSummarySchema)
      .values({ subjectId, markdown })
      .onConflictDoUpdate({
        target: adaptiveSubjectSummarySchema.subjectId,
        set: { markdown, generatedAt: new Date() },
      });
    return { markdown };
  } catch (err) {
    console.error('[adaptive summary] 生成失敗：', err);
    return { error: friendlyAIGenerationError(err) };
  }
}

/** 取得課前重點摘要：有快取直接回傳，沒有才生成並快取（給「查看課前重點摘要」按鈕用） */
export async function getOrGenerateAdaptiveSummary(
  subjectId: string,
): Promise<{ markdown: string } | { error: string }> {
  const { userId } = await auth();
  if (!userId) {
    return { error: '請先登入' };
  }
  try {
    await assertSubjectUsable(subjectId, userId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : '學科不可用' };
  }

  const [cached] = await db
    .select()
    .from(adaptiveSubjectSummarySchema)
    .where(eq(adaptiveSubjectSummarySchema.subjectId, subjectId));
  if (cached) {
    return { markdown: cached.markdown };
  }
  return generateAndCacheSummary(subjectId, userId);
}

/** 略過快取，強制重新生成（給 Modal 裡的「重新生成」按鈕用） */
export async function regenerateAdaptiveSummary(
  subjectId: string,
): Promise<{ markdown: string } | { error: string }> {
  const { userId } = await auth();
  if (!userId) {
    return { error: '請先登入' };
  }
  try {
    await assertSubjectUsable(subjectId, userId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : '學科不可用' };
  }
  return generateAndCacheSummary(subjectId, userId);
}
```

- [ ] **Step 3: 型別檢查（此專案 server action 不寫單元測試，走型別檢查 + build 把關）**

Run: `npm run check-types`
Expected: 無錯誤。特別注意 `'use server'` 檔案只能 export async function——這兩個新增的
export 都是 async function，`generateAndCacheSummary` 沒有 export（純內部使用），符合限制。

- [ ] **Step 4: 跑一次完整 build 確認 'use server' 限制沒有違反**

Run: `npm run build`
Expected: build 成功。（依 CLAUDE.md 記錄，`'use server'` 檔案違規 export 只有 build 抓得到，
check-types 與 vitest 都測不出來，這一步不可省略。）

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: 無錯誤。

- [ ] **Step 6: Commit**

```bash
git add src/actions/adaptiveActions.ts
git commit -m "$(cat <<'EOF'
feat(adaptive): 新增課前重點摘要 server actions

getOrGenerateAdaptiveSummary 讀快取或生成，regenerateAdaptiveSummary
略過快取強制重新生成；生成前都會檢查 AI 用量限制。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `PreLessonSummaryModal.tsx` 元件

**Files:**
- Create: `src/app/[locale]/(auth)/dashboard/adaptive/PreLessonSummaryModal.tsx`

**Interfaces:**
- Consumes: `getOrGenerateAdaptiveSummary(subjectId: string): Promise<{ markdown: string } |
  { error: string }>`、`regenerateAdaptiveSummary(subjectId: string): Promise<{ markdown:
  string } | { error: string }>`（Task 3，從 `@/actions/adaptiveActions` import）；`marked`
  套件（既有依賴，`import { marked } from 'marked'`）。
- Produces: `PreLessonSummaryModal` React 元件，props `{ subjectId: string; subjectName:
  string; onClose: () => void }`（Task 5 會 render 這個元件）。

這個元件是純 UI 邏輯（呼叫兩個既有 server action、切換 loading/ready/error 狀態），不涉及
需要單元測試的純函式，所以本任務不寫 Vitest 測試，改在 Task 5 完成後的瀏覽器手動驗證步驟裡
一併驗證（跟專案裡其他 client 元件如 `ShareModal.tsx`、`GenerateWeakpointFlashcardsButton.tsx`
的測試現況一致——這些互動型 modal/按鈕元件都沒有對應的 `.test.tsx`）。

- [ ] **Step 1: 建立元件**

```tsx
'use client';

/**
 * 課前重點摘要講義 Modal：老師在「建立新練習」選好學科後，點按鈕開啟，
 * 顯示 AI 根據該學科知識點圖譜生成的重點摘要（本課概述＋知識點重點＋教學建議）。
 */
import { marked } from 'marked';
import { useEffect, useState } from 'react';

import { getOrGenerateAdaptiveSummary, regenerateAdaptiveSummary } from '@/actions/adaptiveActions';

type Status = 'loading' | 'ready' | 'error';

export function PreLessonSummaryModal({
  subjectId,
  subjectName,
  onClose,
}: {
  subjectId: string;
  subjectName: string;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<Status>('loading');
  const [markdown, setMarkdown] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [regenerating, setRegenerating] = useState(false);

  async function load() {
    setStatus('loading');
    const result = await getOrGenerateAdaptiveSummary(subjectId);
    if ('error' in result) {
      setErrorMessage(result.error);
      setStatus('error');
      return;
    }
    setMarkdown(result.markdown);
    setStatus('ready');
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在 subjectId 變動時重新載入，load 每次 render 都是新函式
  }, [subjectId]);

  async function handleRegenerate() {
    setRegenerating(true);
    const result = await regenerateAdaptiveSummary(subjectId);
    if ('error' in result) {
      setErrorMessage(result.error);
      setStatus('error');
    } else {
      setMarkdown(result.markdown);
      setStatus('ready');
    }
    setRegenerating(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-xl bg-background p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {subjectName}
            {' '}
            課前重點摘要
          </h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {status === 'loading' && (
            <p className="py-8 text-center text-sm text-muted-foreground">生成中，請稍候…</p>
          )}
          {status === 'error' && (
            <div className="py-8 text-center text-sm text-destructive">
              <p>{errorMessage}</p>
              <button
                type="button"
                onClick={load}
                className="mt-3 rounded-lg border px-3 py-1.5 text-sm hover:bg-muted"
              >
                重試
              </button>
            </div>
          )}
          {status === 'ready' && (
            <div
              className="prose prose-sm max-w-none"
              // eslint-disable-next-line react/no-danger -- 內容全部是 AI 生成，非使用者輸入，沿用 AdaptiveLearnClient.tsx 既有的 marked 渲染慣例
              dangerouslySetInnerHTML={{ __html: String(marked.parse(markdown)) }}
            />
          )}
        </div>

        {status === 'ready' && (
          <div className="mt-4 flex justify-end gap-2 border-t pt-3">
            <button
              type="button"
              onClick={handleRegenerate}
              disabled={regenerating}
              className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
            >
              {regenerating ? '生成中…' : '重新生成'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90"
            >
              關閉
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 型別檢查與 lint**

Run: `npm run check-types && npm run lint`
Expected: 無錯誤。

- [ ] **Step 3: Commit**

```bash
git add "src/app/[locale]/(auth)/dashboard/adaptive/PreLessonSummaryModal.tsx"
git commit -m "$(cat <<'EOF'
feat(adaptive): 新增課前重點摘要 Modal 元件

loading/ready/error 三態；ready 時用既有 marked 套件渲染 Markdown，
底部提供重新生成按鈕。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `SubjectCombobox.tsx` 加「查看課前重點摘要」按鈕

**Files:**
- Modify: `src/app/[locale]/(auth)/dashboard/adaptive/SubjectCombobox.tsx`

**Interfaces:**
- Consumes: `PreLessonSummaryModal`（Task 4，props `{ subjectId, subjectName, onClose }`）。
- Produces: 無新 export（`SubjectCombobox` 對外簽名不變，仍是
  `{ builtInSubjects: SubjectOption[]; customSubjects: SubjectOption[] }`）。

- [ ] **Step 1: 加 import 與 Modal 開關 state**

在檔案頂端 import 區塊（目前只有一行 `import { useEffect, useMemo, useRef, useState } from
'react';`）之後加入：

```ts
import { PreLessonSummaryModal } from './PreLessonSummaryModal';
```

在 `SubjectCombobox` 函式內、`rootRef` 定義之後加入：

```ts
const [showSummaryModal, setShowSummaryModal] = useState(false);
```

- [ ] **Step 2: 在 combobox 旁加按鈕，並在元件最外層 render Modal**

找到目前的 return 語句開頭：

```tsx
  return (
    <div ref={rootRef} className="relative flex flex-col gap-1">
```

改成（用 Fragment 包住 combobox 與按鈕，並在同一層放 Modal）：

```tsx
  const selectedSubject = allSubjects.find(s => s.id === selectedId);

  return (
    <div className="flex items-end gap-2">
      <div ref={rootRef} className="relative flex flex-col gap-1">
```

（原本 `<div ref={rootRef} ...>` 內部的 label／input／hidden input／listbox 全部維持不變，
只是外面多包一層。）

在該 combobox 的 `</div>`（原本 `SubjectCombobox` return 的最外層結尾）之後、函式結尾
`);` 之前，加入按鈕與 Modal：

```tsx
      </div>

      {selectedSubject && (
        <button
          type="button"
          onClick={() => setShowSummaryModal(true)}
          className="h-9 whitespace-nowrap rounded-lg border px-3 text-sm hover:bg-muted"
        >
          📄 查看課前重點摘要
        </button>
      )}

      {showSummaryModal && selectedSubject && (
        <PreLessonSummaryModal
          subjectId={selectedSubject.id}
          subjectName={selectedSubject.name}
          onClose={() => setShowSummaryModal(false)}
        />
      )}
    </div>
  );
```

整個 return 語句完整結構應為：

```tsx
  const selectedSubject = allSubjects.find(s => s.id === selectedId);

  return (
    <div className="flex items-end gap-2">
      <div ref={rootRef} className="relative flex flex-col gap-1">
        <label htmlFor="adaptive-subject" className="text-sm font-medium">學科</label>
        <input
          id="adaptive-subject"
          role="combobox"
          aria-expanded={open}
          aria-controls="adaptive-subject-listbox"
          aria-autocomplete="list"
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="輸入關鍵字搜尋學科"
          className="h-9 w-56 rounded-lg border bg-background px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        {/* 真正隨表單送出的值 */}
        <input type="hidden" name="subjectId" value={selectedId} />

        {open && (
          <div
            id="adaptive-subject-listbox"
            role="listbox"
            className="absolute top-full z-10 mt-1 max-h-64 w-72 overflow-y-auto rounded-lg border bg-popover p-1 shadow-md"
          >
            {filteredBuiltIn.length > 0 && (
              <div>
                <div className="px-2 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">內建科目</div>
                {filteredBuiltIn.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => selectSubject(s)}
                    className={`block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${
                      s.id === selectedId ? 'bg-primary/10 text-primary' : ''
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
            {filteredCustom.length > 0 && (
              <div>
                <div className="px-2 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">我的學科</div>
                {filteredCustom.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => selectSubject(s)}
                    className={`block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${
                      s.id === selectedId ? 'bg-primary/10 text-primary' : ''
                    }`}
                  >
                    {s.pinned ? `📌 ${s.name}` : s.name}
                  </button>
                ))}
              </div>
            )}
            {filteredBuiltIn.length === 0 && filteredCustom.length === 0 && (
              <div className="px-2 py-3 text-center text-sm text-muted-foreground">找不到符合的學科</div>
            )}
          </div>
        )}
      </div>

      {selectedSubject && (
        <button
          type="button"
          onClick={() => setShowSummaryModal(true)}
          className="h-9 whitespace-nowrap rounded-lg border px-3 text-sm hover:bg-muted"
        >
          📄 查看課前重點摘要
        </button>
      )}

      {showSummaryModal && selectedSubject && (
        <PreLessonSummaryModal
          subjectId={selectedSubject.id}
          subjectName={selectedSubject.name}
          onClose={() => setShowSummaryModal(false)}
        />
      )}
    </div>
  );
```

- [ ] **Step 3: 型別檢查與 lint**

Run: `npm run check-types && npm run lint`
Expected: 無錯誤。

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/(auth)/dashboard/adaptive/SubjectCombobox.tsx"
git commit -m "$(cat <<'EOF'
feat(adaptive): 建立新練習表單加「查看課前重點摘要」按鈕

選好學科後點按鈕開啟 PreLessonSummaryModal，沿用既有 combobox
的選中學科狀態，不影響表單原本的送出行為。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 完整驗證（build + 瀏覽器手動測試）

**Files:** 無新增/修改檔案，純驗證任務。

**Interfaces:** 無（驗證前五個任務組裝起來的完整功能）。

- [ ] **Step 1: 全專案驗證指令**

Run: `npm run lint && npm run check-types && npm run test && npm run build`
Expected: 四個指令全部成功，`npm run test` 的既有測試（含 Task 2 新增的
`generate-summary.test.ts`）全部通過，無 failures。

- [ ] **Step 2: 啟動開發伺服器**

Run: `npm run dev`

- [ ] **Step 3: 瀏覽器手動驗證（比照 spec「測試」章節的 5 個情境）**

1. 開啟「建立新練習」頁，選一個內建學科（例如 C++ 程式設計），點「📄 查看課前重點摘要」，
   確認彈出 Modal、顯示 loading，接著正常顯示生成結果（驗證內建學科走 `resolveSubject` 也能
   拿到 `graph.nodes`）。
2. 關閉 Modal 後，同一學科再點一次「查看課前重點摘要」，確認**立即顯示**（沒有 loading
   等待），代表讀到快取。
3. 點「重新生成」，確認按鈕顯示「生成中…」並 disable，完成後內容更新。
4. 選一個自己建立但**未發佈**的自建學科（若沒有現成的，先到「學科管理」頁建一個草稿），點
   「查看課前重點摘要」，確認 Modal 顯示「這個學科尚未發佈，請先到「學科管理」頁審核發佈」
   而非空白或 crash。
5. 若方便測試 Free 方案用量限制：把測試帳號的 AI 用量刷到超額（或暫時調整方案），點「查看
   課前重點摘要」確認顯示額度用完的訊息，而不是直接顯示生成失敗。

- [ ] **Step 4: 記錄驗證結果**

若全部通過，這個功能即完成，可以視需要開 PR（依 CLAUDE.md「Agent 任務工作流」，若這次改動
對應一個 GitHub issue，記得在 PR 描述寫 `Closes #<N>`，不要自己 merge）。若某個情境沒過，回
對應任務修正、重新走一次該任務的驗證步驟，不要跳過原因直接改別的地方。
