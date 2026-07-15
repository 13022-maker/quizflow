# PDF 章節選取（AI 出題上傳講義）設計文件

- 日期：2026-07-15
- 範圍：AI 出題 → 上傳講義（PDF）流程的前端 UI
- 影響檔案：`src/components/quiz/AIQuizModal.tsx`（僅前端，不動 API / DB / server action）

## 背景與問題

老師上傳大型 PDF 教材時（如「程式設計實習升學寶典_第1章_教師本.pdf」，9.4MB、25 頁），
目前只能手動填「從第 X 頁到第 Y 頁」。老師需要先自己翻頁、記住章節對應的頁碼，才能填對範圍，
不夠省事。

**目標**：在頁碼選擇器之外，額外提供「章節」清單，老師點一下章節即自動帶入對應頁碼範圍。

## 決策

### 章節資料來源：PDF 內建書籤（方案 A）

用 `pdfjs-dist` 的 `pdf.getOutline()` 取得 PDF 內建書籤（目錄）。

- **優點**：章節與頁碼由 PDF 製作者標定，最精準可信賴；實作最單純，不需啟發式猜測。
- **缺點**：掃描版 / 部分匯出版 PDF 沒有書籤，此時抓不到章節。
- **無書籤時的行為**：不顯示章節區塊，維持現行純頁碼流程（完全向後相容）。

未採用：從內文文字用規則抓「第X章」標題（覆蓋率高但屬猜測式、頁碼易不準）。
等實務上遇到大量無書籤教材再評估補上。

### 頁碼換算

- 每個章節書籤有 `dest`，用 `pdf.getPageIndex(...)` 解析成 0-based page index，+1 得起始頁。
- 結束頁 = 「下一章起始頁 − 1」；最後一章的結束頁 = 全書總頁數。
- 解析完依起始頁排序，避免書籤順序異常導致範圍算錯。

### 只取第一層章節

書籤常有階層（第2章 → 2-1、2-2）。只取最上層（章）：清單短、乾淨、手機版塞得下，
且符合老師多以「章」為單位命題的習慣。忽略更深階層。

### 互動：單選、自動帶入頁碼

- 點一個章節 → 把該章的起始頁 / 結束頁填進現有 `startPage` / `endPage` state。
- **頁碼欄位仍是唯一真實來源**：老師點完仍可手動微調頁碼。
- 選中的章節列以 amber 高亮（與現有配色一致）。
- 手動改頁碼後，若頁碼不再完全等於任一章的範圍，就取消章節高亮（純視覺，不阻擋操作）。

### 版面

章節清單放在現有頁碼選擇器**上方**，作為主要入口。每列顯示「章節名稱 · p.起–迄」。

```
📑 依章節選取（點一下自動帶入頁碼）
┌────────────────────────────────┐
│ 第1章 程式設計概論      p.1–7   │
│ 第2章 迴圈結構 ✓        p.8–14  │ ← 選中 amber 高亮
│ 第3章 陣列              p.15–25 │
└────────────────────────────────┘
📄 共 25 頁，選擇要命題的範圍
從第 [8] 頁到第 [14] 頁  （共 7 頁）
```

## 資料流

1. 老師選檔 → 既有 `handleFiles` 流程判定為 PDF。
2. 讀 `pdf.numPages`（既有）→ 設 `pdfPageCount`、`startPage`、`endPage`。
3. **新增**：同段 async 內呼叫 `pdf.getOutline()`：
   - 回 null / 空陣列 → `chapters` 設為空，UI 不顯示章節區塊。
   - 有內容 → 逐項解析第一層書籤的起始頁，計算結束頁，排序後存進新 state `chapters`。
4. 老師點章節列 → `setStartPage` / `setEndPage` 帶入該章範圍。
5. 命題送出（generate）流程完全不變，仍以 `startPage` / `endPage` 為準（含大 PDF 前端裁切）。

## 元件內部設計（AIQuizModal.tsx）

- 新增型別：`type PdfChapter = { title: string; start: number; end: number }`。
- 新增 state：`const [chapters, setChapters] = useState<PdfChapter[]>([])`。
- 在讀 PDF 的 try 區塊內，`getDocument` 之後：
  - `const outline = await pdf.getOutline();`
  - 若有 outline，對第一層每項：`await pdf.getPageIndex(item.dest)`（dest 可能是字串，需先 `pdf.getDestination(name)` 解析；用 try/catch 包住個別項，失敗即略過）。
  - 依 start 排序後，回填 end（下一項 start − 1，末項 = total）。
  - `setChapters(...)`。
- 換檔 / 清空時 `setChapters([])`（與 `setPdfPageCount(null)` 一起重置）。
- UI：在頁碼選擇器 `<div>` 前插入章節清單區塊，`chapters.length > 0` 時才 render。
  - 每列一個 `<button type="button">`，`onClick` 帶入頁碼。
  - 選中判定：`startPage === ch.start && endPage === ch.end`。

## 錯誤處理與邊界

| 情況 | 行為 |
|------|------|
| PDF 無書籤 / `getOutline()` 回 null 或 `[]` | 不顯示章節區塊，維持純頁碼 |
| 個別章節 `dest` 解析失敗 | try/catch 略過該項，其餘正常 |
| `getOutline()` 整段拋錯 | catch 後 `setChapters([])`，不影響 `pdfPageCount` / 頁碼功能 |
| 老師手動改頁碼偏離章節範圍 | 取消該章高亮，不阻擋 |
| 非 PDF（圖片 / 音檔） | 不觸發章節邏輯（既有分支不變） |

## 不做（YAGNI）

- 不做內文文字啟發式抓章節（方案 B）。
- 不做多章節複選 / 不連續選取。
- 不做巢狀階層縮排顯示。
- 不改 API、DB schema、server action、i18n（此區塊為 PDF 上傳流程，現有亦為繁中硬字串）。

## 測試方式

以本機 `npm run dev` 手動驗證三類 PDF：

1. **有書籤的教科書 PDF**：章節清單正確顯示、頁碼對應正確、點選帶入頁碼、高亮正確、手動改頁碼取消高亮。
2. **無書籤 PDF**：不顯示章節區塊，頁碼流程照舊。
3. **大 PDF（>4.5MB）有書籤**：點章節帶入頁碼後，送出命題的前端裁切仍以帶入的頁碼裁切正確。

另跑 `npm run lint` 與 `npm run check-types` 確保無錯。
