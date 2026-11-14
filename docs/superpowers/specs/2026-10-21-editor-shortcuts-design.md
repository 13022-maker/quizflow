# 命題編輯快捷鍵設計（QuizEditor + 段考命題助手）

日期：2026-10-21
狀態：段考命題助手（`public/tools/exam-composer.html`）**已實作**；QuizEditor **待實作**（本文件為規格）

## 原則

- 不加套件（專案無 hotkey library），自寫 `useEditorShortcuts` hook。
- 修飾鍵統一 Mod = Win `Ctrl` / Mac `⌘`；比對一律用 `KeyboardEvent.code`（Mac `⌥+字母` 的 `e.key` 會變特殊字元），只有 `?` 用 `e.key`。
- IME guard：`e.isComposing || e.keyCode === 229` 直接 return（Safari 選字確認那下 `isComposing` 為 false，所以兩個都要檢查）。
- 單鍵（J/K/`/`/`?`）只在焦點不在 input/textarea/select 時生效；有 Alt/Mod 的組合在輸入框內也生效。
- 不攔截：`Mod+S/T/W/N/D/R/L/P/Z`、`Mod+Shift+↑↓`（文字選取）、`Alt+←→`（上一頁）、單獨的 `Alt+Shift`（Windows 切換輸入法）。
- 「題目」類快捷鍵作用在 active 題（點擊／焦點進入卡片時設定，卡片加 ring 樣式）。

## 快捷鍵表

| 快捷鍵（Win / Mac） | 動作 | 範圍 | 優先級 |
|---|---|---|---|
| `Alt+↓` `Alt+↑`；`J` `K`（非輸入中） | 下一題／上一題 | 兩者 | P0 |
| `Alt+Shift+↓` `Alt+Shift+↑` | 本題下移／上移 | 兩者 | P0 |
| `Alt+1…5` | 設正解 A–E（是非題 1=O、2=X；QuizEditor 多選題為切換勾選） | 兩者 | P0 |
| `Mod+Enter` | 儲存並關閉 QuestionForm | QuizEditor | P0 |
| `Esc` | 取消編輯／離開輸入框 | 兩者 | P0 |
| `Alt+Shift+M/T/F/E` | 新增選擇／是非／填充（cloze）／問答（short_answer），插在本題後 | 兩者 | P0–P1 |
| `Alt+Shift+D` | 複製本題 | 兩者 | P1 |
| `Alt+Backspace` | 刪除本題（必須 confirm） | 兩者 | P1 |
| `/`（非輸入中） | 跳到本題題幹 | 兩者 | P1 |
| `Alt+=` `Alt+-` | 配分 ±1 | 兩者 | P2 |
| `Alt+Shift+Y` | 循環題型 | 助手（QuizEditor 只在 QuestionForm 內） | P2 |
| `Alt+Shift+L` / `Alt+Shift+U` | 循環認知層次／單元 | 助手 | P2 |
| `Alt+Shift+1/2/3` | 切到編輯／細目表／預覽 | 助手 | P2 |
| `?`、`Mod+/` | 快捷鍵說明 | 兩者 | P0 |

## QuizEditor 實作計畫（待做）

1. `src/hooks/useEditorShortcuts.ts`：`useEditorShortcuts(shortcuts: Shortcut[], opts?: { enabled?: boolean })`；listener 只註冊一次（shortcuts 放 `useRef`），capture phase（早於 dnd-kit `KeyboardSensor`）；附 `isMac()`、`formatCombo()`。
   - 測試 `src/hooks/useEditorShortcuts.test.ts`（jsdom）：IME 忽略、輸入中單鍵放行、Mac meta 對應 Mod、`e.code` 比對 `⌥` 鍵。
2. `QuizEditor.tsx` 新增 `activeId` state；三種卡片（`QuestionForm` / `InlineQuestionCard` / `QuestionCard`）root 加 `data-question-id` + `onFocusCapture` / `onMouseDown` → `setActiveId`，Props 加 `isActive`。`router.refresh()` 同步 effect 後要檢查 activeId 是否仍存在。
3. 從 `handleDragEnd` 抽出 `moveQuestion(from, to)`，拖曳與快捷鍵共用。
4. `QuestionForm` 加 `initialType` prop；`<form onKeyDown>` 處理 `Mod+Enter` / `Esc`。
5. 正解與配分：`InlineQuestionCard` 的正解是本地 state → 快捷鍵放在卡片內（`enabled: isActive`）；配分需新增本地 `points` state 並讓 `save()` 接受覆寫。
6. 新元件 `src/components/quiz/ShortcutsDialog.tsx`（無 Radix Dialog，照 `LiveStartDialog` 自製 overlay；root 加 `role="dialog" data-state="open"` 供 hook 的 modal guard 偵測），「⋯ 更多」加「⌨️ 鍵盤快捷鍵」入口。
7. 所有 modal（AIQuizModal、ShareModal…）開啟時以 `opts.enabled` 停用。

## 已知風險

1. **`handleDeleteQuestion` 目前沒有 confirm**（既有問題）：加快捷鍵前必須先補，按鈕一起修。
2. **`createQuestion` 不回傳 id 且固定加在最後**：複製插在下一題、新增後 focus 都需要 id → 改成回傳 `{ id }`，或新增 `duplicateQuestion` server action（transaction 內後續 position +1）。屬寫入路徑，須 test-first。
3. **`distributePoints` race**：所有題目皆 1 分時新增會觸發平均配分；`isSubmitting` 期間停用新增類快捷鍵。
4. 注音模式下 `/` 會變「ㄥ」（組字中），說明 dialog 已註明需英數模式。
