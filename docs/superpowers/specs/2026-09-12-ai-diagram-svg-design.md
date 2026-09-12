# AI 出題附概念圖（SVG 圖解題）— 設計文件

## Context

QuizFlow 目前 AI 出題只有純文字。對於流程、概念關係、時間軸、比較類的題目，
純文字常常不如一張圖直觀。這次要讓 AI 出題時，針對適合的題目自動附一張
自包含 SVG 圖解，渲染在學生作答頁與教材靜態匯出頁。

風格參考 `cathrynlavery/diagram-design`：乾淨、無陰影、非 Mermaid 風格。

## 探勘結果（現況）

- **出題入口 → API**：
  - 文字模式：`AIQuizModal.tsx` → `POST /api/ai/generate-questions`
  - 檔案模式（PDF/圖片）：`FileQuizGenerator.tsx` → `POST /api/ai/generate-from-file`
  - 兩條路由都是自己組 prompt 字串直接呼叫 Gemini（主）+ Claude（fallback），
    沒有走 `src/lib/ai/textModel.ts` 的 `generateAIText` 抽象層。本次**維持現狀**，
    不把這兩條路由遷移去 textModel.ts（遷移是另一個獨立技術債任務，混在一起做
    風險更高、review 更難）。
  - 每種題型有固定的 JSON 範本（各路由自己的 `TYPE_EXAMPLES`），AI 依範本填空回傳。
- **Schema**：`questionSchema`（`src/models/Schema.ts:179`），現有欄位含
  `body / imageUrl / audioUrl / options / correctAnswers / referenceAnswer /
  explanation / points / aiHint`。
- **Word export**：`quizExport.ts`、`teacherExam.ts` 都用 `docx` npm 套件（結構化建構
  文件，非 HTML）。`docx@9.6.1` 的 `ImageRun` 雖支援 `type: 'svg'`，但強制要求同時
  提供 raster `fallback`（舊版 Word 無法直接渲染 SVG）。**v1 範圍不含 docx 匯出**，
  這個限制先記錄，之後要做再處理（可用專案既有的 `sharp` 依賴 rasterize SVG→PNG
  當 fallback）。
- **教材靜態匯出**（`src/lib/exportPracticePage.ts`）是純 HTML 字串模板，直接內嵌
  `<svg>` 無 fallback 問題。
- **Sanitize**：專案目前沒有任何 sanitize-html / DOMPurify 依賴。既有
  `dangerouslySetInnerHTML` 用法（`AdaptiveLearnClient.tsx` 搭配 `marked.parse()`）
  目前也沒做消毒——這是既有技術債，不在本次範圍內修。
- **渲染點**：`QuizTaker.tsx` 目前用 `<img>` 顯示 `question.imageUrl`（約 150 行）。

## 範圍決策（澄清問題答案）

1. **「這題需要配圖」怎麼決定**：AI 自動判斷，不需要老師手動勾選，出題 UI 零改動。
2. **適用題型**：只有 mc（單選/多選）、tf（是非）、fill（填空）。short_answer、
   ranking、listening、cloze 不產圖。
3. **v1 渲染範圍**：學生作答頁（`QuizTaker.tsx`）+ 教材靜態頁
   （`exportPracticePage.ts`）。**不含** docx 匯出（`quizExport.ts` /
   `teacherExam.ts`）與學生詳解區塊，之後有需要再擴充。
4. **AI 呼叫方式**：維持現狀，直接在既有 prompt 字串加規則，不遷移去 textModel.ts。
5. **SVG 產生方式**：做法 B——AI 只回傳結構化語意資料，程式碼用 4 個固定 SVG
   範本渲染，不讓 AI 自由手刻 SVG markup。原因：LLM 手刻 SVG 座標/排版品質不穩定
   （文字重疊、比例跑掉），template 渲染能保證「乾淨無陰影」風格一致，且
   sanitizer 範圍大幅縮小（只需處理文字 escape，不用擋整個 SVG 語法空間）、
   4 個渲染函式是純函式，TDD 好寫。

## 資料流

```
AI 生成 (Gemini/Claude 既有呼叫不變)
  → prompt 新增規則:mc/tf/fill 題型若適合圖解,回傳 "diagram": {...4 種結構之一}
  → route.ts 解析 JSON 後,對每個帶 diagram 的題目呼叫 renderDiagramSvg(data)
  → 成功 → 該題附上 diagramSvg 字串(拿掉原始 diagram 物件,只留最終 SVG)
  → renderDiagramSvg 拋出任何錯誤(DiagramTooComplexError 或 assertSvgSafe 的一般 Error)
    → route 端一律 catch 住,該題單純不附圖,記錄警告,其餘題目不受影響
    (fail-open,不讓一張圖搞砸整批出題)
  → 回傳給前端預覽(AIQuizModal / FileQuizGenerator)
  → 老師確認匯入 → questionActions.ts 既有 Zod schema 存進 DB
```

## Schema 改動

`src/models/Schema.ts`，`questionSchema` 內緊鄰 `imageUrl` 加：

```ts
diagramSvg: text('diagram_svg'), // AI 自動生成的圖解 SVG(乾淨風格,4 種範本之一;無則 null)
```

Migration 放 `migrations/`（非 `drizzle/`）。**注意**：專案已知 migration snapshot
脫鉤問題（`migrations/meta/` 缺 0015-0017 的 snapshot），`npm run db:generate` 後
務必手動檢查產出的 SQL，刪掉不屬於本次改動的 CREATE/ALTER 語句。

## 新增檔案：`src/lib/ai/diagramSvg.ts`

兩條出題路由（`generate-questions` / `generate-from-file`）共用同一份渲染邏輯，
避免各自複製一套 template 程式碼。

### 結構化資料形狀

```ts
type FlowDiagram = { type: 'flow'; steps: string[] };              // 2-6 步
type CompareDiagram = {                                             // 固定兩欄
  type: 'compare';
  leftTitle: string; leftPoints: string[];                          // 每欄 1-5 點
  rightTitle: string; rightPoints: string[];
};
type TimelineDiagram = {                                            // 2-6 個事件
  type: 'timeline';
  events: { label: string; note?: string }[];
};
type ConceptDiagram = {                                             // 2-6 節點
  type: 'concept';
  nodes: string[];
  edges: { from: string; to: string; label?: string }[];            // 最多 8 條
};

type DiagramData = FlowDiagram | CompareDiagram | TimelineDiagram | ConceptDiagram;
```

數量上限訂這麼緊的原因：4 個範本是固定版面，步驟/節點數一多版面會擠爆或字重疊，
違背「乾淨」的初衷。超過上限直接視為錯誤，不強行擠版面。

### 渲染器介面

```ts
export class DiagramTooComplexError extends Error {}

export function renderDiagramSvg(data: DiagramData): string;
// 內部:文字一律先過 escapeSvgText() 才插進 template 字串;
// viewBox/座標由 code 依項目數量計算(不是 AI 給);
// 渲染完成後跑 assertSvgSafe(svg) 防禦性檢查;
// 超出上限 → throw DiagramTooComplexError

export function escapeSvgText(str: string): string;
// 對 < > & " ' 做 XML entity escape,所有插進 template 的 AI 文字必經此層,無例外路徑

export function assertSvgSafe(svg: string): void;
// 防禦性最後一關(belt-and-suspenders):斷言輸出不含
// <script、on\w+=、javascript:、<foreignObject、xlink:href/href
// 理論上這些字串永遠不會出現(template 本身沒有這些標籤/屬性),
// 純粹防未來改 template 時手滑;若命中則 throw 一般 Error(不是 DiagramTooComplexError)
```

## Prompt 規則

加在兩條路由既有 prompt 的規則區，套用到 mc/tf/fill 題型：

> 若這題的內容適合用圖表輔助理解（流程步驟、兩者比較、時間先後、概念之間的關係），
> 在該題 JSON 加一個 `"diagram"` 欄位，格式為以下 4 種之一（不適合就完全不要加這個
> 欄位，不要為了加圖而硬湊）：
> - 流程：`{"type":"flow","steps":["步驟1","步驟2",...]}`（2-6 步）
> - 比較：`{"type":"compare","leftTitle":"...","leftPoints":["..."],"rightTitle":"...","rightPoints":["..."]}`（每欄 1-5 點）
> - 時間軸：`{"type":"timeline","events":[{"label":"...","note":"..."}]}`（2-6 個事件，note 可省略）
> - 概念關係：`{"type":"concept","nodes":["A","B",...],"edges":[{"from":"A","to":"B","label":"..."}]}`（2-6 節點，最多 8 條關係，label 可省略）
>
> 不是每題都需要圖，大部分題目不需要。

刻意不給 AI「自由發揮第 5 種格式」的空間——做法 B 的核心是 AI 只出資料，
範本形狀由 code 鎖死。

## 安全模型

因為 SVG 完全是 code 自己的 4 個 template 產生（AI 從頭到尾拿不到 SVG 語法控制權），
風險縮小成單一個點：AI 填的文字內容被插進 `<text>` 節點時若沒 escape，理論上可能
用類似 `"><script>...` 的字串跳出標籤。因此：

- `escapeSvgText` 是唯一合法的文字插入路徑，沒有例外路徑
- `assertSvgSafe` 是防禦性最後一關，理論上永遠不該觸發，但作為 defense-in-depth 保留
- **不引入** `dompurify` / `sanitize-html`：輸入面已經被「AI 只給資料、不給 markup」
  這個架構決定掐死，裝通用 sanitizer 反而多一個依賴、多一層攻擊面假設

## 渲染點

### 1. `QuizTaker.tsx`

在既有 `question.imageUrl && <img>` 區塊旁加：

```tsx
{question.diagramSvg && (
  <div className="my-3" dangerouslySetInnerHTML={{ __html: question.diagramSvg }} />
)}
```

程式碼註解需寫明：這裡放的是 server 端 `renderDiagramSvg` 產生、已過
`escapeSvgText` + `assertSvgSafe` 的字串，禁止改成顯示使用者原始輸入。

### 2. `exportPracticePage.ts`

HTML 字串模板裡，`diagramSvg` 直接原樣拼接。**不能**用現有的 `esc()` helper
（那是給純文字用的，會把 SVG 的 `<` 跳成 `&lt;` 導致圖顯示不出來）。

## 不做的事（v1 範圍外）

- docx 匯出（`quizExport.ts` / `teacherExam.ts`）
- 學生詳解區塊（`QuizTaker.tsx` post-submit explanation）
- 老師成績頁（`ResultsResponseTable.tsx`）
- 老師手動編輯/新增圖解（圖解僅 AI 生成，v1 不提供手動編輯 UI）
- 遷移 `generate-questions` / `generate-from-file` 到 `textModel.ts`
- 引入通用 SVG sanitizer 套件

## 改動點清單

- `src/models/Schema.ts` — 加 `diagramSvg` 欄位
- `migrations/` — 新 migration（含手動 SQL 檢查）
- `src/lib/ai/diagramSvg.ts` — 新檔：4 個 template 渲染器 + escape + 安全檢查
- `src/app/api/ai/generate-questions/route.ts` — prompt 加規則 + 解析後呼叫渲染器
- `src/app/api/ai/generate-from-file/route.ts` — 同上
- `src/components/quiz/AIQuizModal.tsx` / `FileQuizGenerator.tsx` — `GeneratedQuestion`
  型別加 `diagramSvg?: string`，原樣透傳不處理
- `src/actions/questionActions.ts` — `QuestionInputSchema` 加 `diagramSvg`，兩處
  DB insert 帶入
- `src/features/quiz/QuizTaker.tsx` — 題目渲染區加 SVG 顯示
- `src/lib/exportPracticePage.ts` — HTML 模板嵌入

## 測試計畫

對應使用者要求：每個 checkpoint 做完貼 `build + check-types + lint + test` 四項
fresh 輸出，0 failures 才進下一段；checkpoint 3 走 test-driven-development，
先見紅再轉綠。

| Checkpoint | 內容 | 驗證方式 |
|---|---|---|
| 1. Schema | 加欄位 + migration | `npm run db:generate` 產出後手動檢查 SQL 無夾帶無關 diff，`npm run check-types` |
| 2. AI 生成 | prompt 規則 + `renderDiagramSvg` 4 個 template | 每種 diagram type 的渲染測試（給定資料 → 斷言輸出 SVG 結構/內容），`DiagramTooComplexError` 超上限測試 |
| 3. 安全 | `escapeSvgText` + `assertSvgSafe` | 先寫紅測試：塞入 `steps: ['正常步驟', '"><script>alert(1)</script>']` 跑完整 `renderDiagramSvg`，斷言輸出不含可執行的 `<script>` 標籤 → 看紅 → 補 escape 邏輯轉綠 |
| 4. 渲染 | `QuizTaker.tsx` 顯示 | `npm run dev` 手動出一題含圖題目確認顯示正常 + 型別檢查 |
| 5. Export | `exportPracticePage.ts` 嵌入 | 既有 `exportPracticePage.test.ts` 補一個含 `diagramSvg` 的案例 |

每段完成停下來等使用者 review 再繼續下一段。
