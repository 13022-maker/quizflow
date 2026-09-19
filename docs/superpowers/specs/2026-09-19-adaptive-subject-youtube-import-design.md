# 適性學習「AI 生成學科」加入 YouTube 匯入 設計文件

- 日期：2026-09-19
- 起因：老師想直接用 YouTube 教學影片（單支或多支）生成適性學習學科，AI 自動拆 KC（知識點）、
  補強課文、依 Bloom 認知層次分類的題庫，並讓每個 KC 對應到來源影片的關鍵片段，學生卡關補強時
  可以「重看關鍵片段」跳回該段影片。
- 範圍：只加 YouTube 匯入這條新路徑；不動既有「貼文字」「上傳檔案」兩種模式的程式碼與行為；
  不動一般測驗出題（`generate-from-url`）既有的單支影片匯入功能。

## 使用者決策（brainstorming 階段已確認）

1. **逐字稿抽取**：沿用現有免費的 `youtube-transcript` 套件（`generate-from-url/route.ts`
   已經在用、直連 YouTube 抓字幕），不換成付費第三方 transcript API。
2. **Playlist**：第一版**不做真的 playlist 解析**。老師直接貼多支「單支影片」URL（換行分隔），
   前端限制最多 **5 支**。整個匯入**同步跑完，不做 queue／背景任務／進度輪詢**。
3. **Bloom 分類**：**要真的加** Bloom's Taxonomy 六層標籤（記憶/理解/應用/分析/評鑑/創造），
   加在每一題上。這跟 `tutor.ts` 裡提到的「Bloom」（開源專案 Li-Evan/Bloom，教學風格）是兩回事，
   避免混淆——本次加的是認知層次標籤，不影響 `tutor.ts` 的既有邏輯。
4. **重看關鍵片段入口**：只在「卡關補強課文」畫面顯示，一般答題畫面不顯示。

## 現況重點（供對照，不是本次改動）

- `adaptive_subject` 目前**沒有** `status`（草稿/發佈）欄位、**沒有**來源 URL 欄位——
  只要生成成功就直接可被選來建立 `adaptive_practice`（產生 accessCode 開免登入連結）。
- 現有「AI 生成學科」（文字/檔案模式）走 `generateSubject()`（`src/libs/adaptive/generate-subject.ts`），
  **沒有 AI quota 檢查**（2026-08-28 spec 明確決定不加，維持一致）。本次 YouTube 模式因為多一道
  抽字幕成本、且使用者明確要求「整個過程計入 AI quota」，**會**加 quota 檢查——這是刻意的例外，
  不是把 quota 補回其他兩個模式。
- 補強課文（`RemedialLesson`）是學生答題卡關時**即時生成、不落地存 DB**（只存在伺服器記憶體），
  由 `BloomTutorLayer.getNextStep()`（`src/libs/adaptive/tutor.ts`）觸發。
- `generate-from-url/route.ts`（一般測驗出題的 YouTube 匯入）已有 `extractYouTubeId`／
  `classifyYouTubeError`／字幕擷取，但**丟棄 timestamp**、只支援單支影片。本次刻意**不去動這個
  既有檔案**，避免影響現有出題功能；新功能改在 `src/libs/youtube.ts` 另外實作一份精簡版
  （犧牲一點程式碼重複，換取「不動到已經在跑的功能」）。

## 架構

```
NewSubjectForm.tsx（新增第三個 tab：貼文字 / 上傳檔案 / 從 YouTube 匯入）
  └─ YouTube 模式 ──▶ generateAdaptiveSubjectFromYouTube(topic, videoUrls[])  [新 server action]
                          │
                          ├─ checkAndIncrementAiUsage(userId)                 [quota，新加]
                          ├─ 逐支影片：fetchYouTubeTranscriptSegments(videoId) [src/libs/youtube.ts，新]
                          ├─ buildTimestampedTranscript(videos[])             [清洗＋合併＋加 timestamp 標記]
                          ├─ generateSubjectFromYoutube(topic, transcript, videoIds)
                          │     [src/libs/adaptive/generate-subject-from-youtube.ts，新]
                          │     └─ generateAIText()（沿用既有 Claude/Gemini 分流，不用另建）
                          └─ saveGeneratedYoutubeSubject(userId, topic, generated, videoUrls)
                                                                                     [新 helper，不動既有 saveGeneratedSubject]

學科管理頁（/dashboard/adaptive/subjects）
  └─ 草稿學科顯示「草稿」badge + 「審核並發佈」按鈕 ──▶ publishAdaptiveSubject(subjectId) [新 action]

建立適性練習（createAdaptivePractice）
  └─ assertSubjectUsable() 多檢查一項：status !== 'published' 就拒絕      [擴充既有檢查]
  └─ listAvailableSubjects() 下拉選單只列 status = 'published' 的自建學科  [擴充既有查詢]

答題端：卡關補強課文
  BloomTutorLayer.getNextStep()（tutor.ts）
    生成 lesson 後，從 this.graph.nodes 找到對應 KnowledgeNode.videoRef，
    塞進 lesson.videoRef 一起回傳（toClientStep 對 type:'lesson' 不做欄位剝除，直接透傳）
  AdaptiveLearnClient.tsx 補強課文卡片
    有 lesson.videoRef 才顯示「▶️ 重看關鍵片段」按鈕，YouTube IFrame Player API 內嵌播放＋seek
```

## 改動點

### 1. Schema migration — `adaptive_subject` 新增兩欄位

```ts
// src/models/Schema.ts（adaptiveSubjectSchema）
status: text('status').$type<'draft' | 'published'>().default('published').notNull(),
sourceUrls: jsonb('source_urls').$type<string[]>(), // YouTube 匯入才有值，其餘模式維持 null
```

- `status` 預設 `'published'`：既有文字/檔案模式生成的學科行為完全不變（一律視為已發佈）。
  只有新的 YouTube 匯入路徑會明確寫入 `'draft'`。
- 加 CHECK 約束限制只能是 `'draft'`／`'published'`（比照 `vocabSetSchema.status` 現有寫法，
  用 text + CHECK 而非 `pgEnum`，避免 PG enum 加新值要 `ALTER TYPE` 的既有痛點）。
- `graph.nodes[]` 的 TS 型別（`engine.ts` 的 `KnowledgeNode`）新增可選欄位
  `videoRef?: { videoId: string; startSec: number; endSec: number }`——純 TS 型別擴充，
  JSONB 欄位本身不用 migration。
- `itemBank.items[]` 的 `Item` 型別（`engine.ts`）新增
  `bloomLevel?: '記憶' | '理解' | '應用' | '分析' | '評鑑' | '創造'`（可選，文字/檔案模式產出的
  舊資料與新資料都不會因為缺這欄位而炸型別檢查）。
- 執行 `npm run db:generate` 後**務必手動檢視產生的 SQL**，比照 CLAUDE.md 記錄的已知問題
  （`migrations/meta/` snapshot 脫鉤），刪掉任何不屬於本次改動、被誤帶進來的
  CREATE/ALTER TABLE。

### 2. `src/libs/youtube.ts`（新檔）— 保留 timestamp 的抽字幕與清洗

```ts
export function extractYouTubeId(url: string): string | null
export function classifyYouTubeError(err: unknown): string
export async function fetchYouTubeTranscriptSegments(
  videoId: string
): Promise<{ text: string; offset: number; duration: number }[]>
  // 同現有 fetchYouTubeTranscript 的 zh-TW → zh → 自動偵測 fallback 鏈，
  // 但回傳完整 segments（保留 offset/duration），不 join 成純文字
export function buildTimestampedTranscript(
  videos: { videoId: string; segments: { text: string; offset: number }[] }[]
): string
  // 每支影片的 segments 依時間分桶（約 20 秒一桶，減少 token 量又保留可定位精度），
  // 輸出格式：
  //   === 影片 1：{videoId} ===
  //   [t=0s] ……
  //   [t=23s] ……
  // 多支影片依序串接；總長度沿用現有 20000 字元上限（超過直接截斷，
  // 跟文字模式 `<教材>` 截斷邏輯一致，不特別做智慧摘要）
```

`extractYouTubeId`／`classifyYouTubeError` 跟 `generate-from-url/route.ts` 裡的版本邏輯相同、
**刻意重複實作**而非抽出共用（見上方「現況重點」的說明），换取不去碰既有已經在跑的一般出題功能。

### 3. `src/libs/adaptive/generate-subject-from-youtube.ts`（新檔）

不修改 `generate-subject.ts` 既有的 `generatedSubjectSchema` / `SYSTEM_PROMPT` /
`generateSubject()`（文字、檔案模式完全不受影響），改用獨立的一份：

```ts
const youtubeGeneratedSubjectSchema = z.object({
  name: z.string().min(1).max(40),
  knowledgePoints: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1).max(30),
    prerequisites: z.array(z.string()),
    videoRef: z.object({
      videoId: z.string(),
      startSec: z.number().min(0),
      endSec: z.number().min(0),
    }).optional(), // 沒有明顯對應片段時可留空，不強求每個 KC 都要有
  })).min(3).max(5),
  items: z.array(z.object({
    id: z.string().min(1),
    knowledgeId: z.string(),
    difficulty: z.number().min(0.1).max(1),
    prompt: z.string().min(1),
    options: z.array(z.string().min(1)).length(4),
    answerIndex: z.number().int().min(0).max(3),
    explanation: z.string().min(1),
    bloomLevel: z.enum(['記憶', '理解', '應用', '分析', '評鑑', '創造']),
  })).min(9),
  tutor: z.object({ lessonExampleRule: z.string().min(1), formatRule: z.string().min(1) }),
});
```

- `YOUTUBE_SYSTEM_PROMPT`：以既有 `SYSTEM_PROMPT` 為基礎修改，額外規則：
  - 教材是「帶時間戳的影片逐字稿」，輸出的 `knowledgePoints[].videoRef` 必須引用實際出現在
    逐字稿裡的 `videoId` 與時間範圍（`startSec`/`endSec` 落在該片段附近，抓一段約 30~90 秒、
    足以完整講解該知識點的範圍），沒有明確對應片段就不要硬湊、留空即可。
  - 每題新增 `bloomLevel`，六層需求跟現有「answerIndex 分散」鐵則並列（同一知識點內盡量覆蓋
    多種層次，不要全部都是「記憶」層級的選擇題）。
  - 其餘六條設計鐵則（3~5 個知識點、每點 5~8 題、難度光譜、4 選項、繁中、禁 LaTeX）原樣沿用。
- `validateYoutubeSemantics()`：複製既有 `validateSemantics` 的知識點引用／題目數量／DAG 檢查
  （呼叫 `AdaptiveEngine` 建構驗證），另外加：`videoRef.videoId` 必須存在於本次傳入的
  `videoIds` 清單裡，`startSec < endSec`。
- `generateSubjectFromYoutube(topic, transcript, videoIds)`：架構照抄 `generateSubject()`
  （呼叫 `generateAIText`、`extractJson`、失敗重試一次帶錯誤訊息），`extractJson` 從
  `generate-subject.ts` **改成 export** 讓兩邊共用（純函式、零行為風險）；
  `friendlyAIGenerationError` 已經是 export，直接重用。回傳型別
  `export type YoutubeGeneratedSubject = z.infer<typeof youtubeGeneratedSubjectSchema>;`。

**注意（自我校閱抓到的坑）**：既有 `toSubject()`（`generate-subject.ts`）組 `graph.nodes` 時
明確只挑 `{id, name, prerequisites}` 三個欄位——如果直接沿用它，`videoRef` 會在存檔這一步被
悄悄丟掉，導致「重看關鍵片段」功能整個失效卻不會有任何錯誤訊息。因此**不重用** `toSubject()`／
`saveGeneratedSubject()`，YouTube 模式的存檔邏輯（見下一節）另外寫一份，明確把 `videoRef`／
`bloomLevel`／`sourceUrls`／`status` 都放進去。

### 4. `src/actions/adaptiveActions.ts` — 擴充

- `saveGeneratedSubject()`（既有文字／檔案模式共用的存檔 helper）**完全不動**。

- 新增 `saveGeneratedYoutubeSubject(userId, topic, generated: YoutubeGeneratedSubject, videoUrls: string[])`：
  跟既有 `saveGeneratedSubject` 平行的一份獨立存檔邏輯（重新驗證登入身份的部分照抄），
  差別在組 `graph`/`itemBank` 時**手動保留** `videoRef`／`bloomLevel`：

  ```ts
  const graph = {
    nodes: generated.knowledgePoints.map(k => ({
      id: k.id, name: k.name, prerequisites: k.prerequisites, videoRef: k.videoRef,
    })),
  };
  const itemBank = { items: generated.items }; // items 本來就整包指派，bloomLevel 不會被丟掉
  await db.insert(adaptiveSubjectSchema).values({
    ownerId: userId, name: generated.name, sourceTopic: topic,
    graph, itemBank, tutor: generated.tutor,
    sourceUrls: videoUrls, status: 'draft',
  }).returning();
  ```

- 新增 `generateAdaptiveSubjectFromYoutube(input: { topic: string; videoUrls: string[] })`：
  1. zod 驗證：`topic` 同既有規則；`videoUrls` 陣列 1~5 支，每支跑 `extractYouTubeId` 驗證格式。
  2. `checkAndIncrementAiUsage(userId)`，`allowed:false` 直接回 `{ error: reason }`（整個匯入
     算一次額度，不因為貼了幾支影片而扣多點）。
  3. 逐支影片呼叫 `fetchYouTubeTranscriptSegments`，任一支失敗就整批中止（不做部分略過），
     回傳哪支 URL、什麼原因（`classifyYouTubeError`）。
  4. `buildTimestampedTranscript()` 組合教材 → `generateSubjectFromYoutube()`。
  5. 成功 → `saveGeneratedYoutubeSubject(userId, topic, generated, videoUrls)`。
- 新增 `publishAdaptiveSubject(subjectId: number)`：驗證擁有者 → 把 `status` 從 `draft` 改成
  `published`（`published` 狀態再呼叫視同 no-op，不拋錯，方便前端重複點擊不出錯）。
- `assertSubjectUsable()` 多一項檢查：查出的 row 若 `status !== 'published'`，丟
  `新學科尚未發佈，請先到「學科管理」頁審核發佈`。
- `listAvailableSubjects()` 的自建學科查詢加 `eq(adaptiveSubjectSchema.status, 'published')`
  條件——草稿學科不會出現在「建立適性練習」下拉選單，逼老師一定要先去管理頁審核發佈。

### 5. `NewSubjectForm.tsx` — 加「從 YouTube 匯入」UI

- 教材來源從現有「貼文字／上傳檔案」二選一 tab，改成三選一：**貼文字／上傳檔案／從 YouTube 匯入**。
- YouTube 模式：一個多行 `<textarea>`，一行一支影片 URL；前端即時驗證每一行（`extractYouTubeId`
  邏輯搬一份到 client，或簡化成純正則），非法格式（含貼 playlist 網址、格式不對）標紅提示；
  超過 5 支擋在送出前。
- 送出 → 呼叫 `generateAdaptiveSubjectFromYoutube` server action，沿用既有「生成中…（約需
  1~3 分鐘）／✅ 已生成」狀態機（跟文字/檔案模式共用同一組 `generating`/`result`/`error` UI）。
  這個 action 所在檔案需要 `export const maxDuration = 300`（Server Action 可在同檔案宣告；
  比照 `src/app/api/test/generate-subject/route.ts` 既有的正確設定值，這個 bug 不在本次修範圍，
  只確保新路徑一開始就設對）。
- 生成成功後的摘要畫面加一行提示：「⚠️ 這是草稿，需要到「學科管理」頁審核發佈後才能建立練習」。

### 6. 學科管理頁（`/dashboard/adaptive/subjects`）— 草稿標示與發佈

- `listMySubjectsForManagement()` 回傳值加 `status` 欄位。
- 列表每筆草稿學科顯示「📝 草稿」badge + 「✅ 審核並發佈」按鈕（呼叫 `publishAdaptiveSubject`）。
- 已發佈學科不顯示這顆按鈕（避免誤觸「取消發佈」——本次不做 unpublish，YAGNI，見下方）。

### 7. 答題端 — 補強課文加「重看關鍵片段」

- `engine.ts`：`KnowledgeNode` 型別加 `videoRef?: { videoId: string; startSec: number; endSec: number }`。
- `tutor.ts`：`RemedialLesson` 型別加同形狀的可選 `videoRef`；`BloomTutorLayer.getNextStep()`
  在 `const lesson = await this.tutor.generateLesson(...)` 之後、`pendingLessons.set(...)` 之前，
  加一行 `lesson.videoRef = node.videoRef;`（`node` 已經是同一個函式裡查出來的 `KnowledgeNode`，
  不用額外查詢）。`ClaudeTutorProvider`／`TemplateTutorProvider` 完全不用改——影片資訊是
  `BloomTutorLayer` 事後貼上去的，不影響課文生成本身。
- `service.ts` 的 `toClientStep()` 對 `type: 'lesson'` 不做欄位剝除，`videoRef` 會直接透傳到
  前端，這段不用改。
- `AdaptiveLearnClient.tsx` 補強課文卡片（L577-582 header badge 區）：`step.lesson.videoRef`
  存在時，在「📖 補強課文」badge 旁加「▶️ 重看關鍵片段」按鈕，點擊後在卡片內展開一個
  YouTube IFrame Player（`https://www.youtube.com/iframe_api`，動態載入一次），
  `loadVideoById({ videoId, startSeconds: startSec, endSeconds: endSec })`。沒有 `videoRef`
  就不顯示按鈕（文字/檔案模式產生的學科、或 LLM 沒標出片段的 KC，維持現況不受影響）。
  行動裝置走同一顆 `<iframe>`，YouTube Player API 本身就是 mobile-friendly，不用另外做
  deep-link fallback。

## 資料流

1. 老師在「從 YouTube 匯入」貼 1~5 支單支影片 URL + 單元主題，送出。
2. `generateAdaptiveSubjectFromYoutube`：quota 檢查 → 逐支抽字幕（保留 timestamp）→ 清洗分桶
   合併成一份帶時間戳的教材文字。
3. 餵給 `YOUTUBE_SYSTEM_PROMPT` → `generateAIText()`（Claude/Gemini 分流，跟其他模式共用同一
   個統一入口）→ 一次吐出知識圖譜（含 `videoRef`）+ 題庫（含 `bloomLevel`）+ 導師風格規則。
4. zod 結構驗證 + 語意驗證（含 `videoRef` 合法性）+ `AdaptiveEngine` 建構驗 DAG，失敗重試一次。
5. `saveGeneratedYoutubeSubject(userId, topic, generated, videoUrls)` 寫入 `adaptive_subject`
   （`status: 'draft'`）。
6. 老師到「學科管理」頁看到草稿 badge，確認內容後按「審核並發佈」→ `status` 變 `published`。
7. 老師建立「適性練習」時，下拉選單只列已發佈學科；`assertSubjectUsable` 再把關一次。
8. 學生作答，卡關觸發補強課文，`videoRef` 隨課文一起送到前端，顯示「重看關鍵片段」內嵌播放。

## 錯誤處理

- URL 格式不對／貼了 playlist 網址／超過 5 支：前端擋在送出前，訊息直接告訴老師哪一行有問題。
- AI quota 用盡：回傳現有 `checkAndIncrementAiUsage` 的 `reason` 文字，UI 顯示同既有 quota
  不足時的樣式（沿用 `AiQuotaBanner` 附近既有文案風格）。
- 任一支影片抽字幕失敗（無字幕/私人/不存在/YouTube 暫時無法讀取）：**整批中止**，明確標出是
  第幾支、哪個 URL、什麼原因（`classifyYouTubeError`），不做「失敗的跳過、其餘照跑」——
  符合專案「優先最簡單解法」的偏好，老師拿掉那支重新送出即可。
- LLM 產出的 `videoRef` 指到沒送進去的 `videoId`，或 `startSec >= endSec`：視同結構驗證失敗，
  比照既有邏輯重試一次，兩次都失敗才回錯誤給老師。
- Server Action 逾時（>300s）：Vercel 層級的例外，前端顯示「生成逾時，請減少影片數量或縮短
  單元範圍再試」（沿用既有 AI 生成失敗的錯誤呈現方式，不特別為 timeout 做專屬 UI）。

## 測試

比照專案 TDD 慣例，先寫會失敗的 test 再實作：

- `src/libs/youtube.ts`：`extractYouTubeId`（各種 URL 格式 + playlist 網址應回傳 null）、
  `buildTimestampedTranscript`（多影片合併格式、20000 字元截斷邏輯、分桶時間戳正確性）。
- `src/libs/adaptive/generate-subject-from-youtube.ts`：`validateYoutubeSemantics`（videoRef
  指向不存在 videoId 應丟錯、startSec>=endSec 應丟錯、其餘沿用既有 `validateSemantics` 的
  測試案例：知識點引用、題目數量下限、DAG 循環偵測）。
- `src/actions/adaptiveActions.ts`：
  - `assertSubjectUsable` 對 `status='draft'` 的學科應拒絕。
  - `listAvailableSubjects` 不應回傳草稿學科。
  - `publishAdaptiveSubject` 只有擁有者能發佈、發佈後 `status` 正確變更、重複呼叫不拋錯。
  - `generateAdaptiveSubjectFromYoutube` 的 quota 用盡分支（mock `checkAndIncrementAiUsage`
    回傳 `allowed:false`）應直接回錯誤、不呼叫 AI。
- `npm run lint`、`npm run check-types`、`npm run test` 需全過。
- 手動驗證（瀏覽器實跑）：
  1. 貼 1 支有繁中字幕的教學影片，生成學科，確認至少一個知識點有 `videoRef`、題目有
     `bloomLevel` 標籤、學科狀態是草稿。
  2. 貼 3 支影片一次生成，確認知識點分別對應到不同支影片（`videoId` 不同）。
  3. 貼一支關閉字幕的影片，確認錯誤訊息清楚可行動。
  4. 「學科管理」頁按「審核並發佈」，確認能在「建立適性練習」下拉選單看到它；發佈前應該看不到。
  5. 模擬學生連錯 2 題觸發補強課文，確認「重看關鍵片段」按鈕出現且能正確 seek 到片段起點、
     手機瀏覽器（或 DevTools 手機模擬）點擊可正常播放。
  6. 確認「貼文字」「上傳檔案」兩種既有模式完全沒被動到（既有流程照跑、無 quota 檢查行為不變）。

## 不做（YAGNI）

- 不做真正的 playlist 自動展開（不接 YouTube Data API v3），第一版老師手動貼多支影片網址。
- 不做背景任務／queue／進度輪詢，超過 300 秒就是失敗，請老師減少影片數量重試。
- 不做「取消發佈」（unpublish 回草稿），發佈是單向操作，如果老師想下架，本次沿用既有的
  「封存」（`archivedAt`）機制即可，不用另外做一套狀態切換。
- 不把 `videoRef`／`bloomLevel` 補標到既有文字／檔案模式產生的學科（純新增，不回溯既有資料）。
- 不做一般答題畫面（非卡關補強）的重看片段入口。
- 不去修 `generate-from-url/route.ts`（一般測驗出題的既有 YouTube 匯入功能）本身的
  `maxDuration=60`／丟棄 timestamp 等既有行為，範圍外。
- 不换第三方付費 transcript API（沿用免費套件的決策，若日後真的常態性被 Vercel IP block，
  再另開一次 spike 評估換 API）。
