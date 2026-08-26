# 題目「影片連結」欄位 設計文件

- 日期：2026-08-26
- 範圍：`src/models/Schema.ts`、`src/actions/questionActions.ts`、`src/features/quiz/QuestionForm.tsx`、`src/features/quiz/QuizEditor.tsx`、`src/features/quiz/QuizTaker.tsx`

## 需求
老師命題後，有些題目需要學生先看過一段影片（YouTube）再作答。需要一個地方讓老師貼影片連結，並讓學生在作答該題前看到嵌入式播放器。

## 決策
- **層級**：`question` 表新增 `videoUrl`（text, nullable），比照現有 `imageUrl` 的做法，非 quiz 層級的 description。
- **適用題型**：所有題型皆可加（跟 imageUrl 一樣不限題型），欄位在 `QuestionForm.tsx` 無條件顯示，不依 `type` 條件渲染。
- **來源限制**：只接受 YouTube 網址。新增 `normalizeYoutubeUrl()`（放在 `QuestionForm.tsx`，比照既有 `normalizeImageUrl()` 的寫法），解析下列格式並轉成 embed 網址：
  - `youtube.com/watch?v=VIDEO_ID`
  - `youtu.be/VIDEO_ID`
  - `youtube.com/embed/VIDEO_ID`
  - 統一存成 `https://www.youtube.com/embed/{VIDEO_ID}`
  - 抽不出 video ID 時顯示黃色警告文字「請貼 YouTube 影片連結」，**不阻擋存檔**（跟圖片網址警告邏輯一致，`normalizeImageUrl` 的 `warning` 欄位同一種模式）
- **呈現方式**：嵌入式 iframe 播放器（非純連結），16:9 響應式容器、`loading="lazy"`、`allowFullScreen`
- **強制程度**：不強制看完才能作答，跟聽力題一樣只是文字提醒（`🎬 請先看完影片再作答`），寫死繁中字串，不走 next-intl（比照 `QuizTaker.tsx` 現有聽力提醒 `🎧 請先聽完音檔再作答` 的寫法，該處本來就不是 i18n key）
- **學生端渲染順序**（`QuizTaker.tsx` 的 `QuestionItem`）：題幹 → 圖片（如有）→ **影片**（如有）→ 聽力音檔（如有）→ 選項
- **驗證層**（`questionActions.ts`）：`videoUrl: z.string().url().optional().or(z.literal(''))`，跟 `imageUrl` 同規格；建立/更新時 `videoUrl: parsed.data.videoUrl || null`

## 資料流補齊點
- `QuestionForm.tsx`：`QuestionSchema` 加 `videoUrl`、`defaultValues` 加 `videoUrl: ''`
- `QuizEditor.tsx`：兩處編輯表單初始值（`imageUrl` 出現的同兩行，約 1156、1204 行）比照加 `videoUrl`
- `questionActions.ts`：create 與 update 的 zod schema、DB insert/update 物件都要加 `videoUrl`
- `src/models/Schema.ts`：`questionSchema` 加 `videoUrl: text('video_url')`，放在 `imageUrl` 欄位下方；跑 `npm run db:generate` 後依專案慣例人工檢查產出的 SQL（migration snapshot 脫鉤是已知技術債，需確認新 migration 沒有夾帶不相關的 CREATE/ALTER）

## 不做（YAGNI）
- Live Mode（`LiveQuestionScreen.tsx`／`LivePlayerQuestion.tsx`）不加這個功能，範圍與計時器邏輯不同，之後有需要再獨立評估
- 不做「強制看完才能作答」
- 不限制/驗證影片時長
- 不支援 YouTube 以外的影片來源（Vimeo、mp4 直連等）
- 不做觀看紀錄／統計

## 驗證
1. `npm run check-types`、`npm run lint`
2. 手動：老師端貼三種 YouTube 網址格式（watch/youtu.be/embed）都能正確轉換並預覽；貼非 YouTube 網址顯示警告但仍可儲存
3. 手動：學生作答頁該題正確嵌入播放器，且順序在圖片之後、選項之前；沒填影片的題目不受影響
4. `npm run db:generate` 後檢查新 migration SQL 只包含 `video_url` 這一欄的變更
