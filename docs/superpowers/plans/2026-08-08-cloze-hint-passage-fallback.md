# 克漏字題提示「文章抽字」備援 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 克漏字題的「💡 提示」按鈕，目前只在同一題有 ≥3 個空格時才會出現（幹擾項只從同題其他空格答案抽，湊不到 2 個不重複的就不顯示）。這個 plan 加一層備援：同題空格不夠時，改從文章本身抽字（沿用既有「🎲 隨機挑選」的規則），讓 1-2 個空格的克漏字題也有機會出現提示按鈕。

**Architecture:** 只改 `src/lib/cloze.ts` 的 `pickClozeHintOptions`，加一個 optional 第三參數 `passageBody`。呼叫端（`ClozeQuestion.tsx`）多傳這個參數即可，不用改資料流、不用新 prop、不動 `QuizTaker.tsx`、不動批改邏輯（`gradeClozeAnswers` 完全不用改，提示還是提示、批改還是批改，只是「決定要不要顯示提示按鈕」這一步的資料來源變廣）。

**Tech Stack:** 沿用既有 cloze 功能的技術棧（純函式、Vitest）。無新依賴，複用既有的 `findClozeCandidates`（教師「隨機挑選」功能已經在用的抽字規則）。

## Global Constraints

- 幹擾項第一層優先權不變：同一題其他空格的答案優先用（品質較好，跟題目情境相關）。只有第一層湊不到 2 個不重複的才動用第二層。
- 第二層（文章抽字）**必須排除同一題「任何一格」的正確答案**（不是只排除目標格），避免把其他空格的真正答案偽裝成「錯誤選項」端出來。
- 第二層抽字規則沿用既有 `findClozeCandidates`（英文詞 ≥3 字母、數字、標點分隔的 2-4 字中文詞組），**不新增規則、不叫 AI**，繼承既有的已知限制（連續中文無標點分隔時抽不到字，這是既有限制，不在這個 plan 修）。
- `pickClozeHintOptions` 的新參數必須是 optional（`passageBody?: string`），沒傳的呼叫端（若有）行為完全不變——但實務上這個專案裡只有一個呼叫端（`ClozeQuestion.tsx`），這個 plan 會把它也改成一定傳。
- 兩層合計還是湊不到 2 個不重複幹擾項時，回傳 `null`，行為跟現在一樣（不顯示提示按鈕），不要硬湊。
- UI 文字寫死繁體中文，跟既有 cloze 功能一致。

---

## 檔案總覽

| 檔案 | 動作 | 用途 |
|---|---|---|
| `src/lib/cloze.ts` | 修改 | `pickClozeHintOptions` 加 `passageBody` 備援參數 |
| `src/lib/cloze.test.ts` | 修改 | 新增備援相關測試 |
| `src/features/quiz/ClozeQuestion.tsx` | 修改 | 兩個呼叫點多傳 `body`，更新 JSDoc |

---

### Task 1: `src/lib/cloze.ts` — `pickClozeHintOptions` 加文章抽字備援（TDD）

**Files:**
- Modify: `src/lib/cloze.ts:98-119`（`pickClozeHintOptions` 整個函式）
- Modify: `src/lib/cloze.test.ts`（`describe('pickClozeHintOptions', ...)` 區塊新增測試）

**Interfaces:**
- Consumes: 同檔案內既有的 `parseClozeBody`、`ClozeSegment`、`findClozeCandidates`、`normalizeClozeAnswer`（都已存在，不用新建）
- Produces: `pickClozeHintOptions(correctAnswers: string[], blankIndex: number, passageBody?: string): string[] | null`（第三參數是新增的，optional，向後相容）

- [ ] **Step 1: 寫失敗測試**

在 `src/lib/cloze.test.ts` 現有的 `describe('pickClozeHintOptions', ...)` 區塊內加入：

```ts
it('沒傳 passageBody 時行為完全不變（向後相容）：同題空格不夠仍回傳 null', () => {
  expect(pickClozeHintOptions(['陽光', '水'], 0)).toBeNull();
});

it('同題空格夠（≥3）時，即使有傳 passageBody 也優先用同題答案，不用管 passageBody 對不對', () => {
  // passageBody 給一個完全抽不到字的內容（純標點），確認不影響同題答案已經足夠的情況
  const options = pickClozeHintOptions(['陽光', '水', '葉綠素'], 0, '。，！？');

  expect(options).not.toBeNull();
  expect(options).toHaveLength(3);
});

it('同題空格不夠時，改用 passageBody 抽字當備援', () => {
  const passageBody = 'Photosynthesis needs [[陽光]] and water to occur naturally';
  const options = pickClozeHintOptions(['陽光', '水'], 0, passageBody);

  expect(options).not.toBeNull();
  expect(options).toHaveLength(3);
  expect(options).toContain('陽光');
});

it('文章抽字備援不會把「同題其他空格答案」重複列成第二個候選（不會跟第一層撞名）', () => {
  // "water" 本來就是這題另一格的答案，會透過第一層合法成為幹擾項候選——
  // 這是既有、預期的行為（同題其他空格答案本來就可以當幹擾項），不用排除。
  // 這個測試要確認的是：文章裡的 "water" 不會被第二層又「重複」加進候選池一次
  // （只會有一個 water，不會有兩個 water 佔掉 2 個幹擾項名額）。
  const passageBody = 'The process needs sunlight and water and energy and carbon to occur';
  const options = pickClozeHintOptions(['sunlight', 'water'], 0, passageBody)!;

  expect(options).not.toBeNull();
  expect(options.filter(o => o.toLowerCase() === 'water')).toHaveLength(options.includes('water') ? 1 : 0);
});

it('文章抽字備援也抽不到字（連續中文無標點）時，仍回傳 null，不會硬湊', () => {
  const passageBody = '光合作用需要陽光水分和二氧化碳才能順利進行';
  const options = pickClozeHintOptions(['陽光', '水分'], 0, passageBody);

  expect(options).toBeNull();
});

it('只有 1 個空格（同題完全沒有其他空格）時，兩個幹擾項都靠文章抽字備援', () => {
  const passageBody = 'The quick brown fox jumps over the lazy dog near [[river]]';
  const options = pickClozeHintOptions(['river'], 0, passageBody);

  expect(options).not.toBeNull();
  expect(options).toHaveLength(3);
  expect(options).toContain('river');
});

it('文章抽字備援不會把正確答案自己當成幹擾項（就算文章裡出現兩次）', () => {
  const passageBody = 'The sunlight and more sunlight and water and energy appear here today';
  const options = pickClozeHintOptions(['sunlight'], 0, passageBody)!;

  expect(options).not.toBeNull();
  expect(options.filter(o => o.toLowerCase() === 'sunlight')).toHaveLength(1);
});
```

- [ ] **Step 2: 執行測試確認新增的都失敗**

Run: `npx vitest run src/lib/cloze.test.ts`
Expected: 新加的測試 FAIL（`pickClozeHintOptions` 還不吃第三參數，或吃了但沒實作備援邏輯）。

- [ ] **Step 3: 實作**

`src/lib/cloze.ts:98-119`，原本：

```ts
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

改為：

```ts
/**
 * 「💡 提示」用的 3 選項：1 個正確答案 + 2 個幹擾項，純規則、不叫 AI、不用教師額外輸入。
 * 幹擾項來源分兩層：
 * 1. 優先用同一題「其他空格」的正確答案（去除跟目標答案重複的）——品質較好，
 *    跟題目情境相關。
 * 2. 第 1 層湊不到 2 個不重複的時，改用 passageBody（文章原文，含 [[ ]] 標記皆可）
 *    比照「🎲 隨機挑選」的規則（見 findClozeCandidates）從文章本身抽字當備援，
 *    排除同一題「任何一格」的正確答案（避免把其他空格的真答案偽裝成幹擾項），
 *    也排除已經在幹擾項池裡的詞。沒傳 passageBody 或抽不到字時，維持只看
 *    同題其他空格的行為。
 * 兩層合計還是湊不到 2 個不重複的幹擾項時回傳 null，呼叫端應該在拿到 null 時
 * 不顯示提示按鈕，不要硬湊假選項。
 */
export function pickClozeHintOptions(
  correctAnswers: string[],
  blankIndex: number,
  passageBody?: string,
): string[] | null {
  const correct = correctAnswers[blankIndex];
  if (correct === undefined) {
    return null;
  }
  const normalizedCorrect = normalizeClozeAnswer(correct);

  let distractorPool = Array.from(new Set(
    correctAnswers
      .filter((_, i) => i !== blankIndex)
      .filter(ans => normalizeClozeAnswer(ans) !== normalizedCorrect),
  ));

  if (distractorPool.length < 2 && passageBody) {
    const usedAnswers = new Set(correctAnswers.map(normalizeClozeAnswer));
    const textCandidates = parseClozeBody(passageBody)
      .filter((s): s is Extract<ClozeSegment, { kind: 'text' }> => s.kind === 'text')
      .flatMap(s => findClozeCandidates(s.text));
    const extraCandidates = Array.from(new Set(textCandidates)).filter((cand) => {
      const normalizedCand = normalizeClozeAnswer(cand);
      return !usedAnswers.has(normalizedCand)
        && !distractorPool.some(p => normalizeClozeAnswer(p) === normalizedCand);
    });
    distractorPool = [...distractorPool, ...extraCandidates];
  }

  if (distractorPool.length < 2) {
    return null;
  }
  const distractors = [...distractorPool].sort(() => Math.random() - 0.5).slice(0, 2);
  return [correct, ...distractors].sort(() => Math.random() - 0.5);
}
```

不需要移動 `findClozeCandidates`/`parseClozeBody`/`ClozeSegment` 的位置——TypeScript 的函式宣告（`function` 關鍵字，不是 `const fn = () => {}`）會整檔案 hoist，`pickClozeHintOptions` 定義在 `findClozeCandidates` 前面也能直接呼叫，不用搬動任何既有程式碼。

- [ ] **Step 4: 執行測試確認全部通過**

Run: `npx vitest run src/lib/cloze.test.ts`
Expected: PASS（含原本 38 個 + 這次新加的 7 個，全部綠燈）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/cloze.ts src/lib/cloze.test.ts
git commit -m "feat(cloze): pickClozeHintOptions 加文章抽字備援，1-2 空格的題目也能有提示"
```

---

### Task 2: `src/features/quiz/ClozeQuestion.tsx` — 呼叫端多傳 `body`

**Files:**
- Modify: `src/features/quiz/ClozeQuestion.tsx:1-21`（檔案頂端 JSDoc）
- Modify: `src/features/quiz/ClozeQuestion.tsx:61`（`handleUseHint` 內的呼叫）
- Modify: `src/features/quiz/ClozeQuestion.tsx:88`（`hintAvailable` 判斷式）

**Interfaces:**
- Consumes: `pickClozeHintOptions`（Task 1，新的第三參數 `passageBody`）

- [ ] **Step 1: 更新檔案頂端 JSDoc 最後一句**

`src/features/quiz/ClozeQuestion.tsx:20`，原本：

```
 * 同一題內少於 3 個空格（湊不到 2 個不重複的幹擾項）時，該空格不顯示提示按鈕。
 */
```

改為：

```
 * 同一題其他空格答案湊不到 2 個不重複的幹擾項時，會改從文章本身抽字當備援
 * （見 pickClozeHintOptions 的第二層邏輯），讓 1-2 個空格的題目也有機會出現
 * 提示按鈕；兩層都湊不到才不顯示提示按鈕。
 */
```

- [ ] **Step 2: `handleUseHint` 呼叫多傳 `body`**

`src/features/quiz/ClozeQuestion.tsx:61`，原本：

```ts
    const options = pickClozeHintOptions(correctAnswers ?? [], index);
```

改為：

```ts
    const options = pickClozeHintOptions(correctAnswers ?? [], index, body);
```

- [ ] **Step 3: `hintAvailable` 判斷式呼叫多傳 `body`**

`src/features/quiz/ClozeQuestion.tsx:88`，原本：

```ts
              const hintAvailable = pickClozeHintOptions(correctAnswers ?? [], seg.index) !== null;
```

改為：

```ts
              const hintAvailable = pickClozeHintOptions(correctAnswers ?? [], seg.index, body) !== null;
```

- [ ] **Step 4: 驗證**

Run: `npm run check-types` 與 `npx eslint src/features/quiz/ClozeQuestion.tsx`
Expected: 都 0 錯誤。

程式碼路徑走讀（無瀏覽器環境，靜態確認）：
1. `body` 這個 prop 本來就存在（元件簽章第一個欄位），這次只是把它多傳進兩次既有的函式呼叫，沒有新增 prop、沒有改資料流。
2. 兩個呼叫點（`handleUseHint` 跟 `hintAvailable`）用的都是同一個 `body`，數值一致，不會出現「按鈕顯示但按下去卻拿不到選項」的不一致情況。

- [ ] **Step 5: Commit**

```bash
git add src/features/quiz/ClozeQuestion.tsx
git commit -m "feat(cloze): 提示按鈕串接文章抽字備援（傳 body 給 pickClozeHintOptions）"
```

---

### Task 3: 全流程驗收

**Files:** 無新改動，純驗證。

- [ ] **Step 1: 跑完整測試套件**

Run: `npm run test`
Expected: 全部通過（含 Task 1 新增的 7 個備援相關測試）。

- [ ] **Step 2: 型別 + lint**

Run: `npm run check-types` 與 `npm run lint`
Expected: 都 0 錯誤（既有的 pre-existing warning 不算）。

- [ ] **Step 3: 手動驗收提醒**

這個環境沒有可連線的瀏覽器（前兩次 cloze 相關功能開發都是這個狀況）。**建議在 merge / 上線前，由使用者親自用瀏覽器走一次**：
1. 建一題只有 **2 個空格**的克漏字題，文章內容含有一些英文詞或標點分隔的中文詞組（確保抽字備援抓得到候選字），例如：「The mitochondria (粒線體) is the powerhouse of the cell, producing ATP through cellular respiration.」搭配 `[[mitochondria]]` 和 `[[ATP]]` 兩個空格。
2. 學生連結作答：確認**這次**兩個空格旁邊都出現「💡」按鈕（上次驗收時因為只有 2 個空格所以完全沒出現）。
3. 按下提示，確認顯示「（提示：詞1／詞2／詞3）」，其中一個是正確答案，另外兩個是從文章裡抽出來的詞（不會是「mitochondria」或「ATP」這兩個答案本身）。
4. 建一題**只有 1 個空格**、文章是連續中文沒有標點分隔的克漏字題（例如「光合作用需要陽光水分和二氧化碳才能順利進行」，空格挖在「陽光」），確認**不會**出現提示按鈕（兩層都湊不到幹擾項，這是預期的已知限制，不是 bug）。
5. 確認上次已經驗證過的「≥3 空格題目直接用同題答案當幹擾項」的行為沒有被這次改動影響。
