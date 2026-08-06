# 克漏字題（cloze）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增第 7 種題型「克漏字題」（cloze）：老師貼一段文章，用 `[[詞彙]]` 標記要挖空的重點（可手動指定、也可按鈕隨機挑選），學生在文章中直接填空作答，每個空格獨立批改、依對錯比例算部分分。

**Architecture:** 沿用既有 `question`/`answer` 表結構，不新增欄位——`body` 直接存含 `[[ ]]` 標記的原始文章（老師可重複編輯），`correctAnswers`（既有 jsonb `string[]`）改由伺服器端從 `body` 解析出來，`answer`（學生作答，既有 jsonb `string | string[]`）沿用 `string[]` 分支、依文章順序一格一個字串。批改邏輯是純規則字串比對（trim + 大小寫不敏感），不叫 AI，也沒有「隨機」用 AI 的路——隨機挑空是前端純規則的簡單演算法。所有解析/批改邏輯集中在新檔 `src/lib/cloze.ts`，教師編輯器與學生作答元件都是這個檔案的 consumer，避免邏輯分散。

**Tech Stack:** Next.js 14 App Router + TypeScript strict + Drizzle ORM/Postgres + React Hook Form + Zod + Vitest。沒有新依賴。

## Global Constraints

- UI 文字、註解一律繁體中文；變數/函式/檔名英文 camelCase / PascalCase（元件檔）。
- 這個題型的 UI 文字**跟其他 6 種既有題型一致，直接寫死繁體中文**，不新增 i18n key（`QuestionForm.tsx`/`QuizTaker.tsx` 目前完全沒有走 `useTranslations`，新增這一種題型才走會造成風格不一致——這是跟需求方確認過的決定）。
- Schema 改動後必須 `npm run db:generate` 並 commit migration；**產生後務必打開 SQL 檔手動檢查**，這個 repo 的 migration snapshot 曾經脫鉤（0015-0017 缺 snapshot），可能把不相關的既有改動也塞進新 migration，只保留 `ALTER TYPE ... ADD VALUE 'cloze'` 這一行。
- 批改方式：**純規則精準比對**（trim + 大小寫不敏感），不用 AI。空格挑選：**純規則**（英文/數字詞 + 標點分隔的 2–4 字中文詞組），不用 AI。兩者皆為使用者確認過的 MVP 範圍。
- 每個空格獨立比對，整題部分分 = `round(該題配分 × 答對空格數 / 總空格數)`；`isCorrect`（全對才 true）只在有空格時才有意義。
- 不做的事（MVP 明確排除，之後再看）：AI 輔助挑空、AI 輔助批改、老師人工複核 cloze（`gradeShortAnswerByTeacher` 目前只認 `short_answer`，不擴充）、AI 出題（`generate-questions` 等三條 AI 出題流程的 `'fill'` 偽題型維持塞進 `short_answer`，不改去對接 `cloze`）、結果頁逐格對錯的行內標色（用既有的「你的答案：詞1、詞2」純文字列表即可，見 Task 6 說明）。
- **`src/features/quiz/QuestionBreakdownTable.tsx` 與成績報表頁不用改動**：`EXPANDABLE_TYPES`（`QuestionBreakdownTable.tsx:55`）只有 `single_choice`/`multiple_choice`/`true_false` 三種會展開逐選項長條圖，`ranking`/`listening` 已經直接落在「顯示 `correct/total` + 對錯率」的一般路徑，cloze 的 `isCorrect`（全對才 true，見 Task 5）天生也吃這條路徑，不用額外分支。逐格明細（哪一格對/錯）沒有專屬 UI，是刻意的 MVP 簡化。

---

## 檔案總覽

| 檔案 | 動作 | 用途 |
|---|---|---|
| `src/models/Schema.ts` | 修改 | `questionTypeEnum` 加 `'cloze'` |
| `migrations/00XX_*.sql` | 新增（`db:generate` 產生） | enum 加值 |
| `src/lib/cloze.ts` | 新增 | 標記語法解析、批改、去標記、隨機挑空——唯一真相來源 |
| `src/lib/cloze.test.ts` | 新增 | 上面檔案的單元測試 |
| `src/actions/questionActions.ts` | 修改 | zod enum 加 `'cloze'`；`correctAnswers` 對 cloze 改由 `body` 伺服器端推導 |
| `src/features/quiz/QuestionForm.tsx` | 修改 | label map、zod enum、題型切換 effect、選項區塊排除 cloze、掛載 `ClozeEditor` |
| `src/features/quiz/ClozeEditor.tsx` | 新增 | 老師編輯介面：文章 textarea + 隨機挑空按鈕 + 即時預覽 |
| `src/features/quiz/ClozeQuestion.tsx` | 新增 | 學生作答介面：文章中交錯渲染文字與輸入框 |
| `src/features/quiz/QuizTaker.tsx` | 修改 | `gradeAnswer()` 加分支、`QuestionItem` 掛載 `ClozeQuestion`、結果頁/列印報告去標記、把 cloze 排除在錯題重做/單字卡/弱點分析候選集之外 |
| `src/actions/responseActions.ts` | 修改 | `submitQuizResponse` 加 cloze 批改分支（部分分） |
| `src/features/quiz/QuestionCard.tsx` | 修改 | 儀表板列表摘要行改顯示「N 個空格」 |

---

### Task 1: Schema — 新增 `cloze` enum 值

**Files:**
- Modify: `src/models/Schema.ts:63-70`
- Create: `migrations/00XX_*.sql`（`db:generate` 自動產生檔名）

**Interfaces:**
- Produces: `questionTypeEnum` 的 TypeScript 型別（`question.type` 欄位）多一個字面值 `'cloze'`，後續所有 Task 都靠這個型別窄化。

- [ ] **Step 1: 修改 enum**

```ts
export const questionTypeEnum = pgEnum('question_type', [
  'single_choice', // 單選題
  'multiple_choice', // 多選題
  'true_false', // 是非題
  'short_answer', // 簡答題
  'ranking', // 排序題（拖拉排序）
  'listening', // 聽力題（播放音檔 + 選擇題）
  'cloze', // 克漏字/填空題（文章挖空，[[詞彙]] 標記，body 直接存含標記的原文）
]);
```

- [ ] **Step 2: 產生 migration**

Run: `npm run db:generate`

Expected: 產生一個新檔 `migrations/00XX_xxx.sql`，內容應該**只有**這一行（比照 `migrations/0014_complete_morbius.sql` 當初加 `'listening'` 的先例）：

```sql
ALTER TYPE "public"."question_type" ADD VALUE 'cloze';--> statement-breakpoint
```

- [ ] **Step 3: 檢查產生的 SQL 沒有夾帶不相關的改動**

打開新產生的 `.sql` 檔案，確認只有上面那一行 `ALTER TYPE`。如果因為 migration snapshot 脫鉤問題被塞進其他 `CREATE TABLE`/`ALTER TABLE`，手動刪除不屬於本次改動的部分，只留 enum 加值。

- [ ] **Step 4: 啟動 dev server 確認不會炸**

Run: `npm run dev`

Expected: 伺服器正常啟動（PGlite 本地會自動套用新 migration），無型別或 migration 錯誤。`Ctrl+C` 停掉即可，這步只是驗證 schema 沒壞掉。

- [ ] **Step 5: Commit**

```bash
git add src/models/Schema.ts migrations/
git commit -m "feat(quiz): 新增 cloze（克漏字題）題型 enum"
```

---

### Task 2: `src/lib/cloze.ts` — 標記解析 / 批改 / 隨機挑空（TDD）

**Files:**
- Create: `src/lib/cloze.ts`
- Test: `src/lib/cloze.test.ts`

**Interfaces:**
- Consumes: 無（純函式，不依賴 DB/React）
- Produces（後面所有 Task 都靠這些名字）：
  - `CLOZE_BLANK_REGEX: RegExp`
  - `type ClozeSegment = { kind: 'text'; text: string } | { kind: 'blank'; index: number; answer: string }`
  - `parseClozeBody(body: string): ClozeSegment[]`
  - `extractClozeAnswers(body: string): string[]`
  - `countClozeBlanks(body: string): number`
  - `stripClozeMarkers(body: string, placeholder?: string): string`
  - `type ClozeGradeResult = { perBlank: boolean[]; correctCount: number; totalBlanks: number; isCorrect: boolean; awardedRatio: number }`
  - `gradeClozeAnswers(correctAnswers: string[], studentAnswers: (string | undefined)[] | undefined): ClozeGradeResult`
  - `findClozeCandidates(plainText: string): string[]`
  - `applyRandomClozeBlanks(body: string, count: number): string`

- [ ] **Step 1: 寫失敗測試 — `parseClozeBody` 基本情境**

```ts
// src/lib/cloze.test.ts
import { describe, expect, it } from 'vitest';

import {
  applyRandomClozeBlanks,
  countClozeBlanks,
  extractClozeAnswers,
  findClozeCandidates,
  gradeClozeAnswers,
  parseClozeBody,
  stripClozeMarkers,
} from './cloze';

describe('parseClozeBody', () => {
  it('沒有標記時回傳單一 text 段落', () => {
    expect(parseClozeBody('光合作用是一個過程。')).toEqual([
      { kind: 'text', text: '光合作用是一個過程。' },
    ]);
  });

  it('解析單一標記，前後都有文字', () => {
    expect(parseClozeBody('光合作用需要[[陽光]]才能進行。')).toEqual([
      { kind: 'text', text: '光合作用需要' },
      { kind: 'blank', index: 0, answer: '陽光' },
      { kind: 'text', text: '才能進行。' },
    ]);
  });

  it('解析多個標記，index 依出現順序遞增', () => {
    expect(parseClozeBody('需要[[陽光]]、水和[[二氧化碳]]。')).toEqual([
      { kind: 'text', text: '需要' },
      { kind: 'blank', index: 0, answer: '陽光' },
      { kind: 'text', text: '、水和' },
      { kind: 'blank', index: 1, answer: '二氧化碳' },
      { kind: 'text', text: '。' },
    ]);
  });

  it('標記在開頭或結尾時不多出空的 text 段落', () => {
    expect(parseClozeBody('[[陽光]]很重要')).toEqual([
      { kind: 'blank', index: 0, answer: '陽光' },
      { kind: 'text', text: '很重要' },
    ]);
    expect(parseClozeBody('很重要的是[[陽光]]')).toEqual([
      { kind: 'text', text: '很重要的是' },
      { kind: 'blank', index: 0, answer: '陽光' },
    ]);
  });

  it('標記內容前後空白會被 trim', () => {
    expect(parseClozeBody('需要[[ 陽光 ]]。')).toEqual([
      { kind: 'text', text: '需要' },
      { kind: 'blank', index: 0, answer: '陽光' },
      { kind: 'text', text: '。' },
    ]);
  });
});

describe('extractClozeAnswers / countClozeBlanks', () => {
  it('依出現順序回傳答案陣列', () => {
    expect(extractClozeAnswers('需要[[陽光]]和[[水]]。')).toEqual(['陽光', '水']);
  });

  it('沒有標記時回傳空陣列', () => {
    expect(extractClozeAnswers('沒有標記的文字')).toEqual([]);
  });

  it('countClozeBlanks 回傳標記數量', () => {
    expect(countClozeBlanks('需要[[陽光]]、水和[[二氧化碳]]。')).toBe(2);
    expect(countClozeBlanks('沒有標記')).toBe(0);
  });
});

describe('stripClozeMarkers', () => {
  it('把標記換成預設佔位符，不洩漏答案', () => {
    expect(stripClozeMarkers('需要[[陽光]]和[[水]]。')).toBe('需要＿＿＿＿和＿＿＿＿。');
  });

  it('可自訂佔位符', () => {
    expect(stripClozeMarkers('需要[[陽光]]。', '___')).toBe('需要___。');
  });

  it('沒有標記時原樣回傳', () => {
    expect(stripClozeMarkers('普通文字')).toBe('普通文字');
  });
});

describe('gradeClozeAnswers', () => {
  it('全部答對 → isCorrect true，awardedRatio 1', () => {
    const result = gradeClozeAnswers(['陽光', '水'], ['陽光', '水']);
    expect(result).toEqual({
      perBlank: [true, true],
      correctCount: 2,
      totalBlanks: 2,
      isCorrect: true,
      awardedRatio: 1,
    });
  });

  it('部分答對 → isCorrect false，awardedRatio 按比例', () => {
    const result = gradeClozeAnswers(['陽光', '水', '二氧化碳'], ['陽光', '水', '土']);
    expect(result.correctCount).toBe(2);
    expect(result.totalBlanks).toBe(3);
    expect(result.isCorrect).toBe(false);
    expect(result.awardedRatio).toBeCloseTo(2 / 3);
  });

  it('比對忽略前後空白與英文大小寫', () => {
    const result = gradeClozeAnswers(['Sunlight'], [' sunlight ']);
    expect(result.perBlank).toEqual([true]);
  });

  it('學生沒填的空格算錯', () => {
    const result = gradeClozeAnswers(['陽光', '水'], ['陽光', undefined]);
    expect(result.perBlank).toEqual([true, false]);
    expect(result.correctCount).toBe(1);
  });

  it('studentAnswers 為 undefined 時全部算錯，不會炸', () => {
    const result = gradeClozeAnswers(['陽光', '水'], undefined);
    expect(result.correctCount).toBe(0);
    expect(result.isCorrect).toBe(false);
  });

  it('沒有空格（totalBlanks=0）時 isCorrect 為 false、awardedRatio 為 0', () => {
    const result = gradeClozeAnswers([], []);
    expect(result.isCorrect).toBe(false);
    expect(result.awardedRatio).toBe(0);
  });
});

describe('findClozeCandidates', () => {
  it('抓出英文詞（≥3 字母）', () => {
    expect(findClozeCandidates('The sunlight is important')).toEqual(
      expect.arrayContaining(['The', 'sunlight', 'important']),
    );
  });

  it('抓出數字詞', () => {
    expect(findClozeCandidates('溫度是 100 度')).toEqual(expect.arrayContaining(['100']));
  });

  it('抓出 2-4 字中文詞組', () => {
    const candidates = findClozeCandidates('光合作用需要陽光、水和二氧化碳');
    expect(candidates.length).toBeGreaterThan(0);
  });

  it('太短的英文詞（<3 字母）不算候選', () => {
    expect(findClozeCandidates('a is it')).toEqual([]);
  });
});

describe('applyRandomClozeBlanks', () => {
  it('標記數量等於 min(count, 候選詞數量)', () => {
    const body = 'The sunlight and water are important for photosynthesis';
    const result = applyRandomClozeBlanks(body, 3);
    expect(countClozeBlanks(result)).toBe(3);
  });

  it('候選詞不足時，標記數 = 候選詞數，不會炸', () => {
    const body = 'ab cd';
    const result = applyRandomClozeBlanks(body, 5);
    // ab / cd 都只有 2 個字母，不符合候選規則，維持原文不變
    expect(result).toBe(body);
  });

  it('不會重複標記已經被 [[ ]] 包住的文字', () => {
    const body = '需要[[陽光]]才能進行 photosynthesis process';
    const result = applyRandomClozeBlanks(body, 5);
    // 「陽光」已經被標記過，不應該出現 [[[[陽光]]]] 這種雙重標記
    expect(result).not.toContain('[[[[');
    expect(extractClozeAnswers(result)).toContain('陽光');
  });

  it('沒有候選詞時原樣回傳', () => {
    expect(applyRandomClozeBlanks('。，！？', 3)).toBe('。，！？');
  });
});
```

- [ ] **Step 2: 執行測試確認全部失敗（檔案還不存在）**

Run: `npx vitest run src/lib/cloze.test.ts`
Expected: FAIL，錯誤訊息是找不到 `./cloze` 模組。

- [ ] **Step 3: 寫最小實作**

```ts
// src/lib/cloze.ts

/**
 * 克漏字題（cloze）共用工具：標記語法解析、批改、安全去標記、純規則隨機挑空。
 * 標記語法：[[答案]]，例如「光合作用需要[[陽光]]和[[水]]。」
 * question.body 直接存含 [[ ]] 標記的原始文章（不額外開欄位），
 * 讓老師編輯時原樣讀回、可重複編輯；correctAnswers 由伺服器端從 body 推導（見 questionActions.ts）。
 */

export const CLOZE_BLANK_REGEX = /\[\[([^[\]]+)\]\]/g;

export type ClozeSegment =
  | { kind: 'text'; text: string }
  | { kind: 'blank'; index: number; answer: string };

/** 把含標記的文章拆成「文字／空格」交錯的 segment 陣列，空格 index 依出現順序遞增 */
export function parseClozeBody(body: string): ClozeSegment[] {
  const segments: ClozeSegment[] = [];
  let lastIndex = 0;
  let blankIndex = 0;
  const regex = new RegExp(CLOZE_BLANK_REGEX);
  let match = regex.exec(body);
  while (match !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: 'text', text: body.slice(lastIndex, match.index) });
    }
    segments.push({ kind: 'blank', index: blankIndex, answer: match[1]!.trim() });
    blankIndex += 1;
    lastIndex = match.index + match[0].length;
    match = regex.exec(body);
  }
  if (lastIndex < body.length) {
    segments.push({ kind: 'text', text: body.slice(lastIndex) });
  }
  return segments;
}

/** 依文章順序回傳每個空格的正確答案 */
export function extractClozeAnswers(body: string): string[] {
  return parseClozeBody(body)
    .filter((s): s is Extract<ClozeSegment, { kind: 'blank' }> => s.kind === 'blank')
    .map(s => s.answer);
}

export function countClozeBlanks(body: string): number {
  return extractClozeAnswers(body).length;
}

const CLOZE_PLACEHOLDER = '＿＿＿＿';

/** 把標記換成安全佔位符，任何會把 body 丟給學生／AI／列印報告看的地方都要先過這層，避免洩漏答案 */
export function stripClozeMarkers(body: string, placeholder: string = CLOZE_PLACEHOLDER): string {
  return parseClozeBody(body)
    .map(s => (s.kind === 'text' ? s.text : placeholder))
    .join('');
}

function normalizeClozeAnswer(v: string): string {
  return v.trim().toLocaleLowerCase();
}

export type ClozeGradeResult = {
  perBlank: boolean[];
  correctCount: number;
  totalBlanks: number;
  isCorrect: boolean; // 全部答對才 true；totalBlanks 為 0 時視為 false（沒有空格不算「答對」）
  awardedRatio: number; // correctCount / totalBlanks，totalBlanks 為 0 時為 0
};

/** 逐格比對：trim + 大小寫不敏感的精準字串比對，不叫 AI */
export function gradeClozeAnswers(
  correctAnswers: string[],
  studentAnswers: (string | undefined)[] | undefined,
): ClozeGradeResult {
  const totalBlanks = correctAnswers.length;
  const perBlank = correctAnswers.map((correct, i) => {
    const given = studentAnswers?.[i];
    return given !== undefined && normalizeClozeAnswer(given) === normalizeClozeAnswer(correct);
  });
  const correctCount = perBlank.filter(Boolean).length;
  return {
    perBlank,
    correctCount,
    totalBlanks,
    isCorrect: totalBlanks > 0 && correctCount === totalBlanks,
    awardedRatio: totalBlanks > 0 ? correctCount / totalBlanks : 0,
  };
}

// ---------- 隨機挑空（教師編輯器用，純規則，不叫 AI） ----------
// 中文沒有分詞函式庫可用，這裡用「標點分隔的 2-4 字詞組」當粗略啟發式，
// 對英文/數字效果較好；中文長文建議老師手動用 [[ ]] 標記重點詞彙。

const ENGLISH_TOKEN = /^[a-z]{3,}$/i;
const NUMBER_TOKEN = /^\d[\d.,%]*$/;
const CJK_PHRASE = /^[一-鿿]{2,4}$/;
const TOKEN_SPLIT = /([\s，。、！？「」『』,.!?;:()（）\n]+)/;

/** 掃出文字中可以拿來挖空的候選詞（尚未去重） */
export function findClozeCandidates(plainText: string): string[] {
  return plainText
    .split(TOKEN_SPLIT)
    .map(t => t.trim())
    .filter(t => t && (ENGLISH_TOKEN.test(t) || NUMBER_TOKEN.test(t) || CJK_PHRASE.test(t)));
}

/**
 * 從文章（可能已含部分 [[ ]] 標記）隨機挑 N 個「還沒被標記」的候選詞，
 * 自動包上 [[ ]]。只掃未標記的文字段落，不會動到既有標記，也不會雙重標記。
 */
export function applyRandomClozeBlanks(body: string, count: number): string {
  const segments = parseClozeBody(body);
  const textSegments = segments.filter((s): s is Extract<ClozeSegment, { kind: 'text' }> => s.kind === 'text');
  const candidates = Array.from(new Set(textSegments.flatMap(s => findClozeCandidates(s.text))));
  if (candidates.length === 0) {
    return body;
  }

  const n = Math.max(1, Math.min(count, candidates.length));
  const picked = new Set([...candidates].sort(() => Math.random() - 0.5).slice(0, n));
  const marked = new Set<string>();

  return segments
    .map((seg) => {
      if (seg.kind === 'blank') {
        return `[[${seg.answer}]]`;
      }
      return seg.text
        .split(TOKEN_SPLIT)
        .map((t) => {
          const trimmed = t.trim();
          if (trimmed && picked.has(trimmed) && !marked.has(trimmed)) {
            marked.add(trimmed);
            return t.replace(trimmed, `[[${trimmed}]]`);
          }
          return t;
        })
        .join('');
    })
    .join('');
}
```

- [ ] **Step 4: 執行測試確認全部通過**

Run: `npx vitest run src/lib/cloze.test.ts`
Expected: PASS（全部 case）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/cloze.ts src/lib/cloze.test.ts
git commit -m "feat(quiz): 新增 cloze 標記解析／批改／隨機挑空共用工具 + 測試"
```

---

### Task 3: 教師出題表單 — `QuestionForm.tsx` + `questionActions.ts` 接上 cloze

**Files:**
- Modify: `src/features/quiz/QuestionForm.tsx:10-17,55-56,198-244,261-267,303-318,468`
- Modify: `src/actions/questionActions.ts:24-36,63-76,94-107`
- Modify: `src/libs/fork.ts:10-16`（第 4 個手動複製的題型 union，題庫市集 fork 功能用，見 Step 8）
- Create: `src/features/quiz/ClozeEditor.tsx`

**Interfaces:**
- Consumes: `parseClozeBody`, `countClozeBlanks`, `applyRandomClozeBlanks`, `extractClozeAnswers`（`src/lib/cloze.ts`, Task 2）
- Produces: `ClozeEditor` 元件 `{ body: string; onChange: (body: string) => void }`，`QUESTION_TYPE_LABELS.cloze`

- [ ] **Step 1: `QUESTION_TYPE_LABELS` 加入 cloze**

`src/features/quiz/QuestionForm.tsx:10-17`：

```ts
export const QUESTION_TYPE_LABELS = {
  single_choice: '單選題',
  multiple_choice: '多選題',
  true_false: '是非題',
  short_answer: '簡答題',
  ranking: '排序題',
  listening: '聽力題',
  cloze: '克漏字題',
} as const;
```

- [ ] **Step 2: zod enum 兩處加 `'cloze'`**

`src/features/quiz/QuestionForm.tsx:56`：

```ts
type: z.enum(['single_choice', 'multiple_choice', 'true_false', 'short_answer', 'ranking', 'listening', 'cloze']),
```

`src/actions/questionActions.ts:25`（同樣改法）：

```ts
type: z.enum(['single_choice', 'multiple_choice', 'true_false', 'short_answer', 'ranking', 'listening', 'cloze']),
```

- [ ] **Step 3: 題型切換 effect 加 cloze 分支**

`src/features/quiz/QuestionForm.tsx:215-217`（`short_answer` 分支之後插入，`ranking` 分支之前）：

```ts
} else if (type === 'short_answer') {
  replace([]);
  form.setValue('correctAnswers', []);
} else if (type === 'cloze') {
  // 克漏字題不用 options，答案是從 body 的 [[ ]] 標記推導出來的
  replace([]);
  form.setValue('correctAnswers', []);
} else if (type === 'ranking') {
```

- [ ] **Step 4: 建立 `ClozeEditor.tsx`**

```tsx
// src/features/quiz/ClozeEditor.tsx
'use client';

/**
 * ClozeEditor — 克漏字題（cloze）的老師編輯介面。
 * 老師直接在文章裡用 [[詞彙]] 標記要挖空的重點，或按「隨機挑選」
 * 讓系統用純規則（不叫 AI）自動挑詞標記。下方即時預覽目前有幾個空格、位置在哪。
 */
import { useState } from 'react';

import { applyRandomClozeBlanks, countClozeBlanks, parseClozeBody } from '@/lib/cloze';

type Props = {
  body: string;
  onChange: (body: string) => void;
};

export function ClozeEditor({ body, onChange }: Props) {
  const [randomCount, setRandomCount] = useState(5);
  const blankCount = countClozeBlanks(body);
  const segments = parseClozeBody(body);

  return (
    <div>
      {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
      <label className="mb-1 block text-sm font-medium">
        文章段落
        <span className="ml-1 text-xs font-normal text-muted-foreground">
          （用 [[詞彙]] 標記要挖空的重點，或用下方按鈕自動挑選）
        </span>
      </label>
      <textarea
        value={body}
        onChange={e => onChange(e.target.value)}
        rows={6}
        placeholder="貼上文章段落，並用 [[詞彙]] 標記要挖空的重點，例如：光合作用需要[[陽光]]、水和[[二氧化碳]]。"
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={1}
          max={10}
          value={randomCount}
          onChange={e => setRandomCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
          aria-label="隨機挑選空格數"
          className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm"
        />
        <button
          type="button"
          onClick={() => onChange(applyRandomClozeBlanks(body, randomCount))}
          className="rounded-md border border-input bg-background px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          🎲 隨機挑選
        </button>
        <span className="text-xs text-muted-foreground">
          隨機模式對英文/數字效果較佳，中文段落建議手動用 [[ ]] 標記重點詞彙
        </span>
      </div>

      <div className="mt-2 rounded-md border bg-muted/30 px-3 py-2 text-sm leading-relaxed">
        {segments.length === 0
          ? <span className="text-muted-foreground">尚未輸入文章</span>
          : segments.map(seg => seg.kind === 'text'
              ? <span key={`t-${seg.text}-${segments.indexOf(seg)}`}>{seg.text}</span>
              : (
                  <span
                    key={`b-${seg.index}`}
                    className="mx-0.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800"
                  >
                    空格
                    {seg.index + 1}
                  </span>
                ))}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        共
        {' '}
        {blankCount}
        {' '}
        個空格
      </p>
    </div>
  );
}
```

- [ ] **Step 5: `QuestionForm.tsx` 掛載 `ClozeEditor`，取代一般題型的「題目內容」欄位**

`src/features/quiz/QuestionForm.tsx:303-318` 原本是固定顯示的「題目內容」textarea，改成依題型二選一：

```tsx
{/* 題目內容：克漏字題用專用的 ClozeEditor（body 本身就是含標記的文章），其他題型用一般 textarea */}
{type === 'cloze'
  ? (
      <ClozeEditor
        body={form.watch('body')}
        onChange={next => form.setValue('body', next, { shouldDirty: true, shouldValidate: true })}
      />
    )
  : (
      <div>
        {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
        <label className="mb-1 block text-sm font-medium">題目內容</label>
        <textarea
          {...form.register('body')}
          rows={2}
          placeholder="輸入題目..."
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {form.formState.errors.body && (
          <p className="mt-1 text-xs text-destructive">
            {form.formState.errors.body.message}
          </p>
        )}
      </div>
    )}
```

記得在檔案頂端加 import：

```ts
import { ClozeEditor } from './ClozeEditor';
```

- [ ] **Step 6: 選項清單區塊排除 cloze**

`src/features/quiz/QuestionForm.tsx:468`，原本：

```tsx
{type !== 'short_answer' && (
```

改成：

```tsx
{type !== 'short_answer' && type !== 'cloze' && (
```

- [ ] **Step 7: `questionActions.ts` — cloze 的 `correctAnswers` 由 `body` 伺服器端推導**

`src/actions/questionActions.ts` 檔案頂端加 import：

```ts
import { extractClozeAnswers } from '@/lib/cloze';
```

`createQuestion`（原 `src/actions/questionActions.ts:70-71`）：

```ts
options: parsed.data.options ?? null,
correctAnswers: parsed.data.type === 'cloze'
  ? extractClozeAnswers(parsed.data.body)
  : (parsed.data.correctAnswers ?? null),
```

`updateQuestion`（原 `src/actions/questionActions.ts:102-103`）同樣改法：

```ts
options: parsed.data.options ?? null,
correctAnswers: parsed.data.type === 'cloze'
  ? extractClozeAnswers(parsed.data.body)
  : (parsed.data.correctAnswers ?? null),
```

這樣即使前端沒送 `correctAnswers`（cloze 本來就不會送），伺服器一律從 `body` 重新算，`body` 永遠是唯一真相來源，不用擔心前端漏送或送錯。

- [ ] **Step 8: `src/libs/fork.ts` 的 `QuestionType` 也要加 `'cloze'`（Task 2 完成後 `npm run check-types` 才發現的缺口）**

`src/libs/fork.ts:10-16` 有第 4 個手動複製的題型 union（給題庫市集「複製公開測驗」的 fork 邏輯用，註解寫「與 schema 一致」），沒跟著 Task 1 的 DB enum 一起加。不加的話 `src/libs/fork-dao.ts:69` 會出現 `Type '"cloze"' is not assignable to type 'QuestionType'` 的型別錯誤（`npm run check-types` 會擋下來）。fork 邏輯本身是通用欄位複製（body/options/correctAnswers 原樣複製過去），不需要看題型做特殊處理，所以只要加這一行、不用改其他邏輯：

```ts
// question 表 type enum,與 schema 一致
type QuestionType =
  | 'single_choice'
  | 'multiple_choice'
  | 'true_false'
  | 'short_answer'
  | 'ranking'
  | 'listening'
  | 'cloze';
```

- [ ] **Step 9: 手動驗證**

Run: `npm run dev`，到任一測驗的編輯頁「新增題目」：
1. 題型選「克漏字題」，貼一段含中英文的文章，手動打 `[[詞彙]]` 標記 2-3 個空格，確認下方預覽正確顯示「空格1」「空格2」pill 跟「共 N 個空格」。
2. 按「🎲 隨機挑選」，確認自動標記了英文/數字詞（中文詞組視內容而定）。
3. 儲存後重新整理，確認題目卡片上的摘要顯示題型「克漏字題」（Task 6 會補上「N 個空格」摘要行，這步先確認不會壞掉即可）。
4. 點編輯，確認原本打的 `[[ ]]` 標記原樣讀回 textarea（round-trip 沒有遺失）。

- [ ] **Step 10: Commit**

```bash
git add src/features/quiz/QuestionForm.tsx src/features/quiz/ClozeEditor.tsx src/actions/questionActions.ts src/libs/fork.ts
git commit -m "feat(quiz): 老師出題表單支援 cloze 題型（ClozeEditor + 伺服器端推導答案）"
```

---

### Task 4: 學生作答 — `ClozeQuestion.tsx` + `QuizTaker.tsx` 掛載

**Files:**
- Create: `src/features/quiz/ClozeQuestion.tsx`
- Modify: `src/features/quiz/QuizTaker.tsx:52-72,125-263`

**Interfaces:**
- Consumes: `parseClozeBody`, `gradeClozeAnswers`（`src/lib/cloze.ts`, Task 2）
- Produces: `ClozeQuestion` 元件 `{ body: string; value: string[] | undefined; onChange: (value: string[]) => void }`

- [ ] **Step 1: 建立 `ClozeQuestion.tsx`**

```tsx
// src/features/quiz/ClozeQuestion.tsx
'use client';

/**
 * ClozeQuestion — 學生作答克漏字題（cloze）用的元件。
 * 依 body 的 [[ ]] 標記位置，把文章渲染成「文字 + 空格輸入框」交錯排列。
 * 受控元件：value 是每個空格目前的作答，依文章順序排列。
 * 這是計分測驗題（不是練習頁），作答中不做即時對錯提示，只顯示「已完成 N/M 空格」進度。
 */
import { parseClozeBody } from '@/lib/cloze';

type Props = {
  body: string;
  value: string[] | undefined;
  onChange: (value: string[]) => void;
};

export function ClozeQuestion({ body, value, onChange }: Props) {
  const segments = parseClozeBody(body);
  const totalBlanks = segments.filter(s => s.kind === 'blank').length;
  const filledCount = segments.filter(
    s => s.kind === 'blank' && (value?.[s.index] ?? '').trim() !== '',
  ).length;

  const handleBlankChange = (index: number, text: string) => {
    const next = [...(value ?? Array.from({ length: totalBlanks }, () => ''))];
    next[index] = text;
    onChange(next);
  };

  return (
    <div>
      <p className="text-base leading-loose text-gray-800">
        {segments.map(seg => seg.kind === 'text'
          ? <span key={`t-${seg.text}-${segments.indexOf(seg)}`}>{seg.text}</span>
          : (
              <input
                key={`b-${seg.index}`}
                type="text"
                aria-label={`空格 ${seg.index + 1}`}
                value={value?.[seg.index] ?? ''}
                onChange={e => handleBlankChange(seg.index, e.target.value)}
                className="mx-1 inline-block w-24 rounded-md border-2 border-gray-200 bg-gray-50/50 px-2 py-0.5 text-center text-base focus:border-emerald-400 focus:bg-white focus:outline-none"
              />
            ))}
      </p>
      {totalBlanks > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          已完成
          {' '}
          {filledCount}
          {' / '}
          {totalBlanks}
          {' '}
          空格
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: `QuizTaker.tsx` 掛載 `ClozeQuestion`，並壓下一般題型的 body 直出**

檔案頂端加 import（`src/features/quiz/QuizTaker.tsx` import 區塊）：

```ts
import { gradeClozeAnswers } from '@/lib/cloze';

import { ClozeQuestion } from './ClozeQuestion';
```

`QuestionItem` 內，原本 `src/features/quiz/QuizTaker.tsx:131` 一律顯示題目本文：

```tsx
<p className="text-base font-semibold leading-relaxed sm:text-lg">{question.body}</p>
```

改成克漏字題不重複顯示原始 body（因為 body 含 `[[ ]]` 標記，而且 `ClozeQuestion` 會自己把文章渲染出來）：

```tsx
{question.type !== 'cloze' && (
  <p className="text-base font-semibold leading-relaxed sm:text-lg">{question.body}</p>
)}
```

在 ranking 區塊之後（`src/features/quiz/QuizTaker.tsx:253-263` 之後）新增 cloze 分支：

```tsx
{/* 克漏字題 */}
{question.type === 'cloze' && (
  <ClozeQuestion
    body={question.body}
    value={Array.isArray(answer) ? answer : undefined}
    onChange={v => onChange(v)}
  />
)}
```

- [ ] **Step 3: `gradeAnswer()` 家教模式本機批改加 cloze 分支**

`src/features/quiz/QuizTaker.tsx:52-72`，在 `ranking` 分支之後、`return false` 之前加：

```ts
if (question.type === 'cloze') {
  if (!question.correctAnswers) {
    return false;
  }
  return gradeClozeAnswers(
    question.correctAnswers,
    Array.isArray(answer) ? answer : undefined,
  ).isCorrect;
}
```

- [ ] **Step 4: 手動驗證**

Run: `npm run dev`，用 Task 3 建立的克漏字題發佈成測驗，用學生連結作答：
1. 確認文章正確渲染成「文字 + 輸入框」交錯排列，看不到任何 `[[ ]]` 符號。
2. 打完所有空格，確認下方「已完成 N/M 空格」數字正確更新。
3. 開啟「家教模式」（若有）用同一題確認「確認答案」按鈕能正確判對錯。

- [ ] **Step 5: Commit**

```bash
git add src/features/quiz/ClozeQuestion.tsx src/features/quiz/QuizTaker.tsx
git commit -m "feat(quiz): 學生作答頁支援 cloze 題型（ClozeQuestion + 本機批改）"
```

---

### Task 5: 正式批改 — `responseActions.ts` 部分分邏輯

**Files:**
- Modify: `src/actions/responseActions.ts:1-13,113-171`

**Interfaces:**
- Consumes: `gradeClozeAnswers`（`src/lib/cloze.ts`, Task 2）
- Produces: `submitQuizResponse` 回傳的 `SubmitResult.details[].awardedPoints` 對 cloze 題支援部分分（既有型別 `number` 不用改）

- [ ] **Step 1: 加 import**

`src/actions/responseActions.ts` 頂端：

```ts
import { gradeClozeAnswers } from '@/lib/cloze';
```

- [ ] **Step 2: 批改迴圈加 cloze 分支**

`src/actions/responseActions.ts:113-171`，原本結構是 `if (isShortAnswer) {...} else if (question.correctAnswers && studentAnswer !== undefined) {...} else if (!isShortAnswer) {...}`。在 `isShortAnswer` 分支之後、既有 `else if (question.correctAnswers ...)` 分支之前插入新的 `else if`：

```ts
for (const question of questions) {
  const studentAnswer = answers[question.id.toString()];
  const isShortAnswer = question.type === 'short_answer';

  let isCorrect: boolean | null = null;
  let awardedPoints = 0;
  let aiReason: string | undefined;

  if (isShortAnswer) {
    // ...既有簡答題邏輯不動...
  } else if (question.type === 'cloze') {
    // 克漏字題：逐格精準比對，部分分 = 配分 × 答對比例，全對才 isCorrect=true
    const studentBlanks = Array.isArray(studentAnswer) ? studentAnswer : [];
    const grade = gradeClozeAnswers(question.correctAnswers ?? [], studentBlanks);
    totalPoints += question.points;
    if (grade.totalBlanks > 0) {
      isCorrect = grade.isCorrect;
      awardedPoints = Math.round(question.points * grade.awardedRatio);
    }
  } else if (question.correctAnswers && studentAnswer !== undefined) {
    // ...既有 single_choice / multiple_choice / true_false / listening / ranking 邏輯不動...
  } else if (!isShortAnswer) {
    // ...既有 fallback 不動...
  }

  score += awardedPoints;
  details.push({
    questionId: question.id,
    isCorrect,
    points: question.points,
    awardedPoints,
    ...(aiReason ? { aiReason } : {}),
  });
}
```

（上面省略號的部分維持原檔案內容不動，只新增中間那個 `else if (question.type === 'cloze')` 區塊。）

- [ ] **Step 3: 手動驗證**

Run: `npm run dev`，用 Task 3/4 的克漏字題（例如 3 個空格），用學生連結作答：
1. 全部答對 → 送出後確認得該題滿分，`isCorrect` 顯示對。
2. 答對 2/3 → 確認得分是 `round(該題配分 × 2/3)`。
3. 全部空白不填 → 確認得 0 分，`isCorrect` 為 false（不是 null）。

- [ ] **Step 4: Commit**

```bash
git add src/actions/responseActions.ts
git commit -m "feat(quiz): submitQuizResponse 支援 cloze 部分分批改"
```

---

### Task 6: 結果頁 / 列印報告安全性 — 排除標記外洩 + 候選集排除 cloze

**Files:**
- Modify: `src/features/quiz/QuizTaker.tsx:396-414,469-531,556-600,1370-1379`

**Interfaces:**
- Consumes: `stripClozeMarkers`（`src/lib/cloze.ts`, Task 2）

**背景**：`question.body` 對 cloze 題來說是**含答案標記的原始文字**（`[[陽光]]` 這種）。有幾個地方會不分題型直接把 `question.body` 塞進畫面或 AI prompt，這些地方對其他題型沒問題，但對 cloze 題會把正確答案原封不動洩漏出去（甚至不受老師 `showAnswers` 設定控制）。這個 Task 把這些地方堵起來。至於結果頁「你的答案／正確答案」那兩行，因為 cloze 題的 `options` 一定是空陣列，既有的 `options.find(...) ?? id` fallback 邏輯會自動把 `id`（也就是空格作答字串本身）當顯示文字用，**不用改**就會正確顯示成「你的答案：詞1、詞2」——這是刻意選的 MVP 簡化：不做逐格對錯行內標色，維持跟 ranking/multiple_choice 一樣的純文字列表。

- [ ] **Step 1: 補 import**

Task 4 Step 2 已經在 `src/features/quiz/QuizTaker.tsx` 頂端加了 `import { gradeClozeAnswers } from '@/lib/cloze';`——這步把它擴充成也匯入 `stripClozeMarkers`，**不要**另外新增一行重複 import：

```ts
import { gradeClozeAnswers, stripClozeMarkers } from '@/lib/cloze';
```

- [ ] **Step 2: 結果頁逐題列表（`ResultScreen`）— body 一律去標記**

`src/features/quiz/QuizTaker.tsx:840-846`，原本：

```tsx
<p className="text-sm font-medium">
  Q
  {index + 1}
  .
  {' '}
  {question.body}
</p>
```

改成：

```tsx
<p className="text-sm font-medium">
  Q
  {index + 1}
  .
  {' '}
  {question.type === 'cloze' ? stripClozeMarkers(question.body) : question.body}
</p>
```

這一段目前**不受 `showAnswers` 控制**（外層沒有 `{showAnswers && ...}` 包住），所以無論老師有沒有開放看解答，都不能讓學生看到原始標記。

- [ ] **Step 3: 下載列印報告（`handleDownloadReport`）— body 一律去標記**

`src/features/quiz/QuizTaker.tsx:487-492`，原本：

```ts
return `<div style="margin-bottom:16px;padding:12px;border:1px solid ${detail?.isCorrect === false ? '#fca5a5' : '#d1d5db'};border-radius:8px;${detail?.isCorrect === false ? 'background:#fef2f2' : ''}">
  <p style="font-weight:600;margin:0">${icon} Q${i + 1}. ${q.body}</p>
  <p style="margin:4px 0 0;color:#666">你的答案：${studentText}</p>
  ${correctText && detail?.isCorrect === false ? `<p style="margin:4px 0 0;color:#15803d">正確答案：${correctText}</p>` : ''}
  ${hint ? `<div style="margin-top:8px;padding:8px;background:#fef3c7;border-radius:6px;font-size:13px"><b>💡 AI 助教：</b>${hint}</div>` : ''}
</div>`;
```

在這段前面加一行，並把 `q.body` 換成 `safeBody`：

```ts
const safeBody = q.type === 'cloze' ? stripClozeMarkers(q.body) : q.body;

return `<div style="margin-bottom:16px;padding:12px;border:1px solid ${detail?.isCorrect === false ? '#fca5a5' : '#d1d5db'};border-radius:8px;${detail?.isCorrect === false ? 'background:#fef2f2' : ''}">
  <p style="font-weight:600;margin:0">${icon} Q${i + 1}. ${safeBody}</p>
  <p style="margin:4px 0 0;color:#666">你的答案：${studentText}</p>
  ${correctText && detail?.isCorrect === false ? `<p style="margin:4px 0 0;color:#15803d">正確答案：${correctText}</p>` : ''}
  ${hint ? `<div style="margin-top:8px;padding:8px;background:#fef3c7;border-radius:6px;font-size:13px"><b>💡 AI 助教：</b>${hint}</div>` : ''}
</div>`;
```

- [ ] **Step 4: 錯題重做候選集排除 cloze**

`src/features/quiz/QuizTaker.tsx:1370-1379`，原本：

```ts
const retryQuestions = useMemo(() => {
  if (!result) {
    return [];
  }
  return displayQuestions.filter(
    q =>
      q.type !== 'short_answer'
      && result.details.some(d => d.questionId === q.id && d.isCorrect === false),
  );
}, [result, displayQuestions]);
```

改成：

```ts
const retryQuestions = useMemo(() => {
  if (!result) {
    return [];
  }
  return displayQuestions.filter(
    q =>
      q.type !== 'short_answer'
      && q.type !== 'cloze'
      && result.details.some(d => d.questionId === q.id && d.isCorrect === false),
  );
}, [result, displayQuestions]);
```

`src/features/quiz/QuizTaker.tsx:399-401` 的 `retryableWrongCount`（`ResultScreen` 裡顯示「可重做 N 題」按鈕用的計數）也要同步排除，原本：

```ts
const retryableWrongCount = result.details.filter(
  d => d.isCorrect === false && questions.find(q => q.id === d.questionId)?.type !== 'short_answer',
).length;
```

改成：

```ts
const retryableWrongCount = result.details.filter((d) => {
  if (d.isCorrect !== false) {
    return false;
  }
  const qType = questions.find(q => q.id === d.questionId)?.type;
  return qType !== 'short_answer' && qType !== 'cloze';
}).length;
```

- [ ] **Step 5: 錯題單字卡候選集排除 cloze**

`src/features/quiz/QuizTaker.tsx:411-414`，原本：

```ts
const wrongQuestions = result.details
  .filter(d => d.isCorrect === false)
  .map(d => questions.find(q => q.id === d.questionId))
  .filter(Boolean) as Question[];
```

改成：

```ts
const wrongQuestions = result.details
  .filter(d => d.isCorrect === false)
  .map(d => questions.find(q => q.id === d.questionId))
  .filter((q): q is Question => !!q && q.type !== 'cloze');
```

（原本 `.filter(Boolean) as Question[]` 這種寫法會把 `[[ ]]` 標記文字直接送進 `/api/ai/generate-flashcards` prompt，排除掉更單純。）

- [ ] **Step 6: 弱點分析候選集排除 cloze**

`src/features/quiz/QuizTaker.tsx:566`，原本：

```ts
if (!q || q.type === 'short_answer') {
  return null;
}
```

改成：

```ts
if (!q || q.type === 'short_answer' || q.type === 'cloze') {
  return null;
}
```

- [ ] **Step 7: 手動驗證**

Run: `npm run dev`，用一份混合「一題克漏字 + 一題單選」都答錯的測驗送出作答：
1. 在老師 `showAnswers` 關閉的情況下看結果頁，確認克漏字題那行**看不到任何 `[[ ]]`**（應顯示 `＿＿＿＿` 佔位符）。
2. 開啟「下載學習報告」，確認 PDF/列印預覽裡克漏字題的題目文字也看不到 `[[ ]]`。
3. 確認「錯題重做」按鈕的計數**不包含**克漏字題（只算其他題型的錯題）。
4. 若測驗有錯題單字卡功能，確認克漏字題不會出現在單字卡候選裡。

- [ ] **Step 8: Commit**

```bash
git add src/features/quiz/QuizTaker.tsx
git commit -m "fix(quiz): cloze 題的原始標記不外洩到結果頁/列印報告，排除出錯題重做等候選集"
```

---

### Task 7: 儀表板題目卡片摘要行

**Files:**
- Modify: `src/features/quiz/QuestionCard.tsx:1-10,154-169`

**Interfaces:**
- Consumes: `countClozeBlanks`（`src/lib/cloze.ts`, Task 2）

- [ ] **Step 1: 加 import**

`src/features/quiz/QuestionCard.tsx` 頂端：

```ts
import { countClozeBlanks } from '@/lib/cloze';
```

- [ ] **Step 2: 摘要行加 cloze 分支**

`src/features/quiz/QuestionCard.tsx:154-169`，原本：

```tsx
{question.options && question.options.length > 0 && (
  <p className="mt-1 text-xs text-muted-foreground">
    {question.options.length}
    {' '}
    個選項
    {question.correctAnswers && question.correctAnswers.length > 0 && (
      <span className="ml-1 text-green-600">
        ·
        {' '}
        {question.correctAnswers.length}
        {' '}
        個正確答案
      </span>
    )}
  </p>
)}
```

改成：

```tsx
{question.type === 'cloze'
  ? (
      <p className="mt-1 text-xs text-muted-foreground">
        {countClozeBlanks(question.body)}
        {' '}
        個空格
      </p>
    )
  : question.options && question.options.length > 0 && (
      <p className="mt-1 text-xs text-muted-foreground">
        {question.options.length}
        {' '}
        個選項
        {question.correctAnswers && question.correctAnswers.length > 0 && (
          <span className="ml-1 text-green-600">
            ·
            {' '}
            {question.correctAnswers.length}
            {' '}
            個正確答案
          </span>
        )}
      </p>
    )}
```

- [ ] **Step 3: 手動驗證**

`npm run dev`，回到 Task 3 建立的克漏字題所在測驗編輯頁，確認題目卡片摘要行顯示「N 個空格」而不是「N 個選項」。

- [ ] **Step 4: Commit**

```bash
git add src/features/quiz/QuestionCard.tsx
git commit -m "feat(quiz): 題目卡片摘要行支援 cloze（顯示空格數）"
```

---

### Task 8: 全流程驗收

**Files:** 無新改動，純驗證。

- [ ] **Step 1: 跑完整測試套件**

Run: `npm run test`
Expected: 全部通過，含 Task 2 新增的 `src/lib/cloze.test.ts`。

- [ ] **Step 2: 型別檢查**

Run: `npm run check-types`
Expected: 無錯誤（尤其注意 `Question['type']` 窄化到 `'cloze'` 的地方型別都吃得下）。

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: 無錯誤；若有 import 排序被 ESLint 自動修正（這個 repo 的 `simple-import-sort` 對新增 import 常抱怨），跑 `npx eslint --fix .` 後重新檢查。

- [ ] **Step 4: 端到端手動驗收（`npm run dev`）**

完整走一輪：
1. 建立新測驗，新增一題克漏字題（貼一段中英混合文章，手動標記 2 個 + 隨機挑選 2 個，共 4 個空格），另外加一題單選題陪測。
2. 用「平均配分」把總分打散到兩題。
3. 用學生連結作答：克漏字題答對 3/4 空格，單選題答對。
4. 送出後確認：
   - 克漏字題得分 = `round(該題配分 × 3/4)`。
   - 總分計算正確。
   - 結果頁看不到任何 `[[ ]]` 標記。
5. 老師端成績報表確認這位學生的分數與逐題明細正常顯示（不會因為 cloze 的 `answer` 是字串陣列而壞掉）。
6. 下載學習報告 PDF，確認克漏字題那行文字乾淨（無標記外洩）。

- [ ] **Step 5: 最終 commit（若驗收過程有修正）**

```bash
git add -A
git commit -m "chore(quiz): cloze 題型全流程驗收修正"
```
