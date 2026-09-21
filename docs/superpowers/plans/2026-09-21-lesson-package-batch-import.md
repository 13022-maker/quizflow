# 備課包批次匯入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓老師把「備課包」JSON（6 份測驗 + 1 個單字卡集 + 教學筆記）貼進 QuizFlow，一次匯入建立，而不用手動一題一題輸入。

**Architecture:** 新增一支 Server Action `importLessonPackage`，搭配一個新頁面 `/dashboard/import`。把現在寫死在 `POST /api/quizzes/[id]/questions` 裡的「AI 題型 → DB 欄位」轉換邏輯抽成共用純函式，讓舊路由與新 action 共用同一套規則。新增 Zod schema 驗證整包 JSON。全部 DB 寫入包在單一 `db.transaction()` 裡，任何一步失敗整包 rollback。

**Tech Stack:** Next.js 14 App Router、TypeScript strict、Drizzle ORM + PostgreSQL/PGlite、Zod、Vitest、Clerk auth。

**Spec:** `docs/superpowers/specs/2026-09-21-lesson-package-batch-import-design.md`

## Global Constraints

- UI 文字、錯誤訊息、程式碼註解一律使用繁體中文；變數/函式/檔案名稱用英文（camelCase / kebab-case）
- 所有寫入操作走 Server Action，先驗證 `userId`（Clerk），用 Zod 做嚴格輸入驗證
- 這個功能只消耗**一次** AI 額度（`checkAndIncrementAiUsage`），不是每份測驗各算一次
- 限 Pro 方案使用（`isProOrAbove`），未 Pro 回傳 `PRO_REQUIRED`
- 6 份測驗 + 1 個單字卡集全部包在同一個 `db.transaction()`，任何一步失敗整包 rollback
- `teacherNotes` 不寫入資料庫，只在匯入完成畫面顯示一次
- 不做：自動套用「平均配分」、Free 方案測驗總數上限檢查、`multiple_choice` 複選題型匯入
- **測試策略**：這個 repo 目前沒有任何測試會直接連 `db`（包含 `fork-dao.ts` 的 transaction）。本計畫比照現有慣例：只對純函式（`buildQuestionInsertRows`、Zod schema）寫自動化單元測試；`importLessonPackage` 這支會碰 `db.transaction()` 的 server action 本身**不寫自動化測試**，改成最後一個任務手動開 dev server、在瀏覽器貼真實 JSON 跑一次完整流程驗證。**不要**在任何測試檔案裡 import `@/libs/DB` 或直接呼叫 `importLessonPackage`。

---

### Task 1: 抽出共用題型轉換函式 `buildQuestionInsertRows`

**Files:**
- Create: `src/lib/quiz/questionRows.ts`
- Create: `src/lib/quiz/questionRows.test.ts`
- Modify: `src/app/api/quizzes/[id]/questions/route.ts:16-169`

**Interfaces:**
- Consumes: `sanitizeStoredDiagramSvg` from `@/lib/ai/diagramSvg`、`stripOptionLabel` from `@/lib/ai/optionText`、`extractClozeAnswers` from `@/lib/cloze`、`questionSchema` from `@/models/Schema`（既有函式，簽章不變）
- Produces：
  - `type FileQuestionType = 'mc' | 'tf' | 'fill' | 'short' | 'rank' | 'listening' | 'cloze'`
  - `type GeneratedQuestion = { type: FileQuestionType; question: string; options?: string[]; answer: string | string[]; explanation?: string; listeningText?: string; audioUrl?: string; audioDurationSec?: number; imageUrl?: string; diagramSvg?: string }`
  - `type QuestionInsertRow = typeof questionSchema.$inferInsert`
  - `function buildQuestionInsertRows(questions: GeneratedQuestion[], quizId: number, startPosition: number): QuestionInsertRow[]`
  - 後續任務（Task 3）會 import 這三個型別 + 這個函式

- [ ] **Step 1: 寫會失敗的單元測試**

建立 `src/lib/quiz/questionRows.test.ts`：

```ts
// 涵蓋 mc/tf/short/fill/rank/cloze/listening 七種 type 的轉換規則
// 對齊既有 src/app/api/quizzes/[id]/questions/route.ts:98-169 的行為，抽出後不能變
import { describe, expect, it } from 'vitest';

import { buildQuestionInsertRows, type GeneratedQuestion } from './questionRows';

describe('buildQuestionInsertRows', () => {
  it('mc：answer 用字母時，依 options 順序比對出正確 id', () => {
    const rows = buildQuestionInsertRows(
      [{ type: 'mc', question: '光合作用發生在哪？', options: ['葉綠體', '粒線體', '細胞核', '液泡'], answer: 'B' }],
      1,
      1,
    );
    expect(rows[0]!.options).toEqual([
      { id: 'a', text: '葉綠體' },
      { id: 'b', text: '粒線體' },
      { id: 'c', text: '細胞核' },
      { id: 'd', text: '液泡' },
    ]);
    expect(rows[0]!.correctAnswers).toEqual(['b']);
    expect(rows[0]!.type).toBe('single_choice');
  });

  it('mc：answer 用選項文字本身時也能比對到（無字母 fallback 走文字比對）', () => {
    const rows = buildQuestionInsertRows(
      [{ type: 'mc', question: 'Q', options: ['甲', '乙', '丙', '丁'], answer: '丙' }],
      1,
      1,
    );
    expect(rows[0]!.correctAnswers).toEqual(['c']);
  });

  it('mc：options 文字帶「(A)」前綴會被去除', () => {
    const rows = buildQuestionInsertRows(
      [{ type: 'mc', question: 'Q', options: ['(A)甲', '(B)乙'], answer: 'A' }],
      1,
      1,
    );
    expect(rows[0]!.options).toEqual([
      { id: 'a', text: '甲' },
      { id: 'b', text: '乙' },
    ]);
  });

  it('tf：answer 為「正確」時，options 固定為 tf-true/tf-false，correctAnswers 為 tf-true', () => {
    const rows = buildQuestionInsertRows(
      [{ type: 'tf', question: 'Q', answer: '正確' }],
      1,
      1,
    );
    expect(rows[0]!.options).toEqual([
      { id: 'tf-true', text: '正確' },
      { id: 'tf-false', text: '錯誤' },
    ]);
    expect(rows[0]!.correctAnswers).toEqual(['tf-true']);
    expect(rows[0]!.type).toBe('true_false');
  });

  it('tf：answer 不是任何一種「真」的表示法時，視為 false', () => {
    const rows = buildQuestionInsertRows(
      [{ type: 'tf', question: 'Q', answer: '錯誤' }],
      1,
      1,
    );
    expect(rows[0]!.correctAnswers).toEqual(['tf-false']);
  });

  it('short：answer 字串直接存進 correctAnswers 單一元素陣列', () => {
    const rows = buildQuestionInsertRows(
      [{ type: 'short', question: 'Q', answer: '光合作用' }],
      1,
      1,
    );
    expect(rows[0]!.correctAnswers).toEqual(['光合作用']);
    expect(rows[0]!.type).toBe('short_answer');
    expect(rows[0]!.options).toBeNull();
  });

  it('rank：answer 文字順序對應出 correctAnswers 的 id 順序（與 options 呈現順序可以不同）', () => {
    const rows = buildQuestionInsertRows(
      [{
        type: 'rank',
        question: 'Q',
        options: ['文藝復興', '工業革命', '二次大戰'],
        answer: ['工業革命', '文藝復興', '二次大戰'],
      }],
      1,
      1,
    );
    expect(rows[0]!.options).toEqual([
      { id: 'a', text: '文藝復興' },
      { id: 'b', text: '工業革命' },
      { id: 'c', text: '二次大戰' },
    ]);
    expect(rows[0]!.correctAnswers).toEqual(['b', 'a', 'c']);
  });

  it('rank：answer 對映失敗（長度不符）時 fallback 回 options 原順序', () => {
    const rows = buildQuestionInsertRows(
      [{
        type: 'rank',
        question: 'Q',
        options: ['甲', '乙', '丙'],
        answer: ['甲', '不存在的選項'],
      }],
      1,
      1,
    );
    expect(rows[0]!.correctAnswers).toEqual(['a', 'b', 'c']);
  });

  it('cloze：correctAnswers 從 [[ ]] 標記依序解析，不看 answer 欄位', () => {
    const rows = buildQuestionInsertRows(
      [{ type: 'cloze', question: '光合作用需要[[陽光]]和[[水]]。', answer: '忽略這個值' }],
      1,
      1,
    );
    expect(rows[0]!.correctAnswers).toEqual(['陽光', '水']);
    expect(rows[0]!.type).toBe('cloze');
    expect(rows[0]!.body).toBe('光合作用需要[[陽光]]和[[水]]。');
  });

  it('cloze：完全沒有 [[ ]] 標記時退回 short_answer，避免建出空白克漏字題', () => {
    const rows = buildQuestionInsertRows(
      [{ type: 'cloze', question: '這句話沒有標記', answer: 'x' }],
      1,
      1,
    );
    expect(rows[0]!.type).toBe('short_answer');
    expect(rows[0]!.correctAnswers).toBeNull();
  });

  it('listening：跟 mc 一樣做選項比對，並存入 audioUrl/audioDurationSec/audioTranscript', () => {
    const rows = buildQuestionInsertRows(
      [{
        type: 'listening',
        question: 'Q',
        options: ['甲', '乙'],
        answer: 'A',
        audioUrl: 'https://blob.example/a.mp3',
        audioDurationSec: 12,
        listeningText: '小明說了什麼',
      }],
      1,
      1,
    );
    expect(rows[0]!.type).toBe('listening');
    expect(rows[0]!.correctAnswers).toEqual(['a']);
    expect(rows[0]!.audioUrl).toBe('https://blob.example/a.mp3');
    expect(rows[0]!.audioDurationSec).toBe(12);
    expect(rows[0]!.audioTranscript).toBe('小明說了什麼');
  });

  it('position 從 startPosition 開始逐題遞增，quizId 帶入每一列', () => {
    const questions: GeneratedQuestion[] = [
      { type: 'short', question: 'Q1', answer: 'A1' },
      { type: 'short', question: 'Q2', answer: 'A2' },
      { type: 'short', question: 'Q3', answer: 'A3' },
    ];
    const rows = buildQuestionInsertRows(questions, 42, 5);
    expect(rows.map(r => r.position)).toEqual([5, 6, 7]);
    expect(rows.every(r => r.quizId === 42)).toBe(true);
  });

  it('每題預設 points = 1', () => {
    const rows = buildQuestionInsertRows(
      [{ type: 'short', question: 'Q', answer: 'A' }],
      1,
      1,
    );
    expect(rows[0]!.points).toBe(1);
  });
});
```

- [ ] **Step 2: 執行測試，確認因為 `./questionRows` 還不存在而失敗**

Run: `npx vitest run src/lib/quiz/questionRows.test.ts`
Expected: FAIL，錯誤訊息類似 `Cannot find module './questionRows'`

- [ ] **Step 3: 建立 `src/lib/quiz/questionRows.ts`，把 `route.ts:16-169` 的邏輯原封不動搬過來，改成吃 `startPosition` 參數**

```ts
// 「AI 題型 → question 表欄位」的轉換規則。
// 原本寫死在 src/app/api/quizzes/[id]/questions/route.ts 裡，
// 抽出來讓「單一測驗匯入」跟「備課包批次匯入」共用同一套規則，不要維護兩份。
import { sanitizeStoredDiagramSvg } from '@/lib/ai/diagramSvg';
import { stripOptionLabel } from '@/lib/ai/optionText';
import { extractClozeAnswers } from '@/lib/cloze';
import type { questionSchema } from '@/models/Schema';

export type FileQuestionType = 'mc' | 'tf' | 'fill' | 'short' | 'rank' | 'listening' | 'cloze';

export type GeneratedQuestion = {
  type: FileQuestionType;
  question: string;
  options?: string[];
  answer: string | string[];
  explanation?: string;
  listeningText?: string; // 聽力題要念的口語化文字
  audioUrl?: string; // 聽力題已生成的音檔 URL
  audioDurationSec?: number; // 聽力題音檔秒數（Live Mode 計時用）
  imageUrl?: string; // 題目圖片網址
  diagramSvg?: string; // AI 自動生成的圖解 SVG(mc/tf/fill 題型才可能有)
};

export type QuestionInsertRow = typeof questionSchema.$inferInsert;

// 題型對應：AI 短碼 → DB enum
export const DB_TYPE_MAP: Record<FileQuestionType, string> = {
  mc: 'single_choice',
  tf: 'true_false',
  fill: 'short_answer',
  short: 'short_answer',
  rank: 'ranking',
  listening: 'listening',
  cloze: 'cloze',
};

/**
 * 把 AI 產生的題目陣列轉成可直接 `db.insert(questionSchema).values(rows)` 的列陣列。
 * position 從 startPosition 開始，逐題遞增（呼叫端負責算好新測驗該從幾號開始接）。
 */
export function buildQuestionInsertRows(
  questions: GeneratedQuestion[],
  quizId: number,
  startPosition: number,
): QuestionInsertRow[] {
  let position = startPosition;

  return questions.map((q) => {
    let type = (DB_TYPE_MAP[q.type] ?? 'short_answer') as QuestionInsertRow['type'];
    let options: { id: string; text: string }[] | null = null;
    let correctAnswers: string[] = [];

    if (q.type === 'cloze') {
      // 克漏字題：body 直接是 AI 回傳含 [[詞彙]] 標記的文章，答案從標記反推
      correctAnswers = extractClozeAnswers(q.question);
      // 防呆：AI 沒標記任何空格就退回簡答題，避免建出空白克漏字題
      if (correctAnswers.length === 0) {
        type = 'short_answer' as QuestionInsertRow['type'];
      }
    } else if ((q.type === 'mc' || q.type === 'listening') && q.options?.length) {
      // 選擇題：將 string[] 轉成 { id, text }[]
      options = q.options.map((text, i) => ({
        id: String.fromCharCode(97 + i), // a, b, c, d
        text: stripOptionLabel(text),
      }));
      // answer 可能是 "A"/"B" 大寫字母，或選項文字本身
      const ansStr = typeof q.answer === 'string' ? q.answer : '';
      const answerKey = ansStr.trim().toLowerCase();
      const byLetter = options.find(o => o.id === answerKey);
      const byText = options.find(o => o.text === stripOptionLabel(ansStr));
      const matched = byLetter ?? byText;
      correctAnswers = matched ? [matched.id] : [];
    } else if (q.type === 'rank' && q.options?.length) {
      // 排序題：每個選項配 id，correctAnswers 為依 q.answer 文字順序對映的 id 陣列
      options = q.options.map((text, i) => ({
        id: String.fromCharCode(97 + i),
        text: stripOptionLabel(text),
      }));
      const answerArr = Array.isArray(q.answer) ? q.answer : [];
      correctAnswers = answerArr
        .map(ansText => options!.find(o => o.text === stripOptionLabel(ansText))?.id)
        .filter((id): id is string => Boolean(id));
      // AI 幻覺保險：若對映失敗，回退到輸入順序當正解
      if (correctAnswers.length !== options.length) {
        correctAnswers = options.map(o => o.id);
      }
    } else if (q.type === 'tf') {
      // 是非題：將 AI 回傳的 ○/✕ 轉換為標準選項 ID
      options = [
        { id: 'tf-true', text: '正確' },
        { id: 'tf-false', text: '錯誤' },
      ];
      const ansStr = typeof q.answer === 'string' ? q.answer.trim() : '';
      const isTrue = ansStr === '○' || ansStr === 'O' || ansStr.toLowerCase() === 'true' || ansStr === '正確';
      correctAnswers = [isTrue ? 'tf-true' : 'tf-false'];
    } else {
      // 填空 / 簡答：直接存 answer 字串
      const ansStr = typeof q.answer === 'string' ? q.answer : '';
      correctAnswers = ansStr ? [ansStr] : [];
    }

    return {
      quizId,
      type,
      body: q.question,
      imageUrl: q.imageUrl || null,
      diagramSvg: sanitizeStoredDiagramSvg(q.diagramSvg),
      options,
      correctAnswers: correctAnswers.length ? correctAnswers : null,
      audioUrl: q.audioUrl || null,
      audioDurationSec: q.audioDurationSec ?? null,
      audioTranscript: q.listeningText || null,
      explanation: q.explanation || null,
      points: 1,
      position: position++,
    };
  });
}
```

- [ ] **Step 4: 執行測試，確認全部通過**

Run: `npx vitest run src/lib/quiz/questionRows.test.ts`
Expected: PASS，14 個測試全綠

- [ ] **Step 5: 讓既有路由改用這個共用函式（純重構，行為不變）**

把 `src/app/api/quizzes/[id]/questions/route.ts` 開頭的 `FileQuestionType`/`GeneratedQuestion`/`DB_TYPE_MAP` 型別定義，以及第 98-169 行整段 `questions.map(...)` 邏輯，改成：

```ts
import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { buildQuestionInsertRows, type GeneratedQuestion } from '@/lib/quiz/questionRows';
import { questionSchema, quizSchema } from '@/models/Schema';
import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';

// 依 CLAUDE.md 規範：所有 API Route 最頂端加 runtime = 'nodejs'
export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  const quizId = Number(params.id);
  if (Number.isNaN(quizId)) {
    return NextResponse.json({ error: '無效的測驗 ID' }, { status: 400 });
  }

  const [quiz] = await db
    .select({ id: quizSchema.id, ownerId: quizSchema.ownerId })
    .from(quizSchema)
    .where(eq(quizSchema.id, quizId))
    .limit(1);

  if (!quiz) {
    console.warn('[api/quizzes/questions POST] quiz not found', { quizId, userId });
    return NextResponse.json({ error: '找不到測驗' }, { status: 404 });
  }
  if (quiz.ownerId !== userId) {
    console.warn('[api/quizzes/questions POST] ownership mismatch', {
      quizId,
      sessionUserId: userId,
      quizOwnerId: quiz.ownerId,
    });
    return NextResponse.json({ error: '無權限操作此測驗' }, { status: 403 });
  }

  const body = await request.json();
  const questions: GeneratedQuestion[] = body.questions ?? [];

  if (!questions.length) {
    return NextResponse.json({ error: '沒有題目可匯入' }, { status: 400 });
  }

  const existing = await db
    .select({ position: questionSchema.position })
    .from(questionSchema)
    .where(eq(questionSchema.quizId, quizId));

  const nextPosition = existing.length > 0
    ? Math.max(...existing.map(q => q.position)) + 1
    : 1;

  const rows = buildQuestionInsertRows(questions, quizId, nextPosition);

  await db.insert(questionSchema).values(rows);

  revalidatePath(`/dashboard/quizzes/${quizId}/edit`);

  return NextResponse.json({ count: rows.length });
}
```

（保留原本的中文註解與 import 排序慣例；上面只列出改動後的完整檔案內容方便比對，實際編輯時用既有檔案做局部替換即可，不要動到 import 排序以外的行為。）

- [ ] **Step 6: 確認型別檢查與既有測試都過**

Run: `npm run check-types && npx vitest run src/lib/quiz/questionRows.test.ts`
Expected: 都是 0 error / 14 tests passed

- [ ] **Step 7: Commit**

```bash
git add src/lib/quiz/questionRows.ts src/lib/quiz/questionRows.test.ts src/app/api/quizzes/\[id\]/questions/route.ts
git commit -m "$(cat <<'EOF'
refactor(quiz): 抽出題型轉換邏輯為共用函式 buildQuestionInsertRows

把 POST /api/quizzes/[id]/questions 裡的「AI 題型 → DB 欄位」轉換邏輯抽成
純函式並補上單元測試，讓備課包批次匯入功能可以共用同一套規則。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 備課包 JSON 的 Zod schema

**Files:**
- Create: `src/lib/ai/lessonPackageSchema.ts`
- Create: `src/lib/ai/lessonPackageSchema.test.ts`

**Interfaces:**
- Consumes: 無（純 Zod schema，不依賴其他任務的程式碼）
- Produces：
  - `const lessonPackageSchema: z.ZodType<LessonPackage>`
  - `type LessonPackage = { quizzes: { stage?: string; title: string; questions: LessonPackageQuestion[] }[]; flashcards: { title: string; cards: { front: string; back: string; example?: string }[] }; teacherNotes: { flow?: string; misconceptions?: string[]; afterClass?: string } }`
  - `type LessonPackageQuestion`（跟 Task 1 的 `GeneratedQuestion` 欄位一致：`type/question/options/answer/explanation/...`）
  - `function formatLessonPackageErrors(error: z.ZodError): { path: string; message: string }[]`
  - Task 3 會 import `lessonPackageSchema`、`formatLessonPackageErrors`、`type LessonPackage`

- [ ] **Step 1: 寫會失敗的單元測試**

建立 `src/lib/ai/lessonPackageSchema.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { formatLessonPackageErrors, lessonPackageSchema } from './lessonPackageSchema';

const validPackage = {
  quizzes: [
    {
      stage: 'pretest',
      title: '診斷測驗 - 光合作用',
      questions: [
        { type: 'mc', question: '光合作用發生在哪？', options: ['葉綠體', '粒線體', '細胞核', '液泡'], answer: 'A', explanation: '葉綠體含葉綠素' },
      ],
    },
    {
      stage: 'deepen',
      title: '深化排序 - 光合作用',
      questions: [
        { type: 'rank', question: '請依步驟排列光合作用流程', options: ['吸收陽光', '固定二氧化碳', '產生葡萄糖'], answer: ['吸收陽光', '固定二氧化碳', '產生葡萄糖'], explanation: '' },
      ],
    },
  ],
  flashcards: {
    title: '詞彙卡 - 光合作用',
    cards: [{ front: '葉綠素', back: '吸收光能的色素', example: '葉綠素讓葉子呈現綠色' }],
  },
  teacherNotes: {
    flow: '5分鐘|前測|pretest|巡堂',
    misconceptions: ['以為光合作用只在白天發生'],
    afterClass: '匯出成績給科任老師',
  },
};

describe('lessonPackageSchema', () => {
  it('合法的完整備課包可以通過驗證', () => {
    const result = lessonPackageSchema.safeParse(validPackage);
    expect(result.success).toBe(true);
  });

  it('缺少 quizzes 欄位時驗證失敗', () => {
    const { quizzes, ...rest } = validPackage;
    const result = lessonPackageSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('quizzes 為空陣列時驗證失敗', () => {
    const result = lessonPackageSchema.safeParse({ ...validPackage, quizzes: [] });
    expect(result.success).toBe(false);
  });

  it('rank 題型的 answer 陣列長度跟 options 不一致時驗證失敗', () => {
    const bad = {
      ...validPackage,
      quizzes: [
        {
          title: '測驗',
          questions: [
            { type: 'rank', question: 'Q', options: ['甲', '乙', '丙'], answer: ['甲', '乙'] },
          ],
        },
      ],
    };
    const result = lessonPackageSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('cloze 題型的 question 沒有 [[ ]] 標記時驗證失敗', () => {
    const bad = {
      ...validPackage,
      quizzes: [
        {
          title: '測驗',
          questions: [
            { type: 'cloze', question: '這句話沒有標記任何詞彙', answer: '忽略' },
          ],
        },
      ],
    };
    const result = lessonPackageSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('cloze 題型有 [[ ]] 標記時可以通過驗證（不需要 answer/options）', () => {
    const ok = {
      ...validPackage,
      quizzes: [
        {
          title: '測驗',
          questions: [
            { type: 'cloze', question: '光合作用需要[[陽光]]。' },
          ],
        },
      ],
    };
    const result = lessonPackageSchema.safeParse(ok);
    expect(result.success).toBe(true);
  });

  it('flashcards.cards 為空陣列時驗證失敗', () => {
    const bad = { ...validPackage, flashcards: { title: '詞彙卡', cards: [] } };
    const result = lessonPackageSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('type 不是允許的短碼時驗證失敗', () => {
    const bad = {
      ...validPackage,
      quizzes: [
        { title: '測驗', questions: [{ type: 'multiple_choice', question: 'Q', answer: 'A' }] },
      ],
    };
    const result = lessonPackageSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('formatLessonPackageErrors 回傳可讀的 path + message 清單', () => {
    const bad = { ...validPackage, quizzes: [] };
    const result = lessonPackageSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = formatLessonPackageErrors(result.error);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toHaveProperty('path');
      expect(errors[0]).toHaveProperty('message');
    }
  });
});
```

- [ ] **Step 2: 執行測試，確認因為 `./lessonPackageSchema` 還不存在而失敗**

Run: `npx vitest run src/lib/ai/lessonPackageSchema.test.ts`
Expected: FAIL，錯誤訊息類似 `Cannot find module './lessonPackageSchema'`

- [ ] **Step 3: 建立 `src/lib/ai/lessonPackageSchema.ts`**

```ts
// 老師貼進 /dashboard/import 的「備課包」JSON 結構驗證。
// 對應 docs/prompts/lesson-prep-assistant.md 產出的格式，
// 題目欄位跟 src/lib/quiz/questionRows.ts 的 GeneratedQuestion 對齊（同一套匯入邏輯共用）。
import { z } from 'zod';

const questionTypeValues = ['mc', 'tf', 'fill', 'short', 'rank', 'listening', 'cloze'] as const;

const CLOZE_MARKER_REGEX = /\[\[[^[\]]+\]\]/;

const baseQuestionSchema = z.object({
  type: z.enum(questionTypeValues),
  question: z.string().min(1, '題目內容不可為空'),
  options: z.array(z.string()).optional(),
  answer: z.union([z.string(), z.array(z.string())]).optional(),
  explanation: z.string().optional(),
  listeningText: z.string().optional(),
  audioUrl: z.string().optional(),
  audioDurationSec: z.number().optional(),
  imageUrl: z.string().optional(),
  diagramSvg: z.string().optional(),
});

export const lessonPackageQuestionSchema = baseQuestionSchema.superRefine((q, ctx) => {
  if (q.type === 'rank') {
    if (!Array.isArray(q.answer)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'rank 題型的 answer 必須是陣列',
        path: ['answer'],
      });
    } else if (!q.options || q.answer.length !== q.options.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'rank 題型的 answer 陣列長度必須跟 options 一致',
        path: ['answer'],
      });
    }
  }

  if (q.type === 'cloze' && !CLOZE_MARKER_REGEX.test(q.question)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'cloze 題型的 question 必須至少包含一組 [[ ]] 標記',
      path: ['question'],
    });
  }
});

export type LessonPackageQuestion = z.infer<typeof baseQuestionSchema>;

const quizEntrySchema = z.object({
  stage: z.string().optional(),
  title: z.string().min(1, '測驗標題不可為空'),
  questions: z.array(lessonPackageQuestionSchema).min(1, '每份測驗至少要有一題'),
});

const flashcardSchema = z.object({
  front: z.string().min(1, '單字卡正面不可為空'),
  back: z.string().min(1, '單字卡背面不可為空'),
  example: z.string().optional(),
});

const flashcardSetSchema = z.object({
  title: z.string().min(1, '單字卡集標題不可為空'),
  cards: z.array(flashcardSchema).min(1, '單字卡集至少要有一張卡'),
});

const teacherNotesSchema = z.object({
  flow: z.string().optional(),
  misconceptions: z.array(z.string()).optional(),
  afterClass: z.string().optional(),
});

export const lessonPackageSchema = z.object({
  quizzes: z.array(quizEntrySchema).min(1, '至少要有一份測驗'),
  flashcards: flashcardSetSchema,
  teacherNotes: teacherNotesSchema,
});

export type LessonPackage = z.infer<typeof lessonPackageSchema>;

/** 把 ZodError 轉成適合直接顯示給老師看的 { path, message } 清單 */
export function formatLessonPackageErrors(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map(issue => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}
```

- [ ] **Step 4: 執行測試，確認全部通過**

Run: `npx vitest run src/lib/ai/lessonPackageSchema.test.ts`
Expected: PASS，9 個測試全綠

- [ ] **Step 5: 型別檢查**

Run: `npm run check-types`
Expected: 0 error

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/lessonPackageSchema.ts src/lib/ai/lessonPackageSchema.test.ts
git commit -m "$(cat <<'EOF'
feat(ai): 新增備課包 JSON 的 Zod 驗證 schema

驗證老師貼進備課包匯入頁的 JSON 結構，包含 rank 題型 answer/options
長度一致、cloze 題型必須有 [[ ]] 標記等規則，並提供可讀錯誤訊息。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Server Action `importLessonPackage`

**Files:**
- Create: `src/actions/lessonPackageActions.ts`

**Interfaces:**
- Consumes:
  - `buildQuestionInsertRows(questions, quizId, startPosition)` from `@/lib/quiz/questionRows`（Task 1）
  - `lessonPackageSchema`、`formatLessonPackageErrors` from `@/lib/ai/lessonPackageSchema`（Task 2）
  - `checkAndIncrementAiUsage(userId)` from `@/actions/aiUsageActions`（既有）
  - `isProOrAbove(userId)` from `@/libs/Plan`（既有）
  - `db` from `@/libs/DB`、`quizSchema`/`questionSchema`/`vocabSetSchema`/`vocabCardSchema` from `@/models/Schema`（既有）
- Produces:
  - `type ImportLessonPackageResult = { quizzes: { id: number; title: string }[]; vocabSetId: number; vocabTitle: string; teacherNotes: { flow?: string; misconceptions?: string[]; afterClass?: string } } | { error: string; detail?: { path: string; message: string }[] }`
  - `async function importLessonPackage(rawJson: string): Promise<ImportLessonPackageResult>`
  - Task 4（頁面）會 import `importLessonPackage`、`type ImportLessonPackageResult`

- [ ] **Step 1: 建立 `src/actions/lessonPackageActions.ts`**

（這支會碰 `db.transaction()`，依 Global Constraints 不寫自動化測試，改在 Task 5 手動驗證）

```ts
'use server';

import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { checkAndIncrementAiUsage } from '@/actions/aiUsageActions';
import { formatLessonPackageErrors, lessonPackageSchema } from '@/lib/ai/lessonPackageSchema';
import { buildQuestionInsertRows } from '@/lib/quiz/questionRows';
import { db } from '@/libs/DB';
import { isProOrAbove } from '@/libs/Plan';
import { questionSchema, quizSchema, vocabCardSchema, vocabSetSchema } from '@/models/Schema';

// 6 碼大寫英數房間碼；邏輯跟 src/actions/quizActions.ts 的 generateRoomCode 一致。
// 獨立複製一份而不是 import quizActions（避免匯入一支帶 CreateQuizSchema/redirect 的
// 'use server' 檔案，多拉不需要的相依）；未來若第三處要用再抽到共用 lib。
function generateRoomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function generateUniqueRoomCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode();
    const [existing] = await db
      .select({ id: quizSchema.id })
      .from(quizSchema)
      .where(eq(quizSchema.roomCode, code))
      .limit(1);
    if (!existing) {
      return code;
    }
  }
  return generateRoomCode() + generateRoomCode().slice(0, 1);
}

export type ImportLessonPackageResult =
  | {
      quizzes: { id: number; title: string }[];
      vocabSetId: number;
      vocabTitle: string;
      teacherNotes: { flow?: string; misconceptions?: string[]; afterClass?: string };
    }
  | { error: string; detail?: { path: string; message: string }[] };

export async function importLessonPackage(rawJson: string): Promise<ImportLessonPackageResult> {
  const { userId } = await auth();
  if (!userId) {
    return { error: '未登入' };
  }

  if (!(await isProOrAbove(userId))) {
    return { error: 'PRO_REQUIRED' };
  }

  const quota = await checkAndIncrementAiUsage(userId);
  if (!quota.allowed) {
    return { error: 'QUOTA_EXCEEDED' };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawJson);
  } catch (err) {
    return { error: `JSON 格式錯誤：${err instanceof Error ? err.message : '無法解析'}` };
  }

  const parsed = lessonPackageSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { error: '備課包內容格式不正確', detail: formatLessonPackageErrors(parsed.error) };
  }

  const pkg = parsed.data;

  // 先在 transaction 外準備好每份測驗要用的房間碼/access code（跟 src/libs/fork-dao.ts
  // 的慣例一致：唯一性檢查用一般查詢，不需要放進 transaction 裡）
  const quizCodes: { roomCode: string; accessCode: string }[] = [];
  for (let i = 0; i < pkg.quizzes.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    quizCodes.push({ roomCode: await generateUniqueRoomCode(), accessCode: nanoid(8) });
  }

  const created = await db.transaction(async (tx) => {
    const createdQuizzes: { id: number; title: string }[] = [];

    for (let i = 0; i < pkg.quizzes.length; i++) {
      const quizEntry = pkg.quizzes[i]!;
      const codes = quizCodes[i]!;

      // eslint-disable-next-line no-await-in-loop
      const [insertedQuiz] = await tx
        .insert(quizSchema)
        .values({
          ownerId: userId,
          title: quizEntry.title,
          accessCode: codes.accessCode,
          roomCode: codes.roomCode,
          quizMode: 'standard',
        })
        .returning();

      if (!insertedQuiz) {
        throw new Error('建立測驗失敗');
      }

      const rows = buildQuestionInsertRows(quizEntry.questions, insertedQuiz.id, 1);
      // eslint-disable-next-line no-await-in-loop
      await tx.insert(questionSchema).values(rows);

      createdQuizzes.push({ id: insertedQuiz.id, title: insertedQuiz.title });
    }

    const [insertedVocabSet] = await tx
      .insert(vocabSetSchema)
      .values({
        ownerId: userId,
        title: pkg.flashcards.title,
        accessCode: nanoid(8),
        status: 'published',
      })
      .returning();

    if (!insertedVocabSet) {
      throw new Error('建立單字卡集失敗');
    }

    await tx.insert(vocabCardSchema).values(
      pkg.flashcards.cards.map((card, i) => ({
        setId: insertedVocabSet.id,
        front: card.front,
        back: card.back,
        example: card.example ?? null,
        position: i,
      })),
    );

    return {
      quizzes: createdQuizzes,
      vocabSetId: insertedVocabSet.id,
      vocabTitle: insertedVocabSet.title,
    };
  });

  return {
    ...created,
    teacherNotes: pkg.teacherNotes,
  };
}
```

- [ ] **Step 2: 型別檢查 + lint**

Run: `npm run check-types && npm run lint`
Expected: 0 error（`no-await-in-loop` 已用行內 eslint-disable 處理，因為每份測驗的房間碼/題目插入本來就要照順序執行，不能 `Promise.all`）

- [ ] **Step 3: Commit**

```bash
git add src/actions/lessonPackageActions.ts
git commit -m "$(cat <<'EOF'
feat(quiz): 新增 importLessonPackage server action

驗證備課包 JSON 後，在單一 db.transaction() 裡建立 6 份測驗 + 1 個單字卡集，
任一步失敗整包 rollback。限 Pro 方案使用，整包只消耗一次 AI 額度。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 新頁面 `/dashboard/import`

**Files:**
- Create: `src/app/[locale]/(auth)/dashboard/import/page.tsx`

**Interfaces:**
- Consumes: `importLessonPackage(rawJson)` + `type ImportLessonPackageResult` from `@/actions/lessonPackageActions`（Task 3）、`Button` from `@/components/ui/button`
- Produces: 無其他任務依賴這個頁面的匯出

- [ ] **Step 1: 建立頁面元件**

```tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { importLessonPackage } from '@/actions/lessonPackageActions';
import { Button } from '@/components/ui/button';

export default function ImportLessonPackagePage() {
  const router = useRouter();
  const [rawJson, setRawJson] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<{ path: string; message: string }[]>([]);
  const [result, setResult] = useState<Extract<Awaited<ReturnType<typeof importLessonPackage>>, { quizzes: unknown }> | null>(null);

  const handleSubmit = async () => {
    if (!rawJson.trim()) {
      return;
    }
    setSubmitting(true);
    setError('');
    setDetail([]);
    setResult(null);

    const res = await importLessonPackage(rawJson);

    if ('error' in res) {
      if (res.error === 'PRO_REQUIRED' || res.error === 'QUOTA_EXCEEDED') {
        router.push('/dashboard/billing');
        return;
      }
      setError(res.error);
      setDetail(res.detail ?? []);
      setSubmitting(false);
      return;
    }

    setResult(res);
    setSubmitting(false);
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <Link href="/dashboard/quizzes" className="text-sm text-muted-foreground hover:text-foreground">
          ← 返回測驗列表
        </Link>
        <h1 className="mt-2 text-xl font-bold">批次匯入備課包</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          把
          {' '}
          <code className="rounded bg-gray-100 px-1">docs/prompts/lesson-prep-assistant.md</code>
          {' '}
          的 prompt 貼到外部 AI 聊天工具，把產出的 JSON 貼在下面，一次建立 6 份測驗 + 1 個單字卡集。
        </p>
      </div>

      {!result && (
        <>
          <textarea
            value={rawJson}
            onChange={e => setRawJson(e.target.value)}
            placeholder="貼上 AI 產生的完整 JSON"
            rows={14}
            className="w-full resize-none rounded-xl border px-4 py-3 font-mono text-xs placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
              <p className="font-medium">{error}</p>
              {detail.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {detail.map(d => (
                    <li key={d.path}>
                      {d.path}
                      {'：'}
                      {d.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <Button
            onClick={handleSubmit}
            disabled={submitting || !rawJson.trim()}
            className="mt-4 w-full"
          >
            {submitting ? '匯入中…' : '批次匯入'}
          </Button>
        </>
      )}

      {result && (
        <div className="space-y-6">
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">
            匯入完成，共建立
            {' '}
            {result.quizzes.length}
            {' '}
            份測驗 + 1 個單字卡集。
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold">測驗</h2>
            <ul className="space-y-1">
              {result.quizzes.map(q => (
                <li key={q.id}>
                  <Link href={`/dashboard/quizzes/${q.id}/edit`} className="text-sm text-blue-600 hover:underline">
                    {q.title}
                    {' '}
                    ↗
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold">單字卡集</h2>
            <Link href="/dashboard/vocab" className="text-sm text-blue-600 hover:underline">
              {result.vocabTitle}
              {' '}
              ↗
            </Link>
          </div>

          {(result.teacherNotes.flow || result.teacherNotes.misconceptions?.length || result.teacherNotes.afterClass) && (
            <div className="rounded-lg border bg-gray-50 p-4 text-sm">
              <p className="mb-2 font-semibold text-amber-600">⚠️ 教學筆記只顯示這一次，請自行複製保存</p>
              {result.teacherNotes.flow && (
                <pre className="mb-3 whitespace-pre-wrap font-sans">{result.teacherNotes.flow}</pre>
              )}
              {result.teacherNotes.misconceptions && result.teacherNotes.misconceptions.length > 0 && (
                <ul className="mb-3 list-disc space-y-1 pl-5">
                  {result.teacherNotes.misconceptions.map(m => <li key={m}>{m}</li>)}
                </ul>
              )}
              {result.teacherNotes.afterClass && <p>{result.teacherNotes.afterClass}</p>}
            </div>
          )}

          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              setResult(null);
              setRawJson('');
            }}
          >
            再匯入一份
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 型別檢查 + lint**

Run: `npm run check-types && npm run lint`
Expected: 0 error

- [ ] **Step 3: Commit**

```bash
git add src/app/\[locale\]/\(auth\)/dashboard/import/page.tsx
git commit -m "$(cat <<'EOF'
feat(quiz): 新增備課包批次匯入頁面 /dashboard/import

貼上 JSON、呼叫 importLessonPackage，成功顯示測驗/單字卡集連結與教學筆記，
Pro/額度不足時導向 billing，格式錯誤時列出逐題錯誤清單。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Dashboard 入口連結 + 手動端到端驗證

**Files:**
- Modify: `src/app/[locale]/(auth)/dashboard/quizzes/page.tsx:147-152`

**Interfaces:**
- Consumes: 無新介面
- Produces: 無（純 UI 連結 + 手動驗證，這是本計畫最後一個任務）

- [ ] **Step 1: 在「建立測驗」按鈕旁加入次要連結**

在 `src/app/[locale]/(auth)/dashboard/quizzes/page.tsx` 第 147-152 行（`手動建立 ↗` 那個 `<Link>`）後面加一行：

```tsx
                <Link
                  href="/dashboard/quizzes/new"
                  className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  手動建立 ↗
                </Link>
                <Link
                  href="/dashboard/import"
                  className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  批次匯入備課包 ↗
                </Link>
```

- [ ] **Step 2: 型別檢查 + lint**

Run: `npm run check-types && npm run lint`
Expected: 0 error

- [ ] **Step 3: Commit**

```bash
git add src/app/\[locale\]/\(auth\)/dashboard/quizzes/page.tsx
git commit -m "$(cat <<'EOF'
feat(quiz): 測驗列表頁加入「批次匯入備課包」入口連結

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: 執行完整自動化驗證（跑 build + 全部測試）**

Run: `npm run check-types && npm run lint && npm run test && npm run build`
Expected: 全部 0 error / 0 failing tests / build 成功。把實際輸出貼出來確認才能算過（照 verification-before-completion skill：宣稱完成前一定要在當下這則訊息貼出驗證指令的輸出）。

- [ ] **Step 5: 手動開 dev server，在瀏覽器跑一次完整流程**

Run: `npm run dev`（背景執行）

在瀏覽器：
1. 登入一個 Pro 方案的測試帳號（或用 VIP 白名單帳號），前往 `/dashboard/quizzes`
2. 點「批次匯入備課包 ↗」，確認導到 `/dashboard/import`
3. 貼一份小型測試 JSON（至少 2 份 quiz、每份 1-2 題、涵蓋 mc/tf/rank/cloze 幾種 type、1 個 flashcards.cards），按「批次匯入」
4. 確認畫面顯示「匯入完成」+ 正確數量的測驗連結 + 單字卡集連結 + 教學筆記
5. 點進其中一份測驗連結，確認題目、選項、正確答案都跟貼進去的 JSON 一致（特別檢查 tf 題選項是「正確/錯誤」、rank 題選項順序、cloze 題挖空是否正確）
6. 前往 `/dashboard/vocab`，確認新單字卡集跟卡片內容正確
7. 刻意貼一份格式錯誤的 JSON（例如 rank 題 answer 長度不符），確認畫面顯示清楚的錯誤訊息，且沒有建立任何測驗/單字卡集（去 `/dashboard/quizzes` 確認數量沒變化，驗證 transaction rollback 有效）
8. 若有非 Pro 測試帳號，確認點擊匯入會被導向 `/dashboard/billing`

把這 8 點的實際結果回報出來，全部通過才算完成這個功能。

---

## Self-Review 紀錄

- **Spec coverage**：架構（Task 1+3）、資料流（Task 3 步驟順序跟 spec 一致）、錯誤處理表格（Task 3 的 `PRO_REQUIRED`/`QUOTA_EXCEEDED`/JSON 錯誤/Zod 錯誤/DB 錯誤 全部對應）、入口位置（Task 5）都各有對應任務。測試計畫依核准後的調整（只測純函式）反映在 Task 1/2 的單元測試 + Task 5 的手動驗證清單。
- **Placeholder scan**：所有 code block 都是完整可執行內容，無 TBD/TODO。
- **Type consistency**：`GeneratedQuestion`（Task 1）與 `LessonPackageQuestion`（Task 2）欄位一致；`ImportLessonPackageResult`（Task 3）在 Task 4 用 `Extract<Awaited<ReturnType<typeof importLessonPackage>>, { quizzes: unknown }>` 取成功分支型別，沒有重複定義一份不同名的型別。
