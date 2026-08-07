# 克漏字題「3 選 1 提示」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 克漏字題（cloze）每個空格可選擇性顯示「💡 提示」按鈕，按下後顯示 3 個候選字（1 個正確答案 + 2 個從同一題其他空格答案抽出的幹擾項），只提示不代填——學生仍要自己在輸入框打字。用過提示的空格，正式送出批改時該格最高只算半分。

**Architecture:** 純前端 + 既有批改管線的最小擴充，不動 DB schema、不動 `answer` 欄位的既有 `string[]` 儲存格式。「哪些空格用過提示」透過一個新的 React callback（`onHintUsed`）從 `ClozeQuestion` 往上通知到 `QuizTaker`，送出作答時併入 `answers` 這個 record 裡一個額外的合成 key（`${questionId}__hints`），伺服器端 `responseActions.ts` 讀這個 key 算半分封頂，`src/lib/cloze.ts` 的 `gradeClozeAnswers` 加一個第三參數承接。

**Tech Stack:** 沿用既有 cloze 功能的技術棧（React 受控元件、Vitest、既有的 `src/lib/cloze.ts` 純函式庫）。無新依賴。

## Global Constraints

- 提示只縮小範圍，**不自動代填**——學生點提示後仍要自己在輸入框打字（使用者已確認的決策）。
- 用過提示的空格，送出批改時該格最高只算半分（`awardedRatio` 貢獻從 1 降成 0.5，答錯仍是 0，不會因為用了提示反而扣更多）——不影響「是否全對」（`isCorrect`）的判斷，只影響實際得分。
- 幹擾項來源：同一題**其他空格**的正確答案（去除跟目標空格答案重複的），不用 AI、不用教師額外輸入。
- 若同一題湊不到 2 個不重複的幹擾項（通常代表這題空格數 < 3，或其他空格答案剛好都跟目標答案相同），該空格**不顯示**提示按鈕，不硬湊假幹擾項。
- 提示是否使用過，**不寫進** `answer`（jsonb `string[]`）欄位本身——透過 `answers` record 的合成 key 傳遞，避免任何顯示學生作答的地方（結果頁「你的答案」、列印報告、Word 匯出）需要額外解析/去標記，這些畫面完全不用改。
- `src/lib/cloze.ts` 仍是唯一真相來源，新邏輯（`pickClozeHintOptions`）加在這裡，不在元件裡重新實作。
- UI 文字寫死繁體中文，跟既有 cloze 功能一致，不新增 i18n key。
- `gradeClozeAnswers` 的新參數必須有預設值（向後相容），現有呼叫端（`QuizTaker.tsx` 的 `gradeAnswer()`、`ClozeQuestion.tsx` 既有的即時對錯檢查、既有 28 個測試）在不傳新參數時行為完全不變。

---

## 檔案總覽

| 檔案 | 動作 | 用途 |
|---|---|---|
| `src/lib/cloze.ts` | 修改 | `gradeClozeAnswers` 加 `hintedIndices` 參數（半分封頂）；新增 `pickClozeHintOptions`；`normalizeClozeAnswer` 改 export |
| `src/lib/cloze.test.ts` | 修改 | 上面兩個改動的測試 |
| `src/features/quiz/ClozeQuestion.tsx` | 修改 | 每格加「💡 提示」按鈕 + 3 選項顯示 + `onHintUsed` callback |
| `src/features/quiz/QuizTaker.tsx` | 修改 | 新增 `clozeHints` state，`QuestionItem` 多穿一個 `onClozeHintUsed` prop，送出時把 hint 資料併入 `answers` |
| `src/actions/responseActions.ts` | 修改 | cloze 批改分支讀取 `${questionId}__hints` 合成 key，傳給 `gradeClozeAnswers` |

---

### Task 1: `src/lib/cloze.ts` — 半分封頂批改 + 提示選項產生（TDD）

**Files:**
- Modify: `src/lib/cloze.ts:56-86`（`normalizeClozeAnswer` 改 export、`gradeClozeAnswers` 加參數、新增 `pickClozeHintOptions`）
- Modify: `src/lib/cloze.test.ts`（新增測試）

**Interfaces:**
- Consumes: 無新依賴
- Produces（後面 Task 2-4 都靠這些名字）：
  - `export function normalizeClozeAnswer(v: string): string`（原本是私有函式，改 export）
  - `gradeClozeAnswers(correctAnswers: string[], studentAnswers: (string | undefined)[] | undefined, hintedIndices?: number[]): ClozeGradeResult`（新增第三參數，預設 `[]`）
  - `export function pickClozeHintOptions(correctAnswers: string[], blankIndex: number): string[] | null`

- [ ] **Step 1: 寫失敗測試**

在 `src/lib/cloze.test.ts` 現有的 `describe('gradeClozeAnswers', ...)` 區塊內加入：

```ts
it('用過提示的空格答對時，該格只算半分（awardedRatio 反映）', () => {
  // 3 格全對，其中 1 格（index 1）用過提示 → (1 + 0.5 + 1) / 3
  const result = gradeClozeAnswers(['陽光', '水', '葉綠素'], ['陽光', '水', '葉綠素'], [1]);

  expect(result.perBlank).toEqual([true, true, true]);
  expect(result.correctCount).toBe(3);
  expect(result.isCorrect).toBe(true); // 全對，用提示不影響「是否全對」的判斷
  expect(result.awardedRatio).toBeCloseTo((1 + 0.5 + 1) / 3);
});

it('用過提示但答錯的空格，仍然算 0 分（不會因為用提示反而扣更多）', () => {
  const result = gradeClozeAnswers(['陽光', '水'], ['陽光', '土壤'], [1]);

  expect(result.perBlank).toEqual([true, false]);
  expect(result.awardedRatio).toBeCloseTo(1 / 2);
});

it('沒有提示（不傳第三參數）時行為完全不變，向後相容', () => {
  const result = gradeClozeAnswers(['陽光', '水', '葉綠素'], ['陽光', '水', '土壤']);

  expect(result.correctCount).toBe(2);
  expect(result.awardedRatio).toBeCloseTo(2 / 3);
});

it('hintedIndices 傳空陣列，效果跟不傳一樣', () => {
  const withEmpty = gradeClozeAnswers(['陽光', '水'], ['陽光', '水'], []);
  const withoutParam = gradeClozeAnswers(['陽光', '水'], ['陽光', '水']);

  expect(withEmpty.awardedRatio).toBe(withoutParam.awardedRatio);
});
```

在 `src/lib/cloze.test.ts` 新增一個 `describe('pickClozeHintOptions', ...)` 區塊：

```ts
describe('pickClozeHintOptions', () => {
  it('空格數足夠時，回傳含正確答案在內的 3 個選項', () => {
    const options = pickClozeHintOptions(['陽光', '水', '葉綠素'], 0);

    expect(options).not.toBeNull();
    expect(options).toHaveLength(3);
    expect(options).toContain('陽光');
  });

  it('幹擾項是從其他空格的答案抽的（不是憑空生成）', () => {
    const correctAnswers = ['陽光', '水', '葉綠素'];
    const options = pickClozeHintOptions(correctAnswers, 0)!;
    const distractors = options.filter(o => o !== '陽光');

    distractors.forEach((d) => {
      expect(['水', '葉綠素']).toContain(d);
    });
  });

  it('只有 2 個空格（湊不到 2 個幹擾項）時回傳 null', () => {
    expect(pickClozeHintOptions(['陽光', '水'], 0)).toBeNull();
  });

  it('其他空格答案跟目標答案重複、去重後不足 2 個時回傳 null', () => {
    // index 0 的答案是「陽光」，其他兩格也都是「陽光」，去重後幹擾項池是空的
    expect(pickClozeHintOptions(['陽光', '陽光', '陽光'], 0)).toBeNull();
  });

  it('blankIndex 超出範圍時回傳 null，不會炸', () => {
    expect(pickClozeHintOptions(['陽光', '水', '葉綠素'], 99)).toBeNull();
  });

  it('去重後幹擾項池剛好 2 個以上，仍然只回傳 2 個幹擾項（共 3 個選項）', () => {
    const options = pickClozeHintOptions(['陽光', '水', '葉綠素', '二氧化碳'], 0)!;

    expect(options).toHaveLength(3);
  });
});
```

- [ ] **Step 2: 執行測試確認新增的都失敗**

Run: `npx vitest run src/lib/cloze.test.ts`
Expected: 新加的測試 FAIL（`pickClozeHintOptions` 不存在、`gradeClozeAnswers` 第三參數還沒實作效果）。

- [ ] **Step 3: 實作**

`src/lib/cloze.ts:56-58`，原本：

```ts
function normalizeClozeAnswer(v: string): string {
  return v.trim().toLocaleLowerCase();
}
```

改為（只加 `export`）：

```ts
export function normalizeClozeAnswer(v: string): string {
  return v.trim().toLocaleLowerCase();
}
```

`src/lib/cloze.ts:60-86`，原本：

```ts
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
```

改為：

```ts
export type ClozeGradeResult = {
  perBlank: boolean[];
  correctCount: number;
  totalBlanks: number;
  isCorrect: boolean; // 全部答對才 true（用過提示不影響這個判斷，只影響 awardedRatio）；totalBlanks 為 0 時視為 false
  awardedRatio: number; // 0~1，用過提示且答對的格子只算 0.5 分，totalBlanks 為 0 時為 0
};

/**
 * 逐格比對：trim + 大小寫不敏感的精準字串比對，不叫 AI。
 * hintedIndices：用過「💡 提示」的空格 index（見 pickClozeHintOptions），
 * 這些格子即使答對，對 awardedRatio 的貢獻也只算 0.5（不是 1），答錯仍是 0。
 */
export function gradeClozeAnswers(
  correctAnswers: string[],
  studentAnswers: (string | undefined)[] | undefined,
  hintedIndices: number[] = [],
): ClozeGradeResult {
  const hintedSet = new Set(hintedIndices);
  const totalBlanks = correctAnswers.length;
  const perBlank = correctAnswers.map((correct, i) => {
    const given = studentAnswers?.[i];
    return given !== undefined && normalizeClozeAnswer(given) === normalizeClozeAnswer(correct);
  });
  const correctCount = perBlank.filter(Boolean).length;
  const totalRatio = perBlank.reduce(
    (sum, ok, i) => sum + (ok ? (hintedSet.has(i) ? 0.5 : 1) : 0),
    0,
  );
  return {
    perBlank,
    correctCount,
    totalBlanks,
    isCorrect: totalBlanks > 0 && correctCount === totalBlanks,
    awardedRatio: totalBlanks > 0 ? totalRatio / totalBlanks : 0,
  };
}

/**
 * 「💡 提示」用的 3 選項：1 個正確答案 + 2 個從同一題「其他空格」答案抽出的幹擾項
 * （去除跟目標答案重複的），純規則、不叫 AI、不用教師額外輸入。
 * 湊不到 2 個不重複的幹擾項（通常是空格數 < 3，或其他答案剛好都跟目標相同）時回傳 null，
 * 呼叫端應該在拿到 null 時不顯示提示按鈕，不要硬湊假選項。
 */
export function pickClozeHintOptions(correctAnswers: string[], blankIndex: number): string[] | null {
  const correct = correctAnswers[blankIndex];
  if (correct === undefined) {
    return null;
  }
  const distractPool = Array.from(new Set(
    correctAnswers
      .filter((_, i) => i !== blankIndex)
      .filter(ans => normalizeClozeAnswer(ans) !== normalizeClozeAnswer(correct)),
  ));
  if (distractPool.length < 2) {
    return null;
  }
  const distractors = [...distractPool].sort(() => Math.random() - 0.5).slice(0, 2);
  return [correct, ...distractors].sort(() => Math.random() - 0.5);
}
```

- [ ] **Step 4: 執行測試確認全部通過**

Run: `npx vitest run src/lib/cloze.test.ts`
Expected: PASS（含原本 28 個 + 這次新加的，全部綠燈）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/cloze.ts src/lib/cloze.test.ts
git commit -m "feat(cloze): gradeClozeAnswers 支援提示半分封頂 + 新增 pickClozeHintOptions"
```

---

### Task 2: `src/features/quiz/ClozeQuestion.tsx` — 每格加「💡 提示」UI

**Files:**
- Modify: `src/features/quiz/ClozeQuestion.tsx`（全檔案，見下方完整內容）

**Interfaces:**
- Consumes: `pickClozeHintOptions`（Task 1，`src/lib/cloze.ts`）
- Produces: `ClozeQuestion` 新增 optional prop `onHintUsed?: (hintedIndices: number[]) => void`——每次有新空格第一次用提示時觸發，傳目前為止「所有」用過提示的空格 index（不是只傳這次新增的那個，方便父層直接整包存）。

**⚠️ 已知陷阱（前一版設計時抓到，這裡直接寫死正確做法，不要重新推導）**：`pickClozeHintOptions` 內部用 `Math.random()` 洗牌，如果在每次 render 時都重新呼叫來「顯示」已經提示過的選項內容，選項會在學生打字（觸發 re-render）時跟著重新洗牌、內容一直變，體驗很差。**正確做法**：`pickClozeHintOptions` 只在「判斷這格要不要顯示提示按鈕」（回傳是不是 null）以及「學生真的按下提示的當下」呼叫；一旦按下，把當次算出的 3 個選項存進 state（`hintOptions: Record<number, string[]>`），之後渲染都從這個 state 讀，不要重新呼叫。

- [ ] **Step 1: 用下面內容整份覆寫 `src/features/quiz/ClozeQuestion.tsx`**

```tsx
'use client';

/**
 * ClozeQuestion — 學生作答克漏字題（cloze）用的元件。
 * 依 body 的 [[ ]] 標記位置，把文章渲染成「文字 + 空格輸入框」交錯排列。
 * 受控元件：value 是每個空格目前的作答，依文章順序排列。
 *
 * 即時對錯回饋（框線變綠/變紅）：欄位失焦過（touched）後就即時判斷該格對錯，
 * 未 touched 或空白時維持中性樣式，不主動顯示正確答案文字（只用顏色，不講白）。
 * 這是刻意的產品決策：question.correctAnswers 本來就已經整份送到瀏覽器（跟其他
 * 6 種題型一樣，QuizTaker.tsx 的 gradeAnswer() 家教模式也讀得到），所以逐格判斷
 * 對錯不是新的外洩管道，只是把既有資料用 UI 呈現——但這也讓克漏字題變成
 * QuizFlow 目前唯一一個作答中就會即時揭露對錯的題型，跟其他題型的考試慣例不同。
 *
 * 提示（💡）：每個空格可選擇性顯示「3 選 1」提示（正確答案 + 2 個從同題其他
 * 空格答案抽出的幹擾項），只提示不代填——學生仍要自己打字。用過提示的空格，
 * 送出後那一格最高只算半分（見 src/lib/cloze.ts 的 gradeClozeAnswers 第三參數），
 * 是否用過提示透過 onHintUsed 往上通知父層，送出時併入 answers 的
 * `${questionId}__hints` 合成 key（不動 DB schema、不動實際作答文字）。
 * 同一題內少於 3 個空格（湊不到 2 個不重複的幹擾項）時，該空格不顯示提示按鈕。
 */
import { useState } from 'react';

import { gradeClozeAnswers, parseClozeBody, pickClozeHintOptions } from '@/lib/cloze';

type Props = {
  body: string;
  value: string[] | undefined;
  onChange: (value: string[]) => void;
  correctAnswers: string[] | null;
  onHintUsed?: (hintedIndices: number[]) => void;
};

export function ClozeQuestion({ body, value, onChange, correctAnswers, onHintUsed }: Props) {
  const segments = parseClozeBody(body);
  const totalBlanks = segments.filter(s => s.kind === 'blank').length;
  // 已經失焦檢查過的空格 index；未 touched 前維持中性樣式，不會一開始就顯示紅色
  const [touched, setTouched] = useState<Set<number>>(new Set());
  // 用過提示的空格 index
  const [hintedBlanks, setHintedBlanks] = useState<Set<number>>(new Set());
  // 已經算好、凍結住的提示選項（避免每次 render 重新洗牌導致內容一直變）
  const [hintOptions, setHintOptions] = useState<Record<number, string[]>>({});

  const { perBlank } = gradeClozeAnswers(correctAnswers ?? [], value);
  const correctCount = perBlank.filter(Boolean).length;

  const handleBlankChange = (index: number, text: string) => {
    const next = [...(value ?? Array.from({ length: totalBlanks }, () => ''))];
    next[index] = text;
    onChange(next);
  };

  const handleBlankBlur = (index: number) => {
    setTouched(prev => new Set(prev).add(index));
  };

  const handleUseHint = (index: number) => {
    if (hintedBlanks.has(index)) {
      return;
    }
    const options = pickClozeHintOptions(correctAnswers ?? [], index);
    if (!options) {
      return;
    }
    setHintOptions(prev => ({ ...prev, [index]: options }));
    const next = new Set(hintedBlanks).add(index);
    setHintedBlanks(next);
    onHintUsed?.(Array.from(next));
  };

  return (
    <div>
      <p className="text-base leading-loose text-gray-800">
        {segments.map(seg => seg.kind === 'text'
          ? <span key={`t-${seg.text}-${segments.indexOf(seg)}`}>{seg.text}</span>
          : (() => {
              const filled = (value?.[seg.index] ?? '').trim() !== '';
              const isTouched = touched.has(seg.index);
              const isCorrect = perBlank[seg.index] === true;
              const stateClass = !isTouched
                ? 'border-gray-200 bg-gray-50/50 focus:border-emerald-400 focus:bg-white'
                : isCorrect
                  ? 'border-emerald-500 bg-emerald-50'
                  : filled
                    ? 'border-red-400 bg-red-50'
                    : 'border-red-300 bg-red-50/60'; // touched 但還是空白：提示還沒填
              // 只用來判斷「要不要顯示提示按鈕」，不拿這次呼叫的洗牌結果來渲染
              const hintAvailable = pickClozeHintOptions(correctAnswers ?? [], seg.index) !== null;
              const isHinted = hintedBlanks.has(seg.index);
              return (
                <span key={`b-${seg.index}`} className="inline-flex items-center gap-1">
                  <input
                    type="text"
                    aria-label={`空格 ${seg.index + 1}`}
                    value={value?.[seg.index] ?? ''}
                    onChange={e => handleBlankChange(seg.index, e.target.value)}
                    onBlur={() => handleBlankBlur(seg.index)}
                    className={`mx-1 inline-block w-24 rounded-md border-2 px-2 py-0.5 text-center text-base outline-none transition-colors ${stateClass}`}
                  />
                  {hintAvailable && !isHinted && (
                    <button
                      type="button"
                      onClick={() => handleUseHint(seg.index)}
                      title="提示（用過後這格最高只算半分）"
                      className="text-sm text-amber-500 transition-colors hover:text-amber-600"
                    >
                      💡
                    </button>
                  )}
                  {isHinted && hintOptions[seg.index] && (
                    <span className="text-xs text-amber-700">
                      （提示：
                      {hintOptions[seg.index]!.join('／')}
                      ）
                    </span>
                  )}
                </span>
              );
            })())}
      </p>
      {totalBlanks > 0 && touched.size > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          答對
          {' '}
          {correctCount}
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

- [ ] **Step 2: 靜態驗證**

Run: `npm run check-types` 與 `npx eslint src/features/quiz/ClozeQuestion.tsx`
Expected: 都 0 錯誤。

這個環境沒有可連線的瀏覽器（前一版 cloze 功能開發時就是這樣），改用程式碼路徑走讀確認：
1. `hintAvailable` 每次 render 都重新算一次「是否可提示」（純判斷 null/非 null，不影響已顯示內容）——沒問題，不是穩定性風險點。
2. `hintOptions[seg.index]` 只在 `handleUseHint` 被呼叫的當下寫入一次，之後渲染都讀這個 state，不會因為別的空格打字觸發 re-render 就重新洗牌——確認符合上面「已知陷阱」的要求。
3. 空格數 < 3 的題目：`pickClozeHintOptions` 對任何 index 都回傳 `null`（因為其他空格數 < 2），`hintAvailable` 恆為 `false`，完全不顯示提示按鈕——不會出現「按了按鈕但沒反應」的情況。

- [ ] **Step 3: Commit**

```bash
git add src/features/quiz/ClozeQuestion.tsx
git commit -m "feat(cloze): 學生作答加「💡 提示」按鈕（3 選 1，不代填）"
```

---

### Task 3: `src/features/quiz/QuizTaker.tsx` — 串接提示狀態 + 送出時併入 answers

**Files:**
- Modify: `src/features/quiz/QuizTaker.tsx:107-119`（`QuestionItem` props 型別）
- Modify: `src/features/quiz/QuizTaker.tsx:279-285`（掛載 `ClozeQuestion` 處）
- Modify: `src/features/quiz/QuizTaker.tsx:1352-1355`（新增 `clozeHints` state，跟 `answers` 放一起）
- Modify: `src/features/quiz/QuizTaker.tsx:1501-1504`（送出時併入合成 key）
- Modify: `src/features/quiz/QuizTaker.tsx:1826-1830`（`<QuestionItem>` 呼叫處，多傳 callback）

**Interfaces:**
- Consumes: `ClozeQuestion` 的 `onHintUsed` prop（Task 2）
- Produces: `answers`（送給 `submitQuizResponse` 的 record）在有 cloze 題用過提示時，會多出 `${questionId}__hints: string[]`（blank index 字串陣列）這個合成 key，供 Task 4 讀取。

**⚠️ 注意**：`QuestionItem` 元件目前是「通用」元件，`onClozeHintUsed` 這個 prop 只有 cloze 題會用到，設成 optional，其他題型不用管。

- [ ] **Step 1: `QuestionItem` props 型別加一個 optional callback**

`src/features/quiz/QuizTaker.tsx:107-119`，原本：

```tsx
function QuestionItem({
  question,
  index,
  answer,
  onChange,
  tutor,
}: {
  question: Question;
  index: number;
  answer: string | string[] | undefined;
  onChange: (value: string | string[]) => void;
  tutor?: TutorState;
}) {
```

改為：

```tsx
function QuestionItem({
  question,
  index,
  answer,
  onChange,
  tutor,
  onClozeHintUsed,
}: {
  question: Question;
  index: number;
  answer: string | string[] | undefined;
  onChange: (value: string | string[]) => void;
  tutor?: TutorState;
  onClozeHintUsed?: (hintedIndices: number[]) => void;
}) {
```

- [ ] **Step 2: 掛載 `ClozeQuestion` 的地方多傳 `onHintUsed`**

`src/features/quiz/QuizTaker.tsx:279-285`，原本：

```tsx
      {/* 克漏字題 */}
      {question.type === 'cloze' && (
        <ClozeQuestion
          body={question.body}
          value={Array.isArray(answer) ? answer : undefined}
          onChange={v => onChange(v)}
          correctAnswers={question.correctAnswers}
        />
      )}
```

改為：

```tsx
      {/* 克漏字題 */}
      {question.type === 'cloze' && (
        <ClozeQuestion
          body={question.body}
          value={Array.isArray(answer) ? answer : undefined}
          onChange={v => onChange(v)}
          correctAnswers={question.correctAnswers}
          onHintUsed={onClozeHintUsed}
        />
      )}
```

- [ ] **Step 3: 新增 `clozeHints` state**

`src/features/quiz/QuizTaker.tsx:1352-1355`，原本：

```tsx
  const [answers, setAnswers] = useState<Record<number, string | string[]>>({});
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const [studentName, setStudentName] = useState('');
  const [studentEmail, setStudentEmail] = useState('');
```

改為（多加一行 state + 一個 setter function）：

```tsx
  const [answers, setAnswers] = useState<Record<number, string | string[]>>({});
  // 克漏字題各題用過提示的空格 index（questionId → 已用提示的 blank index 陣列）
  const [clozeHints, setClozeHints] = useState<Record<number, number[]>>({});
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const [studentName, setStudentName] = useState('');
  const [studentEmail, setStudentEmail] = useState('');

  const handleClozeHintUsed = (questionId: number, hintedIndices: number[]) => {
    setClozeHints(prev => ({ ...prev, [questionId]: hintedIndices }));
  };
```

- [ ] **Step 4: 送出作答時把 `clozeHints` 併入 `answers` payload**

`src/features/quiz/QuizTaker.tsx:1501-1504`，原本：

```tsx
      const stringKeyAnswers: Record<string, string | string[]> = {};
      for (const [key, value] of Object.entries(answers)) {
        stringKeyAnswers[String(key)] = value;
      }
```

改為：

```tsx
      const stringKeyAnswers: Record<string, string | string[]> = {};
      for (const [key, value] of Object.entries(answers)) {
        stringKeyAnswers[String(key)] = value;
      }
      // 克漏字題提示使用紀錄：用合成 key（questionId__hints）夾帶，
      // 不動 answer 本身的格式，伺服器端 responseActions.ts 會讀這個 key
      for (const [questionId, hintedIndices] of Object.entries(clozeHints)) {
        if (hintedIndices.length > 0) {
          stringKeyAnswers[`${questionId}__hints`] = hintedIndices.map(String);
        }
      }
```

- [ ] **Step 5: `<QuestionItem>` 呼叫處傳入 callback**

`src/features/quiz/QuizTaker.tsx:1826-1830`，原本：

```tsx
          <QuestionItem
            question={question}
            index={index}
            answer={answers[question.id]}
            onChange={value => handleAnswer(question.id, value)}
```

改為：

```tsx
          <QuestionItem
            question={question}
            index={index}
            answer={answers[question.id]}
            onChange={value => handleAnswer(question.id, value)}
            onClozeHintUsed={indices => handleClozeHintUsed(question.id, indices)}
```

（這一行後面緊接的 `tutor={...}` 那段維持原樣不動，只是在它前面插入新的一行 prop。）

- [ ] **Step 6: 驗證**

Run: `npm run check-types` 與 `npx eslint src/features/quiz/QuizTaker.tsx`
Expected: 都 0 錯誤。

程式碼路徑走讀（無瀏覽器環境，靜態確認）：
1. 非 cloze 題型完全不會呼叫 `onClozeHintUsed`（`QuestionItem` 只在 cloze 分支把它傳給 `ClozeQuestion`），`clozeHints` state 對其他題型永遠是空物件，不影響任何既有行為。
2. `handleSubmit` 裡新增的迴圈只在 `hintedIndices.length > 0` 時才寫入合成 key，沒用過提示的題目/測驗完全不會多出任何 key，送出的 payload 跟提示功能上線前一模一樣。

- [ ] **Step 7: Commit**

```bash
git add src/features/quiz/QuizTaker.tsx
git commit -m "feat(cloze): 串接提示使用狀態，送出時併入 answers 合成 key"
```

---

### Task 4: `src/actions/responseActions.ts` — 批改時讀取提示紀錄

**Files:**
- Modify: `src/actions/responseActions.ts:152-160`

**Interfaces:**
- Consumes: `answers` record 裡的 `${questionId}__hints` 合成 key（Task 3 產生）、`gradeClozeAnswers` 第三參數（Task 1）

- [ ] **Step 1: 批改分支讀取合成 key**

`src/actions/responseActions.ts:152-160`，原本：

```ts
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
```

改為：

```ts
    } else if (question.type === 'cloze') {
      // 克漏字題：逐格精準比對，部分分 = 配分 × 答對比例，全對才 isCorrect=true
      // 用過提示的空格（合成 key，不是真實 question id，見 QuizTaker.tsx handleSubmit）該格封頂半分
      const studentBlanks = Array.isArray(studentAnswer) ? studentAnswer : [];
      const hintKey = answers[`${question.id}__hints`];
      const hintedIndices = Array.isArray(hintKey)
        ? hintKey.map(s => Number(s)).filter(n => !Number.isNaN(n))
        : [];
      const grade = gradeClozeAnswers(question.correctAnswers ?? [], studentBlanks, hintedIndices);
      totalPoints += question.points;
      if (grade.totalBlanks > 0) {
        isCorrect = grade.isCorrect;
        awardedPoints = Math.round(question.points * grade.awardedRatio);
      }
    } else if (question.correctAnswers && studentAnswer !== undefined) {
```

不需要額外 import：`gradeClozeAnswers` 這個檔案已經 import 過了（Task 5「cloze 部分分批改」那次加的）。

- [ ] **Step 2: 驗證不會誤把合成 key 當成一道題**

確認 `src/actions/responseActions.ts` 裡組 `answerRows`（DB 寫入用）那段（約在 `submitQuizResponse` 後半段，`questions.filter(q => answers[q.id.toString()] !== undefined)`）是用 `questions`（真實題目陣列）去查 `answers`，不是反過來遍歷 `answers` 的 key，所以 `${questionId}__hints` 這種合成 key 不會被誤判成一筆答案寫進 `answer` 表——這段程式碼已經是這樣寫的，不用改，這步只是靜態確認，不用動手。

Run: `npm run check-types` 與 `npx eslint src/actions/responseActions.ts`
Expected: 都 0 錯誤。

手算驗證（無法連真的 DB，靜態核對邏輯）：
- 3 格克漏字題，配分 9 分，全部答對，其中 1 格用過提示：
  `gradeClozeAnswers` 回傳 `awardedRatio = (1 + 0.5 + 1) / 3 ≈ 0.833`；
  `awardedPoints = Math.round(9 × 0.833) = Math.round(7.5) = 8`（`Math.round` 對 .5 采「四捨五入到偶數」以外的一般規則會進位，實際數字視 JS `Math.round(7.5)` 結果為 8，符合預期的「用一次提示扣一點分但不會扣太多」）。
- 沒有任何空格用過提示（`hintedIndices = []`）：跟這個提示功能上線前完全一樣的計分結果，不會有回歸。

- [ ] **Step 3: Commit**

```bash
git add src/actions/responseActions.ts
git commit -m "feat(cloze): 正式批改讀取提示使用紀錄，套用半分封頂"
```

---

### Task 5: 全流程驗收

**Files:** 無新改動，純驗證。

- [ ] **Step 1: 跑完整測試套件**

Run: `npm run test`
Expected: 全部通過（含 Task 1 新增的 `pickClozeHintOptions` / `gradeClozeAnswers` 提示相關測試）。

- [ ] **Step 2: 型別 + lint**

Run: `npm run check-types` 與 `npm run lint`
Expected: 都 0 錯誤（既有的 pre-existing warning 不算，那些跟這次改動無關）。

- [ ] **Step 3: 端到端手動驗收提醒**

這個開發環境沒有可連線的瀏覽器可以實際點過一次（上次 cloze 本體功能開發也是同樣狀況）。**強烈建議在 merge / 上線前，由使用者親自用瀏覽器走一次**：
1. 建一題克漏字題，至少 3 個空格（確保提示按鈕會出現）。
2. 學生連結作答：確認每格輸入框旁邊有「💡」按鈕，按下後顯示「（提示：詞1／詞2／詞3）」，且**沒有**自動把文字填進輸入框。
3. 確認按過提示的空格再打字時，即時對錯回饋（框線變色）還是正常運作。
4. 故意在某一格用提示後填對，其他格不用提示也填對，送出後確認總分符合「用提示那格只算半分」的計算（可用簡單的分數手算對照，例如 3 格 9 分、1 格用提示，預期總分 8 分，見 Task 4 Step 2 的手算）。
5. 確認少於 3 個空格的克漏字題，完全不會出現提示按鈕。
6. 確認結果頁「你的答案」那行沒有出現任何奇怪字元或合成 key 的痕跡（這個合成 key 完全不碰 `answer` 欄位本身，理論上不會有事，但建議還是肉眼確認一次）。
