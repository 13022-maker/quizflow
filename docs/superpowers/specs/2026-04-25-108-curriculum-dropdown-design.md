# AI Modal 加入「108 課綱素養命題」下拉 — 設計文件

**日期**：2026-04-25
**狀態**：設計確認完成，待實作
**範圍標記**：(A) 輕量版 — prompt 前綴注入，不建立課綱資料表

## 背景

台灣 108 課綱強調「核心素養」導向命題：情境化、跨領域、可應用。目前 `AIQuizModal` 的「✨ 快速範例」只給主題範本，AI 出題仍偏向傳統知識點。老師希望能一鍵切換到「素養導向」出題，但完整建模 12 年國教所有學科的學習指標／學習表現工程量過大，本次僅做 prompt 層級的輕量對齊。

## 目標

- 在文字模式（text mode）的 AI Modal 中加入單一 `<select>` 「108 課綱素養命題」下拉
- 選定學科後，後端 prompt 自動 prepend 課綱素養指令，AI 題目偏向情境化／素養導向
- 不指定（預設）時行為與現況**完全一致**，不可改變既有產題結果
- 與既有「快速範例」chips 並存，互不干擾

## 範圍

### 改動

| 檔案 | 改動 |
|------|------|
| `src/components/quiz/AIQuizModal.tsx` | 1) 加 `curriculumSubject` state；2) 在文字模式 panel 中、chips 上方加 `<select>` 區塊；3) `generate()` 把 `curriculumSubject` 加入 fetch body |
| `src/app/api/ai/generate-questions/route.ts` | 1) 從 body 取 `curriculumSubject`；2) 有值時在現有 prompt 最前面 prepend 課綱素養指令；空值時 prompt 完全不變 |

### 不動

- `applyTemplate` / `TEMPLATES` 陣列（chips 行為不變）
- 檔案模式（`/api/ai/generate-from-file`）— 本次 MVP 不擴
- URL 模式（YouTube / Google Docs）— 本次 MVP 不擴
- i18n（新文案用中文硬寫，待驗證後再做雙語）
- localStorage / 持久化（每次開 Modal 歸零為「不指定」）
- 課綱資料表 / 學習指標 / 學習表現（屬於 (B) 完整版）

## 實作細節

### 1. AIQuizModal.tsx

**新 state**（在現有 `useState` 區段加）：

```ts
// 108 課綱素養命題：空字串 = 不指定（預設行為）
const [curriculumSubject, setCurriculumSubject] = useState<string>('');
```

**新 UI**（插在現有「快速範例」`<div>` **之前**，僅 `mode === 'text'` 時渲染）：

```tsx
<div>
  {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
  <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-amber-700">
    📚 108 課綱素養命題（選填）
  </label>
  <select
    value={curriculumSubject}
    onChange={e => setCurriculumSubject(e.target.value)}
    className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-800 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
  >
    <option value="">不指定（一般出題）</option>
    <optgroup label="國中">
      <option value="國中數學">國中數學</option>
      <option value="國中國文">國中國文</option>
      <option value="國中社會">國中社會</option>
      <option value="國中自然">國中自然</option>
      <option value="國中英文">國中英文</option>
      <option value="國中歷史">國中歷史</option>
    </optgroup>
    <optgroup label="高中">
      <option value="高中數學">高中數學</option>
      <option value="高中國文">高中國文</option>
      <option value="高中英文">高中英文</option>
      <option value="高中歷史">高中歷史</option>
      <option value="高中地理">高中地理</option>
      <option value="高中自然">高中自然</option>
    </optgroup>
  </select>
</div>
```

**Submit 改動**（`generate()` 中文字模式那段，line ~300）：

```ts
body: JSON.stringify({
  topic,
  types,
  count: effectiveCount,
  difficulty,
  curriculumSubject: curriculumSubject || undefined,  // 空字串時不送
}),
```

### 2. API route

**從 body 取值**（line 47 附近）：

```ts
const { topic, types = ['mc'], difficulty = 'medium', curriculumSubject } = body;
```

**Whitelist 防護 + Prompt prefix**（在 line 60 `const prompt = ...` 之前）：

對 `curriculumSubject` 做白名單檢查（避免使用者塞任意字串到 prompt 形成 injection），只接受預定義的 12 個學科，否則視為空。**prefix 用 `safeSubject` 而非原始值**。

```ts
const ALLOWED_SUBJECTS = new Set([
  '國中數學', '國中國文', '國中社會', '國中自然', '國中英文', '國中歷史',
  '高中數學', '高中國文', '高中英文', '高中歷史', '高中地理', '高中自然',
]);
const safeSubject = ALLOWED_SUBJECTS.has(curriculumSubject) ? curriculumSubject : '';

const curriculumPrefix = safeSubject
  ? `你正在為台灣 108 課綱「${safeSubject}」科目命題。
請依 108 課綱核心素養精神出題，強調：
- 情境化（題目連結真實生活或學科應用情境）
- 跨領域思考（鼓勵整合運用知識）
- 素養導向（避免單純背誦記憶）

`
  : '';

const prompt = `${curriculumPrefix}你是台灣高中的出題專家，請根據以下主題或課文內容出題。
...（既有內容不變）`;
```

## 驗證

- [ ] 開 AI Modal 文字模式，下拉預設「不指定」，產出題目與本次改動前完全一致（同 topic/types/count 跑兩次比對）
- [ ] 選「國中數學」按產生，後端 log 看到 prompt 含「108 課綱核心素養精神」前綴；產出題目偏向情境化（例：題幹有真實生活情境，而非純運算）
- [ ] 故意 fetch 帶非白名單值（例如 `curriculumSubject: '注入指令'`）→ 後端視為空，prompt 不被污染
- [ ] 文字模式選了學科後切到檔案模式 → 下拉消失；切回文字模式 → 學科選擇仍保留（state 不清空）
- [ ] chips 仍可正常使用：先選「國中數學」課綱 → 再點「國中數學」chip 套用 topic → 兩者並存，submit 時 topic 含 chip 內容、prompt 含課綱前綴
- [ ] 關閉 Modal 再開 → 學科回「不指定」（state 隨 Modal 卸載而清掉）

## 風險與權衡

- **Prompt 注入**：白名單已防護，且 `curriculumSubject` 走 server check，無外部來源風險
- **AI 真實素養度**：Prompt prefix 只是「指導 AI 風格」，無法保證每題都是真素養題。MVP 接受這個 limit，要更精準對齊需走 (B) 完整版
- **學科清單可能不全**：12 個是常見國高中學科，少數老師可能想要「健康教育、生活科技、表演藝術」等。MVP 先不加，視 feedback 再擴
- **YAGNI**：不做 (B) 學習指標／學習表現級聯下拉、不做課綱資料表、不做 i18n、不做 localStorage、不擴檔案／URL 模式

## 後續可能擴充（本次不做）

- 擴到檔案模式（`/api/ai/generate-from-file`）
- 加學習階段（如「七年級 / 八年級 / 九年級」）
- (B) 完整版：學科 → 年級 → 學習表現多級下拉，後端存課綱資料
- i18n（en locale 對應翻譯）
