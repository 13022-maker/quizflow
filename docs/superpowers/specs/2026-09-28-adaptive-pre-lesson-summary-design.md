# 適性學習「建立練習前」課前重點摘要講義 設計文件

- 日期：2026-09-28
- 起因：老師在「適性學習」建立新練習時，選完學科就直接建立練習，缺少一個快速預覽「這個學科
  會教哪些重點、要注意什麼」的環節。老師想要建立前能看一份 AI 生成的課前重點摘要講義，確認
  範圍/難度符合預期再建立。
- 範圍：只加「查看摘要」這個新功能，不動既有「建立新練習」表單送出行為、不動學科建立/發佈
  流程、不動學生端作答流程。

## 使用者決策（brainstorming 階段已確認）

1. **對象**：老師端功能，在「建立新練習」表單、建立前預覽用。學生端不顯示。
2. **內容來源**：根據選定學科的知識點圖譜（`graph.nodes`）＋學科名稱生成，與「這次要建立的
   練習」本身無關，只跟「學科」綁定。
3. **快取策略**：第一次生成後存起來，同一學科被多次建立練習/多位情境重複開啟時直接讀快取，
   不重複燒 AI。老師可手動「重新生成」。
4. **內建學科的儲存問題（brainstorming 中期發現並修正）**：內建三科（cpp/python/calculus）
   是 `src/libs/adaptive/subjects/*.ts` 裡的程式碼常數，**沒有 DB row**，原本「摘要存在
   `adaptive_subject` 表新增欄位」的設計對內建學科存不進去。改為新增一張獨立的快取表
   `adaptive_subject_summary`，以 `subjectId` 字串（`'cpp'` 或 `'db:123'`）為 primary key，
   內建與自建學科統一存同一張表，不改動 `adaptive_subject` 表。
5. **觸發方式**：手動——老師在表單選完學科後，旁邊出現「📄 查看課前重點摘要」按鈕，點下去才
   呼叫（若已有快取直接顯示，沒有才等待生成），不會因為瀏覽下拉選單就默默打 AI。
6. **內容結構**：本課概述（1-2 句）＋知識點重點條列＋教學建議，Markdown 全文顯示。
7. **用量限制**：計入現有 AI 用量限制（`checkAndIncrementAiUsage`，免費方案每月 10 次、
   Pro 無限）。因為有快取重用，實際消耗次數遠低於「每次建立練習都生成」。

## 架構

```
adaptive/page.tsx（建立新練習表單）
  └─ SubjectCombobox 選定 subjectId 後
       └─「📄 查看課前重點摘要」按鈕 → 開 PreLessonSummaryModal（新元件）
            ├─ 掛載時呼叫 getOrGenerateAdaptiveSummary(subjectId)  [server action]
            │     src/actions/adaptiveActions.ts
            │       1. assertSubjectUsable(subjectId, userId) — 沿用既有驗證
            │       2. 查 adaptive_subject_summary 有無快取 → 有就直接回傳
            │       3. 沒有 → checkAndIncrementAiUsage(userId) 過關後：
            │            resolveSubject(subjectId)  [沿用 service.ts 既有函式，
            │              統一回傳內建/自建學科的 { name, graph, ... }]
            │            → generateSubjectSummary(subject)  [新檔案，AI 生成邏輯]
            │            → upsert 進 adaptive_subject_summary
            ├─「重新生成」按鈕 → regenerateAdaptiveSummary(subjectId)（跳過快取檢查，
            │     其餘同上，upsert 覆蓋舊快取）
            └─ marked.parse(markdown) 渲染成 HTML（沿用 AdaptiveLearnClient.tsx
                 既有的 marked 套件用法，不必再引入 react-markdown）
```

## 改動點

### 1. `src/models/Schema.ts` — 新增快取表

放在 `adaptiveSubjectSchema` 定義之後：

```ts
// 課前重點摘要講義快取：以 subjectId 字串為 key，內建學科（'cpp' 等，程式碼常數、無 DB row）
// 與自建學科（'db:<id>'）統一存這張表，不動 adaptive_subject 表。
export const adaptiveSubjectSummarySchema = pgTable('adaptive_subject_summary', {
  subjectId: text('subject_id').primaryKey(),
  markdown: text('markdown').notNull(),
  generatedAt: timestamp('generated_at', { mode: 'date' }).defaultNow().notNull(),
});
```

跑 `npm run db:generate` 後，依 CLAUDE.md 已知的 migration snapshot 脫鉤問題，手動核對產生的
SQL 只含這張新表的 `CREATE TABLE`。

### 2. `src/libs/adaptive/generate-summary.ts`（新檔）— AI 生成邏輯

仿 `generate-subject.ts` 的「結構化 JSON → zod 驗證 → 失敗重試一次」模式：

```ts
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

function buildUserPrompt(subject: Subject): string {
  const pointList = subject.graph.nodes.map(n => `- ${n.name}`).join('\n');
  return `學科：${subject.name}\n涵蓋知識點（依教學順序排列）：\n${pointList}\n\n請針對以上知識點生成課前重點摘要。`;
}

function renderMarkdown(subjectName: string, data: z.infer<typeof summaryOutputSchema>): string {
  const points = data.keyPoints.map(p => `- **${p.concept}**：${p.note}`).join('\n');
  const tips = data.teachingTips.length > 0
    ? `\n\n## 教學建議\n${data.teachingTips.map(t => `- ${t}`).join('\n')}`
    : '';
  return `# ${subjectName} 課前重點\n\n## 本課概述\n${data.overview}\n\n## 知識點重點\n${points}${tips}`;
}

/** 生成課前重點摘要講義（Markdown 全文）。失敗重試一次，兩次都失敗才丟錯。 */
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

- `extractJson` 從 `generate-subject.ts` 改成 export（目前已是 `export function`，直接 import
  即可，不用搬動）。
- 系統提示詞放在這個檔案裡（跟 `generate-subject.ts` 現況一致），不強行搬進
  `src/lib/ai/prompts.ts`——適性學習模組既有的 AI 生成邏輯都是提示詞跟著生成函式放，維持一致。

### 3. `src/actions/adaptiveActions.ts` — 新增兩個 server action

```ts
import { eq } from 'drizzle-orm';
import { friendlyAIGenerationError } from '@/libs/adaptive/generate-subject';
import { generateSubjectSummary } from '@/libs/adaptive/generate-summary';
import { resolveSubject } from '@/libs/adaptive/service';
import { adaptiveSubjectSummarySchema } from '@/models/Schema';

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

- `assertSubjectUsable` 目前是檔案內 private function（沒有 export），這兩個新 action 在同一
  檔案內可以直接呼叫，不用改它的可見度。
- 回傳 `{ markdown } | { error }`（不 throw），比照 `searchYoutubeVideos` 現有慣例——這兩個
  action 會被 client 元件直接呼叫並在 Modal 內就地顯示錯誤，不透過 form action 的錯誤邊界。
- `checkAndIncrementAiUsage` 吃的是 `userId`（不是 orgId），回傳 `{ allowed, reason? }` 而不是
  丟例外，額度用完時 `usage.reason` 就是要顯示的文字（沿用既有 quota 超額訊息）。

### 4. `PreLessonSummaryModal.tsx`（新檔，放在 `src/app/[locale]/(auth)/dashboard/adaptive/`）

- Props：`{ subjectId: string; subjectName: string; onClose: () => void }`
- State：`status: 'loading' | 'ready' | 'error'`、`markdown: string`、`errorMessage: string`、
  `regenerating: boolean`
- 掛載時 `useEffect` 呼叫 `getOrGenerateAdaptiveSummary(subjectId)`，依回傳結果切換狀態。
- `status === 'ready'`：`<div dangerouslySetInnerHTML={{ __html: String(marked.parse(markdown)) }} />`
  （沿用 `AdaptiveLearnClient.tsx` 既有的 `marked` 用法，內容全部是 AI 生成、非使用者輸入，
  風險等同既有課文渲染）。
- 底部按鈕：「重新生成」（呼叫 `regenerateAdaptiveSummary`，過程中 disable 並顯示 loading
  文字）、「關閉」。
- `status === 'error'`：顯示 `errorMessage`，並保留「重試」按鈕（重打
  `getOrGenerateAdaptiveSummary`）。

### 5. `adaptive/page.tsx` + `SubjectCombobox.tsx` — 加按鈕

- `SubjectCombobox` 選定學科後（`subjectId` 有值時），表單同一行出現「📄 查看課前重點摘要」
  按鈕（`type="button"`，不觸發表單送出）。
- 按鈕點擊時 `page.tsx`（或包一層 client wrapper，因為 `page.tsx` 是 Server Component，Modal
  開關要用 client state）維護 `showSummaryModal` 狀態，開啟 `PreLessonSummaryModal`。
- 因為 `page.tsx` 目前整體是 Server Component、`SubjectCombobox` 已經是 client 元件
  （要處理下拉互動），這個「按鈕＋Modal 開關」邏輯直接寫在 `SubjectCombobox.tsx` 內部即可，
  不需要額外新增一層 client wrapper。

## 錯誤處理

- 未登入：action 回 `{ error: '請先登入' }`，Modal 顯示文字（理論上不會發生，按鈕在已登入頁面
  才會出現）。
- 學科不存在/非本人/未發佈：`assertSubjectUsable` 訊息原樣顯示（例如「這個學科尚未發佈，請先
  到「學科管理」頁審核發佈」）。
- AI 用量超額：顯示 `checkAndIncrementAiUsage` 回傳的 `reason` 文字（沿用既有 quota 超額
  文案／升級引導）。
- AI 生成或格式驗證兩次都失敗：`friendlyAIGenerationError` 轉成的友善訊息（沿用既有 3 種
  分類：模型拒絕／截斷／服務暫時無法使用）。

## 測試

- `src/libs/adaptive/generate-summary.test.ts`：
  - `renderMarkdown`（若抽成可測的純函式）：給定 hand-derived 的 `{ overview, keyPoints,
    teachingTips }`，斷言輸出的 Markdown 字串包含正確的標題階層與條列格式；`teachingTips`
    為空陣列時，輸出不應包含「## 教學建議」這個標題。
  - `generateSubjectSummary` 不 mock `generateAIText` 內部行為做端到端測試（跟
    `generateSubject` 現況一致，AI 呼叫本身不寫單元測試），但可以測「zod 驗證失敗時觸發
    重試、兩次都失敗才 throw」這段流程控制邏輯（mock `generateAIText` 回傳固定的壞 JSON
    兩次，斷言呼叫了兩次且最終訊息包含驗證錯誤）。
- `src/actions/adaptiveActions.test.ts`（若既有檔案已有測試基礎建設）：
  - `getOrGenerateAdaptiveSummary` 快取命中時不應呼叫 `generateSubjectSummary`／不應扣
    AI 用量（mock 掉生成函式，斷言未被呼叫）。
  - 用量超額時回傳 `{ error }` 且不寫入快取表。
- `npm run lint`、`npm run check-types` 需全過。
- 瀏覽器手動驗證：
  1. 建立新練習表單選一個內建學科（例如 C++ 程式設計），點「查看課前重點摘要」，確認能正常
     生成並顯示（驗證內建學科走 `resolveSubject` 也能拿到 `graph.nodes`）。
  2. 同一學科第二次點開，確認直接顯示快取內容（不會重新等待生成、Network 面板看不到新的 AI
     呼叫延遲）。
  3. 點「重新生成」，確認內容有機會變化且快取更新。
  4. 選一個自己建立但「未發佈」的自建學科，確認按鈕點下去顯示「尚未發佈」錯誤而非空白或
     crash。
  5. 把 Free 方案的 AI 用量刷到超額，確認顯示額度用完訊息而非直接噴生成失敗。

## 不做（YAGNI）

- 不做「學科內容變更後自動判斷摘要過時」的機制（`generatedAt` 只是紀錄時間，不做自動比對
  失效邏輯）——需要時老師手動按「重新生成」即可。
- 不做學生端顯示（brainstorming 已確認只給老師看）。
- 不做多語言版本摘要（跟著學科本身的語言走，不額外做 i18n 翻譯層）。
- 不做摘要內容的手動編輯功能（AI 生成後只能整份重新生成，不能老師手改局部文字）。
- 不做「刪除快取」的獨立 UI（重新生成即覆蓋，等於變相清快取）。
