# Ranking 題型實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline mode chosen by user). Steps use checkbox (`- [ ]`) syntax.

**Goal:** 在 QuizFlow 新增第 5 種題型 `ranking`（拖拉排序題），學生端用 `survey-react-ui` 動態渲染，老師端沿用既有 QuestionForm。

**Architecture:** 路線 A — 只在學生端、只為 ranking 一題用 SurveyJS。老師輸入順序即正解；批改用 JSON.stringify 全對才給分；ranking 題顯示時永遠強制打亂選項。

**Tech Stack:** Next.js App Router、Drizzle ORM、Zod、survey-core、survey-react-ui、Tailwind、Anthropic SDK

---

## 修正重點（與 spec 不同處）

1. ~~i18n~~：題型標籤本來就是寫死中文常數 `QUESTION_TYPE_LABELS`，不走 locale。本計畫**不修改** zh.json/en.json。
2. **AI 出題流程**真正動到的檔案：`AIQuizModal.tsx`、`generate-questions/route.ts`、`generate-from-file/route.ts`、`api/quizzes/[id]/questions/route.ts`（不是 spec 寫的 `AIGenerateDialog.tsx`）。

---

### Task 0: 安裝套件

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 0.1: 安裝 survey-core 與 survey-react-ui**

```bash
npm install survey-core@^2.5 survey-react-ui@^2.5
```

- [ ] **Step 0.2: 確認安裝成功**

```bash
npm ls survey-core survey-react-ui
```
Expected: 兩個套件版本顯示在依賴樹中。

- [ ] **Step 0.3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(deps): 安裝 survey-core + survey-react-ui 用於 ranking 題型"
```

---

### Task 1: DB enum + migration

**Files:**
- Modify: `src/models/Schema.ts:55-60`
- Create (auto-generated): `migrations/<auto>.sql`

- [ ] **Step 1.1: 修改 questionTypeEnum**

`src/models/Schema.ts:55-60` 把：
```ts
export const questionTypeEnum = pgEnum('question_type', [
  'single_choice', // 單選題
  'multiple_choice', // 多選題
  'true_false', // 是非題
  'short_answer', // 簡答題
]);
```
改成：
```ts
export const questionTypeEnum = pgEnum('question_type', [
  'single_choice', // 單選題
  'multiple_choice', // 多選題
  'true_false', // 是非題
  'short_answer', // 簡答題
  'ranking', // 排序題
]);
```

- [ ] **Step 1.2: 產生 migration**

```bash
npm run db:generate
```
Expected: 在 `migrations/` 下產生新檔，內容包含 `ALTER TYPE "question_type" ADD VALUE 'ranking';`（或對應的 PGlite 轉換後結果）。

- [ ] **Step 1.3: Type check**

```bash
npm run check-types
```
Expected: 無錯誤。

- [ ] **Step 1.4: Commit**

```bash
git add src/models/Schema.ts migrations/
git commit -m "feat(db): questionTypeEnum 加入 ranking 排序題型"
```

---

### Task 2: questionActions Zod schema 加 ranking

**Files:**
- Modify: `src/actions/questionActions.ts:24-33`

- [ ] **Step 2.1: 加 ranking 到 Zod enum**

`src/actions/questionActions.ts:25` 把：
```ts
type: z.enum(['single_choice', 'multiple_choice', 'true_false', 'short_answer']),
```
改成：
```ts
type: z.enum(['single_choice', 'multiple_choice', 'true_false', 'short_answer', 'ranking']),
```

- [ ] **Step 2.2: Type check**

```bash
npm run check-types
```
Expected: 無錯誤。

- [ ] **Step 2.3: Commit**

```bash
git add src/actions/questionActions.ts
git commit -m "feat(actions): questionActions 接受 ranking 題型輸入"
```

---

### Task 3: responseActions 批改邏輯加 ranking

**Files:**
- Modify: `src/actions/responseActions.ts:14, 77-92`

- [ ] **Step 3.1: 更新 SubmitSchema 註解（無功能變更但保持文件正確）**

`src/actions/responseActions.ts:14` 註解保持：`// answer 是 string（簡答/是非）或 string[]（選擇/排序題）` — 把舊註解更新成這樣即可。

- [ ] **Step 3.2: 加 ranking 批改分支**

`src/actions/responseActions.ts:85-91` 把：
```ts
if (question.type === 'single_choice' || question.type === 'true_false') {
  isCorrect = correct.includes(studentAnswer as string);
} else if (question.type === 'multiple_choice') {
  const given = Array.isArray(studentAnswer) ? [...studentAnswer].sort() : [];
  const expected = [...correct].sort();
  isCorrect = JSON.stringify(given) === JSON.stringify(expected);
}
```
改成：
```ts
if (question.type === 'single_choice' || question.type === 'true_false') {
  isCorrect = correct.includes(studentAnswer as string);
} else if (question.type === 'multiple_choice') {
  const given = Array.isArray(studentAnswer) ? [...studentAnswer].sort() : [];
  const expected = [...correct].sort();
  isCorrect = JSON.stringify(given) === JSON.stringify(expected);
} else if (question.type === 'ranking') {
  // 排序題：學生答案順序必須與正確順序完全一致才算對
  const given = Array.isArray(studentAnswer) ? studentAnswer : [];
  isCorrect = JSON.stringify(given) === JSON.stringify(correct);
}
```

- [ ] **Step 3.3: Type check**

```bash
npm run check-types
```
Expected: 無錯誤。

- [ ] **Step 3.4: Commit**

```bash
git add src/actions/responseActions.ts
git commit -m "feat(grading): 加入 ranking 題型批改（全對才給分）"
```

---

### Task 4: QuestionForm 老師端編輯器

**Files:**
- Modify: `src/features/quiz/QuestionForm.tsx`

- [ ] **Step 4.1: 加 ranking 到 QUESTION_TYPE_LABELS**

`src/features/quiz/QuestionForm.tsx:10-15` 把：
```ts
export const QUESTION_TYPE_LABELS = {
  single_choice: '單選題',
  multiple_choice: '多選題',
  true_false: '是非題',
  short_answer: '簡答題',
} as const;
```
改成：
```ts
export const QUESTION_TYPE_LABELS = {
  single_choice: '單選題',
  multiple_choice: '多選題',
  true_false: '是非題',
  short_answer: '簡答題',
  ranking: '排序題',
} as const;
```

- [ ] **Step 4.2: 加 ranking 到 Zod schema**

`src/features/quiz/QuestionForm.tsx:23` 把：
```ts
type: z.enum(['single_choice', 'multiple_choice', 'true_false', 'short_answer']),
```
改成：
```ts
type: z.enum(['single_choice', 'multiple_choice', 'true_false', 'short_answer', 'ranking']),
```

- [ ] **Step 4.3: 切換到 ranking 時 init 3 個空選項**

`src/features/quiz/QuestionForm.tsx:73-93` 的 useEffect，把：
```ts
useEffect(() => {
  if (type === 'true_false') {
    replace(TRUE_FALSE_OPTIONS);
    form.setValue('correctAnswers', []);
  } else if (type === 'short_answer') {
    replace([]);
    form.setValue('correctAnswers', []);
  } else {
    // 從 true_false / short_answer 切換到選擇題時，初始化兩個空選項
    const current = form.getValues('options') ?? [];
    const isTrueFalse = current[0]?.id === 'tf-true';
    if (current.length === 0 || isTrueFalse) {
      replace([
        { id: crypto.randomUUID(), text: '' },
        { id: crypto.randomUUID(), text: '' },
      ]);
      form.setValue('correctAnswers', []);
    }
  }
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [type]);
```
改成：
```ts
useEffect(() => {
  if (type === 'true_false') {
    replace(TRUE_FALSE_OPTIONS);
    form.setValue('correctAnswers', []);
  } else if (type === 'short_answer') {
    replace([]);
    form.setValue('correctAnswers', []);
  } else if (type === 'ranking') {
    // 排序題：至少 3 個選項才有意義
    const current = form.getValues('options') ?? [];
    const isTrueFalseShape = current[0]?.id === 'tf-true';
    if (current.length < 3 || isTrueFalseShape) {
      replace([
        { id: crypto.randomUUID(), text: '' },
        { id: crypto.randomUUID(), text: '' },
        { id: crypto.randomUUID(), text: '' },
      ]);
    }
    // 排序題的 correctAnswers 在 submit 時根據選項順序決定，這裡先清空
    form.setValue('correctAnswers', []);
  } else {
    // 從 true_false / short_answer / ranking 切換到一般選擇題，初始化兩個空選項
    const current = form.getValues('options') ?? [];
    const isTrueFalse = current[0]?.id === 'tf-true';
    if (current.length === 0 || isTrueFalse) {
      replace([
        { id: crypto.randomUUID(), text: '' },
        { id: crypto.randomUUID(), text: '' },
      ]);
      form.setValue('correctAnswers', []);
    }
  }
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [type]);
```

- [ ] **Step 4.4: ranking 時 isChoiceType 視為可加減選項**

`src/features/quiz/QuestionForm.tsx:114` 把：
```ts
const isChoiceType = type === 'single_choice' || type === 'multiple_choice';
```
改成：
```ts
const isChoiceType = type === 'single_choice' || type === 'multiple_choice';
const isOrderingType = type === 'ranking';
const allowsMultipleOptions = isChoiceType || isOrderingType;
```

- [ ] **Step 4.5: 選項列表 UI — ranking 時隱藏正解圓鈕、顯示順序編號**

`src/features/quiz/QuestionForm.tsx:206-263` 整段「選項清單」區塊重寫：
```tsx
{type !== 'short_answer' && (
  <div>
    <label className="mb-1 block text-sm font-medium">
      選項
      <span className="ml-1 text-xs font-normal text-muted-foreground">
        （
        {type === 'multiple_choice'
          ? '可選多個正確答案'
          : type === 'ranking'
            ? '由上到下即正確順序'
            : '點選正確答案'}
        ）
      </span>
    </label>
    <div className="space-y-2">
      {fields.map((field, index) => {
        const isCorrect = correctAnswers.includes(field.id);
        return (
          <div key={field.id} className="flex items-center gap-2">
            {/* ranking：左側顯示順序編號 */}
            {isOrderingType
              ? (
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                    {index + 1}
                  </span>
                )
              : (
                  <button
                    type="button"
                    onClick={() => toggleCorrect(field.id)}
                    className={`size-5 shrink-0 rounded-full border-2 transition-colors ${
                      isCorrect
                        ? 'border-green-500 bg-green-500'
                        : 'border-input bg-background hover:border-green-400'
                    }`}
                    title="設為正確答案"
                    aria-label={isCorrect ? '取消正確答案' : '設為正確答案'}
                  />
                )}
            <input
              {...form.register(`options.${index}.text`)}
              placeholder={`選項 ${index + 1}`}
              disabled={type === 'true_false'}
              className="h-8 flex-1 rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            />
            {allowsMultipleOptions && fields.length > (isOrderingType ? 3 : 2) && (
              <button
                type="button"
                onClick={() => remove(index)}
                className="text-sm text-muted-foreground hover:text-destructive"
                aria-label="刪除選項"
              >
                ✕
              </button>
            )}
          </div>
        );
      })}
    </div>
    {allowsMultipleOptions && (
      <button
        type="button"
        onClick={() => append({ id: crypto.randomUUID(), text: '' })}
        className="mt-2 text-sm text-blue-500 hover:text-blue-600"
      >
        + 新增選項
      </button>
    )}
  </div>
)}
```

- [ ] **Step 4.6: handleSubmit 包裝 — ranking 時把 correctAnswers 設成 options 順序**

`src/features/quiz/QuestionForm.tsx:110-112` 把：
```ts
const handleSubmit = form.handleSubmit(async (data) => {
  await onSubmit(data);
});
```
改成：
```ts
const handleSubmit = form.handleSubmit(async (data) => {
  // 排序題：correctAnswers 由選項輸入順序決定
  if (data.type === 'ranking' && data.options) {
    data.correctAnswers = data.options.map(o => o.id);
  }
  await onSubmit(data);
});
```

- [ ] **Step 4.7: Type check + lint**

```bash
npm run check-types && npm run lint -- --max-warnings=999
```
Expected: 無錯誤；warning 數量不超過原本（35）。

- [ ] **Step 4.8: Commit**

```bash
git add src/features/quiz/QuestionForm.tsx
git commit -m "feat(editor): QuestionForm 加入 ranking 排序題編輯介面"
```

---

### Task 5: RankingQuestion 元件（新檔）

**Files:**
- Create: `src/features/quiz/RankingQuestion.tsx`

- [ ] **Step 5.1: 寫 RankingQuestion 元件**

新檔 `src/features/quiz/RankingQuestion.tsx`：
```tsx
'use client';

/**
 * RankingQuestion
 * 學生端拖拉排序題渲染元件，內部用 survey-react-ui 渲染單一 ranking widget。
 * 受控元件：父層傳入 value（id 陣列）與 onChange，元件負責同步 SurveyJS 狀態。
 */

import { useEffect, useMemo } from 'react';
import { Model } from 'survey-core';
import { Survey } from 'survey-react-ui';

import 'survey-core/survey-core.css';

type Option = { id: string; text: string };

type Props = {
  questionId: number;
  options: Option[]; // 已打亂的顯示順序
  value: string[] | undefined; // 學生目前的答案（id 陣列）
  onChange: (value: string[]) => void;
};

export function RankingQuestion({ questionId, options, value, onChange }: Props) {
  // 用 useMemo 鎖定 model 實例：避免每次 render 都重建造成 SurveyJS 內部狀態錯亂
  const survey = useMemo(() => {
    const name = `q${questionId}`;
    const model = new Model({
      questions: [
        {
          type: 'ranking',
          name,
          title: ' ', // QuizFlow 在外層已顯示題目本文，這裡只渲染 ranking widget
          choices: options.map(o => ({ value: o.id, text: o.text })),
        },
      ],
      showQuestionNumbers: 'off',
      showCompletedPage: false,
      showNavigationButtons: 'none',
    });
    return model;
  // 只有 questionId 或 options 變動時才重建（同一題的連續 render 會重用）
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionId, options]);

  // 同步父層 value 進 SurveyJS（受控）
  useEffect(() => {
    const name = `q${questionId}`;
    if (value && value.length > 0) {
      survey.setValue(name, value);
    }
  }, [survey, questionId, value]);

  // 監聽 SurveyJS 變更回報父層
  useEffect(() => {
    const name = `q${questionId}`;
    const handler = (_sender: unknown, opts: { name: string; value: unknown }) => {
      if (opts.name === name && Array.isArray(opts.value)) {
        onChange(opts.value as string[]);
      }
    };
    survey.onValueChanged.add(handler);
    return () => {
      survey.onValueChanged.remove(handler);
    };
  }, [survey, questionId, onChange]);

  return <Survey model={survey} />;
}
```

- [ ] **Step 5.2: Type check**

```bash
npm run check-types
```
Expected: 無錯誤（survey-core 與 survey-react-ui 內建有 typings）。

- [ ] **Step 5.3: Commit**

```bash
git add src/features/quiz/RankingQuestion.tsx
git commit -m "feat(taker): 新增 RankingQuestion 元件（survey-react-ui 整合）"
```

---

### Task 6: QuizTaker 整合 ranking

**Files:**
- Modify: `src/features/quiz/QuizTaker.tsx`

- [ ] **Step 6.1: import next/dynamic 並動態載入 RankingQuestion**

在 `src/features/quiz/QuizTaker.tsx` 檔案頂端 import 區（第 1-11 行附近）加上：
```ts
import dynamic from 'next/dynamic';
```
並在 `import { FlashCard } from './FlashCard';`（第 11 行）下面加：
```ts
// 只有當測驗包含 ranking 題時才會載入 survey-react-ui，避免影響其他測驗的 bundle 大小
const RankingQuestion = dynamic(
  () => import('./RankingQuestion').then(m => m.RankingQuestion),
  {
    ssr: false,
    loading: () => <p className="text-sm text-muted-foreground">載入排序題…</p>,
  },
);
```

- [ ] **Step 6.2: QuestionItem 加入 ranking 渲染分支**

在 `src/features/quiz/QuizTaker.tsx` 的 `QuestionItem` 元件（第 22-128 行），在「簡答題」區塊之後，`</div>` 結尾之前，加入新的 ranking 分支。具體位置：在第 125 行 `)}` 後、第 126 行 `</div>` 前，加入：
```tsx
      {/* 排序題 */}
      {question.type === 'ranking' && (
        <div className="pl-2">
          <p className="mb-2 text-xs text-muted-foreground">請拖曳選項排出正確順序</p>
          <RankingQuestion
            questionId={question.id}
            options={options}
            value={Array.isArray(answer) ? answer : undefined}
            onChange={v => onChange(v)}
          />
        </div>
      )}
```

- [ ] **Step 6.3: displayQuestions 初始化 — ranking 強制打亂**

`src/features/quiz/QuizTaker.tsx:506-515` 把：
```ts
const [displayQuestions] = useState<Question[]>(() => {
  const ordered = quiz.shuffleQuestions ? shuffle(questions) : questions;
  if (!quiz.shuffleOptions) {
    return ordered;
  }
  return ordered.map(q =>
    q.options ? { ...q, options: shuffle(q.options) } : q,
  );
});
```
改成：
```ts
const [displayQuestions] = useState<Question[]>(() => {
  const ordered = quiz.shuffleQuestions ? shuffle(questions) : questions;
  return ordered.map((q) => {
    // 排序題：永遠打亂選項，否則學生「不拖也對」
    if (q.type === 'ranking' && q.options) {
      return { ...q, options: shuffle(q.options) };
    }
    if (quiz.shuffleOptions && q.options) {
      return { ...q, options: shuffle(q.options) };
    }
    return q;
  });
});
```

- [ ] **Step 6.4: handleSubmit unanswered 檢查加 ranking 分支**

`src/features/quiz/QuizTaker.tsx:550-559` 把：
```ts
const handleSubmit = (skipValidation = false) => {
  if (!skipValidation) {
    const unanswered = displayQuestions.filter(
      q => q.type !== 'short_answer' && !answers[q.id],
    );
    if (unanswered.length > 0) {
      setError(`還有 ${unanswered.length} 題未作答`);
      return;
    }
  }
```
改成：
```ts
const handleSubmit = (skipValidation = false) => {
  if (!skipValidation) {
    const unanswered = displayQuestions.filter((q) => {
      if (q.type === 'short_answer') {
        return false;
      }
      const ans = answers[q.id];
      // 排序題：必須拖完所有選項才算作答完成
      if (q.type === 'ranking') {
        const expectedLen = q.options?.length ?? 0;
        return !Array.isArray(ans) || ans.length !== expectedLen;
      }
      return !ans;
    });
    if (unanswered.length > 0) {
      setError(`還有 ${unanswered.length} 題未作答`);
      return;
    }
  }
```

- [ ] **Step 6.5: RetryScreen 本機批改加 ranking 分支**

`src/features/quiz/QuizTaker.tsx:380-397` 把 `wrongQuestions.forEach((q) => { ... });` 區塊裡的 if/else 改成：
```ts
wrongQuestions.forEach((q) => {
  const ans = retryAnswers[q.id];
  if (!q.correctAnswers || !ans) {
    return;
  }

  if (q.type === 'single_choice' || q.type === 'true_false') {
    if (q.correctAnswers.includes(ans as string)) {
      correct++;
    }
  } else if (q.type === 'multiple_choice') {
    const given = Array.isArray(ans) ? [...ans].sort() : [];
    const expected = [...q.correctAnswers].sort();
    if (JSON.stringify(given) === JSON.stringify(expected)) {
      correct++;
    }
  } else if (q.type === 'ranking') {
    // 排序題：完全相同才算對
    const given = Array.isArray(ans) ? ans : [];
    if (JSON.stringify(given) === JSON.stringify(q.correctAnswers)) {
      correct++;
    }
  }
});
```

- [ ] **Step 6.6: ResultScreen 答案顯示 — ranking 用 → 串接**

`src/features/quiz/QuizTaker.tsx:285-340` 找到 `ResultScreen` 裡的「逐題對照」區塊。在「學生的答案」與「正確答案」兩處顯示邏輯，目前用 `.join('、')` 串接，要為 ranking 改成 `→`。

具體位置在 `src/features/quiz/QuizTaker.tsx:319-340`，把 `<div className="mt-2 text-sm">` 區塊與 `<div className="mt-1 text-sm text-green-700">` 區塊改成：
```tsx
                {/* 學生的答案 */}
                <div className="mt-2 text-sm">
                  <span className="text-muted-foreground">你的答案：</span>
                  {Array.isArray(studentAnswer)
                    ? studentAnswer
                      .map(id => options.find(o => o.id === id)?.text ?? id)
                      .join(question.type === 'ranking' ? ' → ' : '、')
                    : typeof studentAnswer === 'string'
                      ? (options.find(o => o.id === studentAnswer)?.text ?? studentAnswer) || (
                          <span className="italic text-muted-foreground">未作答</span>
                        )
                      : <span className="italic text-muted-foreground">未作答</span>}
                </div>

                {/* 正確答案（非簡答題且答錯） */}
                {!isShort && detail?.isCorrect === false && question.correctAnswers && (
                  <div className="mt-1 text-sm text-green-700">
                    <span className="text-muted-foreground">正確答案：</span>
                    {question.correctAnswers
                      .map(id => options.find(o => o.id === id)?.text ?? id)
                      .join(question.type === 'ranking' ? ' → ' : '、')}
                  </div>
                )}
```

- [ ] **Step 6.7: AI 弱點分析的答案組字也要支援 ranking**

`src/features/quiz/QuizTaker.tsx:178-189` 在 `useEffect` 內組 `wrongQuestions` 給 AI 的地方，把：
```ts
const studentText = Array.isArray(studentAns)
  ? studentAns.map(id => options.find(o => o.id === id)?.text ?? id).join('、')
  : options.find(o => o.id === studentAns)?.text ?? studentAns ?? '（未作答）';

const correctText = (q.correctAnswers ?? [])
  .map(id => options.find(o => o.id === id)?.text ?? id)
  .join('、');
```
改成：
```ts
const sep = q.type === 'ranking' ? ' → ' : '、';
const studentText = Array.isArray(studentAns)
  ? studentAns.map(id => options.find(o => o.id === id)?.text ?? id).join(sep)
  : options.find(o => o.id === studentAns)?.text ?? studentAns ?? '（未作答）';

const correctText = (q.correctAnswers ?? [])
  .map(id => options.find(o => o.id === id)?.text ?? id)
  .join(sep);
```

- [ ] **Step 6.8: Type check + lint**

```bash
npm run check-types && npm run lint -- --max-warnings=999
```
Expected: 無錯誤；warning 數量不超過原本（35）。

- [ ] **Step 6.9: Commit**

```bash
git add src/features/quiz/QuizTaker.tsx
git commit -m "feat(taker): QuizTaker 整合 ranking 題型（強制打亂、批改、結果顯示）"
```

---

### Task 7: AI 出題支援 ranking

**Files:**
- Modify: `src/components/quiz/AIQuizModal.tsx`
- Modify: `src/app/api/ai/generate-questions/route.ts`
- Modify: `src/app/api/ai/generate-from-file/route.ts`
- Modify: `src/app/api/quizzes/[id]/questions/route.ts`

- [ ] **Step 7.1: AIQuizModal 加入 rank 題型勾選**

`src/components/quiz/AIQuizModal.tsx:18` 把：
```ts
type QuestionType = 'mc' | 'tf' | 'fill' | 'short';
```
改成：
```ts
type QuestionType = 'mc' | 'tf' | 'fill' | 'short' | 'rank';
```

`src/components/quiz/AIQuizModal.tsx:42-47` `QUESTION_TYPES` 常數加入 rank：
```ts
const QUESTION_TYPES = [
  { value: 'mc' as QuestionType, emoji: '🔘', label: '選擇題', sub: '四選一' },
  { value: 'tf' as QuestionType, emoji: '⭕', label: '是非題', sub: '○ / ✕' },
  { value: 'fill' as QuestionType, emoji: '✏️', label: '填空題', sub: '填入答案' },
  { value: 'short' as QuestionType, emoji: '📝', label: '簡答題', sub: '短文作答' },
  { value: 'rank' as QuestionType, emoji: '🔢', label: '排序題', sub: '依序排列' },
];
```

- [ ] **Step 7.2: generate-questions/route.ts 加入 rank prompt**

`src/app/api/ai/generate-questions/route.ts:22-27` `TYPE_LABELS` 加入：
```ts
const TYPE_LABELS: Record<string, string> = {
  mc: '選擇題（4選1，標明正確選項字母）',
  tf: '是非題（答案為「○」或「✕」）',
  fill: '填空題（用 ___ 標空格，附答案）',
  short: '簡答題（附參考答案）',
  rank: '排序題（提供 3-5 個項目，answer 為依正確順序排列的項目陣列）',
};
```

`src/app/api/ai/generate-questions/route.ts:69-77` Prompt 的 JSON 範例加入 rank 樣本，把：
```
{
  "title": "根據主題自動命名的試卷標題",
  "questions": [
    { "type": "mc", "question": "題目", "options": ["(A)選項一","(B)選項二","(C)選項三","(D)選項四"], "answer": "A", "explanation": "說明" },
    { "type": "tf", "question": "敘述句題目", "answer": "○", "explanation": "說明" },
    { "type": "fill", "question": "含 ___ 的題目", "answer": "答案", "explanation": "" },
    { "type": "short", "question": "簡答題目", "answer": "參考答案", "explanation": "" }
  ]
}
```
改成：
```
{
  "title": "根據主題自動命名的試卷標題",
  "questions": [
    { "type": "mc", "question": "題目", "options": ["(A)選項一","(B)選項二","(C)選項三","(D)選項四"], "answer": "A", "explanation": "說明" },
    { "type": "tf", "question": "敘述句題目", "answer": "○", "explanation": "說明" },
    { "type": "fill", "question": "含 ___ 的題目", "answer": "答案", "explanation": "" },
    { "type": "short", "question": "簡答題目", "answer": "參考答案", "explanation": "" },
    { "type": "rank", "question": "請依時間先後排列下列事件", "options": ["文藝復興","工業革命","二次大戰","網際網路誕生"], "answer": ["文藝復興","工業革命","二次大戰","網際網路誕生"], "explanation": "說明" }
  ]
}
```

- [ ] **Step 7.3: generate-from-file/route.ts 同步加 rank 支援**

`src/app/api/ai/generate-from-file/route.ts:21-26` `TYPE_LABELS` 同樣加入 rank：
```ts
const TYPE_LABELS: Record<string, string> = {
  mc: '選擇題（4選1，標明正確選項字母）',
  tf: '是非題（答案為「○」或「✕」）',
  fill: '填空題（用 ___ 標空格，附答案）',
  short: '簡答題（附參考答案）',
  rank: '排序題（提供 3-5 個項目，answer 為依正確順序排列的項目陣列）',
};
```

`src/app/api/ai/generate-from-file/route.ts:91-100` Prompt JSON 範例同樣加 rank 樣本，把：
```
{
  "title": "根據文件內容自動命名的試卷標題",
  "questions": [
    { "type": "mc", "question": "題目", "options": ["(A)..","(B)..","(C)..","(D).."], "answer": "A", "explanation": "說明" },
    { "type": "tf", "question": "敘述句題目", "answer": "○", "explanation": "說明" },
    { "type": "fill", "question": "含 ___ 的題目", "answer": "答案", "explanation": "" },
    { "type": "short", "question": "簡答題目", "answer": "參考答案", "explanation": "" }
  ]
}
```
改成：
```
{
  "title": "根據文件內容自動命名的試卷標題",
  "questions": [
    { "type": "mc", "question": "題目", "options": ["(A)..","(B)..","(C)..","(D).."], "answer": "A", "explanation": "說明" },
    { "type": "tf", "question": "敘述句題目", "answer": "○", "explanation": "說明" },
    { "type": "fill", "question": "含 ___ 的題目", "answer": "答案", "explanation": "" },
    { "type": "short", "question": "簡答題目", "answer": "參考答案", "explanation": "" },
    { "type": "rank", "question": "請依時間先後排列下列事件", "options": ["文藝復興","工業革命","二次大戰","網際網路誕生"], "answer": ["文藝復興","工業革命","二次大戰","網際網路誕生"], "explanation": "說明" }
  ]
}
```

- [ ] **Step 7.4: 批次匯入 API 加 rank 轉換邏輯**

`src/app/api/quizzes/[id]/questions/route.ts:9-24` 把：
```ts
type FileQuestionType = 'mc' | 'tf' | 'fill' | 'short';
type GeneratedQuestion = {
  type: FileQuestionType;
  question: string;
  options?: string[];
  answer: string;
  explanation?: string;
};

// 題型對應：AIQuizModal → DB enum
const DB_TYPE_MAP = {
  mc: 'single_choice',
  tf: 'true_false',
  fill: 'short_answer',
  short: 'short_answer',
} as const satisfies Record<FileQuestionType, 'single_choice' | 'true_false' | 'short_answer'>;
```
改成：
```ts
type FileQuestionType = 'mc' | 'tf' | 'fill' | 'short' | 'rank';
type GeneratedQuestion = {
  type: FileQuestionType;
  question: string;
  options?: string[];
  // rank 題的 answer 是陣列；其他題型是字串
  answer: string | string[];
  explanation?: string;
};

// 題型對應：AIQuizModal → DB enum
const DB_TYPE_MAP = {
  mc: 'single_choice',
  tf: 'true_false',
  fill: 'short_answer',
  short: 'short_answer',
  rank: 'ranking',
} as const satisfies Record<FileQuestionType, 'single_choice' | 'true_false' | 'short_answer' | 'ranking'>;
```

`src/app/api/quizzes/[id]/questions/route.ts:71-102` 把整段 `const rows = questions.map(...)` 改成：
```ts
  const rows = questions.map((q) => {
    const type = DB_TYPE_MAP[q.type] ?? 'short_answer';
    let options: { id: string; text: string }[] | null = null;
    let correctAnswers: string[] = [];

    if (q.type === 'mc' && q.options?.length) {
      // 選擇題：將 string[] 轉成 { id, text }[]
      options = q.options.map((text, i) => ({
        id: String.fromCharCode(97 + i), // a, b, c, d
        text,
      }));
      // answer 可能是 "A"/"B" 大寫字母，或選項文字本身
      const ansStr = typeof q.answer === 'string' ? q.answer : '';
      const answerKey = ansStr.trim().toLowerCase();
      const byLetter = options.find(o => o.id === answerKey);
      const byText = options.find(o => o.text === ansStr);
      const matched = byLetter ?? byText;
      correctAnswers = matched ? [matched.id] : [];
    } else if (q.type === 'rank' && q.options?.length) {
      // 排序題：把每個選項文字配上 id；correctAnswers 是依 q.answer 順序對映的 id 陣列
      options = q.options.map((text, i) => ({
        id: String.fromCharCode(97 + i),
        text,
      }));
      const answerArr = Array.isArray(q.answer) ? q.answer : [];
      correctAnswers = answerArr
        .map(ansText => options!.find(o => o.text === ansText)?.id)
        .filter((id): id is string => Boolean(id));
      // 若 AI 幻覺導致對映失敗（長度不一致），回退到輸入順序
      if (correctAnswers.length !== options.length) {
        correctAnswers = options.map(o => o.id);
      }
    } else {
      // 是非題 / 填空 / 簡答：直接存 answer 字串
      const ansStr = typeof q.answer === 'string' ? q.answer : '';
      correctAnswers = ansStr ? [ansStr] : [];
    }

    return {
      quizId,
      type,
      body: q.question,
      options,
      correctAnswers: correctAnswers.length ? correctAnswers : null,
      points: 1,
      position: nextPosition++,
    };
  });
```

- [ ] **Step 7.5: Type check + lint**

```bash
npm run check-types && npm run lint -- --max-warnings=999
```
Expected: 無錯誤。

- [ ] **Step 7.6: Commit**

```bash
git add src/components/quiz/AIQuizModal.tsx src/app/api/ai/generate-questions/route.ts src/app/api/ai/generate-from-file/route.ts src/app/api/quizzes/[id]/questions/route.ts
git commit -m "feat(ai): AI 出題支援 ranking 排序題（modal、prompt、批次匯入轉換）"
```

---

### Task 8: 全站建置驗證

**Files:**
- 無檔案修改

- [ ] **Step 8.1: Type check**

```bash
npm run check-types
```
Expected: 0 錯誤。

- [ ] **Step 8.2: Lint**

```bash
npm run lint
```
Expected: 不增加新的 warning（原本約 35 個）。

- [ ] **Step 8.3: Build**

```bash
npm run build
```
Expected: build 成功；輸出顯示 ranking-related chunks（survey-react-ui 應為獨立 chunk）。

- [ ] **Step 8.4: 若 build 失敗，回頭修對應 Task 並重 commit；若全綠，無需額外 commit**

---

### Task 9: 手動煙霧測試（dev server）

**Files:**
- 無檔案修改

- [ ] **Step 9.1: 啟動 dev server（背景）**

```bash
npm run dev
```
背景執行，監聽 stdout 直到看到 `Ready in` 訊息（或約 10 秒）。

- [ ] **Step 9.2: 條列待手動驗證項目（無法在無瀏覽器環境自動執行）**

以下項目記錄在 commit message 或 follow-up 給 user，不做自動執行：

1. 老師建立 ranking 題（4 個選項：「文藝復興」「工業革命」「二次大戰」「網際網路誕生」），按輸入順序儲存
2. 發佈測驗 → 用無痕視窗開學生作答頁
3. 確認看到 4 個選項顯示順序與輸入順序不同（已強制打亂）
4. 不拖任何選項就點送出 → 應被擋在「還有 1 題未作答」
5. 拖出完全錯誤順序送出 → 0 分
6. 拖出完全正確順序送出 → 滿分
7. 答錯時成績頁應顯示「你的答案：A → B → C → D」「正確答案：D → C → B → A」
8. AI 出題勾「排序題」+ 主題「中國朝代興衰」→ 應產生 ranking 題並能匯入
9. 既有 4 種題型測驗（單選/多選/是非/簡答）打開仍正常運作（迴歸）
10. 沒有 ranking 題的測驗，學生作答頁載入時 Network 不應有 survey-react-ui chunk

- [ ] **Step 9.3: 停止 dev server**

```bash
# 透過先前的 background id kill 掉
```

---

## Self-Review

**Spec 涵蓋率**：
- ✅ DB enum 變更（Task 1）
- ✅ QuestionForm（Task 4）
- ✅ RankingQuestion 新元件（Task 5）
- ✅ QuizTaker 整合（Task 6）
- ✅ 批改邏輯（Task 3）
- ✅ AI prompt + 匯入（Task 7）
- ⚠️ i18n（spec 列入但實際 codebase 寫死中文，本計畫**故意省略**並在頂部說明）
- ✅ 不做的事（YAGNI）— 維持原樣

**Placeholder 掃描**：無 TBD/TODO/「實作後處理」字樣。

**Type 一致性**：`RankingQuestion` props 介面與 `QuizTaker.QuestionItem` 呼叫處一致；`correctAnswers: string[]` 在 DB、Server Action、批改、UI 顯示處都使用相同型別。

**Scope check**：所有任務在同一 spec 範圍內，無需拆分。
