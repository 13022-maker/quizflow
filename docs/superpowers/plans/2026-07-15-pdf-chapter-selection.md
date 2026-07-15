# PDF 章節選取 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 AI 出題「上傳講義」流程在頁碼選擇器上方多一個 PDF 章節清單，老師點章節即自動帶入對應頁碼範圍；沒書籤的 PDF 完全照舊。

**Architecture:** 把「章節結束頁計算 + 排序」的純邏輯抽成獨立可測檔案 `pdfChapters.ts`（用 vitest 單元測試）。`AIQuizModal.tsx` 在既有讀 PDF 的 async 流程內呼叫 `pdf.getOutline()` 解析各章起始頁，交給純函式算出章節清單，存進新 state，並在 UI 顯示可點選清單。

**Tech Stack:** Next.js 14 App Router、TypeScript strict、React（client component）、pdfjs-dist ^5.6.205、vitest、Tailwind CSS。

## Global Constraints

- UI 文字、程式碼註解一律繁體中文；變數/函式/檔名用英文。
- 僅改前端，不動 API / DB schema / server action / i18n。
- 完全向後相容：無書籤 PDF 維持現行純頁碼行為。
- 頁碼欄位（`startPage` / `endPage`）仍是唯一真實來源。
- 改完跑 `npm run lint` 與 `npm run check-types` 需無錯。
- 新增 third-party import 後跑 `npx eslint --fix` 再 commit（simple-import-sort 順序）。

---

### Task 1: 章節計算純函式 `buildChapters`

把「解析後的各章起始頁」轉成「含結束頁、已排序的章節清單」。這段邏輯（結束頁 = 下一章起始頁 −1、末章到尾頁、排序、去除重複起始頁）與 pdfjs 無關，抽成純函式獨立測試。

**Files:**
- Create: `src/components/quiz/pdfChapters.ts`
- Test: `src/components/quiz/pdfChapters.test.ts`

**Interfaces:**
- Consumes: 無（純函式，輸入為單純資料）
- Produces:
  - `type PdfChapter = { title: string; start: number; end: number }`
  - `type RawChapter = { title: string; start: number }`
  - `function buildChapters(raw: RawChapter[], totalPages: number): PdfChapter[]`

- [ ] **Step 1: Write the failing test**

建立 `src/components/quiz/pdfChapters.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { buildChapters } from './pdfChapters';

describe('buildChapters', () => {
  it('依序 3 章：結束頁為下一章起始頁 −1，末章到尾頁', () => {
    const raw = [
      { title: '第1章 程式設計概論', start: 1 },
      { title: '第2章 迴圈結構', start: 8 },
      { title: '第3章 陣列', start: 15 },
    ];
    expect(buildChapters(raw, 25)).toEqual([
      { title: '第1章 程式設計概論', start: 1, end: 7 },
      { title: '第2章 迴圈結構', start: 8, end: 14 },
      { title: '第3章 陣列', start: 15, end: 25 },
    ]);
  });

  it('輸入未排序時會自動依起始頁排序', () => {
    const raw = [
      { title: '第2章', start: 8 },
      { title: '第1章', start: 1 },
    ];
    expect(buildChapters(raw, 10)).toEqual([
      { title: '第1章', start: 1, end: 7 },
      { title: '第2章', start: 8, end: 10 },
    ]);
  });

  it('空輸入回空陣列', () => {
    expect(buildChapters([], 10)).toEqual([]);
  });

  it('單一章節：結束頁為尾頁', () => {
    expect(buildChapters([{ title: '全冊', start: 1 }], 30)).toEqual([
      { title: '全冊', start: 1, end: 30 },
    ]);
  });

  it('重複起始頁時去重（保留第一個標題）', () => {
    const raw = [
      { title: '第1章', start: 1 },
      { title: '第1章重複書籤', start: 1 },
      { title: '第2章', start: 5 },
    ];
    expect(buildChapters(raw, 8)).toEqual([
      { title: '第1章', start: 1, end: 4 },
      { title: '第2章', start: 5, end: 8 },
    ]);
  });

  it('過濾無效項目（起始頁 < 1 或標題空白）', () => {
    const raw = [
      { title: '  ', start: 1 },
      { title: '第1章', start: 0 },
      { title: '第2章', start: 3 },
    ];
    expect(buildChapters(raw, 6)).toEqual([
      { title: '第2章', start: 3, end: 6 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/quiz/pdfChapters.test.ts`
Expected: FAIL（`buildChapters` / 檔案不存在）

- [ ] **Step 3: Write minimal implementation**

建立 `src/components/quiz/pdfChapters.ts`：

```ts
/**
 * pdfChapters.ts
 * PDF 書籤（目錄）→ 章節頁碼範圍的純計算邏輯。
 * 與 pdfjs 無關，方便單獨測試。
 */

// 單一章節：含起始頁與結束頁
export type PdfChapter = { title: string; start: number; end: number };

// 尚未算結束頁的原始章節（由書籤解析得到起始頁）
export type RawChapter = { title: string; start: number };

/**
 * 把「各章起始頁」轉成「含結束頁、已排序、去重」的章節清單。
 * - 結束頁 = 下一章起始頁 − 1；最後一章 = 全書尾頁
 * - 依起始頁排序；相同起始頁只保留第一個
 * - 過濾標題空白或起始頁 < 1 的無效項
 */
export function buildChapters(raw: RawChapter[], totalPages: number): PdfChapter[] {
  // 過濾無效項並依起始頁排序
  const valid = raw
    .filter(c => c.title.trim() !== '' && c.start >= 1 && c.start <= totalPages)
    .sort((a, b) => a.start - b.start);

  // 去除重複起始頁（保留第一個標題）
  const deduped: RawChapter[] = [];
  for (const c of valid) {
    if (deduped.length === 0 || deduped[deduped.length - 1]!.start !== c.start) {
      deduped.push(c);
    }
  }

  // 回填結束頁
  return deduped.map((c, i) => {
    const next = deduped[i + 1];
    const end = next ? next.start - 1 : totalPages;
    return { title: c.title.trim(), start: c.start, end: Math.max(c.start, end) };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/quiz/pdfChapters.test.ts`
Expected: PASS（6 個測試全綠）

- [ ] **Step 5: Commit**

```bash
git add src/components/quiz/pdfChapters.ts src/components/quiz/pdfChapters.test.ts
git commit -m "feat(ai-quiz): 章節頁碼計算純函式 buildChapters

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 讀取 PDF 書籤並存進 state

在 `AIQuizModal.tsx` 既有讀 PDF 的 async 流程內，呼叫 `pdf.getOutline()`，解析第一層書籤各項的起始頁，交給 `buildChapters` 算出章節清單並存入新 state。此任務不含 UI，以「無書籤不炸、有書籤能存」為主，靠 Task 3 的畫面驗證，這步先靠 `npm run check-types` 確認型別正確。

**Files:**
- Modify: `src/components/quiz/AIQuizModal.tsx`（state 宣告區 173-177、讀 PDF 區塊 303-317、重置點 290/322/831）

**Interfaces:**
- Consumes: `buildChapters`、`PdfChapter`、`RawChapter`（Task 1）
- Produces:
  - state `chapters: PdfChapter[]`（供 Task 3 render）
  - setter `setChapters`

- [ ] **Step 1: 加入 import**

在 `AIQuizModal.tsx` 檔案上方 import 區加入（實際位置以 `npx eslint --fix` 排序為準）：

```ts
import { buildChapters, type PdfChapter } from './pdfChapters';
```

- [ ] **Step 2: 新增 chapters state**

在既有 PDF 頁數 state（`AIQuizModal.tsx:173-177`）下方加入：

```ts
  // PDF 章節（來自書籤，無書籤時為空陣列）
  const [chapters, setChapters] = useState<PdfChapter[]>([]);
```

- [ ] **Step 3: 讀 PDF 時解析書籤**

在讀 PDF 的 try 區塊內，`setEndPage(Math.min(10, total));`（約 `AIQuizModal.tsx:312`）之後、`} catch {` 之前，插入書籤解析：

```ts
        // 解析 PDF 內建書籤（目錄）→ 章節清單；無書籤或解析失敗時維持空陣列
        try {
          const outline = await pdf.getOutline();
          if (outline && outline.length > 0) {
            const raw: { title: string; start: number }[] = [];
            for (const item of outline) {
              try {
                // dest 可能是字串（具名目的地）或陣列，需解析成頁面參照
                const dest = typeof item.dest === 'string'
                  ? await pdf.getDestination(item.dest)
                  : item.dest;
                const ref = Array.isArray(dest) ? dest[0] : null;
                if (!ref) {
                  continue;
                }
                const pageIndex = await pdf.getPageIndex(ref);
                raw.push({ title: item.title, start: pageIndex + 1 });
              } catch {
                // 個別書籤解析失敗即略過，不影響其餘章節
              }
            }
            setChapters(buildChapters(raw, total));
          } else {
            setChapters([]);
          }
        } catch {
          // 整體書籤讀取失敗 → 不顯示章節，頁碼功能不受影響
          setChapters([]);
        }
```

- [ ] **Step 4: 換檔 / 移除檔案時重置 chapters**

在三處 `setPdfPageCount(null);` 旁補上 `setChapters([]);`：

1. `AIQuizModal.tsx:290`（選到 PDF/音檔的單檔模式開頭）：

```ts
      setPdfPageCount(null);
      setChapters([]);
      setFiles([nonImage]);
```

2. `AIQuizModal.tsx:322`（全為圖片分支）：

```ts
    setPdfPageCount(null);
    setChapters([]);
    setFiles((prev) => {
```

3. `AIQuizModal.tsx:831`（移除已選檔案的按鈕）：

```ts
                              if (fExt === 'pdf') {
                                setPdfPageCount(null);
                                setChapters([]);
                              }
```

> 註：`AIQuizModal.tsx:314` 的 `setPdfPageCount(null)` 在讀 PDF 的 catch 內，Step 3 的書籤 catch 已把 chapters 設空，且該 catch 代表整個 PDF 讀取失敗、不會顯示章節，這裡不需再加。

- [ ] **Step 5: 型別檢查**

Run: `npm run check-types`
Expected: 無錯誤（若 pdfjs 型別對 `item.dest` / `getDestination` 有 union，確認上面的 `typeof` 分支與 `Array.isArray` 已覆蓋；必要時對 `ref` 用 `as any` 傳入 `getPageIndex`，並加繁中註解說明 pdfjs 型別限制）

- [ ] **Step 6: Commit**

```bash
git add src/components/quiz/AIQuizModal.tsx
git commit -m "feat(ai-quiz): 讀取 PDF 書籤解析章節頁碼範圍

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: 章節清單 UI 與點選帶入頁碼

在頁碼選擇器上方 render 章節清單，點選自動帶入頁碼，選中列 amber 高亮。

**Files:**
- Modify: `src/components/quiz/AIQuizModal.tsx`（PDF 頁數選擇器區塊，約 873-924，在其前插入章節區塊）

**Interfaces:**
- Consumes: `chapters`（Task 2）、`startPage`/`endPage`/`setStartPage`/`setEndPage`（既有）
- Produces: 無（純 UI）

- [ ] **Step 1: 插入章節清單區塊**

在 `{/* PDF 頁數範圍選擇器 */}`（約 `AIQuizModal.tsx:865`）這段**之前**、`{pageLoading && (...)}` 判斷附近的同層位置，插入以下區塊（放在 `pdfPageCount !== null` 的頁碼卡片之前，讓章節在上方）：

```tsx
                  {/* 依章節選取（僅當 PDF 含書籤時顯示） */}
                  {chapters.length > 0 && (
                    <div className="space-y-1.5 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:px-4">
                      <p className="text-xs font-bold text-gray-700">
                        📑 依章節選取（點一下自動帶入頁碼）
                      </p>
                      <div className="max-h-48 space-y-1 overflow-y-auto">
                        {chapters.map((ch) => {
                          // 頁碼完全等於某章範圍時才視為選中（手動改頁碼會自動取消高亮）
                          const selected = startPage === ch.start && endPage === ch.end;
                          return (
                            <button
                              key={`${ch.title}-${ch.start}`}
                              type="button"
                              onClick={() => {
                                setStartPage(ch.start);
                                setEndPage(ch.end);
                              }}
                              className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-left text-sm transition-colors ${
                                selected
                                  ? 'border-amber-400 bg-amber-50 text-amber-800'
                                  : 'border-gray-200 bg-white text-gray-700 hover:border-amber-300 hover:bg-amber-50/40'
                              }`}
                            >
                              <span className="min-w-0 flex-1 truncate font-medium">{ch.title}</span>
                              <span className="shrink-0 font-mono text-xs text-gray-500">
                                {`p.${ch.start}–${ch.end}`}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
```

- [ ] **Step 2: Lint 與型別檢查**

Run: `npx eslint --fix src/components/quiz/AIQuizModal.tsx src/components/quiz/pdfChapters.ts && npm run lint && npm run check-types`
Expected: 皆無錯誤

- [ ] **Step 3: 手動驗證（三類 PDF）**

Run: `npm run dev`，開 AI 出題 →「上傳講義」，逐一測：

1. **有書籤教科書 PDF**：章節清單顯示於頁碼上方；點某章 → 頁碼自動變成該章範圍、該列 amber 高亮；手動改頁碼偏離 → 高亮消失；送出命題正常。
2. **無書籤 PDF**：不顯示章節區塊；頁碼流程照舊。
3. **大 PDF（>4.5MB）有書籤**：點章節帶入頁碼後送出，前端 `pdf-lib` 裁切以帶入頁碼正確裁切。

Expected: 三類皆符合；無 console 錯誤。

- [ ] **Step 4: Commit**

```bash
git add src/components/quiz/AIQuizModal.tsx
git commit -m "feat(ai-quiz): 章節清單 UI，點選自動帶入頁碼範圍

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- 章節來源 `getOutline()`（方案 A）→ Task 2 Step 3 ✅
- 頁碼換算（getPageIndex、下一章 −1、末章尾頁、排序）→ Task 1（純邏輯）+ Task 2（解析）✅
- 只取第一層章節 → Task 2 Step 3 只迭代 `outline` 頂層、不遞迴 `item.items` ✅
- 單選、點章帶入頁碼、頁碼為真實來源 → Task 3 Step 1 ✅
- amber 高亮 + 手動改頁碼取消高亮 → Task 3 Step 1（`selected` 判定）✅
- 版面放頁碼上方 → Task 3 Step 1（插在頁碼卡片之前）✅
- 邊界：無書籤 / 個別 dest 失敗 / 整體失敗 → Task 2 Step 3（三層處理）✅
- 換檔重置 → Task 2 Step 4 ✅
- 測試（純函式單元 + 三類 PDF 手動 + lint/check-types）→ Task 1 + Task 3 Step 3/Step 2 ✅

**Placeholder scan:** 無 TBD/TODO，每步含實際程式碼與指令。

**Type consistency:** `PdfChapter`（Task 1 定義，Task 2 import、Task 3 使用）、`buildChapters(raw, total)` 簽章一致、`chapters`/`setChapters` 命名一致。無矛盾。
