# AI 優先建立測驗入口 — 設計文件

**日期**：2026-04-25
**狀態**：設計確認完成，待實作

## 背景

目前 QuizFlow 的「建立測驗 / 建立新測驗」入口分散，有些直達 AI 命題畫面，有些還是先進 `/dashboard/quizzes/new` 中間頁，動線不一致。

老師日常最高頻的需求是 **AI 出題**，少數場景才會用手動出題或單字記憶模式。本次調整把所有「建立測驗 / 建立新測驗」按鈕統一改為直達 AI 命題畫面，把 `/new` 頁降成副選單，仍可從特定入口進入做手動 / vocab。

## 目標

- 所有「建立測驗 / 建立新測驗」按鈕點下後**直接進入 AI Modal**（即 `/dashboard/quizzes/[id]/edit?ai=1&just_created=1`）
- `/dashboard/quizzes/new` 頁面與 `QuizForm.tsx`（手動 / vocab / 標題範本）**完全保留**，僅改變進入路徑
- 維持既有 quota 處理、loading state、超量導 billing 的行為

## 範圍

### 要改的 3 個入口

| # | 檔案 / 位置 | 現況 | 改成 |
|---|------|------|------|
| 1 | `src/app/[locale]/(auth)/dashboard/page.tsx:144-149`（Dashboard 空狀態 `+ 建立新測驗`） | `<Link href="/dashboard/quizzes/new">` | 改用 `<CreateQuizWithAIButton>`，沿用相同樣式 className |
| 2 | `src/features/dashboard/templates/RecentQuizzesGrid.tsx:155-165`（虛線 `+ 建立新測驗` 卡片） | `<Link href="/dashboard/quizzes/new">` | 改用 `<CreateQuizWithAIButton>`，保留 dashed 卡片視覺 |
| 3 | `src/features/dashboard/templates/TemplateB.tsx:53-70`（第一張卡片「建立新測驗 — 手動出題」） | `<Link href="/dashboard/quizzes/new">` | 改名為「進階建立」（副標「手動出題、單字記憶」），仍連到 `/dashboard/quizzes/new`，作為副選單入口 |

### 要新增的 1 個副入口

| 位置 | 內容 |
|------|------|
| `src/app/[locale]/(auth)/dashboard/quizzes/page.tsx:91-139`（測驗列表頁標題列工具列） | 在主按鈕 `CreateQuizWithAIButton` 旁新增小字 ghost 連結「手動建立 ↗」連到 `/dashboard/quizzes/new`，僅在 `!isAtLimit` 時顯示 |

### 完全不動

- `src/app/[locale]/(auth)/dashboard/quizzes/new/page.tsx`（NewQuizPage）
- `src/features/quiz/QuizForm.tsx`（含 vocab 模式、標題範本）
- `src/actions/quizActions.ts`（`createQuiz` 邏輯與 redirect 不變）
- `src/features/quiz/CreateQuizWithAIButton.tsx`（重用即可，本次不改 props）
- `src/features/dashboard/templates/QuickCreateAIButton.tsx`（已是 AI 直達，保持原樣）
- 既有 i18n keys（`add_quiz_button`、`empty_button`、`new_quiz_button`、`message_state_button` 等）

## 實作細節

### 1. Dashboard 空狀態（`page.tsx:144-149`）

把 `<Link>` 換成 `<CreateQuizWithAIButton>`，className 沿用原本的 inline-flex 樣式。子元素文字用「+ 建立新測驗」（與原本一致，不動 i18n key）。

### 2. RecentQuizzesGrid 虛線卡片（`RecentQuizzesGrid.tsx:155-165`）

`<Link>` 換成 `<CreateQuizWithAIButton>`。原本的 dashed border + plus icon + 「建立新測驗」label 整段塞進 button children。pendingLabel 用「建立中…」即可。

### 3. TemplateB 第一張卡片（`TemplateB.tsx:53-70`）

保留 `<Link href="/dashboard/quizzes/new">` 結構，僅改文案：
- 標題：「進階建立」
- 副標：「手動出題、單字記憶模式」
- icon 維持原本的藍色加號（不換圖示，減少視覺改動風險）

### 4. 測驗列表頁副入口（`quizzes/page.tsx`）

在 `!isAtLimit` 分支內，主按鈕 `CreateQuizWithAIButton` **左側**加一個 `<Link href="/dashboard/quizzes/new">`，樣式為 `text-xs text-muted-foreground hover:text-foreground`，文字「手動建立 ↗」。維持小字次要動線，不搶主按鈕注意力。達上限時與主按鈕一起被「🔒 已達上限 · 升級」取代，不顯示副入口。

## i18n

本次新增的「進階建立」「手動出題、單字記憶模式」「手動建立」屬於新文案，需同步更新：
- `src/locales/zh.json`：加 `Dashboard.advanced_create_title`、`Dashboard.advanced_create_subtitle`、`Quizzes.manual_create_link`
- `src/locales/en.json`：對應 key 加英文翻譯（"Advanced create" / "Manual & vocab quiz" / "Manual create ↗"）

## 驗證

- [ ] Dashboard 空狀態按鈕點下進入 `/edit?ai=1&just_created=1` 並開啟 AI Modal
- [ ] RecentQuizzesGrid 虛線卡片點下進入 AI Modal
- [ ] TemplateB 第一張卡片連到 `/dashboard/quizzes/new`，可看到 QuizForm 並能進手動 / vocab
- [ ] TemplateB 第二張「AI 智慧出題」卡片不變，仍直達 AI Modal
- [ ] 測驗列表頁標題列：主按鈕直達 AI、左側「手動建立 ↗」連到 `/new`
- [ ] 免費方案達上限（10 份）時，主按鈕變「升級」狀態，副入口「手動建立 ↗」**也一併隱藏**（quota 是「總測驗數」上限，不論 AI 或手動都會佔額度，因此達上限時兩條建立動線都該隱藏）
- [ ] `/new` 頁原本所有功能（QuizForm 三段：直接開始 / vocab / 範本）行為不變
- [ ] zh / en 兩個 locale 文案皆顯示正常

## 風險與權衡

- **TemplateB 第一張卡片改名**：原本「建立新測驗 — 手動出題」是明確 CTA，改成「進階建立」對部分老師可能不夠直覺。但 QuickCreateAIButton 已是清楚的「AI 智慧出題」CTA，主動線不會被搶走。
- **副入口暴露程度**：測驗列表頁的「手動建立 ↗」用小字 ghost 樣式，刻意低調。若日後發現使用率過低，可考慮把它收進三點下拉選單。
- **YAGNI**：本次不做 `/new` 頁本身的調整、不改 `createQuiz` server action、不動 AI Modal 本身的行為。
