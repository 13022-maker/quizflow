# 段考考卷 Word 匯出 — 設計

日期：2026-06-08
狀態：設計確認，待實作

## 目標

新增「段考考卷」Word 匯出選項，套用既有 `src/libs/teacherExam.ts`（啟英高中試卷模板），
讓老師一鍵把 QuizFlow 測驗輸出成符合學校段考格式的 .docx（B4 紙、頁首勾選欄、答案欄、頁尾頁碼）。

參照來源：`114第1 段考程式語言實習試題(僑資二甲).docx`

## 背景

- `teacherExam.ts`（PR #61）已實作學校模板，有測試（`teacherExam.test.ts`），但**從未接進匯出流程**。
- 目前匯出 route（`/api/quizzes/[id]/export`）走簡易版 `generateQuizDocx`，選單在 `QuizEditor.tsx` 下拉。
- `teacherExam.ts` 現有缺口：只支援單選題（固定 A–D）、配分文字寫死「每格4分共100分」、答案欄固定 30 格、無簡答區、無 teacher/student 變體。

## 決策（已與使用者確認）

1. **頁首來源：寫死成參照值。** 集中放在映射檔頂端常數區，方便日後手改或在 Word 直接改。
   - school=啟英高中、academicYear=114、semester=1、examPeriod=期初、subject=程式語言、
     classType=僑生班、applicableClass=僑資二甲B班、teacherName=謝金洪、scope=ch1~ch3
2. **匯出入口：新增選項。** 現有「老師版／學生版」簡易匯出不動，另加段考考卷項目。
3. **非選擇題：另闢一區。** 選擇題進「一、選擇題」+答案欄；簡答/填空進「二、簡答題」。
4. **段考分學生卷／老師卷（選 B）。** 選單放兩個連結，沿用 `variant`。
   - 學生卷：答案欄空白、簡答留作答線（＝參照那份空白卷）
   - 老師卷：答案欄預填正解字母、簡答顯示參考答案

## 實作範圍

### 1. `src/libs/teacherExam.ts`（擴充）

- `TeacherExamInput` 調整：
  - `questions`：選項由固定 `{A,B,C,D}` 改為 `options: string[]`（支援 N 選項）+ 每題 `points`、`answerIndex`（正解，老師卷用）
  - 新增 `variant: 'teacher' | 'student'`
  - 新增 `shortAnswers?: { stem: string; points: number; refAnswer?: string }[]`
  - 配分相關欄位移除硬編：由題目分數計算
- `buildQuestion`：支援 N 選項，標籤自動 (A)(B)(C)… 由 index 產生。
- 配分文字：依選擇題分數加總算「(每格 X 分共 Y 分)」；每題同分顯示每格分，否則顯示「(共 Y 分)」。
- `buildAnswerGrid`：依選擇題題數動態產生列數（每列 10 格，題號 1…N，最後一列多餘格留空）。老師卷在格內預填正解字母。
- 新增 `buildShortAnswerSection`：有簡答題時加「二、簡答題(每題…)」+ 逐題題幹；學生卷留作答線、老師卷顯示參考答案。
- 主流程依 `variant` 組裝。

### 2. 新增映射 `src/libs/quizExamMapper.ts`（或併入 export route）

- 把 quiz + questions（DB）轉成 `TeacherExamInput`。
- 頁首常數寫死於此檔頂端（清楚標示）。
- 題型映射：
  - single_choice / multiple_choice → 選擇題（多選照列全部選項）
  - true_false → 選擇題，選項自動 `(A)正確 (B)錯誤`
  - short_answer / fill → 簡答區
  - ranking → 暫不支援，略過（與簡易匯出一致行為，必要時日後補）
- 正解：由 question.correctAnswers 對映選項 index（老師卷用）。

### 3. `src/app/api/quizzes/[id]/export/route.ts`

- 加 `format` 參數：`format=exam` 走段考產生器，否則沿用 `generateQuizDocx`。
- 沿用既有所有權驗證、`variant`、檔名安全化（檔名後綴改「段考_老師卷／段考_學生卷」）。

### 4. `src/features/quiz/QuizEditor.tsx`

- 下拉選單在現有兩個匯出項下方，新增兩個：
  - 「📝 段考考卷（學生卷）」→ `?format=exam&variant=student`
  - 「📝 段考考卷（老師卷）」→ `?format=exam&variant=teacher`

### 5. 測試

- 更新 `teacherExam.test.ts` 以符合新型別（N 選項、variant、簡答區、動態答案欄）。
- 至少涵蓋：純選擇題、含簡答題、老師卷預填答案、選擇題數非 10 倍數時答案欄補空格。

## 不做（YAGNI）

- ranking 題進考卷（沿用簡易匯出的略過行為）。
- 頁首欄位 UI / 存 DB（本次寫死）。
- 簡答區的程式碼填空特殊模板（參照卷的 code 模板是手刻內容，非 quiz 資料可生成）。

## 風險 / 注意

- 改 `TeacherExamInput` 型別會動到既有測試，需同步更新。
- 全形空白（U+3000）排版需保留（檔案已 `eslint-disable no-irregular-whitespace`）。
- 答案欄寬度依 B4 內容寬計算，沿用現有 COL_WIDTH 邏輯。
