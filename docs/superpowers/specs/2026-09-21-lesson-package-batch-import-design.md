# 備課包批次匯入（Lesson Package Batch Import）設計文件

日期：2026-09-21
狀態：已核准設計，待寫實作計畫

## 背景與動機

`docs/prompts/lesson-prep-assistant.md` 是一份給老師複製貼到外部 AI 聊天工具（例如
Claude.ai 網頁版）用的 prompt，一次可以產出「診斷測驗、基礎/進階/挑戰練習、深化排序、
驗收測驗」共 6 份測驗 + 1 個單字卡集 + 教學筆記的完整 JSON。但目前 QuizFlow 完全沒有
任何地方能把這包 JSON 貼回系統：

- `AIQuizModal.tsx` 的四個分頁（主題/上傳講義/連結/題庫）都是呼叫系統自己的 API
  現場產生內容，不接受外部已經產好的 JSON。
- `createQuiz`（`src/actions/quizActions.ts:55-120`）跟 `createVocabSet`
  （`src/actions/vocabActions.ts:19-53`）都只處理「單一資源」，而且內建
  `redirect()`，不適合在迴圈裡呼叫 6 次。
- 沒有任何地方一次建立多份測驗（grep 確認過，`quiz.?bundle`/`批次(建立|匯入|生成)`
  等關鍵字只對應到既有的靜態範本系統或單一測驗的批次「插入題目」，跟這裡要做的
  「批次建立多份測驗」是兩回事）。

本設計新增一個「批次匯入備課包」功能，讓老師把上述 JSON 貼進一個新頁面，一次建立
6 份測驗 + 1 個單字卡集，並在畫面上顯示教學筆記。

## 架構總覽

- 新頁面：`src/app/[locale]/(auth)/dashboard/import/page.tsx`（textarea 貼 JSON + 送出）
- 新 Server Action：`src/actions/lessonPackageActions.ts` 匯出 `importLessonPackage(rawJson: string)`
- 新 Zod schema：驗證整包 JSON 結構（`{quizzes, flashcards, teacherNotes}`），檔案建議
  `src/lib/ai/lessonPackageSchema.ts`
- 抽出共用純函式 `buildQuestionInsertRows()`（新檔 `src/lib/quiz/questionRows.ts`），
  把現在寫死在 `src/app/api/quizzes/[id]/questions/route.ts:98-169` 的「題型 →
  DB 欄位」轉換邏輯抽出來，讓舊路由（單一測驗、由 AIQuizModal 觸發）跟新的批次
  匯入 action 共用同一套規則，不要維護兩份重複邏輯。這段邏輯目前完全沒有測試，
  抽出來的同時要補上單元測試。
- 入口：`src/app/[locale]/(auth)/dashboard/quizzes/page.tsx` 「建立測驗」按鈕旁加一個
  次要文字連結「批次匯入備課包 →」導向 `/dashboard/import`，不動現有按鈕/流程。

## 資料流

1. 老師在 `/dashboard/import` 貼 JSON，按送出，前端呼叫 `importLessonPackage(rawJson)`
2. Server Action 依序執行：
   a. `auth()` 取得 `userId`，未登入則照現有慣例處理
   b. `isProOrAbove(userId)` 檢查，否則回傳 `{ error: 'PRO_REQUIRED' }`
   c. `checkAndIncrementAiUsage(userId)`，否則回傳 `{ error: 'QUOTA_EXCEEDED' }`
      —— **整包 JSON 只消耗一次額度**，不是每份測驗各算一次
   d. `JSON.parse(rawJson)`，失敗回傳 `{ error: 'INVALID_JSON', detail }`
   e. 用 Zod schema `.safeParse()` 驗證整體結構（含逐題依 `type` 的欄位規則，
      例如 `rank` 題 `answer` 陣列長度必須等於 `options` 長度、`cloze` 題
      `question` 內文必須至少有一組 `[[ ]]` 標記），失敗回傳結構化錯誤陣列
      （`{path: 'quizzes[2].questions[1].answer', message: '...'}[]`），方便
      老師拿去跟外部 AI 說「幫我修 XXX」
   f. 驗證通過後，開一個 `db.transaction()`：
      - 對 `quizzes` 陣列逐一：insert 一列 `quizSchema`（`ownerId`、`title`、
        自動產生的 6 碼 room code + 8 碼 access code、`quizMode: 'standard'`），
        再用 `buildQuestionInsertRows(questions, quizId, 0)` 轉換該份題目並
        `insert` 到 `questionSchema`
      - insert 一列 `vocabSetSchema`（`ownerId`、`title`、access code、
        `status: 'published'`），再批次 insert `vocabCardSchema`
      - 任何一步 DB 錯誤，transaction 自動 rollback，不留部分資料
   g. 成功回傳 `{ quizzes: [{id, title}], vocabSetId, vocabTitle, teacherNotes }`
      （不呼叫 `redirect()`，因為要在同一頁列出多個連結）
3. 前端顯示「匯入完成」結果畫面：6 個測驗連結（可直接點進去編輯/檢視）、1 個
   單字卡集連結、教學筆記原文（純文字顯示，並標示「請自行複製保存，離開此頁
   不會保留」——`teacherNotes` 不寫入資料庫）

## 錯誤處理

| 情境 | 處理方式 |
|---|---|
| 非 Pro 方案 | 回傳 `PRO_REQUIRED`，前端導向 `/dashboard/billing`（沿用 `CreateQuizWithAIButton` 現有模式） |
| AI 額度用完 | 回傳 `QUOTA_EXCEEDED`，同上導向 billing |
| JSON 語法錯誤 | 顯示「JSON 格式錯誤，請確認貼上完整內容」+ 原始 parse 錯誤訊息 |
| Zod 結構驗證失敗 | 逐條列出「第幾份測驗、第幾題、哪個欄位」，視為可預期的使用者輸入錯誤，不當系統錯誤處理 |
| DB insert 失敗（少見，如唯一鍵衝突） | transaction rollback，顯示「匯入失敗，請重試」 |

## 測試計畫（TDD）

1. `buildQuestionInsertRows` 單元測試：涵蓋 `mc`/`tf`/`short`/`rank`/`cloze`/
   `listening` 六種 type 的正確轉換規則（先寫會失敗的測試，比照
   `src/libs/scoring.ts` 的 19-test 模式）
2. Zod schema 測試：合法輸入 + 常見不合法輸入案例（缺欄位、`type` 打錯、
   `rank` 的 `answer`/`options` 長度不符等）
3. `importLessonPackage` 整合測試（PGlite）：
   - 成功匯入：驗證建立 6 份 quiz、各份題數正確、1 個 vocab set 建立成功
   - Pro 方案檢查擋下非 Pro 使用者
   - AI 額度用完時擋下
   - 其中一份測驗資料壞掉時，驗證 transaction 完整 rollback（DB 裡完全沒有
     殘留任何一份 quiz/question/vocab 資料）

## 明確排除的範圍（YAGNI，本次不做）

- 不自動套用「平均配分」（`distributePoints`）——沿用現有匯入行為，每題預設
  1 分，老師可事後自己在各測驗按「平均配分」
- 不檢查「Free 方案最多 3 個測驗」的總數上限——本功能限 Pro 方案，Pro 的
  測驗數量額度足夠寬鬆，之後真的需要再補
- `teacherNotes` 不建立對應資料表持久化，只在匯入完成當下顯示一次
- 不處理 `multiple_choice`（複選）題型的批次匯入（跟既有單一測驗匯入路徑
  一致，目前系統對複選題的匯入邏輯本來就不保證正確）

## 影響的既有檔案

- `src/app/api/quizzes/[id]/questions/route.ts`：把 `98-169` 行的題型轉換邏輯
  抽到 `src/lib/quiz/questionRows.ts`，路由本身改成呼叫這個共用函式（行為不變，
  純重構）
- `src/app/[locale]/(auth)/dashboard/quizzes/page.tsx`：加一個次要文字連結

## 新增檔案

- `src/app/[locale]/(auth)/dashboard/import/page.tsx`
- `src/actions/lessonPackageActions.ts`
- `src/lib/ai/lessonPackageSchema.ts`
- `src/lib/quiz/questionRows.ts`
- 對應測試檔（依專案慣例放在同目錄或 `__tests__`）
