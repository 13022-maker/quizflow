# 段考命題助手（Exam Builder）— 設計規格 v1

日期：2026-10-11
來源：`/Users/hsiehchinhung/Downloads/段考命題助手.md`（產品原型 v0.3）
狀態：待實作規劃（下一步交給 writing-plans）

## 一句話

給台灣國高中老師的段考命題工具：批次貼上題目文字，自動產生雙向細目表、檢核配分與單元比重，排出 A／B 卷與答案卷。

## 範圍邊界（這次做什麼、不做什麼）

**v1 做：**
- 單一考卷編輯畫面（進入即編輯，無列表頁）
- 考卷基本資訊表單
- 批次貼上題目文字並解析（選擇／是非／填空／簡答）
- 從既有 QuizFlow 題庫（`quiz`/`question`）匯入題目（一次性複製）
- 逐題手動編輯（部分欄位）與刪除
- 即時配分檢核、單元配分占比
- 單元與授課節數輸入，配分占比 vs 節數占比比較與偏差警示
- 雙向細目表（單元 × 認知層次）
- 試題卷／答案卷預覽，A／B 卷（同題型內打亂題目順序＋選擇題選項打亂），複製文字

**v1 不做（原型文件「下一步 MVP」清單，明確延後）：**
- 多份考卷與列表頁
- 匯出 Word（.docx）
- AI 自動命題
- 個人題庫、跨學期重複使用、相似題偵測
- 試題分析（難度、鑑別度）
- 同科協作審題
- 與 QuizFlow 現有 Pro 方案的計費/配額閘門
- 拖曳排序
- 選擇題多選（答案僅支援單一字母）

## 資料模型

### `exam_paper`
單一老師只會有一筆（見下方 unique index）。

| 欄位 | 型別 | 說明 |
|---|---|---|
| id | uuid/serial PK | |
| ownerId | text | Clerk user id，**unique index**，保證每人只有一份 |
| school | text nullable | 學校 |
| academicYear | text nullable | 學年度／學期 |
| examName | text nullable | 考試名稱 |
| subject | text nullable | 科目 |
| gradeLevel | text nullable | 年級 |
| durationMinutes | integer nullable | 作答時間（分鐘） |
| teacherName | text nullable | 命題教師 |
| examScope | text nullable | 考試範圍 |
| deviationThreshold | integer, default 5 | 偏差警示門檻（±百分點） |
| shuffleSeed | integer nullable | B 卷打亂用種子；null 表示尚未產生過 B 卷 |
| createdAt / updatedAt | timestamp | |

**Migration 備註**：`CREATE UNIQUE INDEX` on `exam_paper(owner_id)`；find-or-create 用 `INSERT ... ON CONFLICT (owner_id) DO NOTHING` 後再查一次,避免併發產生第二筆。

### `exam_item`

| 欄位 | 型別 | 說明 |
|---|---|---|
| id | uuid/serial PK | |
| paperId | FK → exam_paper.id | |
| source | enum: `pasted` \| `imported` | 決定「貼上整批覆蓋」只動哪些資料 |
| position | integer | 排序；貼上的題目依文字順序編號，匯入的題目接續編號到最後 |
| type | enum: `single_choice` \| `true_false` \| `fill_in_blank` \| `short_answer` | 存檔後不可透過逐題編輯修改 |
| unit | text nullable | 單元；自由文字 |
| cognitiveLevel | enum nullable: `remember`\|`understand`\|`apply`\|`analyze`\|`evaluate`\|`create` | Bloom 六層，固定值，不接受任意文字 |
| points | numeric | 配分 |
| stem | text | 題幹原文，含 `> ` 程式碼行與 `____` 填空標記 |
| options | jsonb nullable | 僅 `single_choice` 使用，`[{ "label": "A", "text": "int" }, ...]`，存檔後不可增減筆數（只能編輯文字/答案字母） |
| answer | text | 選擇題存字母；是非題存 `O`/`X`；填空/簡答存原文（不結構化） |
| createdAt / updatedAt | timestamp | |

### `exam_unit_hour`

| 欄位 | 型別 | 說明 |
|---|---|---|
| id | uuid/serial PK | |
| paperId | FK → exam_paper.id | |
| unitName | text | 單元名稱，比對 `exam_item.unit` 時做去頭尾空白＋全半形空格正規化（不做模糊比對） |
| hours | integer | 授課節數 |

## 批次貼上解析規則

共用 lib：`src/lib/examBuilder/parseExamText.ts`。輸入整份 textarea 文字，輸出 `{ items: ParsedItem[], errors: { index: number; message: string }[] }`。

**分段**：以空行切成題目區塊。

**第一行格式**（用全半形 `｜`/`|` 分隔），合法形式只有三種，配分永遠是最後一欄、必須是數字：
- `題型｜配分`
- `題型｜單元｜配分`
- `題型｜單元｜認知層次｜配分`

不支援「跳過單元只填認知層次」。

- `題型` 白名單：`選擇`→`single_choice`、`是非`→`true_false`、`填空`→`fill_in_blank`、`簡答`→`short_answer`。不在白名單內記為錯誤。
- `認知層次`（若有填）必須是「記憶／理解／應用／分析／評鑑／創造」六個值之一，不符合記為錯誤。

**題幹與選項行**（第一行之後、答案行之前的所有行）：
- `> ` 開頭的行永遠當題幹的程式碼區塊內容，不參與選項判斷。
- 其餘行用正則找出所有 `(字母) 內容` 配對（不管是擠在同一行還是分散多行），彙總成該題選項；字母必須從 A 起連續遞增，中間跳號視為錯誤。
- 僅 `single_choice` 才解析選項；其他題型若出現 `(字母)` 樣式的行，一律當題幹文字（不解析成選項）。
- `____`（四個以上底線）在渲染時轉成填答底線樣式，不影響 parsing。

**答案行**：以 `答案：` 或 `答案:` 開頭的行（必須是區塊的最後一行）。
- `single_choice`：單一字母，且必須落在該題已解析出的選項字母範圍內。
- `true_false`：只接受 `O` 或 `X`（全半形、大小寫皆可，正規化後比對）。
- `fill_in_blank` / `short_answer`：原文整段存入 `answer`，不做格式驗證。

**錯誤回報**：每一題獨立驗證，錯誤用 `{ index, message }` 逐題列出，不中斷整批解析；沒有錯誤的題目照常可預覽/儲存，有錯誤的題目在 UI 上標紅並附錢誤訊息,不會被存入 DB。

## 「貼上並解析」與「匯入題庫」的覆蓋規則

- 「貼上並解析」送出時：
  1. 用上面的 lib 重新解析整份 textarea 文字（server action 重跑一次,不信任前端）。
  2. 在同一個 transaction 裡，刪除該 `exam_paper` 底下所有 `source = 'pasted'` 的 `exam_item`，重新寫入這次解析出的題目（`position` 依文字順序重編）。
  3. `source = 'imported'` 的題目完全不受影響。
  4. UI 在「貼上並解析」按鈕旁顯示明顯警告：「⚠️ 這個動作會覆蓋所有用貼上方式新增的題目（不影響從題庫匯入的題目）」。

- 「從題庫匯入」：
  1. 老師選一個自己名下的 quiz，列出該 quiz 底下 `type` 為 `single_choice`／`true_false`／`short_answer` 的題目（`multiple_choice`／`ranking`／`listening`／`cloze` 不列出）。
  2. 勾選要匯入的題目，送出後複製成新的 `exam_item`（`source = 'imported'`），`position` 接續排在現有題目最後；`unit`／`cognitiveLevel` 一律留空（UI 標示「未分類」）；`points` 沿用原題分數；選項/答案依既有 `question.options`/`correctAnswers` 轉換成 `exam_item.options`/`answer` 格式。
  3. 這是一次性複製，之後原 quiz/question 被編輯或刪除都不影響已匯入的 `exam_item`。

## 逐題編輯

- 可編輯欄位：`unit`、`cognitiveLevel`、`points`、`stem`、選項文字（僅改既有選項的 `text`，不可新增/刪除選項）、`answer`。
- **不可編輯**：`type`（唯讀，顯示但不能改）。要改題型必須回到原始貼上文字調整後整批重貼（`source='pasted'` 的題目才能透過重貼改題型；`source='imported'` 的題目若題型要改，就刪除重新匯入或改走貼上）。
- 可刪除單一 `exam_item`（不分 source）。
- `answer` 編輯時依題型做範圍檢查：`single_choice` 限制在目前選項字母範圍內；`true_false` 限制 O/X。

## 即時檢核

- 總分：所有 `exam_item.points` 加總，即時顯示「X / 100 分」；未滿 100 只用顏色警示，不擋任何操作（貼上、匯入、匯出都正常可做）。
- 各單元配分占比：依 `exam_item.unit` 分組加總 `points` 算百分比；`unit` 為 null 的歸入「未分類」。
- 節數占比：依 `exam_unit_hour` 算每個 `unitName` 的節數百分比。
- 偏差警示：同一個單元名稱（正規化後）比較「配分占比」與「節數占比」，差值超過 `exam_paper.deviationThreshold` 顯示警示；單元名稱只出現在其中一邊（節數清單有但沒題目用到，或反過來）時顯示「⚠️ 未對應」。

## 雙向細目表

- 列：所有 `exam_item.unit` 出現過的值（去重）＋一列「未分類」（給 unit 為 null 的題目）。
- 欄：固定六個 Bloom 值（記憶／理解／應用／分析／評鑑／創造）＋一欄「未分類」（給 cognitiveLevel 為 null 的題目）。
- 格內顯示：落在該（單元, 認知層次）組合的題目「配分加總／題數」。
- 全表格子加總必須等於總分（因為每題必落在某一格，含未分類列/欄），用於內部驗證/測試的不變量。

## A／B 卷與答案卷匯出

- A 卷：題目依 `position` 原始順序呈現。
- B 卷：
  - 需要 `exam_paper.shuffleSeed`。老師按下「產生 B 卷」時，若 `shuffleSeed` 為 null 才產生一個新的隨機整數並存檔；已有 seed 時沿用。
  - 老師可按「重新打亂」顯式產生新的 `shuffleSeed`（覆蓋舊的）。
  - 打亂演算法：共用 lib（例如 `src/lib/examBuilder/shuffle.ts`）用 seed 做 deterministic shuffle；題目打亂範圍限制在「同題型內」（例如所有 `single_choice` 題目只在彼此之間重新排序，不會跟 `true_false` 混排）；`single_choice` 的選項另外用同一個 seed 衍生的子序列打亂。
  - 打亂結果不寫回 `exam_item.position`，是 render 時用 `shuffleSeed` 即時推導出的「顯示用」順序與選項對照表，保證同一個 seed 任何時候算出來都一樣。
- 答案卷：依 A 卷或 B 卷目前呈現的題目順序列出對應答案；B 卷模式下選擇題答案字母要换算成「打亂後」的新字母位置。
- 試題卷／答案卷、A 卷／B 卷用 tab 切換（沿用原型 UI）。
- 複製：按鈕觸發對應文字區塊「全選」，提示老師自行 Ctrl/Cmd+C；不使用 Clipboard API。

## 路由與頁面

- `src/app/[locale]/(auth)/dashboard/exam-builder/page.tsx`（唯一一頁）：
  - Server Component：用 `ownerId` 查 `exam_paper`，查無則 `INSERT ... ON CONFLICT DO NOTHING` 建立一筆空白考卷後再查一次，傳給 client component。
  - Client component 內分區塊：考卷資訊表單 / 批次貼上＋題庫匯入 / 即時檢核 / 單元與節數 / 雙向細目表 / 試題卷答案卷預覽。

## Server Actions

放在 `src/actions/examBuilderActions.ts`，遵循既有慣例（`'use server'`、Zod 驗證、用 `ownerId` 做權限檢查，非 orgId）：

- `updateExamPaperInfo`：更新考卷基本資訊欄位與 `deviationThreshold`。
- `pasteAndParseExamItems`：接收 textarea 原文，重新解析、覆蓋 `source='pasted'` 的題目,回傳逐題錯誤清單。
- `importQuestionsFromQuizBank`：接收 quizId + 選中的 questionId 清單，複製成 `source='imported'` 的 `exam_item`。
- `updateExamItem`：逐題編輯（不含 type、不含增減選項)。
- `deleteExamItem`：刪除單一題目。
- `upsertUnitHours`：覆蓋整份 `exam_unit_hour` 清單（老師在「單元與節數」區塊整份提交）。
- `regenerateShuffleSeed`：產生/重新產生 `shuffleSeed`。

## 測試重點

- `parseExamText` 的單元測試：三種欄位省略格式、程式碼行與選項行的區分、選項分行 vs 擠一行、答案格式驗證（含是非題 O/X、選擇題字母範圍）、跳號選項錯誤、Bloom 值白名單錯誤，逐題錯誤不中斷整批。
- `pasteAndParseExamItems` 覆蓋範圍測試：確認只刪 `source='pasted'`，`source='imported'` 不受影響。
- 雙向細目表矩陣加總 = 總分（含未分類列/欄）的不變量測試。
- B 卷 shuffle 的 deterministic 測試：同 seed 兩次呼叫結果一致；不同 seed 結果（機率上）不同；同題型內打亂不會跨題型混排。
- `exam_paper(owner_id)` unique index 的併發 find-or-create 測試（兩個並發請求只會留一筆）。

## 待確認（實作規劃階段處理）

- Migration 檔名需照 `CLAUDE.md` 規則重新命名成 `YYYYMMDD_exam_builder.sql` 並同步處理 snapshot/journal。
- 所有新增 UI 文字需同步補 `src/locales/zh.json` 與 `en.json`。
- Server Action 檔案若用到 Zod schema 匯出，需留意 `'use server'` 檔案不能 export Zod schema 的專案已知限制（見記憶 `feedback_use_server_export_restriction`），schema 定義要放在獨立檔案。
