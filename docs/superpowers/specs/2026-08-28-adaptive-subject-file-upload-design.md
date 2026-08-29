# 適性學習「AI 生成學科」加入 PDF／圖片上傳 設計文件

- 日期：2026-08-28
- 起因：`/dashboard/adaptive/new-subject`（AI 生成學科）的「教材內容」欄位目前只能貼文字，
  AI 出題那邊（`FileQuizGenerator`）已經支援 PDF／圖片上傳，兩邊體驗不一致。
- 範圍：只加檔案上傳這條路徑；不動既有貼文字流程、不加 AI quota 限制（現況本來就沒有，維持一致）。

## 使用者決策（brainstorming 階段已確認）

1. 目標功能：確認就是「適性學習 → AI 生成學科」表單的教材欄位（不是 AI 出題，那邊已有）。
2. 模型選擇：**不加**手動 Gemini/Claude 切換，維持現有自動判斷
   （付費走 Claude Opus、其餘走 Gemini，邏輯不變）。
3. 多檔支援：**要**，比照 AI 出題允許多張圖片一次上傳；PDF 仍限單一份。
4. 架構做法：三個方案（A. 新 route + 擴充 `textModel.ts` / B. PDF 前端擷取文字 + 圖片另開簡單
   route / C. 新 route 自帶一份 Gemini/Claude 呼叫）中選 **A**——跟 2026-07-16 那次
   「新 AI 功能統一走 `textModel.ts`」的架構方向一致，PDF/圖片品質對齊 AI 出題（模型直接讀檔案，
   不做前端文字擷取，避免圖表/掃描檔品質打折）。

## 架構

```
NewSubjectForm.tsx
  ├─ 貼文字模式（既有）──▶ generateAdaptiveSubject(server action) ──▶ generateSubject(topic, material)
  └─ 上傳檔案模式（新增）─▶ POST /api/ai/generate-subject-from-file ─▶ generateSubject(topic, undefined, media)
                                                                              │
                                                          兩條路徑收斂到同一個 helper
                                                          saveGeneratedSubject(userId, topic, generated)
                                                          （寫入 adaptive_subject + revalidatePath）
```

選新 route 而非直接讓 server action 收 `File`：Next.js Server Action 預設 body 上限 1MB
（`next.config.mjs` 未覆寫此值），PDF/多圖檔案很容易超過，這也是 AI 出題那邊本來就用
API Route + FormData（而非 server action）處理檔案上傳的原因，這裡比照辦理。

## 改動點

### 1. `src/lib/ai/textModel.ts` — 加多模態支援

`GenerateAITextOptions` 加：

```ts
media?: { mimeType: string; base64: string }[];
```

`callClaude` / `callGemini` 收到 `media` 時，把 image/document blocks 接到訊息內容最前面，
文字 prompt 放最後——程式碼直接搬 `generate-from-file/route.ts` 現成的
`generateWithClaude` / `generateWithGemini` 寫法（image 用 `type: 'image'`、
PDF 用 `type: 'document'` / `inlineData`），不重新設計格式。

`callClaude` 目前用 `client.messages.stream(...)` 串流聚合（避免長輸出撞 timeout），
加 media 後這個串流呼叫方式不變，只是 `messages[0].content` 從純字串換成
`(ImageBlockParam | DocumentBlockParam | TextBlockParam)[]`。

### 2. `src/libs/adaptive/generate-subject.ts` — 傳遞 media

- `generateSubject(topic: string, material?: string, media?: Media[])`
  （`Media` type 定義在 `textModel.ts`並 export，`generate-subject.ts` 跟新 route 都從那裡
  import；`generate-from-file/route.ts` 自己既有的同形狀 local type 不動，避免無關改動）。
- `buildUserPrompt` 在 `media` 有值時换一段提示文字（例如「以下是老師上傳的教材檔案，
  知識點劃分與題目範圍以檔案內容為準」），不再插入 `<教材>` 文字區塊
  （文字內容已經用 media blocks 直接餵給模型）。
- 驗證＋重試邏輯（zod 結構驗證、`validateSemantics`、失敗重試一次）完全不變。

### 3. 抽出共用存檔 helper

把 `generateAdaptiveSubject`（`src/actions/adaptiveActions.ts`）裡「取正規化 subject →
insert `adaptive_subject` → `revalidatePath('/dashboard/adaptive')` → 組回傳值」那段抽成：

```ts
async function saveGeneratedSubject(
  userId: string,
  topic: string,
  generated: GeneratedSubject,
): Promise<{ id: number; name: string; knowledgeCount: number; itemCount: number }>
```

新 route 跟既有 server action 都呼叫這個 helper，避免存檔邏輯寫兩份。

### 4. 新增 `src/app/api/ai/generate-subject-from-file/route.ts`

- `export const runtime = 'nodejs'`、`export const maxDuration = 60`。
- 認證：`auth()` 未登入回 401（比照 `generate-from-file`）。
- 收 multipart FormData：`topic`（string）、`file`（一或多個 File）、
  PDF 才有的 `startPage`/`endPage`。
- 驗證（訊息直接對齊 `generate-from-file` 既有用詞，不要讓老師看到兩套不一致的錯誤文案）：
  - 未上傳檔案 → 400「請上傳檔案」
  - 副檔名不在 `pdf/jpg/jpeg/png/webp/gif` → 400「支援 PDF、圖片格式」
  - 多檔且非全部為圖片 → 400（沿用 `generate-from-file` 現有訊息）
  - `topic` 為空 → 400「請輸入單元主題」
- PDF 頁數：沿用 `src/libs/pdfPageLimit.ts` 的 `resolvePdfPageRange`
  （20 頁上限、頁數範圍裁切，跟 `generate-from-file` 一致）。
- 組 `media: Media[]`（檔案轉 base64）→ `generateSubject(topic, undefined, media)`
  → 成功呼叫 `saveGeneratedSubject` → 回傳 `{ id, name, knowledgeCount, itemCount }`；
  失敗比照既有 `generateAdaptiveSubject` 的友善錯誤映射（拒絕/SAFETY、截斷/MAX_TOKENS）。

### 5. `NewSubjectForm.tsx` — 加上傳 UI

- 「教材內容」欄位上方加二選一切換：**貼文字 / 上傳檔案**（互斥，選檔案時文字框隱藏或清空，
  避免同時有兩種輸入來源造成混淆）。
- 上傳檔案 UI 直接搬 `FileQuizGenerator.tsx` 的既有模式：
  - 拖曳／點擊上傳（`accept=".pdf,.png,.jpg,.jpeg,.webp,.gif"`，不含 doc/音檔——這個表單不需要）
  - PDF 頁數範圍選擇器 + 大檔（`> 4.5MB`）前端用 `pdf-lib` 裁切後再上傳，沿用同一個
    `MAX_UPLOAD_SIZE` 常數與裁切邏輯
  - 多圖上傳（`<input multiple>`，選了非圖片檔就不能再選第二個，同 `generate-from-file` 規則）
- 送出邏輯：`file`（或 `files`）有值 → 組 FormData 打新 route；否則照舊呼叫
  `generateAdaptiveSubject(server action)`。兩條路徑共用同一組「生成中…／✅ 已生成」
  UI 狀態（`generating` / `result` / `error`），不用另外做一份結果畫面。

## 資料流

1. 老師輸入單元主題，選擇「貼文字」或「上傳檔案」。
2. 上傳檔案模式：選 PDF 時讀頁數、選範圍；檔案過大則前端先用 `pdf-lib` 裁切。
3. 送出：
   - 貼文字 → `generateAdaptiveSubject(topic, material)`（server action，不變）
   - 上傳檔案 → `POST /api/ai/generate-subject-from-file`（multipart）
4. Server：組 `media[]` → `generateSubject(topic, undefined, media)` →
   `generateAIText({ ...opts, media })` → 依 `isPaidSubscriberSafe()` 走 Claude Opus
   （帶 thinking）或 Gemini → JSON 解析 → zod 結構驗證 → `validateSemantics`
   （含 `AdaptiveEngine` 建構驗 DAG）→ 失敗重試一次（帶錯誤訊息給模型修正）。
5. 驗證通過 → `saveGeneratedSubject` 寫入 `adaptive_subject` →
   `revalidatePath('/dashboard/adaptive')`。
6. Route／server action 回傳同一形狀的結果 → 前端顯示既有的「✅ 學科已生成」摘要畫面。

## 錯誤處理

- 認證失敗：401「未登入」。
- 檔案驗證失敗：400，訊息對齊 `generate-from-file` 既有用詞。
- AI 生成失敗（兩個 provider 都失敗 / 模型拒絕 / 輸出截斷）：沿用
  `generateAdaptiveSubject` 現有的友善錯誤映射，前端顯示紅字訊息，不讓例外冒泡成
  整頁 digest error。

## 測試

- 新增的邏輯盡量拆成純函式方便單元測試：
  - `textModel.ts` 內組 media blocks 的部分（Claude image/document 分流、Gemini inlineData 組裝）
    抽成獨立可測函式。
  - 新 route 的檔案驗證（副檔名判斷、多檔必須全圖片）抽成純函式，比照
    `generate-from-file` 目前的寫法（雖然那邊是寫在 route handler 內聯，這次盡量抽出來測）。
- `npm run lint`、`npm run check-types` 需全過。
- 手動驗證（瀏覽器實跑，比照先前 Live Mode 那次的驗證方式）：
  1. 上傳一份文字型 PDF（1~2 頁）生成學科，確認知識點/題目內容有對應到 PDF 內容。
  2. 上傳 2 張圖片（例如課本照片）生成學科，確認同上。
  3. 上傳超過 20 頁的 PDF，確認出現裁切限制的錯誤訊息或已裁切成功。
  4. 確認「貼文字」模式完全沒被動到（既有流程照跑）。

## 不做（YAGNI）

- 不加手動 Gemini/Claude 切換（維持自動判斷）。
- 不支援同時貼文字＋上傳檔案（互斥二選一，避免合併邏輯複雜化）。
- 不加音檔／Word 上傳（AI 出題那邊有音檔是聽力題專用情境，這裡用不到）。
- 不加 AI quota 限制（`generateAdaptiveSubject` 現況本來就沒有 quota 檢查，新路徑維持一致，
  不在這次順手加，避免範圍外改動）。
- 不遷移 Vercel AI SDK（既有技術債決策，見 CLAUDE.md）。
