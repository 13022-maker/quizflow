# 段考命題助手（Exam Builder）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v1 段考命題助手 — a single-paper exam-building tool where a teacher pastes/imports questions, gets live scoring/unit-balance checks and a two-way specification table (單元 × Bloom), and exports A/B papers + answer sheets.

**Architecture:** A brand-new module (`exam_paper`/`exam_item`/`exam_unit_hour` tables) independent of the existing `quiz`/`question` system. Pure, unit-tested logic (text parsing, deterministic shuffle, balance/matrix math) lives in `src/lib/examBuilder/`; all mutations go through `src/actions/examBuilderActions.ts` (Zod-validated, ownerId-checked); one server-component page finds-or-creates the teacher's single paper and hands it to a client component tree.

**Tech Stack:** Next.js App Router (Server Components + Server Actions), Drizzle ORM / PostgreSQL (PGlite in tests), Zod, Vitest + React Testing Library, Tailwind (hand-rolled UI, no shadcn Dialog/Tabs in this codebase).

**Spec:** `docs/superpowers/specs/2026-10-11-exam-builder-design.md`

> **⚠️ 已暫停：v1 已由 PR #80 取代，保留作為 v2 雲端版藍圖。** 執行前先讀 spec 開頭的說明與解凍條件。

## Global Constraints

- `points` is stored as `integer` (matches existing `question.points` convention), not `numeric` — the spec's example data never uses decimals, and this avoids drizzle's numeric-as-string footgun. If a future teacher needs half-points, that's a follow-up.
- No `next-intl` translation keys for this feature. Recently-added standalone tool pages (`dashboard/import/page.tsx`, `AIGenerateDialog.tsx`, etc.) hardcode 繁體中文 directly and skip `useTranslations`; this feature follows that established, more-recent pattern rather than the older `Quizzes` page's i18n pattern.
- No shadcn `Dialog`/`Tabs` components exist in `src/components/ui/`. Modals and tab-like UI are hand-rolled (`fixed inset-0` overlay + absolute panel, local `useState` for active tab) — follow that pattern exactly, do not add new UI library dependencies.
- All new Zod schemas live as **unexported** `const` inside `'use server'` files (only `export type ... = z.infer<...>` is exported) — exporting a Zod schema object from a `'use server'` file breaks the build (see `feedback_use_server_export_restriction` memory); `npm run build` must be run at least once before this plan is considered done, since `check-types`/`vitest` do not catch this.
- Migration file naming: `CLAUDE.md`'s mandatory rename procedure (`.sql` file, `meta/*_snapshot.json`, `meta/_journal.json` `tag` field, then re-run `db:generate` to confirm "No schema changes") applies to Task 1 and must not be skipped.
- Server actions use `ownerId` (Clerk `userId`), never `orgId` — this project removed Clerk Organizations.

## Review Focus

- **Re-pasting after manual edits**: a teacher edits one item's points via the item list, then re-pastes the textarea to fix a typo elsewhere — the edited item must survive untouched because it's `source='pasted'` too. (Spec explicitly accepts losing this, but the *other* `source='imported'` items must never be touched by a paste — Task 6's test must prove the `source` filter, not just that paste works.)
- **Partially-broken batches**: one bad block in a 20-question paste must not blank out the other 19 — `parseExamText` must keep returning the 19 good items with the bad one's slot as `null` + an error, and the server action must only persist the good ones.
- **Unicode-lookalike answer tokens**: a teacher typing fullwidth `Ｏ`/`Ｘ` (common from IME autocomplete) or lowercase `o`/`x` for a true/false answer must still parse correctly — this is a silent-wrong-grade risk if missed, not just a UI inconvenience.
- **Shuffle determinism across time**: regenerating `shuffleSeed` must only happen on an explicit action call, never as a side effect of simply reading/rendering the B-paper twice — a flaky test here would hide a correctness bug that only shows up as "my printed B paper doesn't match the answer key I filed."
- **Matrix/total invariant**: the two-way spec table's cell sum must always equal the live total-points display, including items with `unit: null` and/or `cognitiveLevel: null` landing in "未分類" — a silent off-by-N here means the table a teacher hands to 教務處 doesn't add up.

---

## Task 1: Database schema — `exam_paper` / `exam_item` / `exam_unit_hour`

**Files:**
- Modify: `src/models/Schema.ts` (append new section at end of file)
- Create: `migrations/<date>_exam_builder.sql` (generated then renamed per `CLAUDE.md`)
- Create: `migrations/meta/<date>_exam_builder_snapshot.json` (generated then renamed)
- Modify: `migrations/meta/_journal.json` (generated entry's `tag` field renamed to match)

**Interfaces:**
- Produces: `examPaperSchema`, `examItemSchema`, `examUnitHourSchema` (Drizzle `pgTable`s), `examItemTypeEnum`, `examItemSourceEnum`, `bloomLevelEnum` (Drizzle `pgEnum`s) — exported from `src/models/Schema.ts`, consumed by every later task.

- [ ] **Step 1: Append the new schema section to `src/models/Schema.ts`**

Add at the end of the file (all imports used — `pgEnum`, `pgTable`, `serial`, `text`, `integer`, `jsonb`, `timestamp`, `uniqueIndex` — are already imported at the top of this file):

```ts
// ---------- exam builder（段考命題助手）----------
// 獨立於 quiz/question 之外的全新模組：給老師排段考紙本考卷用，
// 不是學生線上作答的 quiz。exam_paper 每個老師只有一筆
// （owner_id 唯一索引保證，見 examPaperOwnerIdUniqueIdx）。

export const examItemTypeEnum = pgEnum('exam_item_type', [
  'single_choice',
  'true_false',
  'fill_in_blank',
  'short_answer',
]);

// pasted = 老師貼上文字解析出來的題目；imported = 從既有 quiz/question 題庫匯入的題目。
// 「貼上並解析」只整批覆蓋 source='pasted' 的題目，不動 source='imported' 的。
export const examItemSourceEnum = pgEnum('exam_item_source', ['pasted', 'imported']);

// Bloom 修訂版認知層次六層，固定值，parser 跟逐題編輯都只接受這六個。
export const bloomLevelEnum = pgEnum('bloom_level', [
  'remember',
  'understand',
  'apply',
  'analyze',
  'evaluate',
  'create',
]);

export const examPaperSchema = pgTable(
  'exam_paper',
  {
    id: serial('id').primaryKey(),
    ownerId: text('owner_id').notNull(), // Clerk user ID
    school: text('school'),
    academicYear: text('academic_year'), // 學年度／學期
    examName: text('exam_name'),
    subject: text('subject'),
    gradeLevel: text('grade_level'),
    durationMinutes: integer('duration_minutes'),
    teacherName: text('teacher_name'),
    examScope: text('exam_scope'),
    deviationThreshold: integer('deviation_threshold').default(5).notNull(), // 偏差警示門檻（±百分點）
    shuffleSeed: integer('shuffle_seed'), // B 卷打亂種子；null = 尚未產生過 B 卷
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => {
    return {
      // 每個老師只能有一份考卷（find-or-create 用 ON CONFLICT (owner_id) DO NOTHING 保證不重複）
      ownerIdUniqueIdx: uniqueIndex('exam_paper_owner_id_unique_idx').on(table.ownerId),
    };
  },
);

export const examItemSchema = pgTable('exam_item', {
  id: serial('id').primaryKey(),
  paperId: integer('paper_id')
    .notNull()
    .references(() => examPaperSchema.id, { onDelete: 'cascade' }),
  source: examItemSourceEnum('source').notNull(),
  position: integer('position').notNull(),
  type: examItemTypeEnum('type').notNull(),
  unit: text('unit'), // 單元，自由文字，可為 null（未分類）
  cognitiveLevel: bloomLevelEnum('cognitive_level'), // 可為 null（未分類）
  points: integer('points').notNull(),
  stem: text('stem').notNull(), // 題幹原文，含 `> ` 程式碼行與 `____` 填空標記
  // 僅 single_choice 使用；[{ label: "A", text: "int" }, ...]；存檔後不可增減筆數
  options: jsonb('options').$type<{ label: string; text: string }[]>(),
  // 選擇題存字母；是非題存 O/X；填空/簡答存原文（不結構化比對）
  answer: text('answer').notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

export const examUnitHourSchema = pgTable('exam_unit_hour', {
  id: serial('id').primaryKey(),
  paperId: integer('paper_id')
    .notNull()
    .references(() => examPaperSchema.id, { onDelete: 'cascade' }),
  unitName: text('unit_name').notNull(),
  hours: integer('hours').notNull(),
});
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`

Expected: a new file like `migrations/00XX_<random_name>.sql` and a matching `migrations/meta/00XX_<random_name>_snapshot.json`, plus a new entry appended to `migrations/meta/_journal.json`.

- [ ] **Step 3: Rename the migration per `CLAUDE.md`'s mandatory procedure**

Using today's date (check with `date +%Y%m%d`), rename:
1. `migrations/00XX_<random_name>.sql` → `migrations/<YYYYMMDD>_exam_builder.sql`
2. `migrations/meta/00XX_<random_name>_snapshot.json` → `migrations/meta/<YYYYMMDD>_exam_builder_snapshot.json`
3. In `migrations/meta/_journal.json`, find the entry you just generated and change its `"tag"` field to `"<YYYYMMDD>_exam_builder"` (no extension).

- [ ] **Step 4: Verify the rename didn't break drizzle-kit's bookkeeping**

Run: `npm run db:generate`

Expected output: `No schema changes, nothing to migrate` (or equivalent). If it tries to generate a new migration, the rename in Step 3 was done wrong — fix it before continuing.

- [ ] **Step 5: Sanity-check the new tables load in the in-memory test DB**

Run: `npx vitest run src/libs/youtube.test.ts` (any existing passing test file — this just confirms migrations still apply cleanly to the PGlite test DB used by `src/libs/DB.ts`)

Expected: PASS, no migration errors in output.

- [ ] **Step 6: Commit**

```bash
git add src/models/Schema.ts migrations/
git commit -m "feat(exam-builder): add exam_paper/exam_item/exam_unit_hour schema"
```

---

## Task 2: `parseExamText` — batch-paste parser (pure, TDD)

**Files:**
- Create: `src/lib/examBuilder/parseExamText.ts`
- Test: `src/lib/examBuilder/parseExamText.test.ts`

**Interfaces:**
- Consumes: nothing (pure function, no imports from other new modules)
- Produces: `parseExamText(text: string): ParseExamTextResult`, and types `ExamItemType`, `BloomLevel`, `ParsedOption`, `ParsedExamItem`, `ParseExamTextError`, `ParseExamTextResult` — consumed by Task 5 (`pasteAndParseExamItems` server action) and Task 9 (`PasteAndParsePanel` live preview).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/examBuilder/parseExamText.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { parseExamText } from './parseExamText';

describe('parseExamText', () => {
  it('解析完整四欄格式的選擇題（單元 + 認知層次）', () => {
    const result = parseExamText(`選擇｜變數｜記憶｜4
下列何者不是 Python 的資料型態？
(A) int (B) str (C) loop (D) bool
答案：C`);

    expect(result.errors).toEqual([]);
    expect(result.items).toEqual([
      {
        type: 'single_choice',
        unit: '變數',
        cognitiveLevel: 'remember',
        points: 4,
        stem: '下列何者不是 Python 的資料型態？',
        options: [
          { label: 'A', text: 'int' },
          { label: 'B', text: 'str' },
          { label: 'C', text: 'loop' },
          { label: 'D', text: 'bool' },
        ],
        answer: 'C',
      },
    ]);
  });

  it('是非題答案 X：三欄格式（題型｜單元｜配分）', () => {
    const result = parseExamText(`是非｜迴圈｜3
range(5) 會產生 0 到 5 共六個整數。
答案：X`);

    expect(result.errors).toEqual([]);
    expect(result.items[0]).toEqual({
      type: 'true_false',
      unit: '迴圈',
      cognitiveLevel: null,
      points: 3,
      stem: 'range(5) 會產生 0 到 5 共六個整數。',
      options: null,
      answer: 'X',
    });
  });

  it('兩欄格式（題型｜配分）：單元與認知層次都是 null', () => {
    const result = parseExamText(`簡答｜5
請說明變數與常數的差異。
答案：變數可變、常數不可變`);

    expect(result.errors).toEqual([]);
    expect(result.items[0]).toMatchObject({
      type: 'short_answer',
      unit: null,
      cognitiveLevel: null,
      points: 5,
      answer: '變數可變、常數不可變',
    });
  });

  it('選項分成多行也能解析（一行一個選項）', () => {
    const result = parseExamText(`選擇｜2
以下哪個是迴圈語法？
(A) if
(B) for
(C) def
(D) class
答案：B`);

    expect(result.errors).toEqual([]);
    expect(result.items[0]?.options).toEqual([
      { label: 'A', text: 'if' },
      { label: 'B', text: 'for' },
      { label: 'C', text: 'def' },
      { label: 'D', text: 'class' },
    ]);
  });

  it('> 開頭的程式碼行永遠不會被當成選項，即使內容長得像 (A)', () => {
    const result = parseExamText(`選擇｜2
下列程式執行後 x 的值是？
> x = 1
> # (A) 這是註解不是選項
(A) 1 (B) 2
答案：A`);

    expect(result.errors).toEqual([]);
    expect(result.items[0]?.stem).toBe('下列程式執行後 x 的值是？\n> x = 1\n> # (A) 這是註解不是選項');
    expect(result.items[0]?.options).toEqual([
      { label: 'A', text: '1' },
      { label: 'B', text: '2' },
    ]);
  });

  it('是非題答案接受全形 Ｏ／Ｘ 與小寫 o/x', () => {
    const fullwidthO = parseExamText('是非｜1\n陳述。\n答案：Ｏ');
    const lowercaseX = parseExamText('是非｜1\n陳述。\n答案：x');

    expect(fullwidthO.items[0]?.answer).toBe('O');
    expect(lowercaseX.items[0]?.answer).toBe('X');
  });

  it('填空/簡答答案原文存檔，不做格式驗證', () => {
    const result = parseExamText('填空｜2\n1 + 1 = ____\n答案：隨便寫什麼都存起來！？');

    expect(result.errors).toEqual([]);
    expect(result.items[0]?.answer).toBe('隨便寫什麼都存起來！？');
  });

  it('不支援的題型回報錯誤，不中斷整批（其他題目照常解析）', () => {
    const result = parseExamText(`申論｜5
這題題型不在白名單
答案：X

是非｜1
這題應該正常
答案：O`);

    expect(result.items).toEqual([null, {
      type: 'true_false',
      unit: null,
      cognitiveLevel: null,
      points: 1,
      stem: '這題應該正常',
      options: null,
      answer: 'O',
    }]);
    expect(result.errors).toEqual([{ index: 0, message: expect.stringContaining('選擇／是非／填空／簡答') }]);
  });

  it('認知層次不在六個 Bloom 值白名單內回報錯誤', () => {
    const result = parseExamText('選擇｜變數｜困難｜4\n題幹\n(A) a (B) b\n答案：A');

    expect(result.items).toEqual([null]);
    expect(result.errors[0]?.message).toContain('認知層次');
  });

  it('配分不是數字回報錯誤', () => {
    const result = parseExamText('選擇｜很多分\n題幹\n(A) a (B) b\n答案：A');

    expect(result.errors[0]?.message).toContain('配分');
  });

  it('選項字母跳號（缺 B）回報錯誤', () => {
    const result = parseExamText('選擇｜2\n題幹\n(A) a (C) c\n答案：A');

    expect(result.errors[0]?.message).toContain('連續');
  });

  it('答案字母不在選項範圍內回報錯誤', () => {
    const result = parseExamText('選擇｜2\n題幹\n(A) a (B) b\n答案：C');

    expect(result.errors[0]?.message).toContain('答案');
  });

  it('是非題答案不是 O/X 回報錯誤', () => {
    const result = parseExamText('是非｜1\n陳述。\n答案：對');

    expect(result.errors[0]?.message).toContain('O 或 X');
  });

  it('缺少「答案：」那一行回報錯誤', () => {
    const result = parseExamText('簡答｜5\n只有題幹沒有答案行');

    expect(result.errors[0]?.message).toContain('答案');
  });

  it('「答案：」不是最後一行回報錯誤', () => {
    const result = parseExamText('簡答｜5\n答案：這行在中間\n還有一行題幹');

    expect(result.errors[0]?.message).toContain('最後一行');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/examBuilder/parseExamText.test.ts`
Expected: FAIL — `Cannot find module './parseExamText'` (file doesn't exist yet).

- [ ] **Step 3: Implement `parseExamText.ts`**

Create `src/lib/examBuilder/parseExamText.ts`:

```ts
// parseExamText — 把老師貼上的「題型｜單元｜認知層次｜配分」格式文字解析成結構化題目。
// 純函式，不碰 DB／AI。每題獨立驗證，一題錯誤不會讓整批解析失敗
// （items 跟 blocks 一一對應，解析失敗的那題是 null，詳細原因記在 errors）。
// 規則細節見 docs/superpowers/specs/2026-10-11-exam-builder-design.md「批次貼上解析規則」。

export type ExamItemType = 'single_choice' | 'true_false' | 'fill_in_blank' | 'short_answer';
export type BloomLevel = 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';

export type ParsedOption = { label: string; text: string };

export type ParsedExamItem = {
  type: ExamItemType;
  unit: string | null;
  cognitiveLevel: BloomLevel | null;
  points: number;
  stem: string;
  options: ParsedOption[] | null;
  answer: string;
};

export type ParseExamTextError = { index: number; message: string };

export type ParseExamTextResult = {
  items: (ParsedExamItem | null)[];
  errors: ParseExamTextError[];
};

const TYPE_LABELS: Record<string, ExamItemType> = {
  選擇: 'single_choice',
  是非: 'true_false',
  填空: 'fill_in_blank',
  簡答: 'short_answer',
};

const BLOOM_LABELS: Record<string, BloomLevel> = {
  記憶: 'remember',
  理解: 'understand',
  應用: 'apply',
  分析: 'analyze',
  評鑑: 'evaluate',
  創造: 'create',
};

const OPTION_MARKER_RE = /\([A-Z]\)/;
const OPTION_PAIR_RE = /\(([A-Z])\)\s*([^()]*?)(?=\s*\([A-Z]\)|$)/g;

type HeaderOk = { type: ExamItemType; unit: string | null; cognitiveLevel: BloomLevel | null; points: number };
type Err = { error: string };

function isOptionLine(line: string): boolean {
  return !line.startsWith('> ') && OPTION_MARKER_RE.test(line);
}

function parseHeader(line: string): HeaderOk | Err {
  const fields = line.split(/[｜|]/).map(f => f.trim());

  if (fields.length < 2 || fields.length > 4) {
    return { error: '標頭格式錯誤，須為「題型｜配分」、「題型｜單元｜配分」或「題型｜單元｜認知層次｜配分」' };
  }

  const typeLabel = fields[0]!;
  const type = TYPE_LABELS[typeLabel];
  if (!type) {
    return { error: `不支援的題型「${typeLabel}」，須為選擇／是非／填空／簡答` };
  }

  const pointsText = fields[fields.length - 1]!;
  const points = Number(pointsText);
  if (!Number.isFinite(points) || points <= 0) {
    return { error: `配分「${pointsText}」不是有效數字` };
  }

  let unit: string | null = null;
  let cognitiveLevel: BloomLevel | null = null;

  if (fields.length === 3) {
    unit = fields[1]!;
  } else if (fields.length === 4) {
    unit = fields[1]!;
    const levelLabel = fields[2]!;
    const level = BLOOM_LABELS[levelLabel];
    if (!level) {
      return { error: `認知層次「${levelLabel}」不是記憶／理解／應用／分析／評鑑／創造之一` };
    }
    cognitiveLevel = level;
  }

  return { type, unit, cognitiveLevel, points };
}

function parseOptionLines(optionLines: string[]): { options: ParsedOption[] } | Err {
  const options: ParsedOption[] = [];
  for (const line of optionLines) {
    for (const m of line.matchAll(OPTION_PAIR_RE)) {
      options.push({ label: m[1]!, text: m[2]!.trim() });
    }
  }

  for (let i = 0; i < options.length; i++) {
    const expected = String.fromCharCode(65 + i);
    if (options[i]!.label !== expected) {
      return { error: `選項字母必須從 A 開始連續，第 ${i + 1} 個選項卻是「${options[i]!.label}」` };
    }
  }

  return { options };
}

function parseAnswer(
  type: ExamItemType,
  answerText: string,
  options: ParsedOption[] | null,
): { answer: string } | Err {
  if (type === 'single_choice') {
    const letter = answerText.toUpperCase();
    const valid = (options ?? []).some(o => o.label === letter);
    if (!valid) {
      return { error: `答案「${answerText}」不是這題選項裡的字母` };
    }
    return { answer: letter };
  }

  if (type === 'true_false') {
    const normalized = answerText.trim().toUpperCase().replace(/Ｏ/g, 'O').replace(/Ｘ/g, 'X');
    if (normalized !== 'O' && normalized !== 'X') {
      return { error: `是非題答案「${answerText}」必須是 O 或 X` };
    }
    return { answer: normalized };
  }

  // fill_in_blank / short_answer：原文整段存入，不驗證格式
  return { answer: answerText };
}

function parseBlock(block: string): { item: ParsedExamItem } | Err {
  const lines = block.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 2) {
    return { error: '格式錯誤：至少需要標頭行與答案行' };
  }

  const answerLineIndex = lines.findIndex(l => /^答案[：:]/.test(l));
  if (answerLineIndex === -1) {
    return { error: '找不到「答案：」那一行' };
  }
  if (answerLineIndex !== lines.length - 1) {
    return { error: '「答案：」必須是這題的最後一行' };
  }

  const header = parseHeader(lines[0]!);
  if ('error' in header) {
    return header;
  }

  const bodyLines = lines.slice(1, answerLineIndex);
  if (bodyLines.length === 0) {
    return { error: '缺少題幹內容' };
  }

  let stem: string;
  let options: ParsedOption[] | null = null;

  if (header.type === 'single_choice') {
    const stemLines = bodyLines.filter(l => !isOptionLine(l));
    const optionLines = bodyLines.filter(l => isOptionLine(l));
    if (stemLines.length === 0) {
      return { error: '缺少題幹內容' };
    }
    stem = stemLines.join('\n');

    const parsedOptions = parseOptionLines(optionLines);
    if ('error' in parsedOptions) {
      return parsedOptions;
    }
    if (parsedOptions.options.length === 0) {
      return { error: '選擇題找不到任何選項，格式須為「(A) 內容」' };
    }
    options = parsedOptions.options;
  } else {
    stem = bodyLines.join('\n');
  }

  const answerText = lines[answerLineIndex]!.replace(/^答案[：:]/, '').trim();
  const answerResult = parseAnswer(header.type, answerText, options);
  if ('error' in answerResult) {
    return answerResult;
  }

  return {
    item: {
      type: header.type,
      unit: header.unit,
      cognitiveLevel: header.cognitiveLevel,
      points: header.points,
      stem,
      options,
      answer: answerResult.answer,
    },
  };
}

export function parseExamText(text: string): ParseExamTextResult {
  const blocks = text
    .split(/\r?\n\s*\r?\n/)
    .map(b => b.trim())
    .filter(b => b.length > 0);

  const items: (ParsedExamItem | null)[] = [];
  const errors: ParseExamTextError[] = [];

  blocks.forEach((block, index) => {
    const result = parseBlock(block);
    if ('error' in result) {
      items.push(null);
      errors.push({ index, message: result.error });
    } else {
      items.push(result.item);
    }
  });

  return { items, errors };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/examBuilder/parseExamText.test.ts`
Expected: PASS, all 15 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/examBuilder/parseExamText.ts src/lib/examBuilder/parseExamText.test.ts
git commit -m "feat(exam-builder): add parseExamText batch-paste parser"
```

---

## Task 3: `shuffle` — deterministic seeded shuffle for B-paper (pure, TDD)

**Files:**
- Create: `src/lib/examBuilder/shuffle.ts`
- Test: `src/lib/examBuilder/shuffle.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `seededShuffle<T>(items: T[], seed: number): T[]`, `shuffleItemsWithinType<T extends { type: string }>(items: T[], seed: number): T[]`, `shuffleOptionsWithRelabel(options: { label: string; text: string }[], seed: number): { options: { label: string; text: string }[]; remapAnswerLetter: (originalLetter: string) => string }` — consumed by Task 7 (`regenerateShuffleSeed`/`ensureShuffleSeed`) and Task 14 (`ExamExportPreview`'s B-paper rendering).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/examBuilder/shuffle.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { seededShuffle, shuffleItemsWithinType, shuffleOptionsWithRelabel } from './shuffle';

describe('seededShuffle', () => {
  it('同一個 seed 兩次呼叫結果完全一致（deterministic）', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const first = seededShuffle(items, 42);
    const second = seededShuffle(items, 42);
    expect(first).toEqual(second);
  });

  it('不同 seed 對同一組資料結果不同', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = seededShuffle(items, 1);
    const b = seededShuffle(items, 2);
    expect(a).not.toEqual(b);
  });

  it('不改動原陣列，且打亂後元素集合不變', () => {
    const items = [1, 2, 3, 4, 5];
    const result = seededShuffle(items, 7);
    expect(items).toEqual([1, 2, 3, 4, 5]);
    expect([...result].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('shuffleItemsWithinType', () => {
  it('同題型內打亂，不會跨題型混排（每個 slot 的題型維持跟原本一樣）', () => {
    const items = [
      { id: 'a', type: 'single_choice' },
      { id: 'b', type: 'single_choice' },
      { id: 'c', type: 'true_false' },
      { id: 'd', type: 'single_choice' },
      { id: 'e', type: 'true_false' },
    ];
    const result = shuffleItemsWithinType(items, 99);

    expect(result.map(r => r.type)).toEqual(items.map(i => i.type));
    expect(result.map(r => r.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('同一個 seed 結果 deterministic', () => {
    const items = [
      { id: 'a', type: 'single_choice' },
      { id: 'b', type: 'single_choice' },
      { id: 'c', type: 'single_choice' },
    ];
    expect(shuffleItemsWithinType(items, 5)).toEqual(shuffleItemsWithinType(items, 5));
  });
});

describe('shuffleOptionsWithRelabel', () => {
  it('打亂後重新編號為 A/B/C/...，且 remapAnswerLetter 能把舊字母換成新字母', () => {
    const options = [
      { label: 'A', text: 'int' },
      { label: 'B', text: 'str' },
      { label: 'C', text: 'loop' },
      { label: 'D', text: 'bool' },
    ];
    const { options: shuffled, remapAnswerLetter } = shuffleOptionsWithRelabel(options, 3);

    expect(shuffled.map(o => o.label)).toEqual(['A', 'B', 'C', 'D']);
    expect([...shuffled.map(o => o.text)].sort()).toEqual(['bool', 'int', 'loop', 'str']);

    // 原本答案是 C（loop）；打亂後 loop 在哪個新字母，remap 就該指到那個字母
    const newLetterForLoop = shuffled.find(o => o.text === 'loop')!.label;
    expect(remapAnswerLetter('C')).toBe(newLetterForLoop);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/examBuilder/shuffle.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `shuffle.ts`**

Create `src/lib/examBuilder/shuffle.ts`:

```ts
// shuffle — B 卷用的 deterministic 打亂邏輯。同一個 seed 任何時候算出來都一樣，
// 老師今天預覽、印出存底，隔天重開頁面重印，B 卷跟答案卷必須完全對得上。

// mulberry32：小巧、足夠均勻分布的 seeded PRNG，不需要額外套件。
function createSeededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: T[], seed: number): T[] {
  const rng = createSeededRng(seed);
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

// 把同題型的題目各自打亂，但每個 slot（原始位置）只會被同題型的題目佔住，
// 不會讓選擇題跑到是非題的位置——避免印出來的考卷題型順序整個打散看起來很怪。
export function shuffleItemsWithinType<T extends { type: string }>(items: T[], seed: number): T[] {
  const slotsByType = new Map<string, number[]>();
  items.forEach((item, slot) => {
    const slots = slotsByType.get(item.type) ?? [];
    slots.push(slot);
    slotsByType.set(item.type, slots);
  });

  const result = [...items];
  let typeOffset = 0;
  for (const slots of slotsByType.values()) {
    const group = slots.map(slot => items[slot]!);
    const shuffledGroup = seededShuffle(group, seed + typeOffset);
    slots.forEach((slot, i) => {
      result[slot] = shuffledGroup[i]!;
    });
    typeOffset += 1;
  }
  return result;
}

export type ShuffledOptionsResult = {
  options: { label: string; text: string }[];
  remapAnswerLetter: (originalLetter: string) => string;
};

// 打亂選項後重新編號 A/B/C/...，並回傳「舊字母 → 新字母」的換算函式，
// 給答案卷用（選擇題的正解字母在 B 卷上跟 A 卷不一樣）。
export function shuffleOptionsWithRelabel(
  options: { label: string; text: string }[],
  seed: number,
): ShuffledOptionsResult {
  const shuffled = seededShuffle(options, seed);
  const originalLabelToNewLabel = new Map<string, string>();
  shuffled.forEach((opt, i) => {
    originalLabelToNewLabel.set(opt.label, String.fromCharCode(65 + i));
  });
  const relabeled = shuffled.map((opt, i) => ({ label: String.fromCharCode(65 + i), text: opt.text }));

  return {
    options: relabeled,
    remapAnswerLetter: (originalLetter: string) => originalLabelToNewLabel.get(originalLetter) ?? originalLetter,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/examBuilder/shuffle.test.ts`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/examBuilder/shuffle.ts src/lib/examBuilder/shuffle.test.ts
git commit -m "feat(exam-builder): add deterministic seeded shuffle for B paper"
```

---

## Task 4: `checks` — balance checks + two-way specification matrix (pure, TDD)

**Files:**
- Create: `src/lib/examBuilder/checks.ts`
- Test: `src/lib/examBuilder/checks.test.ts`

**Interfaces:**
- Consumes: `BloomLevel` type from `./parseExamText` (Task 2)
- Produces: `normalizeUnitName`, `calcUnitPointsBreakdown`, `calcUnitHoursBreakdown`, `calcUnitDeviation`, `BLOOM_LEVELS`, `calcSpecMatrix` and their types — consumed by Task 12 (`UnitHoursPanel`) and Task 13 (`SpecMatrixTable`).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/examBuilder/checks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { calcSpecMatrix, calcUnitDeviation, calcUnitHoursBreakdown, calcUnitPointsBreakdown, normalizeUnitName } from './checks';

describe('normalizeUnitName', () => {
  it('去除頭尾空白並把全形空格統一成半形', () => {
    expect(normalizeUnitName('  迴圈　結構 ')).toBe('迴圈 結構');
  });
});

describe('calcUnitPointsBreakdown', () => {
  it('依單元分組加總配分與百分比，null 歸入未分類', () => {
    const result = calcUnitPointsBreakdown([
      { unit: '變數', points: 30 },
      { unit: '變數', points: 20 },
      { unit: '迴圈', points: 40 },
      { unit: null, points: 10 },
    ]);

    expect(result).toEqual([
      { unit: '變數', points: 50, percentage: 50 },
      { unit: '迴圈', points: 40, percentage: 40 },
      { unit: '未分類', points: 10, percentage: 10 },
    ]);
  });
});

describe('calcUnitHoursBreakdown', () => {
  it('依節數算百分比，單元名稱經過正規化', () => {
    const result = calcUnitHoursBreakdown([
      { unitName: ' 變數 ', hours: 6 },
      { unitName: '迴圈', hours: 4 },
    ]);

    expect(result).toEqual([
      { unit: '變數', hours: 6, percentage: 60 },
      { unit: '迴圈', hours: 4, percentage: 40 },
    ]);
  });
});

describe('calcUnitDeviation', () => {
  it('配分占比跟節數占比差超過門檻才標警示', () => {
    const points = calcUnitPointsBreakdown([
      { unit: '變數', points: 60 },
      { unit: '迴圈', points: 40 },
    ]);
    const hours = calcUnitHoursBreakdown([
      { unitName: '變數', hours: 5 },
      { unitName: '迴圈', hours: 5 },
    ]);

    const result = calcUnitDeviation(points, hours, 5);

    const variable = result.find(r => r.unit === '變數')!;
    expect(variable.pointsPercentage).toBe(60);
    expect(variable.hoursPercentage).toBe(50);
    expect(variable.deviation).toBe(10);
    expect(variable.exceedsThreshold).toBe(true);

    const loop = result.find(r => r.unit === '迴圈')!;
    expect(loop.deviation).toBe(10);
    expect(loop.exceedsThreshold).toBe(true);
  });

  it('單元只出現在節數清單或只出現在題目裡，標示為未對應（null 百分比）', () => {
    const points = calcUnitPointsBreakdown([{ unit: '變數', points: 100 }]);
    const hours = calcUnitHoursBreakdown([{ unitName: '迴圈', hours: 10 }]);

    const result = calcUnitDeviation(points, hours, 5);

    const variable = result.find(r => r.unit === '變數')!;
    expect(variable.hoursPercentage).toBeNull();
    expect(variable.deviation).toBeNull();
    expect(variable.exceedsThreshold).toBe(false);

    const loop = result.find(r => r.unit === '迴圈')!;
    expect(loop.pointsPercentage).toBeNull();
  });
});

describe('calcSpecMatrix', () => {
  it('依單元 × 認知層次分組，null 都歸未分類；每格配分加總等於總分（不變量）', () => {
    const items = [
      { unit: '變數', cognitiveLevel: 'remember' as const, points: 4 },
      { unit: '變數', cognitiveLevel: 'remember' as const, points: 3 },
      { unit: '迴圈', cognitiveLevel: 'understand' as const, points: 5 },
      { unit: null, cognitiveLevel: null, points: 2 },
    ];

    const matrix = calcSpecMatrix(items);
    const totalInMatrix = matrix.reduce(
      (sum, row) => sum + Object.values(row.cells).reduce((s, c) => s + c.points, 0),
      0,
    );
    const totalPoints = items.reduce((s, i) => s + i.points, 0);
    expect(totalInMatrix).toBe(totalPoints);

    const variableRow = matrix.find(r => r.unit === '變數')!;
    expect(variableRow.cells.remember).toEqual({ points: 7, count: 2 });

    const uncategorizedRow = matrix.find(r => r.unit === '未分類')!;
    expect(uncategorizedRow.cells['未分類']).toEqual({ points: 2, count: 1 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/examBuilder/checks.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `checks.ts`**

Create `src/lib/examBuilder/checks.ts`:

```ts
// checks — 配分 vs 節數的單元占比比較，以及雙向細目表（單元 × 認知層次）矩陣計算。
// 純函式，輸入輸出都不碰 DB。

import type { BloomLevel } from './parseExamText';

export function normalizeUnitName(name: string): string {
  return name.trim().replace(/　/g, ' ').replace(/\s+/g, ' ');
}

export type UnitPointsBreakdown = { unit: string; points: number; percentage: number };

export function calcUnitPointsBreakdown(items: { unit: string | null; points: number }[]): UnitPointsBreakdown[] {
  const total = items.reduce((sum, i) => sum + i.points, 0);
  const order: string[] = [];
  const totals = new Map<string, number>();

  for (const item of items) {
    const key = item.unit ?? '未分類';
    if (!totals.has(key)) {
      order.push(key);
      totals.set(key, 0);
    }
    totals.set(key, totals.get(key)! + item.points);
  }

  return order.map(unit => ({
    unit,
    points: totals.get(unit)!,
    percentage: total === 0 ? 0 : (totals.get(unit)! / total) * 100,
  }));
}

export type UnitHoursBreakdown = { unit: string; hours: number; percentage: number };

export function calcUnitHoursBreakdown(hours: { unitName: string; hours: number }[]): UnitHoursBreakdown[] {
  const totalHours = hours.reduce((sum, h) => sum + h.hours, 0);
  return hours.map(h => ({
    unit: normalizeUnitName(h.unitName),
    hours: h.hours,
    percentage: totalHours === 0 ? 0 : (h.hours / totalHours) * 100,
  }));
}

export type UnitDeviationRow = {
  unit: string;
  pointsPercentage: number | null;
  hoursPercentage: number | null;
  deviation: number | null;
  exceedsThreshold: boolean;
};

export function calcUnitDeviation(
  pointsBreakdown: UnitPointsBreakdown[],
  hoursBreakdown: UnitHoursBreakdown[],
  thresholdPercentagePoints: number,
): UnitDeviationRow[] {
  const units: string[] = [];
  for (const p of pointsBreakdown) {
    if (!units.includes(p.unit)) {
      units.push(p.unit);
    }
  }
  for (const h of hoursBreakdown) {
    if (!units.includes(h.unit)) {
      units.push(h.unit);
    }
  }

  return units.map((unit) => {
    const pointsPercentage = pointsBreakdown.find(p => p.unit === unit)?.percentage ?? null;
    const hoursPercentage = hoursBreakdown.find(h => h.unit === unit)?.percentage ?? null;
    const deviation = pointsPercentage !== null && hoursPercentage !== null
      ? Math.abs(pointsPercentage - hoursPercentage)
      : null;
    return {
      unit,
      pointsPercentage,
      hoursPercentage,
      deviation,
      exceedsThreshold: deviation !== null && deviation > thresholdPercentagePoints,
    };
  });
}

export const BLOOM_LEVELS: { value: BloomLevel; label: string }[] = [
  { value: 'remember', label: '記憶' },
  { value: 'understand', label: '理解' },
  { value: 'apply', label: '應用' },
  { value: 'analyze', label: '分析' },
  { value: 'evaluate', label: '評鑑' },
  { value: 'create', label: '創造' },
];

const UNCATEGORIZED = '未分類';

export type SpecMatrixCell = { points: number; count: number };
export type SpecMatrixRow = { unit: string; cells: Record<string, SpecMatrixCell> };

export function calcSpecMatrix(
  items: { unit: string | null; cognitiveLevel: BloomLevel | null; points: number }[],
): SpecMatrixRow[] {
  const columnKeys = [...BLOOM_LEVELS.map(l => l.value), UNCATEGORIZED];
  const unitOrder: string[] = [];
  const rows = new Map<string, Map<string, SpecMatrixCell>>();

  for (const item of items) {
    const unitKey = item.unit ?? UNCATEGORIZED;
    const levelKey = item.cognitiveLevel ?? UNCATEGORIZED;

    if (!rows.has(unitKey)) {
      rows.set(unitKey, new Map(columnKeys.map(k => [k, { points: 0, count: 0 }])));
      unitOrder.push(unitKey);
    }
    const cell = rows.get(unitKey)!.get(levelKey)!;
    cell.points += item.points;
    cell.count += 1;
  }

  return unitOrder.map(unit => ({ unit, cells: Object.fromEntries(rows.get(unit)!.entries()) }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/examBuilder/checks.test.ts`
Expected: PASS, all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/examBuilder/checks.ts src/lib/examBuilder/checks.test.ts
git commit -m "feat(exam-builder): add unit balance checks and two-way spec matrix"
```

---

## Task 5: Server actions — exam paper find-or-create & info update

**Files:**
- Create: `src/actions/examBuilderActions.ts`
- Test: `src/actions/examBuilderActions.test.ts`

**Interfaces:**
- Consumes: `db` from `@/libs/DB`; `examPaperSchema` from `@/models/Schema` (Task 1)
- Produces: `getOrCreateExamPaper(): Promise<typeof examPaperSchema.$inferSelect>`, `updateExamPaperInfo(paperId: number, input: ExamPaperInfoInput): Promise<typeof examPaperSchema.$inferSelect>`, type `ExamPaperInfoInput` — consumed by Task 8 (`page.tsx`, `ExamPaperInfoForm`).

- [ ] **Step 1: Write the failing tests**

Create `src/actions/examBuilderActions.test.ts`:

```ts
// Server Action 需要 Clerk 身分；固定回傳測試老師（模式沿用 buzzer.integration.test.ts）。
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getOrCreateExamPaper, updateExamPaperInfo } from '@/actions/examBuilderActions';
import { db } from '@/libs/DB';
import { examPaperSchema } from '@/models/Schema';

let currentUserId = 'user_exam_builder_test_1';

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: currentUserId }),
}));

beforeEach(async () => {
  await db.delete(examPaperSchema);
});

describe('getOrCreateExamPaper', () => {
  it('第一次呼叫會建立一筆空白考卷', async () => {
    currentUserId = 'user_exam_builder_test_1';
    const paper = await getOrCreateExamPaper();

    expect(paper.ownerId).toBe('user_exam_builder_test_1');
    expect(paper.deviationThreshold).toBe(5);
    expect(paper.shuffleSeed).toBeNull();
  });

  it('第二次呼叫回傳同一筆，不會建立第二筆', async () => {
    currentUserId = 'user_exam_builder_test_2';
    const first = await getOrCreateExamPaper();
    const second = await getOrCreateExamPaper();

    expect(second.id).toBe(first.id);

    const rows = await db.select().from(examPaperSchema).where(eq(examPaperSchema.ownerId, 'user_exam_builder_test_2'));
    expect(rows).toHaveLength(1);
  });

  it('併發呼叫兩次也只留一筆（unique index 保證）', async () => {
    currentUserId = 'user_exam_builder_test_3';
    const [a, b] = await Promise.all([getOrCreateExamPaper(), getOrCreateExamPaper()]);

    expect(a.id).toBe(b.id);
    const rows = await db.select().from(examPaperSchema).where(eq(examPaperSchema.ownerId, 'user_exam_builder_test_3'));
    expect(rows).toHaveLength(1);
  });
});

describe('updateExamPaperInfo', () => {
  it('更新考卷資訊欄位並回傳最新資料', async () => {
    currentUserId = 'user_exam_builder_test_4';
    const paper = await getOrCreateExamPaper();

    const updated = await updateExamPaperInfo(paper.id, {
      school: '測試高中',
      academicYear: '114-1',
      examName: '第一次段考',
      subject: '資訊科技',
      gradeLevel: '高一',
      durationMinutes: 50,
      teacherName: '王老師',
      examScope: '第一章到第三章',
      deviationThreshold: 8,
    });

    expect(updated).toMatchObject({
      school: '測試高中',
      academicYear: '114-1',
      examName: '第一次段考',
      subject: '資訊科技',
      gradeLevel: '高一',
      durationMinutes: 50,
      teacherName: '王老師',
      examScope: '第一章到第三章',
      deviationThreshold: 8,
    });
  });

  it('不是自己的考卷會丟錯', async () => {
    currentUserId = 'user_exam_builder_test_5';
    const paper = await getOrCreateExamPaper();

    currentUserId = 'user_exam_builder_test_6';
    await expect(updateExamPaperInfo(paper.id, {
      school: null,
      academicYear: null,
      examName: null,
      subject: null,
      gradeLevel: null,
      durationMinutes: null,
      teacherName: null,
      examScope: null,
      deviationThreshold: 5,
    })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/actions/examBuilderActions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the paper-level part of `examBuilderActions.ts`**

Create `src/actions/examBuilderActions.ts`:

```ts
'use server';

import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { examPaperSchema } from '@/models/Schema';

async function verifyPaperOwnership(paperId: number, userId: string) {
  const [paper] = await db
    .select()
    .from(examPaperSchema)
    .where(and(eq(examPaperSchema.id, paperId), eq(examPaperSchema.ownerId, userId)))
    .limit(1);
  if (!paper) {
    throw new Error('Exam paper not found or unauthorized');
  }
  return paper;
}

// 每個老師只有一份考卷：find-or-create，ON CONFLICT 讓併發呼叫也只留一筆
// （exam_paper.owner_id 有 unique index，見 Task 1）。
export async function getOrCreateExamPaper() {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('Unauthorized');
  }

  await db.insert(examPaperSchema).values({ ownerId: userId }).onConflictDoNothing({ target: examPaperSchema.ownerId });

  const [paper] = await db.select().from(examPaperSchema).where(eq(examPaperSchema.ownerId, userId)).limit(1);
  if (!paper) {
    throw new Error('Failed to find or create exam paper');
  }
  return paper;
}

const ExamPaperInfoInputSchema = z.object({
  school: z.string().trim().nullable(),
  academicYear: z.string().trim().nullable(),
  examName: z.string().trim().nullable(),
  subject: z.string().trim().nullable(),
  gradeLevel: z.string().trim().nullable(),
  durationMinutes: z.coerce.number().int().positive().nullable(),
  teacherName: z.string().trim().nullable(),
  examScope: z.string().trim().nullable(),
  deviationThreshold: z.coerce.number().int().min(0).max(100),
});

export type ExamPaperInfoInput = z.infer<typeof ExamPaperInfoInputSchema>;

export async function updateExamPaperInfo(paperId: number, input: ExamPaperInfoInput) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('Unauthorized');
  }
  await verifyPaperOwnership(paperId, userId);

  const parsed = ExamPaperInfoInputSchema.parse(input);

  const [updated] = await db
    .update(examPaperSchema)
    .set(parsed)
    .where(eq(examPaperSchema.id, paperId))
    .returning();

  if (!updated) {
    throw new Error('Failed to update exam paper');
  }
  return updated;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/actions/examBuilderActions.test.ts`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/actions/examBuilderActions.ts src/actions/examBuilderActions.test.ts
git commit -m "feat(exam-builder): add exam paper find-or-create and info update actions"
```

---

## Task 6: Server actions — paste-and-parse, quiz-bank import

**Files:**
- Modify: `src/actions/examBuilderActions.ts` (append)
- Modify: `src/actions/examBuilderActions.test.ts` (append)

**Interfaces:**
- Consumes: `parseExamText` (Task 2); `questionSchema`, `quizSchema` from `@/models/Schema`; `examItemSchema` (Task 1)
- Produces: `pasteAndParseExamItems(paperId, rawText): Promise<{ errors: ParseExamTextError[]; items: ExamItemRow[] }>`, `listImportableQuizzes(): Promise<{ id: number; title: string }[]>`, `listImportableQuestions(quizId): Promise<ImportableQuestion[]>`, `importQuestionsFromQuizBank(paperId, quizId, questionIds: number[]): Promise<ExamItemRow[]>` — consumed by Task 9 (`PasteAndParsePanel`) and Task 10 (`ImportFromQuizBankDialog`).

- [ ] **Step 1: Write the failing tests (append to `examBuilderActions.test.ts`)**

Add imports and new `describe` blocks:

```ts
import {
  getOrCreateExamPaper,
  importQuestionsFromQuizBank,
  listImportableQuestions,
  listImportableQuizzes,
  pasteAndParseExamItems,
  updateExamPaperInfo,
} from '@/actions/examBuilderActions';
import { examItemSchema, questionSchema, quizSchema } from '@/models/Schema';
```

(Replace the single-line import of `getOrCreateExamPaper, updateExamPaperInfo` with the combined import above.)

```ts
describe('pasteAndParseExamItems', () => {
  it('貼上並解析：成功的題目存檔，失敗的題目回報在 errors', async () => {
    currentUserId = 'user_exam_builder_test_10';
    const paper = await getOrCreateExamPaper();

    const result = await pasteAndParseExamItems(paper.id, `選擇｜變數｜4
題幹一
(A) a (B) b
答案：A

申論｜5
這題題型不支援
答案：X`);

    expect(result.errors).toEqual([{ index: 1, message: expect.stringContaining('選擇／是非／填空／簡答') }]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ source: 'pasted', unit: '變數', points: 4 });
  });

  it('重新貼上只覆蓋 source=pasted，不動 source=imported 的題目', async () => {
    currentUserId = 'user_exam_builder_test_11';
    const paper = await getOrCreateExamPaper();

    await pasteAndParseExamItems(paper.id, '是非｜1\n第一次貼的題目\n答案：O');

    await db.insert(examItemSchema).values({
      paperId: paper.id,
      source: 'imported',
      position: 100,
      type: 'short_answer',
      unit: null,
      cognitiveLevel: null,
      points: 5,
      stem: '匯入的題目',
      options: null,
      answer: '匯入答案',
    });

    const result = await pasteAndParseExamItems(paper.id, '是非｜1\n第二次貼的題目\n答案：X');

    expect(result.items.map(i => i.stem).sort()).toEqual(['匯入的題目', '第二次貼的題目']);
    const allItems = await db.select().from(examItemSchema).where(eq(examItemSchema.paperId, paper.id));
    expect(allItems).toHaveLength(2);
  });
});

describe('listImportableQuizzes / listImportableQuestions / importQuestionsFromQuizBank', () => {
  it('列出自己名下的 quiz，匯入題目轉換成 exam_item（單元/認知層次留空）', async () => {
    currentUserId = 'user_exam_builder_test_20';
    const paper = await getOrCreateExamPaper();

    const [quiz] = await db.insert(quizSchema).values({ ownerId: currentUserId, title: '期中複習' }).returning();
    const [mcQuestion, tfQuestion, rankQuestion] = await db.insert(questionSchema).values([
      {
        quizId: quiz!.id,
        type: 'single_choice',
        body: '下列何者是質數？',
        options: [{ id: 'opt-a', text: '4' }, { id: 'opt-b', text: '7' }],
        correctAnswers: ['opt-b'],
        points: 4,
        position: 0,
      },
      {
        quizId: quiz!.id,
        type: 'true_false',
        body: '1 是質數。',
        options: [{ id: 'tf-true', text: '正確' }, { id: 'tf-false', text: '錯誤' }],
        correctAnswers: ['tf-false'],
        points: 2,
        position: 1,
      },
      {
        quizId: quiz!.id,
        type: 'ranking',
        body: '排序題（不應該被列出來匯入）',
        points: 3,
        position: 2,
      },
    ]).returning();

    const quizzes = await listImportableQuizzes();
    expect(quizzes).toEqual([{ id: quiz!.id, title: '期中複習' }]);

    const importable = await listImportableQuestions(quiz!.id);
    expect(importable.map(q => q.id).sort()).toEqual([mcQuestion!.id, tfQuestion!.id].sort());

    const imported = await importQuestionsFromQuizBank(paper.id, quiz!.id, [mcQuestion!.id, tfQuestion!.id]);

    expect(imported).toHaveLength(2);
    const mc = imported.find(i => i.stem === '下列何者是質數？')!;
    expect(mc.source).toBe('imported');
    expect(mc.unit).toBeNull();
    expect(mc.options).toEqual([{ label: 'A', text: '4' }, { label: 'B', text: '7' }]);
    expect(mc.answer).toBe('B');

    const tf = imported.find(i => i.stem === '1 是質數。')!;
    expect(tf.answer).toBe('X');
    expect(tf.options).toBeNull();

    expect(rankQuestion).toBeDefined(); // 只是確認上面建立成功，排序題本身不該出現在 importable 清單
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/actions/examBuilderActions.test.ts`
Expected: FAIL — `pasteAndParseExamItems` etc. not exported yet.

- [ ] **Step 3: Append the item-paste/import part of `examBuilderActions.ts`**

Add to `src/actions/examBuilderActions.ts` (new imports at top, new code at bottom):

```ts
import { and, eq, inArray } from 'drizzle-orm';
```
Replace the existing `import { and, eq } from 'drizzle-orm';` line with the one above.

```ts
import { parseExamText } from '@/lib/examBuilder/parseExamText';
import { examItemSchema, questionSchema, quizSchema } from '@/models/Schema';
```
Add these alongside the existing `import { examPaperSchema } from '@/models/Schema';` (merge into one `@/models/Schema` import).

Append at the end of the file:

```ts
const IMPORTABLE_QUESTION_TYPES = ['single_choice', 'true_false', 'short_answer'] as const;

export async function pasteAndParseExamItems(paperId: number, rawText: string) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('Unauthorized');
  }
  await verifyPaperOwnership(paperId, userId);

  const { items: parsedItems, errors } = parseExamText(rawText);
  const okItems = parsedItems.filter(i => i !== null);

  await db.transaction(async (tx) => {
    await tx.delete(examItemSchema).where(and(eq(examItemSchema.paperId, paperId), eq(examItemSchema.source, 'pasted')));
    if (okItems.length > 0) {
      await tx.insert(examItemSchema).values(okItems.map((item, position) => ({
        paperId,
        source: 'pasted' as const,
        position,
        type: item.type,
        unit: item.unit,
        cognitiveLevel: item.cognitiveLevel,
        points: item.points,
        stem: item.stem,
        options: item.options,
        answer: item.answer,
      })));
    }
  });

  const items = await db.select().from(examItemSchema).where(eq(examItemSchema.paperId, paperId));
  return { errors, items };
}

export async function listImportableQuizzes() {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('Unauthorized');
  }
  return db.select({ id: quizSchema.id, title: quizSchema.title }).from(quizSchema).where(eq(quizSchema.ownerId, userId));
}

export async function listImportableQuestions(quizId: number) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('Unauthorized');
  }
  const [quiz] = await db.select({ id: quizSchema.id }).from(quizSchema).where(and(eq(quizSchema.id, quizId), eq(quizSchema.ownerId, userId))).limit(1);
  if (!quiz) {
    throw new Error('Quiz not found or unauthorized');
  }

  return db
    .select({
      id: questionSchema.id,
      type: questionSchema.type,
      body: questionSchema.body,
      options: questionSchema.options,
      correctAnswers: questionSchema.correctAnswers,
      referenceAnswer: questionSchema.referenceAnswer,
      points: questionSchema.points,
    })
    .from(questionSchema)
    .where(and(eq(questionSchema.quizId, quizId), inArray(questionSchema.type, IMPORTABLE_QUESTION_TYPES)));
}

function mapQuestionToExamItem(question: Awaited<ReturnType<typeof listImportableQuestions>>[number]) {
  if (question.type === 'single_choice') {
    const options = (question.options ?? []).map((o, i) => ({ label: String.fromCharCode(65 + i), text: o.text }));
    const correctId = question.correctAnswers?.[0];
    const correctIndex = (question.options ?? []).findIndex(o => o.id === correctId);
    return {
      type: 'single_choice' as const,
      options,
      answer: correctIndex >= 0 ? options[correctIndex]!.label : 'A',
    };
  }
  if (question.type === 'true_false') {
    const isTrue = question.correctAnswers?.[0] === 'tf-true';
    return { type: 'true_false' as const, options: null, answer: isTrue ? 'O' : 'X' };
  }
  // short_answer
  return { type: 'short_answer' as const, options: null, answer: question.referenceAnswer ?? '' };
}

export async function importQuestionsFromQuizBank(paperId: number, quizId: number, questionIds: number[]) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('Unauthorized');
  }
  await verifyPaperOwnership(paperId, userId);

  const questions = await listImportableQuestions(quizId); // 已含 quiz 擁有權檢查
  const toImport = questions.filter(q => questionIds.includes(q.id));
  if (toImport.length === 0) {
    return db.select().from(examItemSchema).where(eq(examItemSchema.paperId, paperId));
  }

  const existing = await db.select({ position: examItemSchema.position }).from(examItemSchema).where(eq(examItemSchema.paperId, paperId));
  const nextPositionStart = existing.length > 0 ? Math.max(...existing.map(e => e.position)) + 1 : 0;

  await db.insert(examItemSchema).values(toImport.map((question, i) => {
    const mapped = mapQuestionToExamItem(question);
    return {
      paperId,
      source: 'imported' as const,
      position: nextPositionStart + i,
      type: mapped.type,
      unit: null,
      cognitiveLevel: null,
      points: question.points,
      stem: question.body,
      options: mapped.options,
      answer: mapped.answer,
    };
  }));

  return db.select().from(examItemSchema).where(eq(examItemSchema.paperId, paperId));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/actions/examBuilderActions.test.ts`
Expected: PASS, all tests green (7 total so far).

- [ ] **Step 5: Commit**

```bash
git add src/actions/examBuilderActions.ts src/actions/examBuilderActions.test.ts
git commit -m "feat(exam-builder): add paste-and-parse and quiz-bank import actions"
```

---

## Task 7: Server actions — item edit/delete, unit hours, shuffle seed

**Files:**
- Modify: `src/actions/examBuilderActions.ts` (append)
- Modify: `src/actions/examBuilderActions.test.ts` (append)

**Interfaces:**
- Consumes: `examUnitHourSchema` (Task 1); `BloomLevel` type (Task 2)
- Produces: `updateExamItem(itemId, input)`, `deleteExamItem(itemId)`, `upsertUnitHours(paperId, rows)`, `ensureShuffleSeed(paperId)`, `regenerateShuffleSeed(paperId)` — consumed by Task 11 (`ExamItemList`/`ExamItemEditDialog`), Task 12 (`UnitHoursPanel`), Task 14 (`ExamExportPreview`).

- [ ] **Step 1: Write the failing tests (append to `examBuilderActions.test.ts`)**

Add to the imports:

```ts
import {
  deleteExamItem,
  ensureShuffleSeed,
  getOrCreateExamPaper,
  importQuestionsFromQuizBank,
  listImportableQuestions,
  listImportableQuizzes,
  pasteAndParseExamItems,
  regenerateShuffleSeed,
  updateExamItem,
  updateExamPaperInfo,
  upsertUnitHours,
} from '@/actions/examBuilderActions';
import { examUnitHourSchema } from '@/models/Schema';
```

New `describe` blocks:

```ts
describe('updateExamItem / deleteExamItem', () => {
  it('可以編輯單元/認知層次/配分/題幹/選項文字/答案，但不能改題型或選項數量', async () => {
    currentUserId = 'user_exam_builder_test_30';
    const paper = await getOrCreateExamPaper();
    const { items } = await pasteAndParseExamItems(paper.id, '選擇｜2\n題幹\n(A) a (B) b\n答案：A');
    const item = items[0]!;

    const updated = await updateExamItem(item.id, {
      unit: '新單元',
      cognitiveLevel: 'apply',
      points: 10,
      stem: '改過的題幹',
      options: [{ label: 'A', text: '改過的 a' }, { label: 'B', text: 'b' }],
      answer: 'B',
    });

    expect(updated).toMatchObject({
      unit: '新單元',
      cognitiveLevel: 'apply',
      points: 10,
      stem: '改過的題幹',
      answer: 'B',
    });
    expect(updated.options).toEqual([{ label: 'A', text: '改過的 a' }, { label: 'B', text: 'b' }]);
  });

  it('答案字母超出選項範圍會丟錯', async () => {
    currentUserId = 'user_exam_builder_test_31';
    const paper = await getOrCreateExamPaper();
    const { items } = await pasteAndParseExamItems(paper.id, '選擇｜2\n題幹\n(A) a (B) b\n答案：A');
    const item = items[0]!;

    await expect(updateExamItem(item.id, {
      unit: null,
      cognitiveLevel: null,
      points: 2,
      stem: '題幹',
      options: [{ label: 'A', text: 'a' }, { label: 'B', text: 'b' }],
      answer: 'C',
    })).rejects.toThrow();
  });

  it('刪除單一題目', async () => {
    currentUserId = 'user_exam_builder_test_32';
    const paper = await getOrCreateExamPaper();
    const { items } = await pasteAndParseExamItems(paper.id, '是非｜1\n陳述\n答案：O');
    const item = items[0]!;

    await deleteExamItem(item.id);

    const remaining = await db.select().from(examItemSchema).where(eq(examItemSchema.paperId, paper.id));
    expect(remaining).toHaveLength(0);
  });
});

describe('upsertUnitHours', () => {
  it('整份覆蓋單元節數清單', async () => {
    currentUserId = 'user_exam_builder_test_40';
    const paper = await getOrCreateExamPaper();

    await upsertUnitHours(paper.id, [{ unitName: '變數', hours: 6 }, { unitName: '迴圈', hours: 4 }]);
    const firstRows = await db.select().from(examUnitHourSchema).where(eq(examUnitHourSchema.paperId, paper.id));
    expect(firstRows).toHaveLength(2);

    await upsertUnitHours(paper.id, [{ unitName: '條件判斷', hours: 3 }]);
    const secondRows = await db.select().from(examUnitHourSchema).where(eq(examUnitHourSchema.paperId, paper.id));
    expect(secondRows).toHaveLength(1);
    expect(secondRows[0]).toMatchObject({ unitName: '條件判斷', hours: 3 });
  });
});

describe('ensureShuffleSeed / regenerateShuffleSeed', () => {
  it('ensureShuffleSeed 只在 null 時產生，已有值就不變', async () => {
    currentUserId = 'user_exam_builder_test_50';
    const paper = await getOrCreateExamPaper();
    expect(paper.shuffleSeed).toBeNull();

    const firstSeed = await ensureShuffleSeed(paper.id);
    expect(firstSeed).not.toBeNull();

    const secondSeed = await ensureShuffleSeed(paper.id);
    expect(secondSeed).toBe(firstSeed);
  });

  it('regenerateShuffleSeed 每次都換新的值', async () => {
    currentUserId = 'user_exam_builder_test_51';
    const paper = await getOrCreateExamPaper();

    const first = await regenerateShuffleSeed(paper.id);
    const second = await regenerateShuffleSeed(paper.id);
    expect(first).not.toBe(second);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/actions/examBuilderActions.test.ts`
Expected: FAIL — new exports not found.

- [ ] **Step 3: Append the item-edit/unit-hours/shuffle-seed part of `examBuilderActions.ts`**

Add to the `@/models/Schema` import: `examUnitHourSchema`.

Append at the end of the file:

```ts
async function verifyItemOwnership(itemId: number, userId: string) {
  const [row] = await db
    .select({ item: examItemSchema, paper: examPaperSchema })
    .from(examItemSchema)
    .innerJoin(examPaperSchema, eq(examItemSchema.paperId, examPaperSchema.id))
    .where(and(eq(examItemSchema.id, itemId), eq(examPaperSchema.ownerId, userId)))
    .limit(1);
  if (!row) {
    throw new Error('Exam item not found or unauthorized');
  }
  return row.item;
}

const UpdateExamItemInputSchema = z.object({
  unit: z.string().trim().min(1).nullable(),
  cognitiveLevel: z.enum(['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']).nullable(),
  points: z.coerce.number().int().positive(),
  stem: z.string().trim().min(1),
  options: z.array(z.object({ label: z.string(), text: z.string().trim().min(1) })).optional(),
  answer: z.string().trim().min(1),
});

export type UpdateExamItemInput = z.infer<typeof UpdateExamItemInputSchema>;

export async function updateExamItem(itemId: number, input: UpdateExamItemInput) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('Unauthorized');
  }
  const existing = await verifyItemOwnership(itemId, userId);
  const parsed = UpdateExamItemInputSchema.parse(input);

  let options = existing.options;
  if (existing.type === 'single_choice') {
    const existingLabels = (existing.options ?? []).map(o => o.label);
    const newLabels = (parsed.options ?? []).map(o => o.label);
    if (newLabels.length !== existingLabels.length || newLabels.some((l, i) => l !== existingLabels[i])) {
      throw new Error('選擇題不能增減或重新排列選項，只能改文字內容');
    }
    options = parsed.options ?? existing.options;
    const validAnswer = options!.some(o => o.label === parsed.answer.toUpperCase());
    if (!validAnswer) {
      throw new Error(`答案「${parsed.answer}」不是這題選項裡的字母`);
    }
  } else if (existing.type === 'true_false') {
    const normalized = parsed.answer.toUpperCase();
    if (normalized !== 'O' && normalized !== 'X') {
      throw new Error('是非題答案必須是 O 或 X');
    }
  }

  const [updated] = await db
    .update(examItemSchema)
    .set({
      unit: parsed.unit,
      cognitiveLevel: parsed.cognitiveLevel,
      points: parsed.points,
      stem: parsed.stem,
      options,
      answer: existing.type === 'single_choice' ? parsed.answer.toUpperCase() : parsed.answer,
    })
    .where(eq(examItemSchema.id, itemId))
    .returning();

  if (!updated) {
    throw new Error('Failed to update exam item');
  }
  return updated;
}

export async function deleteExamItem(itemId: number) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('Unauthorized');
  }
  await verifyItemOwnership(itemId, userId);
  await db.delete(examItemSchema).where(eq(examItemSchema.id, itemId));
}

const UnitHourRowSchema = z.object({
  unitName: z.string().trim().min(1),
  hours: z.coerce.number().int().positive(),
});

export async function upsertUnitHours(paperId: number, rows: { unitName: string; hours: number }[]) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('Unauthorized');
  }
  await verifyPaperOwnership(paperId, userId);
  const parsedRows = rows.map(r => UnitHourRowSchema.parse(r));

  await db.transaction(async (tx) => {
    await tx.delete(examUnitHourSchema).where(eq(examUnitHourSchema.paperId, paperId));
    if (parsedRows.length > 0) {
      await tx.insert(examUnitHourSchema).values(parsedRows.map(r => ({ paperId, unitName: r.unitName, hours: r.hours })));
    }
  });

  return db.select().from(examUnitHourSchema).where(eq(examUnitHourSchema.paperId, paperId));
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

export async function ensureShuffleSeed(paperId: number) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('Unauthorized');
  }
  const paper = await verifyPaperOwnership(paperId, userId);
  if (paper.shuffleSeed !== null) {
    return paper.shuffleSeed;
  }

  const seed = randomSeed();
  await db.update(examPaperSchema).set({ shuffleSeed: seed }).where(eq(examPaperSchema.id, paperId));
  return seed;
}

export async function regenerateShuffleSeed(paperId: number) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('Unauthorized');
  }
  await verifyPaperOwnership(paperId, userId);

  const seed = randomSeed();
  await db.update(examPaperSchema).set({ shuffleSeed: seed }).where(eq(examPaperSchema.id, paperId));
  return seed;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/actions/examBuilderActions.test.ts`
Expected: PASS, all tests green (13 total).

- [ ] **Step 5: Commit**

```bash
git add src/actions/examBuilderActions.ts src/actions/examBuilderActions.test.ts
git commit -m "feat(exam-builder): add item edit/delete, unit hours, and shuffle seed actions"
```

---

## Task 8: Page shell — route, server component, paper info form

**Files:**
- Create: `src/app/[locale]/(auth)/dashboard/exam-builder/page.tsx`
- Create: `src/features/examBuilder/ExamBuilderClient.tsx`
- Create: `src/features/examBuilder/ExamPaperInfoForm.tsx`
- Test: `src/features/examBuilder/ExamPaperInfoForm.test.tsx`

**Interfaces:**
- Consumes: `getOrCreateExamPaper` is NOT used here (page queries DB directly, matching `quizzes/page.tsx` convention); `updateExamPaperInfo` (Task 5); `examItemSchema`, `examPaperSchema`, `examUnitHourSchema` (Task 1)
- Produces: `ExamPaperRow`, `ExamItemRow`, `ExamUnitHourRow` types exported from `ExamBuilderClient.tsx` — consumed by every component task from here on (9–14).

- [ ] **Step 1: Write the failing test**

Create `src/features/examBuilder/ExamPaperInfoForm.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { ExamPaperInfoForm } from './ExamPaperInfoForm';

const updateExamPaperInfo = vi.fn();
vi.mock('@/actions/examBuilderActions', () => ({
  updateExamPaperInfo: (...args: unknown[]) => updateExamPaperInfo(...args),
}));

const basePaper = {
  id: 1,
  ownerId: 'user_1',
  school: null,
  academicYear: null,
  examName: null,
  subject: null,
  gradeLevel: null,
  durationMinutes: null,
  teacherName: null,
  examScope: null,
  deviationThreshold: 5,
  shuffleSeed: null,
  updatedAt: new Date(),
  createdAt: new Date(),
};

describe('ExamPaperInfoForm', () => {
  beforeEach(() => {
    updateExamPaperInfo.mockReset();
  });

  it('填寫科目後按儲存，呼叫 updateExamPaperInfo 並把回傳結果傳給 onUpdated', async () => {
    const updatedPaper = { ...basePaper, subject: '資訊科技' };
    updateExamPaperInfo.mockResolvedValue(updatedPaper);
    const onUpdated = vi.fn();

    render(<ExamPaperInfoForm paper={basePaper} onUpdated={onUpdated} />);

    await userEvent.type(screen.getByLabelText('科目'), '資訊科技');
    await userEvent.click(screen.getByRole('button', { name: '儲存考卷資訊' }));

    expect(updateExamPaperInfo).toHaveBeenCalledWith(1, expect.objectContaining({ subject: '資訊科技' }));
    expect(onUpdated).toHaveBeenCalledWith(updatedPaper);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/examBuilder/ExamPaperInfoForm.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ExamBuilderClient.tsx` (shared types + shell) and `ExamPaperInfoForm.tsx`**

Create `src/features/examBuilder/ExamBuilderClient.tsx`:

```tsx
'use client';

import { useState } from 'react';

import type { examItemSchema, examPaperSchema, examUnitHourSchema } from '@/models/Schema';

import { ExamPaperInfoForm } from './ExamPaperInfoForm';

export type ExamPaperRow = typeof examPaperSchema.$inferSelect;
export type ExamItemRow = typeof examItemSchema.$inferSelect;
export type ExamUnitHourRow = typeof examUnitHourSchema.$inferSelect;

type ExamBuilderClientProps = {
  paper: ExamPaperRow;
  initialItems: ExamItemRow[];
  initialUnitHours: ExamUnitHourRow[];
};

export function ExamBuilderClient({ paper: initialPaper, initialItems, initialUnitHours }: ExamBuilderClientProps) {
  const [paper, setPaper] = useState(initialPaper);
  const [items] = useState(initialItems);
  const [unitHours] = useState(initialUnitHours);

  const totalPoints = items.reduce((sum, item) => sum + item.points, 0);

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
      <div>
        <h1 className="text-xl font-bold">段考命題助手</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          批次貼上題目，自動產生雙向細目表、檢核配分與單元比重，排出 A／B 卷與答案卷。
        </p>
      </div>

      <ExamPaperInfoForm paper={paper} onUpdated={setPaper} />

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">題目</h2>
          <p className={`text-sm font-medium ${totalPoints === 100 ? 'text-green-600' : 'text-amber-600'}`}>
            {totalPoints}
            {' '}
            / 100 分
          </p>
        </div>
        {/* PasteAndParsePanel / ImportFromQuizBankDialog 掛在這裡（Task 9、10） */}
      </section>

      {/* ExamItemList 掛在這裡（Task 11） */}
      {/* UnitHoursPanel 掛在這裡（Task 12） */}
      {/* SpecMatrixTable 掛在這裡（Task 13） */}
      {/* ExamExportPreview 掛在這裡（Task 14） */}

      <p className="text-xs text-muted-foreground">
        目前題目數：
        {items.length}
        ；單元節數設定：
        {unitHours.length}
        {' '}
        項。
      </p>
    </div>
  );
}
```

Create `src/features/examBuilder/ExamPaperInfoForm.tsx`:

```tsx
'use client';

import { useState } from 'react';

import { updateExamPaperInfo } from '@/actions/examBuilderActions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import type { ExamPaperRow } from './ExamBuilderClient';

type FormState = {
  school: string;
  academicYear: string;
  examName: string;
  subject: string;
  gradeLevel: string;
  durationMinutes: string;
  teacherName: string;
  examScope: string;
  deviationThreshold: string;
};

function toFormState(paper: ExamPaperRow): FormState {
  return {
    school: paper.school ?? '',
    academicYear: paper.academicYear ?? '',
    examName: paper.examName ?? '',
    subject: paper.subject ?? '',
    gradeLevel: paper.gradeLevel ?? '',
    durationMinutes: paper.durationMinutes ? String(paper.durationMinutes) : '',
    teacherName: paper.teacherName ?? '',
    examScope: paper.examScope ?? '',
    deviationThreshold: String(paper.deviationThreshold),
  };
}

const FIELDS: { key: keyof FormState; label: string }[] = [
  { key: 'school', label: '學校' },
  { key: 'academicYear', label: '學年度／學期' },
  { key: 'examName', label: '考試名稱' },
  { key: 'subject', label: '科目' },
  { key: 'gradeLevel', label: '年級' },
  { key: 'durationMinutes', label: '作答時間（分鐘）' },
  { key: 'teacherName', label: '命題教師' },
  { key: 'examScope', label: '考試範圍' },
  { key: 'deviationThreshold', label: '偏差警示門檻（±百分點）' },
];

type ExamPaperInfoFormProps = {
  paper: ExamPaperRow;
  onUpdated: (paper: ExamPaperRow) => void;
};

export function ExamPaperInfoForm({ paper, onUpdated }: ExamPaperInfoFormProps) {
  const [form, setForm] = useState<FormState>(toFormState(paper));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await updateExamPaperInfo(paper.id, {
        school: form.school || null,
        academicYear: form.academicYear || null,
        examName: form.examName || null,
        subject: form.subject || null,
        gradeLevel: form.gradeLevel || null,
        durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : null,
        teacherName: form.teacherName || null,
        examScope: form.examScope || null,
        deviationThreshold: Number(form.deviationThreshold),
      });
      onUpdated(updated);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border p-4">
      <h2 className="mb-3 text-sm font-semibold">考卷資訊</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {FIELDS.map(f => (
          <div key={f.key}>
            <Label htmlFor={f.key}>{f.label}</Label>
            <Input
              id={f.key}
              value={form[f.key]}
              onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <Button className="mt-3" onClick={handleSave} disabled={saving}>
        {saving ? '儲存中…' : '儲存考卷資訊'}
      </Button>
    </section>
  );
}
```

Create `src/app/[locale]/(auth)/dashboard/exam-builder/page.tsx`:

```tsx
import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { ExamBuilderClient } from '@/features/examBuilder/ExamBuilderClient';
import { db } from '@/libs/DB';
import { examItemSchema, examPaperSchema, examUnitHourSchema } from '@/models/Schema';

export default async function ExamBuilderPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect('/sign-in');
  }

  await db.insert(examPaperSchema).values({ ownerId: userId }).onConflictDoNothing({ target: examPaperSchema.ownerId });

  const [paper] = await db.select().from(examPaperSchema).where(eq(examPaperSchema.ownerId, userId)).limit(1);
  if (!paper) {
    throw new Error('exam_paper find-or-create failed');
  }

  const [items, unitHours] = await Promise.all([
    db.select().from(examItemSchema).where(eq(examItemSchema.paperId, paper.id)).orderBy(examItemSchema.position),
    db.select().from(examUnitHourSchema).where(eq(examUnitHourSchema.paperId, paper.id)),
  ]);

  return <ExamBuilderClient paper={paper} initialItems={items} initialUnitHours={unitHours} />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/examBuilder/ExamPaperInfoForm.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/\[locale\]/\(auth\)/dashboard/exam-builder/page.tsx src/features/examBuilder/ExamBuilderClient.tsx src/features/examBuilder/ExamPaperInfoForm.tsx src/features/examBuilder/ExamPaperInfoForm.test.tsx
git commit -m "feat(exam-builder): add exam-builder page shell and paper info form"
```

---

## Task 9: `PasteAndParsePanel` — textarea with live preview + overwrite warning

**Files:**
- Create: `src/features/examBuilder/PasteAndParsePanel.tsx`
- Test: `src/features/examBuilder/PasteAndParsePanel.test.tsx`
- Modify: `src/features/examBuilder/ExamBuilderClient.tsx` (wire it in, replace the `items` state's setter to be settable, since `pasteAndParseExamItems` now owns the authoritative item list)

**Interfaces:**
- Consumes: `parseExamText` (Task 2, for live client-side preview before submit); `pasteAndParseExamItems` (Task 6)
- Produces: calls `onParsed(items: ExamItemRow[])` prop — consumed by `ExamBuilderClient.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/features/examBuilder/PasteAndParsePanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { PasteAndParsePanel } from './PasteAndParsePanel';

const pasteAndParseExamItems = vi.fn();
vi.mock('@/actions/examBuilderActions', () => ({
  pasteAndParseExamItems: (...args: unknown[]) => pasteAndParseExamItems(...args),
}));

describe('PasteAndParsePanel', () => {
  beforeEach(() => {
    pasteAndParseExamItems.mockReset();
  });

  it('輸入文字即時顯示解析出的題數，有錯誤時顯示逐題錯誤', async () => {
    render(<PasteAndParsePanel paperId={1} onParsed={() => {}} />);

    await userEvent.type(
      screen.getByPlaceholderText(/題型｜單元｜認知層次｜配分/),
      '選擇｜2{enter}題幹{enter}(A) a (B) b{enter}答案：A',
    );

    expect(await screen.findByText(/解析出 1 題/)).toBeInTheDocument();
  });

  it('按下「貼上並解析」呼叫 server action，成功後把回傳的題目列表傳給 onParsed', async () => {
    pasteAndParseExamItems.mockResolvedValue({ errors: [], items: [{ id: 1 }] });
    const onParsed = vi.fn();

    render(<PasteAndParsePanel paperId={7} onParsed={onParsed} />);

    await userEvent.type(
      screen.getByPlaceholderText(/題型｜單元｜認知層次｜配分/),
      '是非｜1{enter}陳述{enter}答案：O',
    );
    await userEvent.click(screen.getByRole('button', { name: '貼上並解析' }));

    expect(pasteAndParseExamItems).toHaveBeenCalledWith(7, expect.stringContaining('是非｜1'));
    expect(onParsed).toHaveBeenCalledWith([{ id: 1 }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/examBuilder/PasteAndParsePanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PasteAndParsePanel.tsx`**

Create `src/features/examBuilder/PasteAndParsePanel.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';

import { pasteAndParseExamItems } from '@/actions/examBuilderActions';
import { Button } from '@/components/ui/button';
import { parseExamText } from '@/lib/examBuilder/parseExamText';

import type { ExamItemRow } from './ExamBuilderClient';

type PasteAndParsePanelProps = {
  paperId: number;
  onParsed: (items: ExamItemRow[]) => void;
};

export function PasteAndParsePanel({ paperId, onParsed }: PasteAndParsePanelProps) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitErrors, setSubmitErrors] = useState<{ index: number; message: string }[]>([]);

  const preview = useMemo(() => parseExamText(text), [text]);
  const okCount = preview.items.filter(i => i !== null).length;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const result = await pasteAndParseExamItems(paperId, text);
      setSubmitErrors(result.errors);
      onParsed(result.items);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border p-4">
      <p className="mb-2 text-xs text-amber-600">
        ⚠️ 這個動作會覆蓋所有用貼上方式新增的題目（不影響從題庫匯入的題目）
      </p>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="每題之間空一行。第一行寫「題型｜單元｜認知層次｜配分」"
        rows={12}
        className="w-full resize-none rounded-xl border px-4 py-3 font-mono text-xs placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
      {text.trim() && (
        <p className="mt-2 text-xs text-muted-foreground">
          解析出
          {' '}
          {okCount}
          {' '}
          題
          {preview.errors.length > 0 && `，${preview.errors.length} 題格式有誤`}
        </p>
      )}
      {submitErrors.length > 0 && (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
          <ul className="list-disc space-y-1 pl-5">
            {submitErrors.map(e => (
              <li key={e.index}>
                第
                {e.index + 1}
                {' '}
                題：
                {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Button className="mt-3" onClick={handleSubmit} disabled={submitting || !text.trim()}>
        {submitting ? '解析中…' : '貼上並解析'}
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Wire it into `ExamBuilderClient.tsx`**

Modify `src/features/examBuilder/ExamBuilderClient.tsx`: change `const [items] = useState(initialItems);` to `const [items, setItems] = useState(initialItems);`, import `PasteAndParsePanel`, and replace the `{/* PasteAndParsePanel / ImportFromQuizBankDialog 掛在這裡（Task 9、10） */}` comment with:

```tsx
        <PasteAndParsePanel paperId={paper.id} onParsed={setItems} />
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/features/examBuilder/PasteAndParsePanel.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/examBuilder/PasteAndParsePanel.tsx src/features/examBuilder/PasteAndParsePanel.test.tsx src/features/examBuilder/ExamBuilderClient.tsx
git commit -m "feat(exam-builder): add paste-and-parse panel with live preview"
```

---

## Task 10: `ImportFromQuizBankDialog` — import questions from existing quizzes

**Files:**
- Create: `src/features/examBuilder/ImportFromQuizBankDialog.tsx`
- Test: `src/features/examBuilder/ImportFromQuizBankDialog.test.tsx`
- Modify: `src/features/examBuilder/ExamBuilderClient.tsx` (wire it in)

**Interfaces:**
- Consumes: `listImportableQuizzes`, `listImportableQuestions`, `importQuestionsFromQuizBank` (Task 6)
- Produces: calls `onImported(items: ExamItemRow[])` prop — consumed by `ExamBuilderClient.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/features/examBuilder/ImportFromQuizBankDialog.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { ImportFromQuizBankDialog } from './ImportFromQuizBankDialog';

const listImportableQuizzes = vi.fn();
const listImportableQuestions = vi.fn();
const importQuestionsFromQuizBank = vi.fn();

vi.mock('@/actions/examBuilderActions', () => ({
  listImportableQuizzes: (...args: unknown[]) => listImportableQuizzes(...args),
  listImportableQuestions: (...args: unknown[]) => listImportableQuestions(...args),
  importQuestionsFromQuizBank: (...args: unknown[]) => importQuestionsFromQuizBank(...args),
}));

describe('ImportFromQuizBankDialog', () => {
  beforeEach(() => {
    listImportableQuizzes.mockReset();
    listImportableQuestions.mockReset();
    importQuestionsFromQuizBank.mockReset();
  });

  it('打開後選一份 quiz → 勾選題目 → 匯入，呼叫 importQuestionsFromQuizBank 並回傳結果給 onImported', async () => {
    listImportableQuizzes.mockResolvedValue([{ id: 5, title: '期中複習' }]);
    listImportableQuestions.mockResolvedValue([
      { id: 11, type: 'single_choice', body: '題目 A', options: [], correctAnswers: [], referenceAnswer: null, points: 4 },
      { id: 12, type: 'true_false', body: '題目 B', options: [], correctAnswers: [], referenceAnswer: null, points: 2 },
    ]);
    importQuestionsFromQuizBank.mockResolvedValue([{ id: 99 }]);
    const onImported = vi.fn();

    render(<ImportFromQuizBankDialog paperId={1} onImported={onImported} />);

    await userEvent.click(screen.getByRole('button', { name: '從題庫匯入' }));
    await userEvent.click(await screen.findByRole('button', { name: '期中複習' }));

    await screen.findByText('題目 A');
    await userEvent.click(screen.getByLabelText('題目 A'));
    await userEvent.click(screen.getByRole('button', { name: /匯入 1 題/ }));

    expect(importQuestionsFromQuizBank).toHaveBeenCalledWith(1, 5, [11]);
    expect(onImported).toHaveBeenCalledWith([{ id: 99 }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/examBuilder/ImportFromQuizBankDialog.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ImportFromQuizBankDialog.tsx`**

Create `src/features/examBuilder/ImportFromQuizBankDialog.tsx`:

```tsx
'use client';

import { useState } from 'react';

import { importQuestionsFromQuizBank, listImportableQuestions, listImportableQuizzes } from '@/actions/examBuilderActions';
import { Button } from '@/components/ui/button';

import type { ExamItemRow } from './ExamBuilderClient';

type Quiz = { id: number; title: string };
type Question = { id: number; type: string; body: string; points: number };

type ImportFromQuizBankDialogProps = {
  paperId: number;
  onImported: (items: ExamItemRow[]) => void;
};

export function ImportFromQuizBankDialog({ paperId, onImported }: ImportFromQuizBankDialogProps) {
  const [open, setOpen] = useState(false);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [selectedQuiz, setSelectedQuiz] = useState<Quiz | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [importing, setImporting] = useState(false);

  const handleOpen = async () => {
    setOpen(true);
    setQuizzes(await listImportableQuizzes());
  };

  const handleSelectQuiz = async (quiz: Quiz) => {
    setSelectedQuiz(quiz);
    setSelectedIds([]);
    setQuestions(await listImportableQuestions(quiz.id));
  };

  const toggleQuestion = (id: number) => {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]));
  };

  const handleImport = async () => {
    if (!selectedQuiz) {
      return;
    }
    setImporting(true);
    try {
      const items = await importQuestionsFromQuizBank(paperId, selectedQuiz.id, selectedIds);
      onImported(items);
      setOpen(false);
      setSelectedQuiz(null);
      setQuestions([]);
      setSelectedIds([]);
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <Button variant="outline" onClick={handleOpen}>從題庫匯入</Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setOpen(false)} />
          <div className="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-5 shadow-lg">
            {!selectedQuiz && (
              <div>
                <h3 className="mb-3 text-sm font-semibold">選一份測驗</h3>
                <ul className="space-y-1">
                  {quizzes.map(quiz => (
                    <li key={quiz.id}>
                      <button
                        type="button"
                        onClick={() => handleSelectQuiz(quiz)}
                        className="w-full rounded-lg border px-3 py-2 text-left text-sm hover:bg-gray-50"
                      >
                        {quiz.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {selectedQuiz && (
              <div>
                <h3 className="mb-3 text-sm font-semibold">
                  {selectedQuiz.title}
                  {' '}
                  — 勾選要匯入的題目
                </h3>
                <ul className="max-h-80 space-y-1 overflow-auto">
                  {questions.map(q => (
                    <li key={q.id} className="flex items-center gap-2">
                      <input
                        id={`import-question-${q.id}`}
                        type="checkbox"
                        aria-label={q.body}
                        checked={selectedIds.includes(q.id)}
                        onChange={() => toggleQuestion(q.id)}
                      />
                      <label htmlFor={`import-question-${q.id}`} className="text-sm">{q.body}</label>
                    </li>
                  ))}
                  {questions.length === 0 && (
                    <li className="text-sm text-muted-foreground">這份測驗沒有可匯入的題型（僅支援選擇／是非／簡答）</li>
                  )}
                </ul>
                <Button className="mt-3" onClick={handleImport} disabled={importing || selectedIds.length === 0}>
                  {importing ? '匯入中…' : `匯入 ${selectedIds.length} 題`}
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
```

- [ ] **Step 4: Wire it into `ExamBuilderClient.tsx`**

Replace `{/* ... Task 9、10 */}` remnants: import `ImportFromQuizBankDialog` and add below the `<PasteAndParsePanel />` line:

```tsx
        <div className="mt-3">
          <ImportFromQuizBankDialog paperId={paper.id} onImported={setItems} />
        </div>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/features/examBuilder/ImportFromQuizBankDialog.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/examBuilder/ImportFromQuizBankDialog.tsx src/features/examBuilder/ImportFromQuizBankDialog.test.tsx src/features/examBuilder/ExamBuilderClient.tsx
git commit -m "feat(exam-builder): add import-from-quiz-bank dialog"
```

---

## Task 11: `ExamItemList` + `ExamItemEditDialog` — list, edit, delete

**Files:**
- Create: `src/features/examBuilder/ExamItemList.tsx`
- Create: `src/features/examBuilder/ExamItemEditDialog.tsx`
- Test: `src/features/examBuilder/ExamItemList.test.tsx`
- Modify: `src/features/examBuilder/ExamBuilderClient.tsx` (wire it in)

**Interfaces:**
- Consumes: `updateExamItem`, `deleteExamItem` (Task 7)
- Produces: calls `onItemsChange(items: ExamItemRow[])` prop — consumed by `ExamBuilderClient.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/features/examBuilder/ExamItemList.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { ExamItemList } from './ExamItemList';

const updateExamItem = vi.fn();
const deleteExamItem = vi.fn();
vi.mock('@/actions/examBuilderActions', () => ({
  updateExamItem: (...args: unknown[]) => updateExamItem(...args),
  deleteExamItem: (...args: unknown[]) => deleteExamItem(...args),
}));

const baseItem = {
  id: 1,
  paperId: 1,
  source: 'pasted' as const,
  position: 0,
  type: 'short_answer' as const,
  unit: null,
  cognitiveLevel: null,
  points: 5,
  stem: '請說明變數的用途',
  options: null,
  answer: '參考答案',
  updatedAt: new Date(),
  createdAt: new Date(),
};

describe('ExamItemList', () => {
  beforeEach(() => {
    updateExamItem.mockReset();
    deleteExamItem.mockReset();
  });

  it('顯示題目清單，標題型唯讀；刪除一題後呼叫 onItemsChange 移除該題', async () => {
    deleteExamItem.mockResolvedValue(undefined);
    const onItemsChange = vi.fn();

    render(<ExamItemList items={[baseItem]} onItemsChange={onItemsChange} />);

    expect(screen.getByText('請說明變數的用途')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '刪除' }));

    expect(deleteExamItem).toHaveBeenCalledWith(1);
    expect(onItemsChange).toHaveBeenCalledWith([]);
  });

  it('沒填單元的題目標示「未分類」', () => {
    render(<ExamItemList items={[baseItem]} onItemsChange={() => {}} />);
    expect(screen.getByText('未分類')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/examBuilder/ExamItemList.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ExamItemEditDialog.tsx` and `ExamItemList.tsx`**

Create `src/features/examBuilder/ExamItemEditDialog.tsx`:

```tsx
'use client';

import { useState } from 'react';

import { updateExamItem } from '@/actions/examBuilderActions';
import { Button } from '@/components/ui/button';
import { BLOOM_LEVELS } from '@/lib/examBuilder/checks';

import type { ExamItemRow } from './ExamBuilderClient';

type ExamItemEditDialogProps = {
  item: ExamItemRow;
  onClose: () => void;
  onSaved: (item: ExamItemRow) => void;
};

export function ExamItemEditDialog({ item, onClose, onSaved }: ExamItemEditDialogProps) {
  const [unit, setUnit] = useState(item.unit ?? '');
  const [cognitiveLevel, setCognitiveLevel] = useState(item.cognitiveLevel ?? '');
  const [points, setPoints] = useState(String(item.points));
  const [stem, setStem] = useState(item.stem);
  const [options, setOptions] = useState(item.options ?? []);
  const [answer, setAnswer] = useState(item.answer);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const updated = await updateExamItem(item.id, {
        unit: unit.trim() ? unit.trim() : null,
        cognitiveLevel: cognitiveLevel ? (cognitiveLevel as typeof BLOOM_LEVELS[number]['value']) : null,
        points: Number(points),
        stem,
        options: item.type === 'single_choice' ? options : undefined,
        answer,
      });
      onSaved(updated);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-5 shadow-lg">
        <h3 className="mb-3 text-sm font-semibold">編輯題目</h3>

        <label className="mb-2 block text-xs text-muted-foreground" htmlFor="edit-unit">單元</label>
        <input id="edit-unit" className="mb-3 w-full rounded border px-2 py-1 text-sm" value={unit} onChange={e => setUnit(e.target.value)} />

        <label className="mb-2 block text-xs text-muted-foreground" htmlFor="edit-level">認知層次</label>
        <select id="edit-level" className="mb-3 w-full rounded border px-2 py-1 text-sm" value={cognitiveLevel} onChange={e => setCognitiveLevel(e.target.value)}>
          <option value="">未分類</option>
          {BLOOM_LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>

        <label className="mb-2 block text-xs text-muted-foreground" htmlFor="edit-points">配分</label>
        <input id="edit-points" type="number" className="mb-3 w-full rounded border px-2 py-1 text-sm" value={points} onChange={e => setPoints(e.target.value)} />

        <label className="mb-2 block text-xs text-muted-foreground" htmlFor="edit-stem">題幹</label>
        <textarea id="edit-stem" className="mb-3 w-full rounded border px-2 py-1 text-sm" rows={3} value={stem} onChange={e => setStem(e.target.value)} />

        {item.type === 'single_choice' && (
          <div className="mb-3 space-y-1">
            <p className="text-xs text-muted-foreground">選項（只能改文字，不能增減）</p>
            {options.map((opt, i) => (
              <div key={opt.label} className="flex items-center gap-2">
                <span className="text-xs">{opt.label}</span>
                <input
                  className="flex-1 rounded border px-2 py-1 text-sm"
                  value={opt.text}
                  onChange={e => setOptions(prev => prev.map((o, j) => (j === i ? { ...o, text: e.target.value } : o)))}
                />
              </div>
            ))}
          </div>
        )}

        <label className="mb-2 block text-xs text-muted-foreground" htmlFor="edit-answer">答案</label>
        <input id="edit-answer" className="mb-3 w-full rounded border px-2 py-1 text-sm" value={answer} onChange={e => setAnswer(e.target.value)} />

        {error && <p className="mb-3 text-xs text-red-600">{error}</p>}

        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={saving}>{saving ? '儲存中…' : '儲存'}</Button>
          <Button variant="outline" onClick={onClose}>取消</Button>
        </div>
      </div>
    </>
  );
}
```

Create `src/features/examBuilder/ExamItemList.tsx`:

```tsx
'use client';

import { useState } from 'react';

import { deleteExamItem } from '@/actions/examBuilderActions';
import { Button } from '@/components/ui/button';
import { BLOOM_LEVELS } from '@/lib/examBuilder/checks';

import type { ExamItemRow } from './ExamBuilderClient';
import { ExamItemEditDialog } from './ExamItemEditDialog';

const TYPE_LABEL: Record<ExamItemRow['type'], string> = {
  single_choice: '選擇',
  true_false: '是非',
  fill_in_blank: '填空',
  short_answer: '簡答',
};

const LEVEL_LABEL: Record<string, string> = Object.fromEntries(BLOOM_LEVELS.map(l => [l.value, l.label]));

type ExamItemListProps = {
  items: ExamItemRow[];
  onItemsChange: (items: ExamItemRow[]) => void;
};

export function ExamItemList({ items, onItemsChange }: ExamItemListProps) {
  const [editingItem, setEditingItem] = useState<ExamItemRow | null>(null);

  const handleDelete = async (id: number) => {
    await deleteExamItem(id);
    onItemsChange(items.filter(i => i.id !== id));
  };

  const handleSaved = (updated: ExamItemRow) => {
    onItemsChange(items.map(i => (i.id === updated.id ? updated : i)));
  };

  return (
    <section className="rounded-xl border p-4">
      <h2 className="mb-3 text-sm font-semibold">
        題目清單（
        {items.length}
        {' '}
        題）
      </h2>
      <ul className="space-y-2">
        {items.map(item => (
          <li key={item.id} className="rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {TYPE_LABEL[item.type]}
                {' '}
                ·
                {item.unit ?? '未分類'}
                {' '}
                ·
                {item.cognitiveLevel ? LEVEL_LABEL[item.cognitiveLevel] : '未分類'}
                {' '}
                ·
                {item.points}
                {' '}
                分
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditingItem(item)}>編輯</Button>
                <Button variant="outline" size="sm" onClick={() => handleDelete(item.id)}>刪除</Button>
              </div>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm">{item.stem}</p>
          </li>
        ))}
      </ul>

      {editingItem && (
        <ExamItemEditDialog item={editingItem} onClose={() => setEditingItem(null)} onSaved={handleSaved} />
      )}
    </section>
  );
}
```

- [ ] **Step 4: Wire it into `ExamBuilderClient.tsx`**

Replace `{/* ExamItemList 掛在這裡（Task 11） */}` with:

```tsx
      <ExamItemList items={items} onItemsChange={setItems} />
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/features/examBuilder/ExamItemList.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/examBuilder/ExamItemList.tsx src/features/examBuilder/ExamItemEditDialog.tsx src/features/examBuilder/ExamItemList.test.tsx src/features/examBuilder/ExamBuilderClient.tsx
git commit -m "feat(exam-builder): add exam item list with per-item edit and delete"
```

---

## Task 12: `UnitHoursPanel` — unit hours input + balance checks display

**Files:**
- Create: `src/features/examBuilder/UnitHoursPanel.tsx`
- Test: `src/features/examBuilder/UnitHoursPanel.test.tsx`
- Modify: `src/features/examBuilder/ExamBuilderClient.tsx` (wire it in)

**Interfaces:**
- Consumes: `upsertUnitHours` (Task 7); `calcUnitPointsBreakdown`, `calcUnitHoursBreakdown`, `calcUnitDeviation` (Task 4)
- Produces: calls `onUnitHoursChange(rows: ExamUnitHourRow[])` prop — consumed by `ExamBuilderClient.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/features/examBuilder/UnitHoursPanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { UnitHoursPanel } from './UnitHoursPanel';

const upsertUnitHours = vi.fn();
vi.mock('@/actions/examBuilderActions', () => ({
  upsertUnitHours: (...args: unknown[]) => upsertUnitHours(...args),
}));

const items = [
  { id: 1, paperId: 1, source: 'pasted' as const, position: 0, type: 'single_choice' as const, unit: '變數', cognitiveLevel: null, points: 60, stem: '', options: null, answer: 'A', updatedAt: new Date(), createdAt: new Date() },
  { id: 2, paperId: 1, source: 'pasted' as const, position: 1, type: 'true_false' as const, unit: '迴圈', cognitiveLevel: null, points: 40, stem: '', options: null, answer: 'O', updatedAt: new Date(), createdAt: new Date() },
];

describe('UnitHoursPanel', () => {
  beforeEach(() => {
    upsertUnitHours.mockReset();
  });

  it('輸入節數後儲存，差超過門檻的單元顯示警示', async () => {
    upsertUnitHours.mockResolvedValue([{ id: 1, paperId: 1, unitName: '變數', hours: 5 }, { id: 2, paperId: 1, unitName: '迴圈', hours: 5 }]);
    const onUnitHoursChange = vi.fn();

    render(
      <UnitHoursPanel paperId={1} items={items} unitHours={[]} deviationThreshold={5} onUnitHoursChange={onUnitHoursChange} />,
    );

    await userEvent.click(screen.getByRole('button', { name: '新增單元' }));
    await userEvent.type(screen.getByLabelText('單元名稱 1'), '變數');
    await userEvent.type(screen.getByLabelText('節數 1'), '5');
    await userEvent.click(screen.getByRole('button', { name: '新增單元' }));
    await userEvent.type(screen.getByLabelText('單元名稱 2'), '迴圈');
    await userEvent.type(screen.getByLabelText('節數 2'), '5');

    await userEvent.click(screen.getByRole('button', { name: '儲存節數設定' }));

    expect(upsertUnitHours).toHaveBeenCalledWith(1, [
      { unitName: '變數', hours: 5 },
      { unitName: '迴圈', hours: 5 },
    ]);
    expect(onUnitHoursChange).toHaveBeenCalled();
    expect(await screen.findByText(/⚠️/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/examBuilder/UnitHoursPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `UnitHoursPanel.tsx`**

Create `src/features/examBuilder/UnitHoursPanel.tsx`:

```tsx
'use client';

import { useState } from 'react';

import { upsertUnitHours } from '@/actions/examBuilderActions';
import { Button } from '@/components/ui/button';
import { calcUnitDeviation, calcUnitHoursBreakdown, calcUnitPointsBreakdown } from '@/lib/examBuilder/checks';

import type { ExamItemRow, ExamUnitHourRow } from './ExamBuilderClient';

type UnitHoursPanelProps = {
  paperId: number;
  items: ExamItemRow[];
  unitHours: ExamUnitHourRow[];
  deviationThreshold: number;
  onUnitHoursChange: (rows: ExamUnitHourRow[]) => void;
};

export function UnitHoursPanel({ paperId, items, unitHours, deviationThreshold, onUnitHoursChange }: UnitHoursPanelProps) {
  const [rows, setRows] = useState(unitHours.map(h => ({ unitName: h.unitName, hours: String(h.hours) })));
  const [saving, setSaving] = useState(false);

  const existingUnits = [...new Set(items.map(i => i.unit).filter((u): u is string => u !== null))];

  const handleSave = async () => {
    setSaving(true);
    try {
      const parsedRows = rows
        .filter(r => r.unitName.trim() && Number(r.hours) > 0)
        .map(r => ({ unitName: r.unitName.trim(), hours: Number(r.hours) }));
      const saved = await upsertUnitHours(paperId, parsedRows);
      onUnitHoursChange(saved);
    } finally {
      setSaving(false);
    }
  };

  const pointsBreakdown = calcUnitPointsBreakdown(items.map(i => ({ unit: i.unit, points: i.points })));
  const hoursBreakdown = calcUnitHoursBreakdown(rows.filter(r => r.unitName.trim() && Number(r.hours) > 0).map(r => ({ unitName: r.unitName, hours: Number(r.hours) })));
  const deviationRows = calcUnitDeviation(pointsBreakdown, hoursBreakdown, deviationThreshold);

  return (
    <section className="rounded-xl border p-4">
      <h2 className="mb-3 text-sm font-semibold">單元與授課節數</h2>
      <p className="mb-2 text-xs text-muted-foreground">
        目前題目用到的單元：
        {existingUnits.length > 0 ? existingUnits.join('、') : '（尚無）'}
      </p>

      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex gap-2">
            <label className="sr-only" htmlFor={`unit-name-${i}`}>
              單元名稱
              {' '}
              {i + 1}
            </label>
            <input
              id={`unit-name-${i}`}
              className="flex-1 rounded border px-2 py-1 text-sm"
              value={row.unitName}
              onChange={e => setRows(prev => prev.map((r, j) => (j === i ? { ...r, unitName: e.target.value } : r)))}
            />
            <label className="sr-only" htmlFor={`unit-hours-${i}`}>
              節數
              {' '}
              {i + 1}
            </label>
            <input
              id={`unit-hours-${i}`}
              type="number"
              className="w-20 rounded border px-2 py-1 text-sm"
              value={row.hours}
              onChange={e => setRows(prev => prev.map((r, j) => (j === i ? { ...r, hours: e.target.value } : r)))}
            />
          </div>
        ))}
      </div>

      <Button variant="outline" className="mt-2" onClick={() => setRows(prev => [...prev, { unitName: '', hours: '' }])}>
        新增單元
      </Button>
      <Button className="mt-2 ml-2" onClick={handleSave} disabled={saving}>
        {saving ? '儲存中…' : '儲存節數設定'}
      </Button>

      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th>單元</th>
            <th>配分占比</th>
            <th>節數占比</th>
            <th>偏差</th>
          </tr>
        </thead>
        <tbody>
          {deviationRows.map(row => (
            <tr key={row.unit} className={row.exceedsThreshold ? 'text-red-600' : ''}>
              <td>{row.unit}</td>
              <td>{row.pointsPercentage !== null ? `${row.pointsPercentage.toFixed(1)}%` : '⚠️ 未對應'}</td>
              <td>{row.hoursPercentage !== null ? `${row.hoursPercentage.toFixed(1)}%` : '⚠️ 未對應'}</td>
              <td>
                {row.exceedsThreshold && '⚠️ '}
                {row.deviation !== null ? `${row.deviation.toFixed(1)} 個百分點` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

Note: the `aria-label` approach used in the earlier dialog test (`getByLabelText`) relies on `<label htmlFor>` pairing — the `sr-only` labels above satisfy `getByLabelText('單元名稱 1')` etc. because their text content is exactly that.

- [ ] **Step 4: Wire it into `ExamBuilderClient.tsx`**

Replace `{/* UnitHoursPanel 掛在這裡（Task 12） */}` with:

```tsx
      <UnitHoursPanel
        paperId={paper.id}
        items={items}
        unitHours={unitHours}
        deviationThreshold={paper.deviationThreshold}
        onUnitHoursChange={setUnitHours}
      />
```

This also requires changing `const [unitHours] = useState(initialUnitHours);` to `const [unitHours, setUnitHours] = useState(initialUnitHours);` in `ExamBuilderClient.tsx`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/features/examBuilder/UnitHoursPanel.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/examBuilder/UnitHoursPanel.tsx src/features/examBuilder/UnitHoursPanel.test.tsx src/features/examBuilder/ExamBuilderClient.tsx
git commit -m "feat(exam-builder): add unit hours panel with balance deviation warnings"
```

---

## Task 13: `SpecMatrixTable` — two-way specification table

**Files:**
- Create: `src/features/examBuilder/SpecMatrixTable.tsx`
- Test: `src/features/examBuilder/SpecMatrixTable.test.tsx`
- Modify: `src/features/examBuilder/ExamBuilderClient.tsx` (wire it in)

**Interfaces:**
- Consumes: `calcSpecMatrix`, `BLOOM_LEVELS` (Task 4)
- Produces: pure display component, no callbacks

- [ ] **Step 1: Write the failing test**

Create `src/features/examBuilder/SpecMatrixTable.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';

import { SpecMatrixTable } from './SpecMatrixTable';

const items = [
  { id: 1, paperId: 1, source: 'pasted' as const, position: 0, type: 'single_choice' as const, unit: '變數', cognitiveLevel: 'remember' as const, points: 4, stem: '', options: null, answer: 'A', updatedAt: new Date(), createdAt: new Date() },
  { id: 2, paperId: 1, source: 'pasted' as const, position: 1, type: 'true_false' as const, unit: null, cognitiveLevel: null, points: 2, stem: '', options: null, answer: 'O', updatedAt: new Date(), createdAt: new Date() },
];

describe('SpecMatrixTable', () => {
  it('顯示單元列與認知層次欄，含未分類列/欄', () => {
    render(<SpecMatrixTable items={items} />);

    expect(screen.getByText('變數')).toBeInTheDocument();
    expect(screen.getAllByText('未分類').length).toBeGreaterThan(0);
    expect(screen.getByText('記憶')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/examBuilder/SpecMatrixTable.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `SpecMatrixTable.tsx`**

Create `src/features/examBuilder/SpecMatrixTable.tsx`:

```tsx
import { BLOOM_LEVELS, calcSpecMatrix } from '@/lib/examBuilder/checks';

import type { ExamItemRow } from './ExamBuilderClient';

type SpecMatrixTableProps = {
  items: ExamItemRow[];
};

export function SpecMatrixTable({ items }: SpecMatrixTableProps) {
  const matrix = calcSpecMatrix(items.map(i => ({ unit: i.unit, cognitiveLevel: i.cognitiveLevel, points: i.points })));
  const columns = [...BLOOM_LEVELS, { value: '未分類' as const, label: '未分類' }];

  return (
    <section className="rounded-xl border p-4">
      <h2 className="mb-3 text-sm font-semibold">雙向細目表（單元 × 認知層次，格內為配分／題數）</h2>
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">單元</th>
              {columns.map(c => <th key={c.value} className="text-left">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {matrix.map(row => (
              <tr key={row.unit}>
                <td>{row.unit}</td>
                {columns.map((c) => {
                  const cell = row.cells[c.value];
                  return (
                    <td key={c.value}>
                      {cell && cell.count > 0 ? `${cell.points} / ${cell.count}` : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Wire it into `ExamBuilderClient.tsx`**

Replace `{/* SpecMatrixTable 掛在這裡（Task 13） */}` with:

```tsx
      <SpecMatrixTable items={items} />
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/features/examBuilder/SpecMatrixTable.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/examBuilder/SpecMatrixTable.tsx src/features/examBuilder/SpecMatrixTable.test.tsx src/features/examBuilder/ExamBuilderClient.tsx
git commit -m "feat(exam-builder): add two-way specification matrix table"
```

---

## Task 14: `ExamExportPreview` — A/B paper, answer sheet, copy-to-clipboard

**Files:**
- Create: `src/features/examBuilder/ExamExportPreview.tsx`
- Test: `src/features/examBuilder/ExamExportPreview.test.tsx`
- Modify: `src/features/examBuilder/ExamBuilderClient.tsx` (wire it in)

**Interfaces:**
- Consumes: `ensureShuffleSeed`, `regenerateShuffleSeed` (Task 7); `shuffleItemsWithinType`, `shuffleOptionsWithRelabel` (Task 3)
- Produces: calls `onPaperChange(paper: ExamPaperRow)` prop — consumed by `ExamBuilderClient.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/features/examBuilder/ExamExportPreview.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { ExamExportPreview } from './ExamExportPreview';

const ensureShuffleSeed = vi.fn();
const regenerateShuffleSeed = vi.fn();
vi.mock('@/actions/examBuilderActions', () => ({
  ensureShuffleSeed: (...args: unknown[]) => ensureShuffleSeed(...args),
  regenerateShuffleSeed: (...args: unknown[]) => regenerateShuffleSeed(...args),
}));

const basePaper = {
  id: 1,
  ownerId: 'user_1',
  school: null,
  academicYear: null,
  examName: null,
  subject: null,
  gradeLevel: null,
  durationMinutes: null,
  teacherName: null,
  examScope: null,
  deviationThreshold: 5,
  shuffleSeed: null,
  updatedAt: new Date(),
  createdAt: new Date(),
};

const items = [
  { id: 1, paperId: 1, source: 'pasted' as const, position: 0, type: 'single_choice' as const, unit: null, cognitiveLevel: null, points: 4, stem: '題幹一', options: [{ label: 'A', text: 'int' }, { label: 'B', text: 'str' }], answer: 'A', updatedAt: new Date(), createdAt: new Date() },
];

describe('ExamExportPreview', () => {
  beforeEach(() => {
    ensureShuffleSeed.mockReset();
    regenerateShuffleSeed.mockReset();
  });

  it('A 卷預設顯示，切到 B 卷時若還沒有 seed 就呼叫 ensureShuffleSeed', async () => {
    ensureShuffleSeed.mockResolvedValue(123);
    const onPaperChange = vi.fn();

    render(<ExamExportPreview paper={basePaper} items={items} onPaperChange={onPaperChange} />);

    expect(screen.getByText('題幹一')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'B 卷' }));

    expect(ensureShuffleSeed).toHaveBeenCalledWith(1);
    expect(onPaperChange).toHaveBeenCalledWith({ ...basePaper, shuffleSeed: 123 });
  });

  it('已經有 seed 時，切到 B 卷不會再呼叫 ensureShuffleSeed（不會悄悄重新打亂）；按「重新打亂」才呼叫 regenerateShuffleSeed', async () => {
    const paperWithSeed = { ...basePaper, shuffleSeed: 10 };
    regenerateShuffleSeed.mockResolvedValue(20);
    const onPaperChange = vi.fn();

    render(<ExamExportPreview paper={paperWithSeed} items={items} onPaperChange={onPaperChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'B 卷' }));

    expect(ensureShuffleSeed).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: '重新打亂' }));

    expect(regenerateShuffleSeed).toHaveBeenCalledWith(1);
    expect(onPaperChange).toHaveBeenCalledWith({ ...paperWithSeed, shuffleSeed: 20 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/examBuilder/ExamExportPreview.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ExamExportPreview.tsx`**

Create `src/features/examBuilder/ExamExportPreview.tsx`:

```tsx
'use client';

import { useMemo, useRef, useState } from 'react';

import { ensureShuffleSeed, regenerateShuffleSeed } from '@/actions/examBuilderActions';
import { Button } from '@/components/ui/button';
import { shuffleItemsWithinType, shuffleOptionsWithRelabel } from '@/lib/examBuilder/shuffle';

import type { ExamItemRow, ExamPaperRow } from './ExamBuilderClient';

type ExamExportPreviewProps = {
  paper: ExamPaperRow;
  items: ExamItemRow[];
  onPaperChange: (paper: ExamPaperRow) => void;
};

type DisplayedItem = ExamItemRow & { displayAnswer: string };

function buildDisplayedItems(items: ExamItemRow[], paperVersion: 'A' | 'B', seed: number | null): DisplayedItem[] {
  if (paperVersion === 'A' || seed === null) {
    return items.map(i => ({ ...i, displayAnswer: i.answer }));
  }

  const ordered = shuffleItemsWithinType(items, seed);
  return ordered.map((item) => {
    if (item.type !== 'single_choice' || !item.options) {
      return { ...item, displayAnswer: item.answer };
    }
    const itemSeed = seed + item.id;
    const { options: shuffledOptions, remapAnswerLetter } = shuffleOptionsWithRelabel(item.options, itemSeed);
    return { ...item, options: shuffledOptions, displayAnswer: remapAnswerLetter(item.answer) };
  });
}

export function ExamExportPreview({ paper, items, onPaperChange }: ExamExportPreviewProps) {
  const [version, setVersion] = useState<'A' | 'B'>('A');
  const [tab, setTab] = useState<'exam' | 'answer'>('exam');
  const examRef = useRef<HTMLDivElement>(null);

  const displayedItems = useMemo(
    () => buildDisplayedItems(items, version, paper.shuffleSeed),
    [items, version, paper.shuffleSeed],
  );

  const handleSwitchToB = async () => {
    setVersion('B');
    if (paper.shuffleSeed === null) {
      const seed = await ensureShuffleSeed(paper.id);
      onPaperChange({ ...paper, shuffleSeed: seed });
    }
  };

  const handleReshuffle = async () => {
    const seed = await regenerateShuffleSeed(paper.id);
    onPaperChange({ ...paper, shuffleSeed: seed });
  };

  const handleSelectAll = () => {
    if (!examRef.current) {
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(examRef.current);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  return (
    <section className="rounded-xl border p-4">
      <div className="mb-3 flex items-center gap-2">
        <Button variant={tab === 'exam' ? 'default' : 'outline'} size="sm" onClick={() => setTab('exam')}>試題卷</Button>
        <Button variant={tab === 'answer' ? 'default' : 'outline'} size="sm" onClick={() => setTab('answer')}>答案卷</Button>
        <span className="mx-2 h-4 w-px bg-border" />
        <Button variant={version === 'A' ? 'default' : 'outline'} size="sm" onClick={() => setVersion('A')}>A 卷</Button>
        <Button variant={version === 'B' ? 'default' : 'outline'} size="sm" onClick={handleSwitchToB}>B 卷</Button>
        {version === 'B' && (
          <Button variant="outline" size="sm" onClick={handleReshuffle}>重新打亂</Button>
        )}
        <Button variant="outline" size="sm" className="ml-auto" onClick={handleSelectAll}>
          全選文字（再按 Ctrl/Cmd+C 複製）
        </Button>
      </div>

      <div ref={examRef} className="whitespace-pre-wrap rounded-lg border p-4 text-sm">
        {tab === 'exam' && displayedItems.map((item, i) => (
          <div key={item.id} className="mb-4">
            <p>
              {i + 1}
              . (
              {item.points}
              {' '}
              分)
              {' '}
              {item.stem}
            </p>
            {item.options && (
              <p>{item.options.map(o => `(${o.label}) ${o.text}`).join(' ')}</p>
            )}
          </div>
        ))}
        {tab === 'answer' && displayedItems.map((item, i) => (
          <p key={item.id}>
            {i + 1}
            .
            {' '}
            {item.displayAnswer}
          </p>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Wire it into `ExamBuilderClient.tsx`**

Replace `{/* ExamExportPreview 掛在這裡（Task 14） */}` with:

```tsx
      <ExamExportPreview paper={paper} items={items} onPaperChange={setPaper} />
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/features/examBuilder/ExamExportPreview.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/examBuilder/ExamExportPreview.tsx src/features/examBuilder/ExamExportPreview.test.tsx src/features/examBuilder/ExamBuilderClient.tsx
git commit -m "feat(exam-builder): add A/B paper and answer sheet export preview"
```

---

## Task 15: Entry link + full verification

**Files:**
- Modify: `src/app/[locale]/(auth)/dashboard/quizzes/page.tsx` (add entry link, same spot as the existing `/dashboard/import` link)

**Interfaces:**
- Consumes: nothing new
- Produces: nothing new (final integration + verification task)

- [ ] **Step 1: Add the entry link**

In `src/app/[locale]/(auth)/dashboard/quizzes/page.tsx`, immediately after the existing:

```tsx
                <Link
                  href="/dashboard/import"
                  className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  批次匯入備課包 ↗
                </Link>
```

add:

```tsx
                <Link
                  href="/dashboard/exam-builder"
                  className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  段考命題助手 ↗
                </Link>
```

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — all existing tests plus every new `src/lib/examBuilder/*.test.ts`, `src/actions/examBuilderActions.test.ts`, and `src/features/examBuilder/*.test.tsx` file green, 0 failures.

- [ ] **Step 3: Run type checking**

Run: `npm run check-types`
Expected: 0 errors. Pay particular attention to the `BLOOM_LEVELS[number]['value']` cast in `ExamItemEditDialog.tsx` and the `examItemTypeEnum`/`bloomLevelEnum` literal types flowing from `Schema.ts` through `parseExamText.ts` — a mismatch here (e.g. `'single_choice'` vs the enum's declared string union) will surface as a type error, not a runtime one.

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: 0 errors. Fix any import-order or unused-import issues `eslint --fix` doesn't already catch (lint-staged ran `eslint --fix` on commit, but a full-repo `npm run lint` can surface things lint-staged's per-file run missed, e.g. cross-file unused exports).

- [ ] **Step 5: Run the production build**

Run: `npm run build`
Expected: build succeeds. This is the step that catches the `'use server'`-file-exporting-a-Zod-schema class of bug (see Global Constraints) — `check-types` and `vitest` do not catch it. If the build fails on `examBuilderActions.ts`, check that every `const ...Schema = z.object(...)` in that file is **not** preceded by `export`.

- [ ] **Step 6: Manual smoke test**

Run: `npm run dev`, sign in, navigate to `/dashboard/exam-builder` (or click "段考命題助手 ↗" from `/dashboard/quizzes`). Confirm:
- Page loads with an empty exam paper (no crash on first visit — this exercises the find-or-create path with a real Postgres-shaped DB, not just PGlite).
- Pasting the sample text from the spec's "批次貼上解析規則" section produces a non-empty item list and a non-zero total-points display.
- Switching to "B 卷" produces a shuffled-looking paper; switching back to "A 卷" and back to "B 卷" again shows the *same* shuffled order (no silent reshuffle on tab switch).
- "從題庫匯入" lists at least one existing quiz if the signed-in teacher has one, and importing a question adds it to the list below.

Report back here if anything in this manual pass looks wrong — this plan's automated tests do not cover real-browser behavior (focus management, actual clipboard selection) since `src/components/ui/` has no existing Playwright coverage to extend for this feature.

- [ ] **Step 7: Final commit**

```bash
git add src/app/\[locale\]/\(auth\)/dashboard/quizzes/page.tsx
git commit -m "feat(exam-builder): add entry link from quizzes page"
```
