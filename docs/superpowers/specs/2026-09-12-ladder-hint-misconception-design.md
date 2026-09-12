# 蘇格拉底階梯提示 + 迷思概念診斷 — 設計文件

- 狀態：**凍結功能，待教師需求驗證通過後才實作**（此 spec 僅供驗證通過後直接照著做，不代表現在要動工）
- 日期：2026-09-12

## 背景與現況

專案裡已經有一套「蘇格拉底式 AI 教練提示」（commit `d7e7234`，已在 production）：

- `/api/hint/socratic`（`src/app/api/hint/socratic/route.ts`）：純無狀態 API，client 傳
  `question / correctAnswer / studentAnswer / roundNumber`，用 Gemini 2.5 Flash 生成「只反問、
  絕不給答案關鍵字」風格的提示，最多 3 輪，第 4 次直接回 `{ showExplanation: true }`。
- 觸發點：只在 `QuizTaker.tsx` 的 `RetakeWrongQuestions`（**提交測驗後的「錯題重做」流程**），
  不是在最初作答當下。
- 目前完全沒有伺服器端持久化：輪次計數只存在 React state，重新整理就歸零，沒有 DB 記錄，
  沒有 per-student/per-question 的伺服器端上限。

這次的新功能**沿用並改造**這套既有機制，而不是另開一套。同時發現兩個跟原始需求假設不符的地方，
已在 brainstorming 階段跟使用者確認並定案：

1. `question.framework`（108課綱/PISA/TOCFL 等）**沒有存進資料庫**，只是出題當下傳給 AI prompt
   的參數，出完題就消失。→ 迷思分類**不依賴 framework**，改用通用固定類別。
2. 現有提示是「只問不給資訊」的純問句風格，跟這次要的「漸進給資訊但不給答案」的階梯式提示是
   不同教學策略。→ **直接改寫既有 prompt 語意**，不是新增第二套平行機制。

## 範圍（已與使用者逐項確認）

- **觸發階段**：僅「錯題重做」流程（提交測驗後才會出現），**不**在學生原始作答當下觸發。
- **成本閘門**：每個 `(responseId, questionId)` 組合最多 3 次提示呼叫，伺服器端持久化計數
  （不再只靠前端 round state）。不另外加 rate limit（IP/room 層），單題上限已足夠，
  日後有濫用證據再加。
- **迷思分類依據**：不依賴 `question.framework`，用固定通用類別（見下），由 LLM 依「題目 + 正解 +
  學生錯答」判斷。
- **迷思分類觸發時機**：搭便車在第 1 輪提示呼叫時一併回傳，**不額外花錢**、**不是**在提交測驗時
  對所有錯答自動分類（那樣成本會跟學生數 × 錯題數成正比，太貴）。代價：老師 dashboard 看到的
  分布只涵蓋「有主動點提示」的學生，非全班錯答者。
- **不做的事**（明確排除，避免範圍蔓延）：
  - 不做「簡短理由」自由文字輸入框（原始需求提到的可選項）— 先靠選項本身 + 題目 + 正解分類。
  - 不新增獨立 rate limit 層。
  - 不新增獨立老師 dashboard 頁面，直接嵌入既有成績頁。
  - 不動 `src/libs/scoring.ts`，不影響任何計分路徑。

## 資料模型變更

`answer` 表（`src/models/Schema.ts`）新增兩欄，皆為向後相容的新增（nullable / 有預設值）：

```ts
export const answerSchema = pgTable('answer', {
  // ...既有欄位不動...
  misconceptionTag: text('misconception_tag'), // 固定類別 enum 值，nullable，未分類為 null
  hintCount: integer('hint_count').default(0).notNull(), // 伺服器端持久化提示呼叫次數
});
```

Migration 檔案放 `migrations/`（本專案慣例，非 `drizzle/`），比照近期
`migrations/20260912_diagram_svg.sql` 的命名與格式（每條 SQL 後加
`--> statement-breakpoint`，見 `[[feedback_drizzle_breakpoint_rule]]`）。

`misconceptionTag` 固定類別（通用、不綁科目，其餘值一律 fallback 成 `other`）：

| 值 | 中文說明 |
|---|---|
| `concept_confusion` | 概念混淆（把兩個相近概念搞混） |
| `misread_question` | 審題錯誤（看錯題目關鍵字/被干擾選項誤導） |
| `incomplete_logic` | 推理步驟遺漏（邏輯少一步） |
| `partial_understanding` | 部分理解（方向對但不完整） |
| `guessing` | 隨機猜測（答案與題目邏輯無關聯） |
| `other` | 其他/無法判斷 |

## API 合約變更

擴充現有 `/api/hint/socratic`（不新開 route）：

**現在**（無狀態）：
```
POST /api/hint/socratic
body: { question, correctAnswer, studentAnswer, roundNumber }
→ { hint, showExplanation }
```

**改成**（持久化 + 分類）：
```
POST /api/hint/socratic
body: { responseId, questionId, studentAnswer, roundNumber }
→ { hint, showExplanation, misconceptionTag? }  // misconceptionTag 只在 roundNumber===1 時回傳
```

Server 端邏輯：

1. 用 `responseId + questionId` 查 `answer` 表，驗證存在。查不到回 403（比照
   `generate-remedial` 現有的「傳 responseId，server 查表確認存在」信任模型 — 學生 QR
   零登入模型不變，不需要額外驗證身分）。
2. 驗證該 `answer.isCorrect === false`（只有答錯的題目允許要提示）。
3. 驗證 `answer.hintCount < 3`，達上限直接回 `{ showExplanation: true }`（不呼叫 LLM，不計費）。
4. 呼叫 Gemini 2.5 Flash（沿用 `@google/genai`，維持 `thinkingConfig: { thinkingBudget: 0 }` 關閉
   thinking mode 的既有作法）。
5. 成功後 `hintCount += 1`（atomic SQL increment，比照 marketplace `forkCount` 的既有寫法）。
6. `roundNumber === 1` 時，同一次 LLM 呼叫要求結構化輸出 `{ hint, misconceptionTag }`，
   分類結果寫回該 `answer` row。**分類失敗（LLM 回傳格式不對）不擋提示流程** —
   `misconceptionTag` 保持 null，`hint` 照樣回傳給學生。

## 提示內容設計（三階語意）

改寫現有 `SOCRATIC_SYSTEM_PROMPT`（從「只反問」換成「漸進給資訊但不給答案」）：

- **第 1 輪（方向）**：指出應該往哪個方向想、排除明顯不相關的干擾，不點名具體概念。
- **第 2 輪（概念）**：講出這題牽涉的關鍵概念名稱/原理，但不告訴學生怎麼套用到這一題。
- **第 3 輪（拆解步驟）**：把解題拆成步驟清單，但留白最後一步讓學生自己填
  （例如「① 先找出...② 再比較...③ 最後你覺得該選哪個？」）。
- **第 4 次（達上限）**：顯示解析，沿用現有 `showExplanation` 行為（不變）。

## 安全要求 + TDD 測試（硬性）

新增可獨立測試的函式（`src/lib/ai/ladderHint.ts` 或等價位置，把 prompt 組裝與後處理從
route handler 抽出來，方便不呼叫真實 API 就能測），依 `test-driven-development` skill 流程，
**先寫會失敗的測試看紅燈，再寫最小實作轉綠燈**：

1. **安全要件（最重要）**：三階提示文字都不能包含 `correctAnswer` 的原文子字串
   （大小寫、全形/半形正規化後比對）。這條測試必須有紅→綠證據，否則不算完成。
2. `misconceptionTag` 只能是上述 6 個固定值之一，其餘值一律 fallback 成 `other`。
3. `hintCount >= 3` 時函式/route 直接回 `showExplanation: true`，不觸發 LLM 呼叫
   （用 mock 驗證呼叫次數為 0）。
4. `answer.isCorrect !== false`（答對或 null）時拒絕生成提示。

## 學生端 UI（`QuizTaker.tsx`，擴充既有 `RetakeWrongQuestions`）

- 按鈕文案反映階梯語意：「請 AI 給個方向」→「再要更明確的提示」→「請 AI 拆解步驟」
  （第 4 次沒有按鈕，直接顯示解析區塊，沿用既有 UI 結構）。
- `fetchSocraticHint` 改傳 `responseId + questionId`（studentAnswer 仍需要文字化傳給 LLM）。
  `responseId` 目前沒有從父層傳進 `RetakeWrongQuestions`，需要新增 prop（來源：
  `result.responseId`，同一個已經給 `RemedialPractice` 用的值）。
- `SocraticHintState` 型別不變（`round / hint / showExplanation / isLoading`），前端仍逐階顯示，
  不一次全給。
- 提示/診斷全程不影響 `handleRetrySubmit` 的本機批改邏輯，錯題重做成績依舊「不計入正式統計」。

## 老師端 UI（`/dashboard/quizzes/[id]/results`，擴充既有 `QuestionBreakdownTable`）

- Server component 查詢加一行：`misconceptionTag: answerSchema.misconceptionTag`。
- 每題展開列（現有「選項分佈 BarChart」的展開區塊）新增一個小型 recharts BarChart，
  顯示該題各 `misconceptionTag` 的次數分布。
- 因為分類只在學生主動點提示時才產生，樣本數通常 < 錯題人數。UI 需明確標註
  「僅計入使用過 AI 提示的學生（N 人）」，避免老師誤以為是全班完整分布。
- 不新增獨立頁面，直接嵌入既有成績頁（YAGNI）。

## 驗證清單（照 `verification-before-completion` skill，每個 checkpoint 都要貼 fresh 輸出）

1. **Schema + migration**：`npm run db:generate` 後手動檢查 SQL 只含本次改動（比照
   `[[feedback_drizzle_breakpoint_rule]]` 提到的 snapshot 脫鉤問題，避免夾帶不相關 diff），
   本機 PGlite 跑過一次 migrate 無錯誤。
2. **安全測試紅→綠**：`ladderHint` 相關 test 先跑一次確認紅燈，實作後再跑一次確認綠燈，
   兩次輸出都要貼。
3. **完成前四項**：`npm run build && npm run check-types && npm run lint && npm run test`
   全部 fresh 輸出、0 failures。
4. 手動或 Playwright 驗證：錯題重做流程走三輪拿到方向/概念/拆解步驟提示、第 4 次強制顯示解析、
   老師成績頁能看到迷思分布圖表且樣本數標註正確。

## 後續（本次不做，留給日後真的需要時）

- 「簡短理由」自由文字輸入框，讓學生選錯答案後補一句話說明想法，喂給分類 LLM 提升準確度。
- IP/room 層級的 rate limit（如果日後真的觀察到濫用）。
- 對「未使用提示功能」的錯答也做迷思分類（需要重新評估成本模型，可能改成批次離線分類而非即時）。
