# 適性學習「AI 生成學科」加入 PDF／圖片上傳 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓「適性學習 → AI 生成學科」表單除了貼文字之外，也能上傳 PDF（單份）或多張圖片作為教材來源。

**Architecture:** 新增一支 API Route（`/api/ai/generate-subject-from-file`）處理檔案上傳；把
`textModel.ts` 的 `generateAIText` 擴充成支援多模態（`media` 參數），`generate-subject.ts` 跟著
加一個可選的 `media` 參數往下傳；把「存進 `adaptive_subject`＋友善錯誤映射」從既有的
`generateAdaptiveSubject` server action 抽成共用 helper，讓新 route 跟舊 action 都能用。

**Tech Stack:** Next.js 14 App Router（Route Handler + Server Action）、`@anthropic-ai/sdk`、
`@google/genai`、`pdf-lib`（server 端頁面裁切）、`pdfjs-dist`（前端讀頁數）、Zod、Vitest。

## Global Constraints

- UI 文字、錯誤訊息、程式碼註解一律繁體中文；變數/函式/檔名一律英文（camelCase / kebab-case）。
- 所有 API Route 最頂端加 `export const runtime = 'nodejs'`；回應一律用 `NextResponse.json()`。
- Vercel Serverless request body 上限 ~4.5MB，大檔案要在前端用 `pdf-lib` 先裁切（沿用
  `FileQuizGenerator.tsx` 既有的 `MAX_UPLOAD_SIZE` 模式），不是直接擋掉上傳。
- PDF 一律用伺服器端量到的真實頁數判斷上限（`resolvePdfPageRange`，`MAX_PDF_PAGES_PER_REQUEST = 20`），
  不信任前端傳來的 `startPage`/`endPage`。
- 新增的邏輯盡量拆成純函式並補單元測試（vitest）；DB 寫入 / AI 呼叫這類 I/O 邏輯不強求單元測試，
  本專案目前沒有對 `db`（Drizzle）直接寫測試的先例，最後用瀏覽器手動跑一次真實流程驗證。
- 每個 task 結束都要 `npm run lint` 跟 `npm run check-types` 過（commit 前 lint-staged 會自動跑一次）。
- 新增翻譯 key 才需要同步 `zh.json`/`en.json`——`NewSubjectForm.tsx` 現況全部是寫死的繁中字串
  （沒有用 `next-intl`），這次比照既有模式，**不**新增 i18n key。

---

### Task 1: `textModel.ts` 加多模態支援（Claude image/document blocks、Gemini inlineData）

**Files:**
- Modify: `src/lib/ai/textModel.ts:9-24`（import 區與 `GenerateAITextOptions`）、
  `src/lib/ai/textModel.ts:106-156`（`callClaude`、`callGemini`）
- Test: `src/lib/ai/textModel.test.ts`（既有檔案，新增 `describe` 區塊）

**Interfaces:**
- Consumes：無（本 task 是最底層）
- Produces：`export type Media = { mimeType: string; base64: string }`、
  `export function buildClaudeMediaBlocks(media: Media[]): (Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam)[]`、
  `export function buildGeminiMediaParts(media: Media[]): { inlineData: { mimeType: string; data: string } }[]`、
  `GenerateAITextOptions` 新增 `media?: Media[]`——Task 2 會 import `Media` 型別並在
  `generateAIText(...)` 呼叫時傳 `media`。

- [ ] **Step 1: 寫失敗的測試（`buildClaudeMediaBlocks` / `buildGeminiMediaParts`）**

在 `src/lib/ai/textModel.test.ts` 檔案最後加入：

```ts
describe('buildClaudeMediaBlocks', () => {
  it('圖片 mimeType（image/ 開頭）轉成 Claude image block', () => {
    const blocks = buildClaudeMediaBlocks([
      { mimeType: 'image/png', base64: 'AAAA' },
    ]);

    expect(blocks).toEqual([
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
      },
    ]);
  });

  it('非 image/ 開頭的 mimeType 轉成 Claude document block（PDF）', () => {
    const blocks = buildClaudeMediaBlocks([
      { mimeType: 'application/pdf', base64: 'BBBB' },
    ]);

    expect(blocks).toEqual([
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: 'BBBB' },
      },
    ]);
  });

  it('多份 media 依原順序轉成多個 blocks', () => {
    const blocks = buildClaudeMediaBlocks([
      { mimeType: 'image/jpeg', base64: 'A' },
      { mimeType: 'image/png', base64: 'B' },
    ]);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ source: { data: 'A' } });
    expect(blocks[1]).toMatchObject({ source: { data: 'B' } });
  });

  it('空陣列回傳空陣列', () => {
    expect(buildClaudeMediaBlocks([])).toEqual([]);
  });
});

describe('buildGeminiMediaParts', () => {
  it('每份 media 轉成一個 inlineData part', () => {
    const parts = buildGeminiMediaParts([
      { mimeType: 'application/pdf', base64: 'CCCC' },
    ]);

    expect(parts).toEqual([
      { inlineData: { mimeType: 'application/pdf', data: 'CCCC' } },
    ]);
  });

  it('多份 media 依原順序轉成多個 parts', () => {
    const parts = buildGeminiMediaParts([
      { mimeType: 'image/png', base64: 'A' },
      { mimeType: 'image/png', base64: 'B' },
    ]);

    expect(parts).toEqual([
      { inlineData: { mimeType: 'image/png', data: 'A' } },
      { inlineData: { mimeType: 'image/png', data: 'B' } },
    ]);
  });

  it('空陣列回傳空陣列', () => {
    expect(buildGeminiMediaParts([])).toEqual([]);
  });
});
```

也把 import 那行改成：

```ts
import { buildClaudeMediaBlocks, buildGeminiMediaParts, isRetryableAIError, resolveAIProvider, withAIRetry } from './textModel';
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test -- src/lib/ai/textModel.test.ts`
Expected: FAIL（`buildClaudeMediaBlocks`/`buildGeminiMediaParts` 尚未定義，import 報錯）

- [ ] **Step 3: 實作 `Media` 型別與兩個純函式，並把 `media` 接進 `GenerateAITextOptions`**

把 `src/lib/ai/textModel.ts:16-24` 的 `GenerateAITextOptions` 改成：

```ts
type GenerateAITextOptions = {
  prompt: string; // 完整使用者 prompt（單輪文字）
  system?: string; // system prompt（Gemini 端會前綴到 prompt）
  claudeModel?: string; // 預設 claude-sonnet-4-6
  claudeThinking?: boolean; // Opus 4.8 需開 adaptive thinking
  maxTokens?: number; // 預設 4096
  json?: boolean; // true 時 Gemini 開 JSON mode
  forceGemini?: boolean; // 呼叫端已自行嘗試過 Claude 失敗時，跳過 Claude 直接走 Gemini
  media?: Media[]; // 多模態素材（PDF / 圖片）；Claude 走 image/document blocks，Gemini 走 inlineData
};

// 一份多模態素材：mimeType + base64（跟 generate-from-file/route.ts 現有的同形狀 local type 對齊）
export type Media = { mimeType: string; base64: string };

/** Claude 多模態 content blocks：image/ 開頭走 image type，其餘（PDF）走 document type（純函式，可測） */
export function buildClaudeMediaBlocks(
  media: Media[],
): (Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam)[] {
  return media.map((m): Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam =>
    m.mimeType.startsWith('image/')
      ? {
          type: 'image',
          source: {
            type: 'base64',
            media_type: m.mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
            data: m.base64,
          },
        }
      : {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: m.base64 },
        },
  );
}

/** Gemini 多模態 parts：inlineData（純函式，可測） */
export function buildGeminiMediaParts(
  media: Media[],
): { inlineData: { mimeType: string; data: string } }[] {
  return media.map(m => ({ inlineData: { mimeType: m.mimeType, data: m.base64 } }));
}
```

- [ ] **Step 4: 跑測試確認新增的測試通過**

Run: `npm run test -- src/lib/ai/textModel.test.ts`
Expected: PASS（`buildClaudeMediaBlocks`/`buildGeminiMediaParts` 兩組 describe 全綠；
`resolveAIProvider`/`isRetryableAIError`/`withAIRetry` 原本的測試也要維持全綠）

- [ ] **Step 5: 把 `callClaude`／`callGemini` 接上 media（沒有自動化測試，靠後面 Task 7 的手動驗證）**

把 `src/lib/ai/textModel.ts:106-127` 的 `callClaude` 改成：

```ts
async function callClaude(opts: GenerateAITextOptions): Promise<string> {
  const client = new Anthropic();
  const content: Anthropic.MessageParam['content'] = opts.media?.length
    ? [...buildClaudeMediaBlocks(opts.media), { type: 'text', text: opts.prompt }]
    : opts.prompt;
  // 串流聚合避免長輸出撞 HTTP 逾時（比照 generate-subject 既有寫法）
  const stream = client.messages.stream({
    model: opts.claudeModel ?? 'claude-sonnet-4-6',
    max_tokens: opts.maxTokens ?? 4096,
    ...(opts.claudeThinking ? { thinking: { type: 'adaptive' as const } } : {}),
    ...(opts.system ? { system: opts.system } : {}),
    messages: [{ role: 'user', content }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') {
    throw new Error('模型拒絕生成此內容');
  }
  if (message.stop_reason === 'max_tokens') {
    throw new Error('輸出被 max_tokens 截斷');
  }
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('');
}
```

把 `src/lib/ai/textModel.ts:129-156` 的 `callGemini` 改成：

```ts
async function callGemini(opts: GenerateAITextOptions): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('AI 服務未設定（缺少 GEMINI_API_KEY）');
  }
  const gemini = new GoogleGenAI({ apiKey: key });
  // Gemini 無獨立 system 欄位使用習慣（比照本專案既有寫法），前綴到 prompt
  const fullPrompt = opts.system ? `${opts.system}\n\n---\n\n${opts.prompt}` : opts.prompt;
  const parts = [
    ...(opts.media?.length ? buildGeminiMediaParts(opts.media) : []),
    { text: fullPrompt },
  ];
  const response = await gemini.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts }],
    config: {
      maxOutputTokens: opts.maxTokens ?? 4096,
      ...(opts.json ? { responseMimeType: 'application/json' } : {}),
      // 關掉 thinking 讓 token 全給輸出（比照 generate-questions）
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
  const text = response.text ?? '';
  const finishReason = response.candidates?.[0]?.finishReason;
  if (finishReason && finishReason !== 'STOP') {
    throw new Error(`Gemini 輸出異常（finishReason=${finishReason}）`);
  }
  if (!text) {
    throw new Error('Gemini 回傳空內容');
  }
  return text;
}
```

- [ ] **Step 6: 全部測試 + lint + type check**

Run: `npm run test -- src/lib/ai/textModel.test.ts && npm run lint && npm run check-types`
Expected: 全部 PASS（沒有 TypeScript 錯誤、ESLint 錯誤）

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/textModel.ts src/lib/ai/textModel.test.ts
git commit -m "feat(ai): textModel 加入多模態支援（Claude image/document、Gemini inlineData）"
```

---

### Task 2: `generate-subject.ts` 接受 `media` 參數，抽出友善錯誤映射

**Files:**
- Modify: `src/libs/adaptive/generate-subject.ts:8-13`（import）、`:93-98`（`buildUserPrompt`）、
  `:164-198`（`generateSubject`）
- Test: `src/libs/adaptive/generate-subject.test.ts`（新檔案）

**Interfaces:**
- Consumes：Task 1 的 `Media` type、`generateAIText({ ...opts, media })`
- Produces：`export function buildUserPrompt(topic: string, material?: string, hasMedia?: boolean): string`、
  `export function friendlyAIGenerationError(err: unknown): string`、
  `generateSubject(topic: string, material?: string, media?: Media[]): Promise<GeneratedSubject>`——
  Task 3 會 import `friendlyAIGenerationError`，新 route（Task 5）會呼叫
  `generateSubject(topic, undefined, media)`。

- [ ] **Step 1: 寫失敗的測試**

建立 `src/libs/adaptive/generate-subject.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { buildUserPrompt, friendlyAIGenerationError } from './generate-subject';

describe('buildUserPrompt', () => {
  it('沒有 material 也沒有 media：只帶主題', () => {
    const prompt = buildUserPrompt('二次函數');

    expect(prompt).toContain('二次函數');
    expect(prompt).not.toContain('<教材>');
  });

  it('有 material、無 media：包住 <教材> 區塊', () => {
    const prompt = buildUserPrompt('二次函數', '課本第三章內容...');

    expect(prompt).toContain('<教材>');
    expect(prompt).toContain('課本第三章內容...');
  });

  it('hasMedia=true：不出現 <教材> 文字區塊，改提示以檔案內容為準', () => {
    const prompt = buildUserPrompt('二次函數', undefined, true);

    expect(prompt).toContain('二次函數');
    expect(prompt).not.toContain('<教材>');
    expect(prompt).toContain('檔案');
  });
});

describe('friendlyAIGenerationError', () => {
  it('訊息含「拒絕」：回傳換主題的提示', () => {
    expect(friendlyAIGenerationError(new Error('模型拒絕輸出'))).toBe(
      '模型拒絕生成此主題的內容，請換一個主題',
    );
  });

  it('訊息含 SAFETY（Gemini 安全過濾）：回傳換主題的提示', () => {
    expect(friendlyAIGenerationError(new Error('finishReason=SAFETY'))).toBe(
      '模型拒絕生成此主題的內容，請換一個主題',
    );
  });

  it('訊息含「截斷」：回傳縮小範圍的提示', () => {
    expect(friendlyAIGenerationError(new Error('輸出被截斷'))).toBe(
      '生成內容過長被截斷，請縮小主題範圍再試',
    );
  });

  it('訊息含 MAX_TOKENS：回傳縮小範圍的提示', () => {
    expect(friendlyAIGenerationError(new Error('stop_reason=MAX_TOKENS'))).toBe(
      '生成內容過長被截斷，請縮小主題範圍再試',
    );
  });

  it('其他未知錯誤：回傳通用的稍後再試提示', () => {
    expect(friendlyAIGenerationError(new Error('ECONNRESET'))).toBe(
      'AI 服務暫時無法使用，請稍後再試',
    );
  });

  it('非 Error 物件不會炸，回傳通用提示', () => {
    expect(friendlyAIGenerationError('plain string')).toBe('AI 服務暫時無法使用，請稍後再試');
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test -- src/libs/adaptive/generate-subject.test.ts`
Expected: FAIL（`buildUserPrompt`/`friendlyAIGenerationError` 尚未 export）

- [ ] **Step 3: 實作**

把 `src/libs/adaptive/generate-subject.ts:8-13` 的 import 區改成：

```ts
import { z } from 'zod';

import { generateAIText, isPaidSubscriberSafe } from '@/lib/ai/textModel';
import type { Media } from '@/lib/ai/textModel';

import { AdaptiveEngine, type ItemBank, type KnowledgeGraph } from './engine';
import type { Subject } from './subjects';
```

把 `src/libs/adaptive/generate-subject.ts:93-98` 的 `buildUserPrompt` 改成（加 `export`、
加第三個參數 `hasMedia`）：

```ts
export function buildUserPrompt(topic: string, material?: string, hasMedia?: boolean): string {
  if (hasMedia) {
    return `請為以下單元主題設計學科：「${topic.trim()}」\n\n以下是老師上傳的教材檔案，知識點劃分與題目範圍以檔案內容為準（不要超出檔案範圍出題）。`;
  }
  const materialBlock = material?.trim()
    ? `\n\n以下是老師提供的教材內容，知識點劃分與題目範圍以此為準（不要超出教材範圍出題）：\n<教材>\n${material.trim().slice(0, 20000)}\n</教材>`
    : '';
  return `請為以下單元主題設計學科：「${topic.trim()}」${materialBlock}`;
}

/**
 * 把 AI 生成失敗的錯誤轉成老師看得懂的訊息（純函式，可測）。
 * Claude 的拒絕/截斷訊息、Gemini 對應的 SAFETY / MAX_TOKENS 都轉成等義的可行動訊息。
 * generateAdaptiveSubject（文字模式）跟 generate-subject-from-file route（檔案模式）共用。
 */
export function friendlyAIGenerationError(err: unknown): string {
  const msg = err instanceof Error ? err.message : '';
  if (msg.includes('拒絕') || msg.includes('SAFETY')) {
    return '模型拒絕生成此主題的內容，請換一個主題';
  }
  if (msg.includes('截斷') || msg.includes('MAX_TOKENS')) {
    return '生成內容過長被截斷，請縮小主題範圍再試';
  }
  return 'AI 服務暫時無法使用，請稍後再試';
}
```

把 `src/libs/adaptive/generate-subject.ts:164-198` 的 `generateSubject` 改成
（簽名加 `media`，傳給 `generateAIText`，`buildUserPrompt` 呼叫加第三個參數）：

```ts
export async function generateSubject(
  topic: string,
  material?: string,
  media?: Media[],
): Promise<GeneratedSubject> {
  // 嚴格付費判定：30 天免費試用不算，避免試用戶單次生成就消耗 32k Opus tokens
  const forceGemini = !(await isPaidSubscriberSafe());
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    // 重試時附上上次的驗證錯誤，讓模型修正
    const retryNote = lastError
      ? `\n\n【上次生成有以下問題，請修正後重新生成】\n${lastError}`
      : '';
    const { text, usedModel } = await generateAIText({
      prompt: buildUserPrompt(topic, material, Boolean(media?.length)) + retryNote,
      system: SYSTEM_PROMPT,
      claudeModel: 'claude-opus-4-8',
      claudeThinking: true,
      maxTokens: 32000,
      json: true,
      forceGemini,
      media,
    });
    console.warn(`[generate-subject] attempt=${attempt} usedModel=${usedModel}`);

    try {
      const generated = generatedSubjectSchema.parse(extractJson(text));
      validateSemantics(generated);
      return generated;
    } catch (error) {
      lastError = (error as Error).message;
    }
  }
  throw new Error(`AI 生成的學科結構驗證失敗：${lastError}`);
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test -- src/libs/adaptive/generate-subject.test.ts`
Expected: PASS

- [ ] **Step 5: lint + type check**

Run: `npx eslint --fix src/libs/adaptive/generate-subject.ts && npm run check-types`
Expected: 無錯誤（`eslint --fix` 順手排好 import 順序——這個專案的
`simple-import-sort` 規則常常要手動 fix 才會排對）

- [ ] **Step 6: Commit**

```bash
git add src/libs/adaptive/generate-subject.ts src/libs/adaptive/generate-subject.test.ts
git commit -m "feat(adaptive): generateSubject 接受 media 參數，抽出 friendlyAIGenerationError"
```

---

### Task 3: `adaptiveActions.ts` 抽出 `saveGeneratedSubject` 共用 helper

**Files:**
- Modify: `src/actions/adaptiveActions.ts:15`（import）、`:139-142`（`generateSubjectSchema`）、
  `:144-198`（`generateAdaptiveSubject`）

**Interfaces:**
- Consumes：Task 2 的 `friendlyAIGenerationError`
- Produces：`export const generateSubjectSchema`（供 Task 5 的 route 驗證 `topic` 用）、
  `export async function saveGeneratedSubject(userId: string, topic: string, generated: Awaited<ReturnType<typeof generateSubject>>): Promise<{ id: number; name: string; knowledgeCount: number; itemCount: number }>`——
  Task 5 的新 route 會 import 這兩個。

- [ ] **Step 1: 把 import 區（`:15`）改成帶入 `friendlyAIGenerationError`**

```ts
import { friendlyAIGenerationError, generateSubject, toSubject } from '@/libs/adaptive/generate-subject';
```

（原本這行是 `import { generateSubject, toSubject } from '@/libs/adaptive/generate-subject';`，
只是多 import 一個 named export，位置維持原本 import 排序區塊。）

- [ ] **Step 2: `generateSubjectSchema`（`:139-142`）加 `export`**

```ts
export const generateSubjectSchema = z.object({
  topic: z.string().trim().min(2, '請輸入單元主題').max(100),
  material: z.string().trim().max(20000).optional(),
});
```

- [ ] **Step 3: 重構 `generateAdaptiveSubject`（`:144-198`），抽出 `saveGeneratedSubject`**

把整段（原本第 144-198 行，從 doc comment 到函式結尾的 `}`）換成：

```ts
type SavedSubjectResult = {
  id: number;
  name: string;
  knowledgeCount: number;
  itemCount: number;
};

/**
 * 把 AI 生成結果（GeneratedSubject）寫入 adaptive_subject，並讓學科清單頁重新驗證快取。
 * 文字模式（generateAdaptiveSubject，本檔案）與檔案上傳模式
 * （/api/ai/generate-subject-from-file）共用，避免存檔邏輯寫兩份。
 */
export async function saveGeneratedSubject(
  userId: string,
  topic: string,
  generated: Awaited<ReturnType<typeof generateSubject>>,
): Promise<SavedSubjectResult> {
  const { subject } = toSubject(generated, 'pending'); // 取正規化後的 graph/itemBank/tutor

  const [row] = await db
    .insert(adaptiveSubjectSchema)
    .values({
      ownerId: userId,
      name: generated.name,
      sourceTopic: topic,
      graph: subject.graph,
      itemBank: subject.itemBank,
      tutor: subject.tutor,
    })
    .returning();

  revalidatePath('/dashboard/adaptive');
  return {
    id: row!.id,
    name: row!.name,
    knowledgeCount: subject.graph.nodes.length,
    itemCount: subject.itemBank.items.length,
  };
}

/**
 * AI 生成一個新學科並存入 adaptive_subject。
 * 回傳結果給前端（不 redirect，讓生成頁顯示成功摘要與學科 id）。
 */
export async function generateAdaptiveSubject(
  input: { topic: string; material?: string },
): Promise<SavedSubjectResult | { error: string }> {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('請先登入');
  }

  const parsed = generateSubjectSchema.parse(input);

  // 呼叫 AI 生成（含結構＋語意＋引擎建構三道驗證，失敗自動重試一次）
  let generated: Awaited<ReturnType<typeof generateSubject>>;
  try {
    generated = await generateSubject(parsed.topic, parsed.material);
  } catch (err) {
    // 兩個 AI provider 都失敗（或模型拒絕）：回傳友善錯誤，不讓例外冒泡成整頁 digest error
    console.error('[generateAdaptiveSubject] AI 生成失敗：', err);
    return { error: friendlyAIGenerationError(err) } as const;
  }

  return saveGeneratedSubject(userId, parsed.topic, generated);
}
```

- [ ] **Step 4: type check（這個檔案沒有既有的單元測試慣例，DB 寫入邏輯留給 Task 7 手動驗證）**

Run: `npm run check-types`
Expected: 無錯誤——特別注意 `NewSubjectForm.tsx` 目前 import 的 `Result` type
（`{ id, name, knowledgeCount, itemCount }`）跟這裡新的 `SavedSubjectResult` 形狀要完全一致，
否則 Task 6 接手時型別會對不上。

- [ ] **Step 5: 手動確認既有「貼文字」流程沒壞（開發伺服器跑一次）**

Run: `npm run dev`（若已在跑就略過），瀏覽器開 `http://localhost:3000/dashboard/adaptive/new-subject`，
用「單元主題」+「教材內容」貼文字，點「開始生成」，確認能正常跑完並顯示「✅ 學科已生成」。
這一步只是確認重構沒有改變既有行為，不用截圖或特別記錄。

- [ ] **Step 6: Commit**

```bash
git add src/actions/adaptiveActions.ts
git commit -m "refactor(adaptive): 抽出 saveGeneratedSubject 共用 helper，export generateSubjectSchema"
```

---

### Task 4: 新增檔案驗證純函式模組 `subjectFileValidation.ts`

**Files:**
- Create: `src/libs/adaptive/subjectFileValidation.ts`
- Test: `src/libs/adaptive/subjectFileValidation.test.ts`

**Interfaces:**
- Consumes：無
- Produces：`export const SUBJECT_UPLOAD_IMAGE_EXTENSIONS`、
  `export type SubjectFileValidationResult = { ok: true } | { ok: false; error: string }`、
  `export function validateSubjectUploadFiles(fileNames: string[]): SubjectFileValidationResult`、
  `export function fileExtToImageMimeType(ext: string): string`——`validateSubjectUploadFiles`
  被 Task 5（route 端）跟 Task 6（前端先擋一次）共用；`fileExtToImageMimeType` 只有 Task 5
  （組 base64 media payload 時）會用到。

- [ ] **Step 1: 寫失敗的測試**

建立 `src/libs/adaptive/subjectFileValidation.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { fileExtToImageMimeType, validateSubjectUploadFiles } from './subjectFileValidation';

describe('validateSubjectUploadFiles', () => {
  it('沒有任何檔案：拒絕', () => {
    const result = validateSubjectUploadFiles([]);

    expect(result).toEqual({ ok: false, error: '請上傳檔案' });
  });

  it('單一 PDF：放行', () => {
    const result = validateSubjectUploadFiles(['講義.pdf']);

    expect(result).toEqual({ ok: true });
  });

  it('單一圖片：放行', () => {
    const result = validateSubjectUploadFiles(['photo.jpg']);

    expect(result).toEqual({ ok: true });
  });

  it('多張圖片：放行', () => {
    const result = validateSubjectUploadFiles(['p1.jpg', 'p2.png', 'p3.webp']);

    expect(result).toEqual({ ok: true });
  });

  it('不支援的副檔名（例如 .docx）：拒絕', () => {
    const result = validateSubjectUploadFiles(['講義.docx']);

    expect(result.ok).toBe(false);
  });

  it('多檔但混雜 PDF：拒絕（多檔只能全部是圖片）', () => {
    const result = validateSubjectUploadFiles(['p1.jpg', '講義.pdf']);

    expect(result.ok).toBe(false);
  });

  it('多個 PDF：拒絕（PDF 只能單檔）', () => {
    const result = validateSubjectUploadFiles(['a.pdf', 'b.pdf']);

    expect(result.ok).toBe(false);
  });

  it('副檔名大小寫不影響判斷', () => {
    const result = validateSubjectUploadFiles(['PHOTO.JPG']);

    expect(result).toEqual({ ok: true });
  });
});

describe('fileExtToImageMimeType', () => {
  it('jpg/jpeg 轉成 image/jpeg', () => {
    expect(fileExtToImageMimeType('jpg')).toBe('image/jpeg');
    expect(fileExtToImageMimeType('jpeg')).toBe('image/jpeg');
  });

  it('png 轉成 image/png', () => {
    expect(fileExtToImageMimeType('png')).toBe('image/png');
  });

  it('webp / gif 轉成對應 mimeType', () => {
    expect(fileExtToImageMimeType('webp')).toBe('image/webp');
    expect(fileExtToImageMimeType('gif')).toBe('image/gif');
  });

  it('未知副檔名 fallback 成 image/png', () => {
    expect(fileExtToImageMimeType('bmp')).toBe('image/png');
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test -- src/libs/adaptive/subjectFileValidation.test.ts`
Expected: FAIL（模組不存在）

- [ ] **Step 3: 實作**

建立 `src/libs/adaptive/subjectFileValidation.ts`：

```ts
/**
 * AI 生成學科（檔案上傳模式）的檔案驗證——從
 * src/app/api/ai/generate-subject-from-file/route.ts 抽出成純函式方便單元測試，
 * 規則對齊 src/app/api/ai/generate-from-file/route.ts 既有的驗證邏輯（訊息用詞盡量一致，
 * 避免老師在 AI 出題跟 AI 生成學科看到兩套不一致的錯誤提示）。
 */

export const SUBJECT_UPLOAD_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'] as const;

export type SubjectFileValidationResult
  = | { ok: true }
  | { ok: false; error: string };

function getExt(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

/** 驗證上傳的檔名清單：允許單一 PDF，或一到多張圖片；不允許混雜、不允許多個 PDF */
export function validateSubjectUploadFiles(fileNames: string[]): SubjectFileValidationResult {
  if (fileNames.length === 0) {
    return { ok: false, error: '請上傳檔案' };
  }

  const imageSet = new Set<string>(SUBJECT_UPLOAD_IMAGE_EXTENSIONS);
  const exts = fileNames.map(getExt);
  const allImages = exts.every(e => imageSet.has(e));
  const firstIsPdf = exts[0] === 'pdf';

  if (!allImages && !(fileNames.length === 1 && firstIsPdf)) {
    if (fileNames.length > 1) {
      return { ok: false, error: '多檔上傳僅支援圖片格式（PDF 請單檔上傳）' };
    }
    return { ok: false, error: '支援 PDF、圖片格式（jpg/jpeg/png/webp/gif）' };
  }

  return { ok: true };
}

/** 副檔名轉成圖片 mimeType；未知副檔名 fallback 成 image/png（跟 generate-from-file 既有寫法一致） */
export function fileExtToImageMimeType(ext: string): string {
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
  };
  return map[ext] ?? 'image/png';
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm run test -- src/libs/adaptive/subjectFileValidation.test.ts`
Expected: PASS（8 + 4 = 12 個測試全綠）

補充：`validateSubjectUploadFiles` 只吃檔名字串陣列（不吃 `File` 物件），刻意設計成這樣是因為
Task 5 的 route 端（`File[]`）跟 Task 6 的前端（也是 `File[]`）都能直接 `.map(f => f.name)`
餵進來，同一份規則兩邊共用，不用各刻一份驗證邏輯。

- [ ] **Step 5: lint + type check**

Run: `npx eslint --fix src/libs/adaptive/subjectFileValidation.ts && npm run check-types`
Expected: 無錯誤

- [ ] **Step 6: Commit**

```bash
git add src/libs/adaptive/subjectFileValidation.ts src/libs/adaptive/subjectFileValidation.test.ts
git commit -m "feat(adaptive): 新增檔案上傳驗證純函式模組 subjectFileValidation"
```

---

### Task 5: 新增 API Route `POST /api/ai/generate-subject-from-file`

**Files:**
- Create: `src/app/api/ai/generate-subject-from-file/route.ts`

**Interfaces:**
- Consumes：Task 1 的 `Media` type；Task 2 的 `generateSubject`；
  Task 3 的 `generateSubjectSchema`、`saveGeneratedSubject`；
  Task 4 的 `validateSubjectUploadFiles`、`fileExtToImageMimeType`；
  既有的 `resolvePdfPageRange`（`@/libs/pdfPageLimit`）
- Produces：`POST /api/ai/generate-subject-from-file`，成功回傳
  `{ id: number; name: string; knowledgeCount: number; itemCount: number }`（跟
  `generateAdaptiveSubject` 成功時同形狀），失敗回傳 `{ error: string }` 搭配對應 HTTP status——
  Task 6 的前端會呼叫這支 API。

- [ ] **Step 1: 建立 route 檔案**

建立 `src/app/api/ai/generate-subject-from-file/route.ts`：

```ts
// pdf-lib、Buffer 是 Node.js 專屬 API，必須明確指定 Node.js Runtime
import { Buffer } from 'node:buffer';

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';

import { generateSubjectSchema, saveGeneratedSubject } from '@/actions/adaptiveActions';
import type { Media } from '@/lib/ai/textModel';
import {
  fileExtToImageMimeType,
  validateSubjectUploadFiles,
} from '@/libs/adaptive/subjectFileValidation';
import { friendlyAIGenerationError, generateSubject } from '@/libs/adaptive/generate-subject';
import { resolvePdfPageRange } from '@/libs/pdfPageLimit';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  const formData = await request.formData();
  const uploaded = formData.getAll('file').filter((v): v is File => v instanceof File);
  const startPage = Number.parseInt(formData.get('startPage') as string) || 1;
  const endPage = Number.parseInt(formData.get('endPage') as string) || 0;

  let topic: string;
  try {
    ({ topic } = generateSubjectSchema.pick({ topic: true }).parse({
      topic: formData.get('topic'),
    }));
  } catch {
    return NextResponse.json({ error: '請輸入單元主題（至少 2 個字）' }, { status: 400 });
  }

  const fileValidation = validateSubjectUploadFiles(uploaded.map(f => f.name));
  if (!fileValidation.ok) {
    return NextResponse.json({ error: fileValidation.error }, { status: 400 });
  }

  const firstFile = uploaded[0]!;
  const isPdf = firstFile.name.split('.').pop()?.toLowerCase() === 'pdf';
  const media: Media[] = [];

  if (isPdf) {
    // 跟 generate-from-file/route.ts 一致：ignoreEncryption + 重新輸出乾淨 PDF，
    // 避免加密限制讓 AI 多模態讀不到內容，也避免整份大 PDF 直接送給 AI 拖慢生成。
    const arrayBuffer = await firstFile.arrayBuffer();
    const srcDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
    const actualTotalPages = srcDoc.getPageCount();

    const range = resolvePdfPageRange({
      actualTotalPages,
      requestedStartPage: startPage,
      requestedEndPage: endPage,
    });
    if (!range.ok) {
      return NextResponse.json({ error: range.error }, { status: 400 });
    }

    const newDoc = await PDFDocument.create();
    const indices = Array.from(
      { length: range.endPage - range.startPage + 1 },
      (_, i) => range.startPage - 1 + i,
    );
    const copiedPages = await newDoc.copyPages(srcDoc, indices);
    copiedPages.forEach(page => newDoc.addPage(page));
    const pdfBytes = await newDoc.save();

    media.push({
      mimeType: 'application/pdf',
      base64: Buffer.from(pdfBytes).toString('base64'),
    });
  } else {
    for (const f of uploaded) {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      const buf = await f.arrayBuffer();
      media.push({
        mimeType: fileExtToImageMimeType(ext),
        base64: Buffer.from(buf).toString('base64'),
      });
    }
  }

  let generated: Awaited<ReturnType<typeof generateSubject>>;
  try {
    generated = await generateSubject(topic, undefined, media);
  } catch (err) {
    console.error('[generate-subject-from-file] AI 生成失敗：', err);
    return NextResponse.json({ error: friendlyAIGenerationError(err) }, { status: 500 });
  }

  const result = await saveGeneratedSubject(userId, topic, generated);
  return NextResponse.json(result);
}
```

- [ ] **Step 2: type check + lint**

Run: `npx eslint --fix src/app/api/ai/generate-subject-from-file/route.ts && npm run check-types`
Expected: 無錯誤。特別確認 `generateSubjectSchema.pick({ topic: true }).parse(...)` 這行型別
沒問題（`generateSubjectSchema` 是 Task 3 export 出來的 Zod object schema，`.pick` 是 Zod 內建方法）。

- [ ] **Step 3: 手動打一次 API 確認基本行為（還不用真的接 AI，先確認驗證邏輯／回應格式）**

開發伺服器跑著的狀態下，用瀏覽器開 devtools 或用 `curl` 測「未登入」與「沒帶檔案」兩種錯誤情境
（`curl` 這裡沒有登入 cookie，預期會落在 401，這一步只是確認 route 能正常被打到不會 500）：

```bash
curl -i -X POST http://localhost:3000/api/ai/generate-subject-from-file
```

Expected: HTTP 狀態碼 401，body 為 `{"error":"未登入"}"`（未帶 Clerk session cookie 時的預期行為）。
真正上傳檔案跑完整 AI 生成流程的驗證留到 Task 7（需要登入態，用瀏覽器操作比較可靠）。

- [ ] **Step 4: Commit**

```bash
git add src/app/api/ai/generate-subject-from-file/route.ts
git commit -m "feat(adaptive): 新增 AI 生成學科的檔案上傳 API route"
```

---

### Task 6: `NewSubjectForm.tsx` 加上傳檔案 UI

**Files:**
- Modify: `src/app/[locale]/(auth)/dashboard/adaptive/new-subject/NewSubjectForm.tsx`（整份重寫）

**Interfaces:**
- Consumes：Task 5 的 `POST /api/ai/generate-subject-from-file`；Task 4 的
  `validateSubjectUploadFiles`（前端先擋一次，跟 route 端共用同一份規則）；既有的
  `generateAdaptiveSubject`（server action，文字模式不變）
- Produces：無（葉節點，UI 元件）

- [ ] **Step 1: 整份改寫 `NewSubjectForm.tsx`**

```tsx
'use client';

/**
 * AI 生成學科表單：呼叫 generateAdaptiveSubject（約 1～3 分鐘）。
 * 生成期間鎖住按鈕並顯示提示；成功後顯示摘要並提供「回去建立練習」入口。
 * 教材來源二選一：貼文字（走 server action）或上傳 PDF/圖片（走 API route，
 * 因為 Server Action 預設 body 上限 1MB，檔案上傳需要走 Route Handler）。
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { generateAdaptiveSubject } from '@/actions/adaptiveActions';
import { validateSubjectUploadFiles } from '@/libs/adaptive/subjectFileValidation';

type Result = {
  id: number;
  name: string;
  knowledgeCount: number;
  itemCount: number;
};

type Mode = 'text' | 'file';

// Vercel Serverless request body 上限 ~4.5MB，超過就要在前端裁切（比照 FileQuizGenerator.tsx）
const MAX_UPLOAD_SIZE = 4.5 * 1024 * 1024;

function getExt(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function NewSubjectForm() {
  const router = useRouter();
  const [topic, setTopic] = useState('');
  const [material, setMaterial] = useState('');
  const [mode, setMode] = useState<Mode>('text');
  const [files, setFiles] = useState<File[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // PDF 頁數範圍選擇器（只有上傳單一 PDF 時才會用到）
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [startPage, setStartPage] = useState(1);
  const [endPage, setEndPage] = useState(1);
  const [pageLoading, setPageLoading] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  async function handleFiles(fileList: File[]) {
    if (fileList.length === 0) {
      return;
    }
    setResult(null);
    setError(null);
    setPdfPageCount(null);

    // 前端先擋一次，跟 route 端共用同一份規則（Task 4），減少無效上傳來回
    const validation = validateSubjectUploadFiles(fileList.map(f => f.name));
    if (!validation.ok) {
      setError(validation.error);
      return;
    }

    setFiles(fileList);

    const first = fileList[0]!;
    const firstIsPdf = getExt(first.name) === 'pdf';
    if (first.size > MAX_UPLOAD_SIZE) {
      const sizeMB = (first.size / 1024 / 1024).toFixed(1);
      setError(`檔案較大（${sizeMB}MB），請選擇較少頁數，系統會自動裁切後上傳`);
    }

    if (!firstIsPdf) {
      return;
    }

    setPageLoading(true);
    try {
      // 用 minified 進入點：非壓縮 pdf.mjs 會被 Sentry wrapping loader 包壞
      const pdfjsLib = await import('pdfjs-dist/build/pdf.min.mjs');
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      const arrayBuffer = await first.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
      const total = pdf.numPages;
      setPdfPageCount(total);
      setStartPage(1);
      setEndPage(Math.min(10, total));
    } catch {
      setPdfPageCount(null);
      setError('無法自動讀取這份 PDF 的頁數，若頁數超過 20 頁，生成可能會被拒絕。建議重新整理頁面再試一次，或改上傳較短的檔案。');
    } finally {
      setPageLoading(false);
    }
  }

  async function submit() {
    if (!topic.trim() || generating) {
      return;
    }
    if (mode === 'file' && files.length === 0) {
      return;
    }

    setGenerating(true);
    setError(null);
    setResult(null);

    try {
      if (mode === 'text') {
        const res = await generateAdaptiveSubject({
          topic: topic.trim(),
          material: material.trim() || undefined,
        });
        if ('error' in res) {
          setError(res.error);
          return;
        }
        setResult(res);
        router.refresh(); // 讓清單頁的學科下拉即時更新
        return;
      }

      const fd = new FormData();
      fd.append('topic', topic.trim());

      const first = files[0]!;
      const isPdf = getExt(first.name) === 'pdf';

      // 大 PDF 且已讀到頁數：前端先裁切成小 PDF 再上傳（繞過 Vercel 4.5MB body 限制）
      if (isPdf && pdfPageCount !== null && first.size > MAX_UPLOAD_SIZE) {
        const { PDFDocument } = await import('pdf-lib');
        const srcBytes = await first.arrayBuffer();
        const srcDoc = await PDFDocument.load(srcBytes);
        const newDoc = await PDFDocument.create();
        const safeStart = Math.max(1, startPage);
        const safeEnd = Math.min(endPage, pdfPageCount);
        const indices = Array.from(
          { length: safeEnd - safeStart + 1 },
          (_, i) => safeStart - 1 + i,
        );
        const copiedPages = await newDoc.copyPages(srcDoc, indices);
        copiedPages.forEach(page => newDoc.addPage(page));
        const trimmedBytes = await newDoc.save();
        const trimmedFile = new File([trimmedBytes as BlobPart], first.name, { type: 'application/pdf' });
        fd.append('file', trimmedFile);
      } else {
        for (const f of files) {
          fd.append('file', f);
        }
        if (isPdf && pdfPageCount !== null) {
          fd.append('startPage', String(startPage));
          fd.append('endPage', String(endPage));
        }
      }

      const apiRes = await fetch('/api/ai/generate-subject-from-file', { method: 'POST', body: fd });
      const data = await apiRes.json();
      if (!apiRes.ok) {
        throw new Error(data.error || '生成失敗');
      }
      setResult(data);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  // 生成成功：顯示摘要
  if (result) {
    return (
      <div className="rounded-lg border p-6">
        <h2 className="text-lg font-semibold">✅ 學科已生成</h2>
        <p className="mt-2 text-sm">
          <strong>{result.name}</strong>
          {' '}
          — 共
          {' '}
          {result.knowledgeCount}
          {' '}
          個知識點、
          {result.itemCount}
          {' '}
          道題目。
        </p>
        <div className="mt-4 flex gap-2">
          <Link
            href="/dashboard/adaptive"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            用它建立練習 →
          </Link>
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setTopic('');
              setMaterial('');
              setFiles([]);
              setPdfPageCount(null);
            }}
            className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            再生成一個
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border p-6">
      <div className="flex flex-col gap-1">
        <label htmlFor="subject-topic" className="text-sm font-medium">單元主題</label>
        <input
          id="subject-topic"
          value={topic}
          onChange={e => setTopic(e.target.value)}
          maxLength={100}
          disabled={generating}
          placeholder="例如：二次函數、Python 字典、細胞分裂"
          className="h-10 rounded-md border px-3 text-sm"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => switchMode('text')}
          disabled={generating}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${mode === 'text' ? 'border-primary bg-primary/10 text-primary' : 'border-gray-200 text-gray-500'}`}
        >
          貼文字
        </button>
        <button
          type="button"
          onClick={() => switchMode('file')}
          disabled={generating}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${mode === 'file' ? 'border-primary bg-primary/10 text-primary' : 'border-gray-200 text-gray-500'}`}
        >
          上傳檔案
        </button>
      </div>

      {mode === 'text'
        ? (
            <div className="flex flex-col gap-1">
              <label htmlFor="subject-material" className="text-sm font-medium">
                教材內容（選填）
              </label>
              <textarea
                id="subject-material"
                value={material}
                onChange={e => setMaterial(e.target.value)}
                maxLength={20000}
                disabled={generating}
                rows={6}
                placeholder="貼上課本段落或講義文字，AI 會依此劃分知識點與出題範圍（不填則依主題自由發揮）。"
                className="rounded-md border px-3 py-2 text-sm"
              />
            </div>
          )
        : (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">教材檔案</span>
              {files.length === 0
                ? (
                    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
                    <div
                      className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-colors ${dragOver ? 'border-primary bg-primary/5' : 'border-gray-200 hover:border-primary/60'}`}
                      onClick={() => inputRef.current?.click()}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOver(true);
                      }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOver(false);
                        void handleFiles(Array.from(e.dataTransfer.files));
                      }}
                    >
                      <input
                        ref={inputRef}
                        type="file"
                        multiple
                        className="hidden"
                        accept=".pdf,.png,.jpg,.jpeg,.webp,.gif"
                        disabled={generating}
                        onChange={(e) => {
                          if (e.target.files?.length) {
                            void handleFiles(Array.from(e.target.files));
                          }
                        }}
                      />
                      <div className="mb-2 text-3xl">📂</div>
                      <p className="text-sm font-medium text-gray-700">點擊或拖曳上傳 PDF 或圖片</p>
                      <p className="mt-1 text-xs text-gray-400">單一 PDF，或多張圖片</p>
                    </div>
                  )
                : (
                    <div className="space-y-2">
                      {files.map(f => (
                        <div key={f.name} className="flex items-center gap-3 rounded-lg border p-2.5">
                          <span className="text-xl">{getExt(f.name) === 'pdf' ? '📕' : '🖼'}</span>
                          <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
                          <span className="font-mono text-xs text-gray-500">{formatSize(f.size)}</span>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          setFiles([]);
                          setPdfPageCount(null);
                          setError(null);
                        }}
                        disabled={generating}
                        className="text-xs text-gray-400 hover:text-red-500"
                      >
                        移除，重新選擇
                      </button>

                      {pageLoading && (
                        <p className="text-xs text-gray-400">⏳ 讀取 PDF 頁數中…</p>
                      )}
                      {pdfPageCount !== null && (
                        <div className="space-y-2 rounded-lg border bg-gray-50 p-3">
                          <p className="text-xs font-bold text-gray-700">
                            📄 共
                            {' '}
                            {pdfPageCount}
                            {' '}
                            頁，選擇要生成的範圍
                          </p>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
                            <span className="text-gray-600">從第</span>
                            <input
                              type="number"
                              min={1}
                              max={pdfPageCount}
                              value={startPage}
                              onChange={(e) => {
                                const v = Math.max(1, Math.min(Number(e.target.value), pdfPageCount));
                                setStartPage(v);
                                if (endPage < v) {
                                  setEndPage(v);
                                }
                              }}
                              className="w-16 rounded-lg border px-2 py-1.5 text-center text-sm"
                            />
                            <span className="text-gray-600">頁到第</span>
                            <input
                              type="number"
                              min={startPage}
                              max={pdfPageCount}
                              value={endPage}
                              onChange={(e) => {
                                const v = Math.max(startPage, Math.min(Number(e.target.value), pdfPageCount));
                                setEndPage(v);
                              }}
                              className="w-16 rounded-lg border px-2 py-1.5 text-center text-sm"
                            />
                            <span className="text-gray-600">頁</span>
                          </div>
                          <p className="text-xs text-gray-400">建議不超過 20 頁，避免超過 AI 限制</p>
                        </div>
                      )}
                    </div>
                  )}
            </div>
          )}

      {error && (
        <p className="text-sm text-red-600">
          ⚠️
          {' '}
          {error}
        </p>
      )}

      {generating && (
        <p className="text-sm text-muted-foreground">
          ⏳ AI 正在設計知識圖譜與題目，約需 1～3 分鐘，請不要關閉此頁…
        </p>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={generating || !topic.trim() || (mode === 'file' && files.length === 0)}
        className="h-10 rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {generating ? '生成中…' : '✨ 開始生成'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: lint + type check**

Run: `npx eslint --fix src/app/[locale]/\(auth\)/dashboard/adaptive/new-subject/NewSubjectForm.tsx && npm run check-types`
Expected: 無錯誤。若 ESLint 對 `<div onClick>` 的 a11y 規則有其他意見，比照 `FileQuizGenerator.tsx`
既有的 `eslint-disable-next-line` 寫法處理，不要整個拿掉互動功能。

- [ ] **Step 3: Commit**

```bash
git add "src/app/[locale]/(auth)/dashboard/adaptive/new-subject/NewSubjectForm.tsx"
git commit -m "feat(adaptive): AI 生成學科表單加入 PDF／圖片上傳"
```

---

### Task 7: 全流程驗證與收尾

**Files:**
- 無新增/修改檔案（純驗證），如驗證中發現問題才回頭修對應 task 的檔案

**Interfaces:**
- Consumes：全部前面 6 個 task 的產出
- Produces：無

- [ ] **Step 1: 跑完整測試、lint、type check**

Run: `npm run test && npm run lint && npm run check-types`
Expected: 全部 PASS，無錯誤

- [ ] **Step 2: 瀏覽器手動驗證——貼文字模式沒被動到**

`npm run dev` 起服務，開 `http://localhost:3000/dashboard/adaptive/new-subject`，確認預設在
「貼文字」模式，輸入主題（例如「二次函數」）不上傳任何檔案直接生成，確認能正常跑完、
顯示「✅ 學科已生成」摘要，且知識點/題目數量 > 0。

- [ ] **Step 3: 瀏覽器手動驗證——上傳 PDF**

切到「上傳檔案」模式，上傳一份 1~2 頁的文字型 PDF（隨便一份課本/講義截圖轉存的 PDF 即可），
輸入主題，點「開始生成」，確認：
1. 頁數選擇器有正確顯示頁數並可選範圍
2. 生成成功，摘要畫面顯示的學科名稱/知識點內容跟 PDF 內容有對應（不是憑空生成跟 PDF 無關的東西）

- [ ] **Step 4: 瀏覽器手動驗證——上傳多張圖片**

切到「上傳檔案」模式，一次選 2 張圖片（例如課本內容截圖），輸入主題，點「開始生成」，
確認生成成功且內容跟圖片有對應。

- [ ] **Step 5: 瀏覽器手動驗證——錯誤情境**

1. 「上傳檔案」模式選一個 `.docx` 或其他不支援格式：確認出現「支援 PDF、圖片格式」的錯誤訊息，
   不會讓表單卡住或送出壞請求。
2. 「上傳檔案」模式同時選 1 張圖片 + 1 份 PDF：確認出現「多檔上傳僅支援圖片格式」錯誤訊息。

- [ ] **Step 6: 如果驗證中發現問題**

回到對應的 task 修正（例如 UI 顯示問題回 Task 6、AI 生成內容跟檔案對不上回 Task 2 的
`buildUserPrompt`），修完重新跑對應 task 的測試 + 這個 Task 7 的手動驗證步驟，
不要跳過驗證直接判定完成。

- [ ] **Step 7: 最終確認 git 狀態乾淨、所有 task 都已個別 commit**

Run: `git log --oneline -8 && git status`
Expected: 看到 Task 1~6 的 6 個 commit 依序排列，`git status` 顯示 working tree clean
（沒有本次改動之外的殘留變更）。
