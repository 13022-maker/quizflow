# Ranking 題型設計規格

**日期**：2026-04-12
**作者**：Claude (brainstorming with @prpispace)
**狀態**：Approved (sections §1 confirmed; §2–§7 auto-approved per user instruction "接下來的問題不用問我，直接做")

## 目標

在 QuizFlow 新增第 5 種題型 **ranking（排序題）**：學生看到一組打亂順序的選項，必須拖拉調整成正確順序才能得分。利用 SurveyJS 的 `survey-react-ui` ranking widget 取得免費的拖拉互動、a11y、動畫，避免自己用 @dnd-kit 從頭刻。

## 決策摘要

| 議題 | 決策 | 理由 |
|---|---|---|
| 整合方式 | 路線 A：只在學生端、只為 ranking 一題使用 SurveyJS | 改動範圍最小、其他題型零風險、bundle 動態載入 |
| 批改方式 | (A) 全對才給分 | 與現有 multiple_choice 風格一致、不動 `isCorrect: boolean` 型別 |
| 老師端輸入 | (A) 輸入順序即正確順序 | 直覺、`useFieldArray` 不用改、和現有題型一致 |
| AI 出題 | (A) 支援 ranking | ranking 對歷史/科學/數學題材特別有用，純加法改動 |
| i18n | 繁/英同步全補 | 遵守 CLAUDE.md 硬規則 |
| 未排完的處理 | 視為未作答（被擋在提交前） | 與現有「沒選就是未作答」一致；避免「不拖也滿分」漏洞 |
| ranking 顯示順序 | 永遠強制打亂，無視 `quiz.shuffleOptions` | 否則題型失去意義 |

## 架構

```
老師端                           DB                       學生端
─────────                        ─────                    ─────────
QuestionForm                                              QuizTaker
 ├─ type='ranking'                                         └─ QuestionItem
 ├─ useFieldArray                                              ├─ if type==='ranking':
 │   (輸入順序=正解)                                            │    dynamic import
 ├─ 隱藏「正解」按鈕            questionTypeEnum               │    <RankingQuestion/>
 └─ submit:                ─→   += 'ranking'           ←─    │      └─ survey-react-ui
    correctAnswers =             (其他欄位不動)                │         <Survey/>
    options.map(o=>o.id)                                     └─ else: 既有渲染
                                                             handleSubmit:
AIGenerateDialog                                              └─ ranking 必須長度相同
 └─ 勾「排序題」                                              批改 (responseActions)
                                                              └─ JSON.stringify 比對
generate-questions/route.ts
 └─ prompt 加 rank 範例
```

## 詳細設計

### 1. DB Schema 變更

**檔案**：`src/models/Schema.ts`

```ts
export const questionTypeEnum = pgEnum('question_type', [
  'single_choice',
  'multiple_choice',
  'true_false',
  'short_answer',
  'ranking', // 排序題（新增）
]);
```

執行：
```bash
npm run db:generate
```

預期 migration 內容：`ALTER TYPE "question_type" ADD VALUE 'ranking';`

**欄位重用**（不需新增欄位）：
- `question.options: {id: string, text: string}[]` — 用法不變
- `question.correctAnswers: string[]` — 存正確順序的 option id 陣列
- `answer.answer: string | string[]` — ranking 時為 string[]，存學生排出的順序

### 2. 老師端 QuestionForm

**檔案**：`src/features/quiz/QuestionForm.tsx`

變更：
1. `QUESTION_TYPE_LABELS` 加 `ranking: '排序題'`
2. Zod schema：`type` enum 加 `'ranking'`
3. `useEffect`（型別切換）加分支：
   ```ts
   else if (type === 'ranking') {
     const current = form.getValues('options') ?? [];
     const isTrueFalseShape = current[0]?.id === 'tf-true';
     if (current.length < 3 || isTrueFalseShape) {
       replace([
         { id: crypto.randomUUID(), text: '' },
         { id: crypto.randomUUID(), text: '' },
         { id: crypto.randomUUID(), text: '' },
       ]);
     }
     form.setValue('correctAnswers', []);
   }
   ```
4. `isChoiceType` 邏輯擴展：ranking 也允許新增/刪除選項
5. 選項列表渲染：`type === 'ranking'` 時隱藏左側「正確答案圓鈕」，改顯示順序編號 `1.` `2.` `3.`
6. 標籤文字（i18n）：「依正確順序由上到下排列選項」
7. `handleSubmit` 包裝：若 `type === 'ranking'`，覆寫 `correctAnswers = options.map(o => o.id)`

### 3. questionActions Server Action

**檔案**：`src/actions/questionActions.ts`

- Zod input schema 的 `type` enum 加 `'ranking'`
- 若 `type === 'ranking'`，server-side 再次保險：`correctAnswers = options.map(o => o.id)`（防止 client 端傳壞資料）
- 驗證：`options.length >= 2`（排序題至少 2 個選項）

### 4. 學生端 RankingQuestion 元件（新檔）

**檔案**：`src/features/quiz/RankingQuestion.tsx`

```tsx
'use client';

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
  const survey = useMemo(() => {
    const m = new Model({
      questions: [
        {
          type: 'ranking',
          name: `q${questionId}`,
          title: ' ', // QuizFlow 已在外層顯示題目，這裡只需要 ranking widget
          choices: options.map(o => ({ value: o.id, text: o.text })),
        },
      ],
      showQuestionNumbers: 'off',
      showCompletedPage: false,
      showNavigationButtons: 'none',
    });
    return m;
  }, [questionId, options]);

  // 同步父層的 value（受控元件）
  useEffect(() => {
    if (value) {
      survey.setValue(`q${questionId}`, value);
    }
  }, [survey, questionId, value]);

  // 監聽 SurveyJS 的值變更，回報給父層
  useEffect(() => {
    const handler = (_: unknown, opts: { name: string; value: unknown }) => {
      if (opts.name === `q${questionId}` && Array.isArray(opts.value)) {
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

### 5. QuizTaker 整合

**檔案**：`src/features/quiz/QuizTaker.tsx`

**5.1 動態載入 RankingQuestion（避免 bundle 影響其他測驗）**
```tsx
import dynamic from 'next/dynamic';

const RankingQuestion = dynamic(
  () => import('./RankingQuestion').then(m => m.RankingQuestion),
  { ssr: false, loading: () => <p className="text-sm text-muted-foreground">載入中…</p> },
);
```

**5.2 `displayQuestions` 初始化：ranking 強制打亂**
```tsx
const [displayQuestions] = useState<Question[]>(() => {
  const ordered = quiz.shuffleQuestions ? shuffle(questions) : questions;
  return ordered.map((q) => {
    if (q.type === 'ranking' && q.options) {
      return { ...q, options: shuffle(q.options) }; // 強制打亂
    }
    if (quiz.shuffleOptions && q.options) {
      return { ...q, options: shuffle(q.options) };
    }
    return q;
  });
});
```

**5.3 `QuestionItem` 加 ranking 分支**
```tsx
{question.type === 'ranking' && (
  <RankingQuestion
    questionId={question.id}
    options={options}
    value={Array.isArray(answer) ? answer : undefined}
    onChange={(v) => onChange(v)}
  />
)}
```

**5.4 `handleSubmit` 的 unanswered 檢查**
```tsx
const unanswered = displayQuestions.filter((q) => {
  if (q.type === 'short_answer') return false;
  const ans = answers[q.id];
  if (q.type === 'ranking') {
    return !Array.isArray(ans) || ans.length !== (q.options?.length ?? 0);
  }
  return !ans;
});
```

**5.5 `RetryScreen` 本機批改**
```tsx
} else if (q.type === 'ranking') {
  const given = Array.isArray(ans) ? ans : [];
  if (JSON.stringify(given) === JSON.stringify(q.correctAnswers)) {
    correct++;
  }
}
```

**5.6 `ResultScreen` 答案顯示**

ranking 答案以 `→` 串接：`A → B → C → D`，套用在「你的答案」與「正確答案」兩處。

### 6. 批改邏輯

**檔案**：`src/actions/responseActions.ts`

```ts
} else if (question.type === 'ranking') {
  const given = Array.isArray(studentAnswer) ? studentAnswer : [];
  isCorrect = JSON.stringify(given) === JSON.stringify(correct);
}
```

### 7. AI 出題

**檔案 A**：`src/features/quiz/AIGenerateDialog.tsx`
- 題型勾選 UI 加「排序題」（key: `rank`）

**檔案 B**：`src/app/api/ai/generate-questions/route.ts`
- `TYPE_LABELS` 加 `rank: '排序題（3–5 個需依正確順序排列的項目）'`
- Prompt JSON 範例加 rank 樣本：
  ```json
  {
    "type": "rank",
    "question": "請依時間先後排列下列事件",
    "options": ["文藝復興", "工業革命", "二次大戰", "網際網路誕生"],
    "answer": ["文藝復興", "工業革命", "二次大戰", "網際網路誕生"],
    "explanation": "..."
  }
  ```

**檔案 C**：`src/features/quiz/QuizEditor.tsx`（或 AI 結果匯入處）
- 將 `rank` 型 AI 結果轉成 DB 格式：
  ```ts
  if (q.type === 'rank') {
    const opts = q.options.map((text: string) => ({ id: crypto.randomUUID(), text }));
    const correctIds = q.answer.map((ansText: string) =>
      opts.find(o => o.text === ansText)?.id
    ).filter(Boolean);
    return {
      type: 'ranking',
      body: q.question,
      options: opts,
      correctAnswers: correctIds,
      points: 1,
    };
  }
  ```

### 8. i18n

新增 key（兩個 locale 同步）：

| Key | zh | en |
|---|---|---|
| `Quiz.questionType.ranking` | 排序題 | Ranking |
| `Quiz.editor.rankingHint` | 由上到下即正確順序 | The order from top to bottom is the correct answer |
| `Quiz.taker.rankingPrompt` | 請拖曳選項排出正確順序 | Drag the options into the correct order |
| `Quiz.taker.rankingIncomplete` | 請完成所有排序 | Please complete the ranking |
| `Quiz.result.yourOrder` | 你的順序 | Your order |
| `Quiz.result.correctOrder` | 正確順序 | Correct order |
| `Quiz.aiDialog.typeRanking` | 排序題 | Ranking |

> 註：上表是邏輯命名，實際 key 路徑以 `src/locales/zh.json` 既有結構為準。

### 9. 套件安裝

```bash
npm install survey-core survey-react-ui
```

兩個套件都是 MIT 授權。

### 10. 不做的事（YAGNI）

- 不做 Kendall Tau 部分給分
- 不做老師端的拖拉編輯（沿用輸入框上下排列）
- 不修既有 `fill` 題型技術債（AI 會吐 fill type 但 DB 沒有對應 enum，列為 tech debt 不在本次範圍）
- 不重寫其他 4 種題型的渲染走 SurveyJS（保持路線 A 範圍）
- 不為 ranking 特別設計倒數、特別 UI 主題、特別動畫

## 風險與緩解

| 風險 | 緩解 |
|---|---|
| `survey-react-ui` bundle 大（~200KB+ gzip） | `next/dynamic` + `ssr: false` 確保只在學生作答含 ranking 題時才載入 |
| SurveyJS 預設樣式與 QuizFlow Tailwind 不一致 | 引入 `survey-core.css`，外觀差異列入手動驗證項目；如過於違和，再加 minimal override |
| AI 產出的 rank 題 `answer` 可能不在 `options` 內（幻覺） | 匯入轉換時 `find().filter(Boolean)`，若 correctIds 長度不等於 options 長度，丟棄該題並記錄 console.warn |
| 學生在沒拖任何選項就送出 | unanswered 檢查擋下，需拖到 `length === options.length` 才算作答完成 |
| 舊資料遷移風險 | enum 純加值，零風險 |

## 驗證計畫

**型別／靜態檢查**
- `npm run check-types`
- `npm run lint`（不引入新 warning）
- `npm run build`

**手動驗證清單**
1. 老師建立 ranking 題（4 個選項），發佈
2. 學生開頁面 → 看到 4 個選項顯示順序與輸入順序不同（已打亂）
3. 學生不拖任何選項就點送出 → 被擋在「還有 X 題未作答」
4. 學生拖部分選項（不滿）→ 仍被擋
5. 學生拖出完全錯誤順序送出 → 0 分
6. 學生拖出完全正確順序送出 → 滿分
7. 答錯的學生在成績頁看到「你的順序：A→B→C」「正確順序：C→A→B」
8. 點「重做錯題」，ranking 題的 retry 也能本機批改正確
9. AI 出題勾「排序題」→ 產生的題目能正確匯入 QuizEditor
10. 既有的 4 種題型（單選/多選/是非/簡答）測驗，打開仍正常運作（迴歸測試）
11. 既有 quiz 不含 ranking 題的，bundle 沒被 `survey-react-ui` 拖累（檢查 Network panel）

## 預估動到的檔案

| 檔案 | 動作 |
|---|---|
| `src/models/Schema.ts` | 加 enum 值 |
| `src/models/migrations/...` | 新 migration 檔（自動產生） |
| `src/features/quiz/QuestionForm.tsx` | 加 ranking 編輯邏輯 |
| `src/features/quiz/QuizTaker.tsx` | 加 ranking 渲染 + 批改 + shuffle 強制 |
| `src/features/quiz/RankingQuestion.tsx` | **新檔** |
| `src/features/quiz/AIGenerateDialog.tsx` | 加題型勾選 |
| `src/features/quiz/QuizEditor.tsx` | AI 匯入轉換 |
| `src/actions/questionActions.ts` | Zod enum + 保險邏輯 |
| `src/actions/responseActions.ts` | 加批改分支 |
| `src/app/api/ai/generate-questions/route.ts` | prompt 加 rank 範例 |
| `src/locales/zh.json` | 加翻譯 key |
| `src/locales/en.json` | 加翻譯 key |
| `package.json` / `package-lock.json` | 加 survey-core, survey-react-ui |

共 11 個既有檔案 + 1 個新檔 + 1 個 migration。
