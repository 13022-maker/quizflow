# AI Provider 分流與備援 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 免費用戶走 Gemini、付費（isProOrAbove）走 Claude 且失敗自動 fallback Gemini；7 個 Claude 呼叫點統一換裝；生成學科頁加友善錯誤。

**Architecture:** 新增共用 helper `src/lib/ai/textModel.ts`（`generateAIText` = 付費判定 + Claude 串流聚合 + Gemini 備援），各站點只換「呼叫層」，prompt 與 JSON 解析不動。卡關家教保留 Claude 串流（付費時）與罐頭模板最後防線。

**Tech Stack:** Next.js 14、TypeScript strict、@anthropic-ai/sdk（不遷移）、@google/genai `gemini-2.5-flash`、vitest。

## Global Constraints

- UI 文字與程式碼註解一律繁體中文；識別字英文。
- 付費判定用既有 `isProOrAbove`（`src/libs/Plan.ts`，內部走 `auth()`）；無 auth context（學生端、CLI）視為 free → Gemini。
- Claude 模型名稱維持既有：`claude-sonnet-4-6`（一般）、`claude-opus-4-8`（適性學科/家教，需 `thinking: { type: 'adaptive' }`）。
- Gemini 統一 `gemini-2.5-flash`、`thinkingConfig: { thinkingBudget: 0 }`、`finishReason !== 'STOP'` 視為錯誤（比照 `generate-questions/route.ts` 既有寫法）。
- 不動 `src/app/api/ai/generate-questions/route.ts`（已有三層備援）。
- 每個 task 完成後 `npx eslint --fix <改的檔>`；最後 `npm run lint` + `npm run check-types` 需無錯。

---

### Task 1: 共用 helper `textModel.ts`

**Files:**
- Create: `src/lib/ai/textModel.ts`
- Test: `src/lib/ai/textModel.test.ts`

**Interfaces:**
- Consumes: `isProOrAbove`（`@/libs/Plan`）
- Produces（後續全部 task 依賴，簽章必須一字不差）:
  - `function resolveAIProvider(isPro: boolean, hasClaudeKey: boolean): 'claude' | 'gemini'`
  - `async function isProSafe(): Promise<boolean>`
  - `async function generateAIText(opts: { prompt: string; system?: string; claudeModel?: string; claudeThinking?: boolean; maxTokens?: number; json?: boolean }): Promise<{ text: string; usedModel: 'claude' | 'gemini' }>`

- [ ] **Step 1: Write the failing test**

建立 `src/lib/ai/textModel.test.ts`（只測純函式，不打真 API）：

```ts
import { describe, expect, it } from 'vitest';

import { resolveAIProvider } from './textModel';

describe('resolveAIProvider', () => {
  it('付費且有 Claude 金鑰 → claude', () => {
    expect(resolveAIProvider(true, true)).toBe('claude');
  });

  it('付費但無 Claude 金鑰 → gemini', () => {
    expect(resolveAIProvider(true, false)).toBe('gemini');
  });

  it('免費即使有金鑰 → gemini', () => {
    expect(resolveAIProvider(false, true)).toBe('gemini');
  });

  it('免費且無金鑰 → gemini', () => {
    expect(resolveAIProvider(false, false)).toBe('gemini');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ai/textModel.test.ts`
Expected: FAIL（檔案不存在）

- [ ] **Step 3: Write implementation**

建立 `src/lib/ai/textModel.ts`：

```ts
/**
 * textModel.ts — AI 文字生成統一入口（provider 分流與備援）
 *
 * 規則：付費（isProOrAbove）且有 ANTHROPIC_API_KEY → Claude，失敗自動 fallback Gemini；
 *       免費 / 未登入 / 無 auth context（學生端、CLI）→ 直接 Gemini。
 * 背景：2026-07-16 Anthropic 額度歸零導致所有 Claude-only 功能整頁炸，
 *       spec: docs/superpowers/specs/2026-07-16-ai-provider-fallback-design.md
 */
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';

import { isProOrAbove } from '@/libs/Plan';

type GenerateAITextOptions = {
  prompt: string; // 完整使用者 prompt（單輪文字）
  system?: string; // system prompt（Gemini 端會前綴到 prompt）
  claudeModel?: string; // 預設 claude-sonnet-4-6
  claudeThinking?: boolean; // Opus 4.8 需開 adaptive thinking
  maxTokens?: number; // 預設 4096
  json?: boolean; // true 時 Gemini 開 JSON mode
};

/** 決定首選 provider（純函式，可測） */
export function resolveAIProvider(isPro: boolean, hasClaudeKey: boolean): 'claude' | 'gemini' {
  return isPro && hasClaudeKey ? 'claude' : 'gemini';
}

/** isProOrAbove 安全版：無 auth context（學生端、CLI）時視為 free，不 throw */
export async function isProSafe(): Promise<boolean> {
  try {
    // isProOrAbove 的參數目前未使用（內部以 auth() 取得 userId）
    return await isProOrAbove('');
  } catch {
    return false;
  }
}

async function callClaude(opts: GenerateAITextOptions): Promise<string> {
  const client = new Anthropic();
  // 串流聚合避免長輸出撞 HTTP 逾時（比照 generate-subject 既有寫法）
  const stream = client.messages.stream({
    model: opts.claudeModel ?? 'claude-sonnet-4-6',
    max_tokens: opts.maxTokens ?? 4096,
    ...(opts.claudeThinking ? { thinking: { type: 'adaptive' as const } } : {}),
    ...(opts.system ? { system: opts.system } : {}),
    messages: [{ role: 'user', content: opts.prompt }],
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

async function callGemini(opts: GenerateAITextOptions): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('AI 服務未設定（缺少 GEMINI_API_KEY）');
  }
  const gemini = new GoogleGenAI({ apiKey: key });
  // Gemini 無獨立 system 欄位使用習慣（比照本專案既有寫法），前綴到 prompt
  const fullPrompt = opts.system ? `${opts.system}\n\n---\n\n${opts.prompt}` : opts.prompt;
  const response = await gemini.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
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

/**
 * 統一文字生成：付費走 Claude（失敗自動 fallback Gemini）、免費走 Gemini。
 * 兩個 provider 都失敗才 throw，讓呼叫端自己的錯誤處理接手。
 */
export async function generateAIText(
  opts: GenerateAITextOptions,
): Promise<{ text: string; usedModel: 'claude' | 'gemini' }> {
  const isPro = await isProSafe();
  const provider = resolveAIProvider(isPro, Boolean(process.env.ANTHROPIC_API_KEY?.trim()));
  if (provider === 'claude') {
    try {
      return { text: await callClaude(opts), usedModel: 'claude' };
    } catch (err) {
      console.warn('[textModel] Claude 失敗，fallback Gemini：', err instanceof Error ? err.message : err);
    }
  }
  return { text: await callGemini(opts), usedModel: 'gemini' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/ai/textModel.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: Lint 與 commit**

```bash
npx eslint --fix src/lib/ai/textModel.ts src/lib/ai/textModel.test.ts
git add src/lib/ai/textModel.ts src/lib/ai/textModel.test.ts
git commit -m "feat(ai): generateAIText 共用 helper——付費走 Claude 失敗備援 Gemini、免費走 Gemini

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 弱點分析與班級建議換裝

**Files:**
- Modify: `src/app/api/ai/analyze-weak-points/route.ts`
- Modify: `src/app/api/ai/analyze-class-performance/route.ts`

**Interfaces:**
- Consumes: `generateAIText`（Task 1）
- Produces: 無（API 回應格式不變）

- [ ] **Step 1: analyze-weak-points 換裝**

1. 刪除 `import Anthropic from '@anthropic-ai/sdk';` 與 `const client = new Anthropic();`，改加：

```ts
import { generateAIText } from '@/lib/ai/textModel';
```

2. 把 `const message = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 1024, messages: [{ role: 'user', content: \`...\` }] });` 與其後的 `const raw = (message.content[0] as ...).text ?? '';` 改為（prompt 模板字串內容**原封不動**搬進 `prompt`）：

```ts
    const { text: raw, usedModel } = await generateAIText({
      prompt: `你是一位學習分析助手。以下是這位學生答錯的題目，請分析學生可能不熟悉的知識概念，並給予 1-2 句具體的學習建議。

${questionsText}

請只回傳合法 JSON，格式如下（不要加任何說明文字）：
{
  "weakPoints": [
    { "concept": "概念名稱", "suggestion": "具體學習建議" }
  ]
}`,
      maxTokens: 1024,
      json: true,
    });
    console.warn(`[analyze-weak-points] usedModel=${usedModel}`);
```

之後既有的 `raw.match(/\{[\s\S]*\}/)` JSON 提取邏輯不動。

- [ ] **Step 2: analyze-class-performance 同樣換裝**

同 Step 1 手法：刪 Anthropic import/client，`client.messages.create` + `message.content[0].text` 改成 `generateAIText({ prompt: <原 prompt 字串原封不動>, maxTokens: 1024, json: true })`，log `usedModel`，JSON 提取不動。

- [ ] **Step 3: 型別與 lint**

Run: `npx eslint --fix src/app/api/ai/analyze-weak-points/route.ts src/app/api/ai/analyze-class-performance/route.ts && npm run check-types`
Expected: 無錯

- [ ] **Step 4: Commit**

```bash
git add src/app/api/ai/analyze-weak-points/route.ts src/app/api/ai/analyze-class-performance/route.ts
git commit -m "feat(ai): 弱點分析與班級建議改走 generateAIText 分流備援

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 補強題生成（generate-remedial）換裝

**Files:**
- Modify: `src/app/api/ai/generate-remedial/route.ts:66-98`（OpenAI/Claude 手工選擇段）

**Interfaces:**
- Consumes: `generateAIText`（Task 1）

- [ ] **Step 1: 換掉 provider 選擇段**

把「`const apiKey = process.env.OPENAI_API_KEY;` 起、到 `else { return NextResponse.json({ error: 'AI 功能尚未設定' }, { status: 503 }); }` 止」整段 OpenAI/Anthropic 手工分支刪除，改為：

```ts
    // 統一走 generateAIText：付費 Claude（失敗備援 Gemini）、免費 Gemini
    const { text: raw, usedModel } = await generateAIText({
      prompt,
      maxTokens: 2048,
      json: true,
    });
    console.warn(`[generate-remedial] usedModel=${usedModel}`);
```

檔案頂部加 `import { generateAIText } from '@/lib/ai/textModel';`，移除不再使用的 OpenAI/Anthropic 相關 import 與變數。之後的 `raw.match(/\{[\s\S]*\}/)` 與錯誤處理不動（`generateAIText` 全失敗會 throw，被既有外層 `catch (err)` 接住回 500——行為可接受）。

- [ ] **Step 2: 型別、lint、commit**

```bash
npx eslint --fix src/app/api/ai/generate-remedial/route.ts && npm run check-types
git add src/app/api/ai/generate-remedial/route.ts
git commit -m "feat(ai): 補強題生成改走 generateAIText 分流備援

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 簡答 AI 批改（gradeShortAnswer）換裝

**Files:**
- Modify: `src/lib/ai/gradeShortAnswer.ts`

**Interfaces:**
- Consumes: `generateAIText`（Task 1）
- 注意：此函式在**學生提交（未登入）**情境執行 → `isProSafe()` 回 false → 自動走 Gemini（符合設計：學生端批改用 Gemini 品質足夠）。

- [ ] **Step 1: 換裝**

刪 `import Anthropic from '@anthropic-ai/sdk';` 與 `const client = new Anthropic();`，加 `import { generateAIText } from '@/lib/ai/textModel';`。

把：

```ts
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [{ role: 'user', content: promptBody }],
  });

  const raw = (message.content[0] as { type: string; text: string }).text ?? '';
```

改為：

```ts
  const { text: raw } = await generateAIText({
    prompt: promptBody,
    maxTokens: 512,
    json: true,
  });
```

之後的 JSON 提取與 clamp 防呆不動（helper 全失敗會 throw，由上層既有「待批改」降級接手——docstring 已載明此策略）。

- [ ] **Step 2: 型別、lint、commit**

```bash
npx eslint --fix src/lib/ai/gradeShortAnswer.ts && npm run check-types
git add src/lib/ai/gradeShortAnswer.ts
git commit -m "feat(ai): 簡答批改改走 generateAIText（學生端自動 Gemini）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: AI 生成學科換裝 + 友善錯誤

**Files:**
- Modify: `src/libs/adaptive/generate-subject.ts`（`generateSubject` 函式）
- Modify: `src/actions/adaptiveActions.ts`（`generateAdaptiveSubject`）
- Modify: `src/app/[locale]/(auth)/dashboard/adaptive/new-subject/NewSubjectForm.tsx`

**Interfaces:**
- Consumes: `generateAIText`（Task 1）
- Produces: `generateAdaptiveSubject` 回傳型別改為 union：成功物件 `| { error: string }`（`NewSubjectForm` 依此顯示錯誤）

- [ ] **Step 1: generateSubject 換裝**

`generateSubject` 內部改用 helper（保留「驗證失敗重試一次」邏輯——重試時把錯誤附進 prompt）：

```ts
export async function generateSubject(topic: string, material?: string): Promise<GeneratedSubject> {
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    // 重試時附上上次的驗證錯誤，讓模型修正
    const retryNote = lastError
      ? `\n\n【上次生成有以下問題，請修正後重新生成】\n${lastError}`
      : '';
    const { text, usedModel } = await generateAIText({
      prompt: buildUserPrompt(topic, material) + retryNote,
      system: SYSTEM_PROMPT,
      claudeModel: 'claude-opus-4-8',
      claudeThinking: true,
      maxTokens: 32000,
      json: true,
    });
    console.warn(`[generate-subject] attempt=${attempt} usedModel=${usedModel}`);

    try {
      const generated = generatedSubjectSchema.parse(extractJson(text));
      // …（既有的語意驗證與 return 保持不動）
```

刪除 `new Anthropic()`、`client.messages.stream`、`stop_reason` 檢查（helper 內已處理 refusal/max_tokens）、`messages` 陣列與「把驗證錯誤 push 回 messages」的舊重試機制（由 `retryNote` 取代）。**既有的 schema 驗證、語意驗證、`lastError = ...` 賦值、兩次失敗後 throw 的邏輯全部保留**。

- [ ] **Step 2: server action 友善錯誤**

`generateAdaptiveSubject`（`src/actions/adaptiveActions.ts:123` 附近）把 AI 呼叫包 try/catch——production 的 server action throw 會被 Next.js 遮罩成 digest，必須改成回傳值：

```ts
  let generated: Awaited<ReturnType<typeof generateSubject>>;
  try {
    generated = await generateSubject(parsed.topic, parsed.material);
  } catch (err) {
    // 兩個 AI provider 都失敗（或模型拒絕）：回傳友善錯誤，不讓例外冒泡成整頁 digest error
    console.error('[generateAdaptiveSubject] AI 生成失敗：', err);
    const msg = err instanceof Error ? err.message : '';
    return {
      error: msg.includes('拒絕') || msg.includes('截斷')
        ? msg // 模型拒絕/截斷是可行動的訊息，照實顯示
        : 'AI 服務暫時無法使用，請稍後再試',
    } as const;
  }
```

- [ ] **Step 3: NewSubjectForm 處理 error 回傳**

`NewSubjectForm.tsx` 呼叫 action 處（約 33-43 行的 try 區塊內），拿到結果後加：

```ts
      const result = await generateAdaptiveSubject({ topic, material: material || undefined });
      if ('error' in result) {
        setError(result.error);
        return;
      }
```

（既有 `catch (e) { setError(...) }` 保留作最後防線；成功分支照舊使用 `result`。若 TS 對 union narrowing 報錯，在成功分支用 `result` 前已被 `'error' in result` guard 排除，應可直接通過。）

- [ ] **Step 4: 型別、lint、commit**

```bash
npx eslint --fix src/libs/adaptive/generate-subject.ts src/actions/adaptiveActions.ts "src/app/[locale]/(auth)/dashboard/adaptive/new-subject/NewSubjectForm.tsx" && npm run check-types
git add src/libs/adaptive/generate-subject.ts src/actions/adaptiveActions.ts "src/app/[locale]/(auth)/dashboard/adaptive/new-subject/NewSubjectForm.tsx"
git commit -m "feat(adaptive): AI 生成學科走分流備援 + 失敗顯示友善錯誤不再整頁炸

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 卡關家教（claude-provider）加 Gemini 中層備援

**Files:**
- Modify: `src/libs/adaptive/claude-provider.ts`（`generateLesson`、`answerAnnotation`）

**Interfaces:**
- Consumes: `generateAIText`、`isProSafe`（Task 1）
- 行為：付費 → Claude 串流（既有體驗不變）；免費/Claude 失敗 → Gemini（`onDelta` 一次收到全文，可接受的降級）；Gemini 也失敗 → 罐頭模板（既有最後防線）。

- [ ] **Step 1: generateLesson 改造**

檔案頂部加 `import { generateAIText, isProSafe } from '@/lib/ai/textModel';`。

`generateLesson` 結構改為：

```ts
  async generateLesson(
    evidence: StruggleEvidence,
    onDelta?: (text: string) => void,
  ): Promise<RemedialLesson> {
    // 付費且有金鑰才走 Claude 串流（免費用戶直接跳到 Gemini）
    if (await isProSafe() && process.env.ANTHROPIC_API_KEY?.trim()) {
      try {
        // …（既有的 client.messages.stream 整段原封不動，含 refusal/max_tokens 檢查）
        // 唯一改動：refusal / max_tokens 兩處的 `return this.fallback.generateLesson(...)`
        // 改為 throw new Error('...')，讓下方 Gemini 備援接手
      } catch (error) {
        // …（既有的錯誤分類 console.warn 保留）
        console.warn('   ⚠️ Claude 失敗，改試 Gemini');
      }
    }
    // Gemini 備援（免費用戶的主路徑）：非串流，一次回全文
    try {
      const { text } = await generateAIText({
        prompt: buildEvidencePrompt(evidence),
        system: this.lessonSystemPrompt,
        maxTokens: 16000,
      });
      onDelta?.(text); // 無串流，全文一次回呼
      return parseLessonMarkdown(text, evidence.node.id);
    } catch (err) {
      console.warn(`   ⚠️ Gemini 也失敗（${(err as Error).message}），改用模板版課文`);
      return this.fallback.generateLesson(evidence, onDelta);
    }
  }
```

注意：既有 Claude try 區塊內的成功 `return parseLessonMarkdown(...)` 保留；只把「降級出口」從模板改成 throw / fallthrough 到 Gemini 段。

- [ ] **Step 2: answerAnnotation 改造**

同樣結構：付費才走既有 Claude 串流段（refusal 處改 throw）；之後加 Gemini 備援——把多輪 messages 序列化成單一 prompt（重用既有 private helper）：

```ts
    // Gemini 備援：把問答歷史序列化成單一 prompt
    try {
      const parts: string[] = [];
      context.history.forEach((ex, i) => {
        parts.push(`【學生】${i === 0
          ? this.firstAnnotationTurn(context, ex.highlightedText, ex.question)
          : this.followUpTurn(ex.highlightedText, ex.question)}`);
        parts.push(`【導師】${ex.answer}`);
      });
      parts.push(`【學生】${context.history.length === 0
        ? this.firstAnnotationTurn(context, context.highlightedText, context.question)
        : this.followUpTurn(context.highlightedText, context.question)}`);
      const { text } = await generateAIText({
        prompt: parts.join('\n\n'),
        system: this.annotationSystemPrompt,
        maxTokens: 4096,
      });
      return text.trim();
    } catch (err) {
      console.warn(`   ⚠️ Gemini 即時回答也失敗（${(err as Error).message}），改用模板版回答`);
      return this.fallback.answerAnnotation(context);
    }
```

- [ ] **Step 3: 型別、lint、commit**

```bash
npx eslint --fix src/libs/adaptive/claude-provider.ts && npm run check-types
git add src/libs/adaptive/claude-provider.ts
git commit -m "feat(adaptive): 卡關家教加 Gemini 中層備援（付費保留 Claude 串流）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 檔案出題付費 gate + Claude 失敗備援 + 全面驗證

**Files:**
- Modify: `src/app/api/ai/generate-from-file/route.ts`

**Interfaces:**
- Consumes: `isProSafe`（Task 1）；既有 `generateWithClaude` / `generateWithGemini` 不動

- [ ] **Step 1: 免費用戶選 Claude → 靜默轉 Gemini**

檔案頂部加 `import { isProSafe } from '@/lib/ai/textModel';`。

在 `let effectiveModel: ModelChoice = isAudio ? 'gemini' : model;`（約 297 行）之後、既有金鑰檢查之前，插入：

```ts
  // 免費用戶選 Claude → 靜默轉 Gemini（付費者才走 Claude；UI 照舊可選，由 server 分流）
  if (effectiveModel === 'claude' && !(await isProSafe())) {
    console.warn('[generate-from-file] 非付費用戶選 Claude，靜默轉 Gemini');
    effectiveModel = 'gemini';
  }
```

- [ ] **Step 2: Claude 失敗 → fallback Gemini**

既有呼叫段（約 371 行）已有「GEMINI_TRUNCATED → Claude」單向備援，補上反向。把：

```ts
      raw = effectiveModel === 'claude'
        ? await generateWithClaude(media, prompt)
        : await generateWithGemini(media, prompt);
    } catch (err) {
      // Gemini 截斷自動 fallback Claude（要有 ANTHROPIC_API_KEY）
      if (err instanceof Error && err.message === 'GEMINI_TRUNCATED' && hasAnthropicKey) {
        raw = await generateWithClaude(media, prompt);
      } else {
        throw err;
      }
    }
```

改為：

```ts
      raw = effectiveModel === 'claude'
        ? await generateWithClaude(media, prompt)
        : await generateWithGemini(media, prompt);
    } catch (err) {
      if (err instanceof Error && err.message === 'GEMINI_TRUNCATED' && hasAnthropicKey) {
        // Gemini 截斷自動 fallback Claude（要有 ANTHROPIC_API_KEY）
        raw = await generateWithClaude(media, prompt);
      } else if (effectiveModel === 'claude' && hasGeminiKey && !isAudio) {
        // Claude 失敗（額度不足/過載等）→ fallback Gemini（音檔本來就只走 Gemini，不會進這裡）
        console.warn('[generate-from-file] Claude 失敗，fallback Gemini：', err instanceof Error ? err.message : err);
        raw = await generateWithGemini(media, prompt);
      } else {
        throw err;
      }
    }
```

- [ ] **Step 3: 全面驗證**

```bash
npx eslint --fix src/app/api/ai/generate-from-file/route.ts
npm run lint          # 預期 0 errors
npm run check-types   # 預期無錯
npm test              # 預期全綠（含 Task 1 的 4 個新測試）
```

- [ ] **Step 4: 手動驗證（本機 dev，Anthropic 額度目前為 0 正好是實戰情境）**

1. 登入老師帳號（試用/付費 → isPro=true）→ 弱點分析或 AI 生成學科 → server log 應出現 `Claude 失敗，fallback Gemini` 且功能正常回結果。
2. AI 生成學科填一個主題 → 成功生成；若兩個 provider 都斷，頁面顯示「AI 服務暫時無法使用」紅字而非整頁炸。
3. 檔案出題選「Claude Sonnet 4」→ 能正常出題（背後轉 Gemini）。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ai/generate-from-file/route.ts
git commit -m "feat(ai): 檔案出題付費 gate + Claude 失敗自動 fallback Gemini

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** 核心規則（helper，Task 1）✅；7 站點：generate-subject（T5）、remedial（T3）、weak-points/class-performance（T2）、gradeShortAnswer（T4）、claude-provider（T6）、generate-from-file（T7）✅；友善錯誤（T5 Step 2/3）✅；resolveAIProvider 單元測試（T1）✅；不動 generate-questions ✅。

**Placeholder scan:** 每步含實際程式碼與指令；T5/T6 中「既有段落保留」處均明確指出保留範圍與唯一改動點。

**Type consistency:** `generateAIText` / `isProSafe` / `resolveAIProvider` 簽章在 T1 定義、T2-T7 使用一致；`usedModel: 'claude' | 'gemini'` 一致。
