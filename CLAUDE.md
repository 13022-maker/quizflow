# CLAUDE.md - QuizFlow 專案規則手冊

This file provides guidance to Claude Code when working with code in this repository.

## 專案簡介
QuizFlow 是專為**台灣老師**設計的 AI 測驗 SaaS 平台。
老師可快速上傳 PDF（或其他素材），AI 自動生成高品質測驗題，發佈分享連結，讓學生**無需登入**即可作答，系統自動批改並顯示成績與詳解。

## 每次啟動請先做
1. 確認目前在 ~/quizflow-A 目錄
2. 確認在 main 分支：git branch
3. 確認有無未 commit 的改動：git status
4. 回報目前待辦事項（來自本文件底部的 TODO 清

**核心價值**：讓老師大幅節省出題時間，生成題目品質需達到或超越 MagicSchool / Eduaide 水準（正確性高、無幻覺、來源可追溯、難度均勻）。

**目標用戶**：中小學、大學老師、補習班、線上課程創作者。

## 技術架構
- **Framework**: Next.js 14+ App Router + TypeScript (Strict Mode)
- **Auth**: Clerk（以 Organization 為 tenant，`ownerId = orgId`，多租戶）
- **Database**: Drizzle ORM + PostgreSQL（本地開發用 PGlite in-memory）
- **UI**: Tailwind CSS + Shadcn UI（基於 Radix primitives）
- **i18n**: next-intl（預設 `zh` 繁體中文，支援 `en`）
- **AI 出題**: Gemma 4 E4B（透過 Ollama 本地運行）／Claude API（分析功能）
- **其他**: Zod 驗證、Playwright 測試

## 專案結構重點
```
src/
├── app/
│   ├── api/ai/          # AI 相關 API Route（analyze-weak-points、analyze-class-performance 等）
│   ├── [locale]/(auth)/ # 需登入頁面（dashboard、quiz editor、results）
│   └── [locale]/(unauth)/quiz/[quizId]/ # 學生公開作答頁
├── features/
│   ├── quiz/            # QuizTaker、QuizEditor、ResultsResponseTable、ClassAIAnalysis
│   └── dashboard/       # TitleBar、MessageState、DashboardHeader
├── components/
│   └── onboarding/      # OnboardingSteps（新手引導）
├── lib/ai/              # 所有 AI 提示詞與生成邏輯（統一放這裡）
├── models/Schema.ts     # Drizzle 所有資料表定義
├── actions/             # Server Actions（quizActions、questionActions、responseActions）
└── locales/             # zh.json / en.json
```

## 常用指令
```bash
npm run dev                    # 啟動開發伺服器
npm run build                  # 正式建置
npm run lint                   # ESLint 檢查
npm run check-types            # TypeScript 型別檢查
npm run test                   # 執行測試

# 資料庫相關
npm run db:generate            # 生成 migration（修改 Schema 後必須執行）
npm run db:migrate             # 執行 migration
npm run db:studio              # 開啟 Drizzle Studio
```

## 絕對開發規則（MUST / MUST NOT）

**語言**
- UI 文字、錯誤訊息、程式碼註解一律使用**繁體中文**
- 變數名稱、函式名稱、路由、檔案名稱一律使用**英文**（camelCase 或 kebab-case）

**Server Actions**
- 所有寫入操作必須透過 Server Action
- 必須先驗證 `orgId`，使用 Zod 進行嚴格輸入驗證

**i18n**
- 新增任何翻譯 key，**必須**同時更新 `src/locales/zh.json` 與 `src/locales/en.json`

**資料庫**
- 修改 `src/models/Schema.ts` 後，**必須**執行 `npm run db:generate` 並 commit migration

**安全性**
- 絕對禁止在 Client Component 直接呼叫 AI/Ollama
- 必須走 Server Action 或 API Route

**API Routes**
- 所有 API Route 最頂端加 `export const runtime = 'nodejs'`
- 所有回應使用 `NextResponse.json()`

## AI 出題核心規則（最重要部分）

AI 出題功能**僅限 Pro 方案**使用（Free 方案最多建立 3 個測驗）。

**模型指定**
- Ollama 本地模型名稱：`gemma4:e4b`
- 分析類功能（弱點分析、班級建議）：Claude API（`claude-sonnet-4-20250514`）
- 所有 AI 相關邏輯統一放在 `src/lib/ai/` 目錄下

**生成輸出格式（標準 JSON Schema）**
每題必須包含以下欄位：
```ts
{
  question: string;
  type: "multiple-choice" | "true-false" | "short-answer" | "fill-in-blank";
  options?: string[];
  correct_answer: string | number | boolean;
  explanation: string;
  source_page?: number;            // 來源 PDF 頁碼（強制追溯）
  difficulty: 1 | 2 | 3 | 4 | 5; // 1 最簡單，5 最難
  rubric: {                        // 評分機制
    correctness: number;           // 0–5
    completeness: number;
    clarity: number;
    teachingValue: number;
    total: number;
  };
}
```

**Gemma 4 多模態提示規則**
- 先放置 `<image>`、`<audio>` 等多模態內容，再接文字指令
- 明確要求輸出結構化 JSON，包含題目、選項、正確答案、解析
- 建議使用 Thinking Mode（step by step）提升生成品質

**提示詞管理**
- 所有 Gemma 4 / Claude 提示詞統一放在 `src/lib/ai/prompts.ts`

## 重要設定檔

| 檔案 | 用途 |
|------|------|
| `src/utils/AppConfig.ts` | 定價方案、功能限制、語系設定 |
| `src/libs/Env.ts` | 環境變數驗證（Zod） |
| `src/models/Schema.ts` | Drizzle 所有資料表定義 |
| `src/locales/zh.json` | 主要翻譯檔（繁體中文） |
| `src/lib/ai/` | Gemma 4 / Claude 相關程式碼與提示詞 |

## 環境變數（開發環境）
開發時只需 `.env.local`，`DATABASE_URL` 可省略（自動使用 PGlite）：
```env
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
STRIPE_SECRET_KEY=any_fake_value
# ANTHROPIC_API_KEY= （analyze-weak-points / analyze-class-performance 需要）
```

## 已修復的問題（Bug Fix 記錄）

- **PDF 上傳限制**：大 PDF（>4.5MB）不阻擋，顯示黃色警告並讓用戶選頁數範圍，前端用 pdf-lib 裁切後再上傳
- **是非題作答**：DB 無 options 時自動補上 `[{id:'tf-true',text:'正確'},{id:'tf-false',text:'錯誤'}]`
- **AI 匯入後題目列表不更新**：`QuizEditor` 的 `useState(initialQuestions)` 不會隨 prop 更新，加 `useEffect` 同步 `initialQuestions → questions` state
- **講義匯入正確答案空白**：`handleFileImport` 的 MC 答案匹配只做 text 比對，AI 回傳字母（"A"）永遠不符。加入 letter-based 匹配（`answer.toLowerCase() → option.id`）
- **quiz submission Server Action**：answers key 明確轉為 string（`String(key)`），確保序列化正確
- **Vercel API Route timeout**：AI 出題 route 需加 `export const maxDuration = 60`
- **.next 快取損壞**：修復方式 `rm -rf .next && npm run dev`
- **手機版 PDF 頁數範圍選擇器**：flex 不 wrap 在 375px 溢出，改 `flex-wrap` + 調整 padding

## 功能規格（已實作）

- **題型**：single_choice、multiple_choice、true_false、short_answer、ranking（排序題）
- **排序題（ranking）**：學生端用 `survey-react-ui` ranking widget（`next/dynamic` + `ssr:false` 動態載入），老師端輸入順序即正確答案，批改為全對才給分，學生端永遠強制打亂選項
- **AI quota**：免費版每月 10 次，Pro 無限（4 月測試期全 Pro）
- **AI 出題**：文字模式 + 檔案模式（PDF/圖片），支援 mc/tf/fill/short/rank 五種題型
- **快閃卡**（`FlashCard.tsx`）：3D 翻牌 + 進度追蹤
- **考試模式防作弊**：`quiz.preventLeave` boolean 控制；學生端 `beforeunload` 攔截 + `visibilitychange` 偵測切換分頁；`response.leaveCount` 記錄離開次數；老師成績頁顯示「⚠️ 離開 N 次」紅色標記 + CSV 匯出
- **測驗快速方案**：考試（隨機題✅/隨機選✅/顯解❌/防離✅）、練習（❌/❌/✅/❌）、複習（✅/✅/✅/❌），手動改 Toggle 自動取消方案選中。按鈕視覺：考試 `bg-gray-900`、練習 `bg-amber-400`、複習 `bg-blue-500`，未選中 `bg-white text-gray-500 border-2`
- **平均配分**：`distributePoints` server action，`Math.floor(100/N)` 每題基礎分，最後一題補足餘數至 100
- **分享頁面**（`ShareModal.tsx` 取代舊 `QRCodeModal`）：
  - 6 碼房間碼（`quiz.roomCode`，大寫英數 A-Z 0-9，UNIQUE，建立測驗時自動生成）
  - `GET /api/quiz/join?code=XXXXXX` → redirect 到 `/quiz/[accessCode]`
  - LINE 分享按鈕（LINE Social Plugins share URL，綠色 `#06C755`）
  - Google Classroom 分享按鈕（`classroom.google.com/share` URL）
  - 到期時間設定：`quiz.expiresAt`（TIMESTAMP nullable），快速選項 1h/24h/3天/7天/永不到期/自訂 datetime-local
  - 學生作答頁 + join API 檢查到期 → 過期顯示「此測驗已結束」
- **題目插入圖片**：URL 貼上 + Google 搜尋 + 預覽
- **錯題重做**：本機批改，不計入正式統計
- **老師成績報表**：可排序表格、CSV 匯出、前 3 難題、AI 班級建議

## 目前完成進度

### ✅ 已完成
- 品牌設定、雙語支援（zh/en）、定價方案
- 資料模型：quiz、question、response、answer + ai_usage
- 測驗 CRUD + 拖曳排序 + 平均配分（總分 100）
- 學生公開作答頁面（`/quiz/[accessCode]`）與自動批改
- AI 出題（文字提示 + PDF/圖片上傳，使用 Claude API，支援 5 種題型含排序題）
- AI 出題完成後自動把試卷主題接到預設標題後面（「AI 出題 4/26 - 光合作用」，≤7 字，僅當標題仍是預設 pattern 才覆寫，PR #49）
- AI 出題命題框架下拉選單（`src/components/quiz/AIQuizModal.tsx` select + `src/app/api/ai/generate-questions/route.ts` `FRAMEWORK_PROMPTS`），分組：
  - 108 課綱素養（國中／高中各 6 科）
  - PISA 國際素養、國中教育會考、Bloom 認知層次（記憶/理解/應用/分析/評鑑/創造）
  - CEFR 英文分級 A1-B2
  - **TOCFL 華語文（國家華語測驗推動工作委員會 SC-TOP）**：A1 萌芽 / A2 基礎 / B1 進階 / B2 高階 / C1 流利 / C2 精通，外加「TOCFL 8,000 詞表」全集詞彙運用題（PR #53）
  - 白名單 fallback：`FRAMEWORK_PROMPTS[framework] || ''`，未知 key 視為未指定，prompt 不變
- Dashboard 智慧首頁（統計卡片 + 最近測驗列表）
- 新手引導步驟（OnboardingSteps，localStorage 記錄）
- 學生成績頁 AI 弱點分析（`/api/ai/analyze-weak-points`）
- 錯題重做功能（本機批改，不計入統計）
- 老師成績報表：可排序表格、CSV 匯出（含離開次數）、前 3 難題、AI 班級建議
- AI 出題 quota 限制（Free 10次/月，Pro 無限）
- Billing 方案頁面（用量顯示 + 方案比較表）
- 題目插入圖片功能（URL 貼上 + Google 搜尋 + 預覽）
- 是非題選項修復（自動補上預設「正確/錯誤」選項）
- 快閃卡複習模式（3D 翻牌 + 進度追蹤）
- 排序題（ranking）：survey-react-ui 拖拉排序，動態載入
- 考試模式防作弊（beforeunload + visibilitychange + leaveCount）
- 測驗快速方案（考試/練習/複習 一鍵套用，各色按鈕）
- 大 PDF 前端裁切上傳（pdf-lib client-side page trimming）
- 分享頁面強化（6 碼房間碼 + LINE + Google Classroom + 到期時間 + QR Code）
- 題庫市集科目／年級擴充（`src/utils/MarketplaceConfig.ts`，PR #54）：科目加「華語檢測」（配合 TOCFL 命題框架，給教華語的老師對應分類）、年級末尾加「不分級」（語言檢定／通識題庫不限學制用）；上架對話框與 `/marketplace` 篩選頁兩處 consumer 都動態 `.map()`，加常數即同步生效
- Paddle Billing 整合（sandbox smoke test 全通過）：
  - `/zh/pricing` 頁用 `components/pricing/PricingSection`，三方案 + 月/年切換
  - `POST /api/paddle/checkout` 建立 customer（含 try/catch），`useCheckout` hook 開 overlay
  - Webhook `/api/webhook`（已從 Clerk middleware 排除）處理 created/updated/canceled
  - `sub.customData` 為 null 時用 `customer_id` 反查 `paddle_customer` 表取得 clerkUserId（關鍵 fix）
- **Live Mode**（Kahoot 風格直播競賽 MVP）：6 碼 PIN 加入、老師主控 + 學生同步、Kahoot 式計分（500 底分 + 最多 500 速度加成）、即時排行榜
  - Realtime：**抽象 adapter 介面**（`src/services/live/realtimeAdapter.ts`）雙實作
    - Polling（預設）：setInterval + REST fetch，host 每 1.5s、player 每 2s
    - Ably（flag 啟用）：WebSocket tick-only，延遲 <200ms，設 `NEXT_PUBLIC_LIVE_REALTIME=ably` + `ABLY_API_KEY` 即切換
  - Schema：`live_game` / `live_player` / `live_answer`（`src/models/Schema.ts`）
  - 後端：`src/services/live/`（liveStore / scoring / types / realtimeAdapter / ablyAdapter / ablyServer / playerSession）+ `src/actions/liveActions.ts`
  - API：`/api/live/join`（學生加入）、`/api/live/[gameId]/host-state` + `.../player-state`（REST 權威來源）、`/api/live/[gameId]/answer`（學生提交）、`/api/live/ably-auth`（Ably token）
  - UI：`src/features/live/`（LiveHostLobby / LiveLeaderboard / LivePlayerJoin / LivePlayerQuestion + 2 個 Room container + hooks）
  - 路由：`/dashboard/live/host/[gameId]`（老師）、`/live/join` + `/live/play/[gameId]`（學生）
  - 入口：QuizEditor 頂部按鈕、QuizTableColumns 下拉選單
  - 本次 MVP 只支援 `single_choice` / `multiple_choice` / `true_false`；ranking / short_answer / listening 待後續
- **SwipeableFlashcard**（滑動式單字卡 UI）：
  - 元件 `src/components/flashcard/SwipeableFlashcard.tsx` + DB row → FlashcardData mapper（`src/lib/flashcard.ts`）
  - 三向滑動評分（左 = 重來、右 = 良好、上 = 簡單）+ 點擊翻牌 + 動畫飛出 + Undo 上一張
  - 預設按鈕模式（多數使用者較不熟滑動）；卡片下方可切到滑動模式
  - 字體隨字長動態縮放（英文 >10 字母縮 34px、>14 縮 26px、>18 縮 20px；中文同分級）+ `overflow-wrap:anywhere` 保險，避免長單字被卡片 `overflow-hidden` 裁掉
  - `langs` prop 控制要顯示的語言 tab；目前帶 `['zh', 'en']`，客語暫時隱藏，等之後跟閩南語一起做
  - TTS 串既有 `/api/ai/tts`（zh-tw-female / en-female / hak voice）；學生端 wrapper `SwipeableVocabPractice.tsx` 把 vocab DB row 轉接過去
  - SRS 寫回先 console.log（vocab_attempts 表尚未建，等之後 schema 擴充再串 server action）
- **題庫市集加入單字卡集**（migration 0029）：
  - `vocabSetSchema` 加 `visibility` / `category` / `gradeLevel` / `forkCount` 4 欄位（與 quiz 對齊）
  - 3 個 server actions：`publishVocabToMarketplace` / `unpublishVocabFromMarketplace` / `copyVocabFromMarketplace`（`src/actions/marketplaceActions.ts`）
  - `/marketplace` 頁首加 tab 切換「測驗」/ 「單字卡」（searchParams 加 `type=quiz|vocab`，預設 quiz 向後相容）
  - `MarketplaceVocabCard.tsx`：兩顆按鈕 — 「開始練習」（→ /vocab/[accessCode]，學生不用登入）+ 「複製到我的單字卡集」（fork → 跳 dashboard/vocab）
  - dashboard/vocab 列表卡片右上「⋯」menu（`VocabActionsMenu.tsx`）：上架/下架（`PublishVocabDialog.tsx` 選 category/grade）、複製公開連結、刪除
  - 卡片顯示「✅ 已上架市集 · N 人複製」徽章；forkCount 用原子 SQL increment 跟 quiz 對齊
  - **不**做 description / tags / slug / publishedAt（scope 簡化，未來需要再補）

### 🔥 下一步優先順序（依序開發）
1. **Paddle production 上線**（階段 2）：production env 補上 PADDLE_* 變數、webhook destination 改回 `https://quizflow-psi.vercel.app/api/webhook`、merge `feature/paddle-sandbox` → main
2. 免費試用機制（Pro 功能 30 天體驗，到期自動降級）
3. 多語系擴展（日語、韓語、英語、簡體中文）
4. Live Mode v2：斷線重連（Ably Presence + Reactor Webhook + localStorage 身份恢復 + 老師端斷線狀態 UI）、支援 ranking / short_answer / listening 題型、UI 完整 i18n（目前中文硬寫在 components 裡）
5. Playwright E2E 測試覆蓋核心流程

## 技術債與技術決策

### Live Mode Realtime：Polling（預設）+ Ably（flag 啟用）
- **雙實作 adapter**（`src/services/live/realtimeAdapter.ts`）：根據 `NEXT_PUBLIC_LIVE_REALTIME` 動態選擇
  - 未設或非 `ably` → `PollingRealtimeAdapter`：host 1.5s、player 2s setInterval fetch，零外部依賴、本機 dev 免設定
  - `ably` → `AblyRealtimeAdapter`：WebSocket tick-only，需同時設 server 端 `ABLY_API_KEY`
- **Tick-only 模式**（而非 push 完整 state）：server 發空 payload 的 `tick` 到 `live:{gameId}` channel，client 收到後用既有 REST 拉自己 state。選擇原因：
  - 單 channel 即可（不用依 host/player 分），channel 計費 = 遊戲數
  - 無隱私洩漏（player 分數 / 排名走 REST 認證層，channel 全 public subscribe）
  - REST endpoint 仍是權威 state 來源，adapter 僅替換「何時觸發 fetch」
- **Token endpoint**：單一 `/api/live/ably-auth` 用 `?role=host|player` 分流；host 驗 Clerk orgId 擁有 game、player 驗 playerToken
- **Middleware 陷阱（踩過 2 次，謹記）**：
  - 不可把 `/api/live/ably-auth` 放進 `isPublicApiRoute`（會整個 skip `clerkMiddleware`，endpoint 內 `auth()` 炸 500）
  - 正解：`isOptionalAuthRoute` matcher + 條件式 `if (isProtectedRoute && !isOptionalAuthRoute) auth.protect(...)` → 保留 Clerk context 但不強制登入
- **所有 publish 只在 server 端**（`ablyServer.publishTick`），client token capability 只含 `subscribe`，防訊息偽造
- **reactionMs 由 server 計算**（`Date.now() - game.questionStartedAt`），client 傳來的時間戳完全不信任（防竄改瀏覽器時鐘拉分）
- **Server fallback**：`ABLY_API_KEY` 未設時 `publishTick` 直接 no-op，不會 throw；也就是拔掉 env 即自動回滾 polling
- Ably 免費 tier：200 併發、3M msg/月，tick-only 模式訊息量低（每 mutation 一則），規劃**跟 Paddle production 同 trigger**（用戶破 100 再評估付費方案）

### Drizzle migration snapshot 脫鉤（已存在問題，非本次造成）
`migrations/meta/` 缺 0015/0016/0017 的 snapshot，導致下次 `npm run db:generate` 會把 vocab 表、quiz marketplace 欄位等既有內容當 diff 又塞一次到新產 migration 裡。**每次產新 migration 後必須檢視 SQL，手動刪除不屬於本次改動的 CREATE TABLE / ALTER TABLE**（本次 `0018_flashy_pete_wisdom.sql` 已處理）。長期解法：重建 snapshot，但要在本機 PGlite + Neon 都驗證。

### AI SDK 維持 @anthropic-ai/sdk（不遷移）
目前使用 @anthropic-ai/sdk 直接呼叫。Vercel 驗證器建議改成 @ai-sdk/anthropic（Vercel AI SDK）。
影響範圍：generate-questions、generate-from-file、analyze-weak-points、analyze-class-performance
三條出題鏈需同時遷移，不能分開改。列為低優先，功能穩定後再處理。

### PDF 大型檔案長期解法
目前前端用 pdf-lib 裁切後上傳（繞過 Vercel 4.5MB body 限制）。
長期改法：改用 Vercel Blob 直傳，server 端從 Blob URL 讀取，不受 body size 限制。尚未實作。

### Stripe 金鑰
目前用測試金鑰（`STRIPE_SECRET_KEY`），5 月替換為正式金鑰。

### ECPay 金流
5 月整合，需綠界商店帳號與 API 金鑰。

### GitHub Actions CI 紅燈
`.github/workflows/CI.yml` 的 `Next.js Build 檢查` 缺少 `NEXT_PUBLIC_CLERK_SIGN_IN_URL` secret，需到 GitHub repo Settings → Secrets 補上。Vercel deploy 不受影響。

### Paddle Sandbox 測試分支（smoke test 已通過 2026-04-15）
`feature/paddle-sandbox` 分支綁 Paddle Sandbox 環境，完整 flow 驗證：訂閱 → webhook → DB upsert → 取消 → status=canceled。
- Vercel preview env（已設）：`PADDLE_API_KEY`、`NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`、`NEXT_PUBLIC_PADDLE_ENV=sandbox`、4 個 sandbox Price ID、`PADDLE_WEBHOOK_SECRET`、`DATABASE_URL`（指 Neon preview branch `preview-paddle-sandbox` = `br-mute-darkness-a1i746p8`，舊的 `br-sparkling-hat-a1j73ctc` 24h TTL 過期已被刪）
- Paddle Sandbox webhook destination：`ntfset_01kp66qw6wj7f3z0htq5ktg2qy`（目前指到 preview URL）
- production merge 前要處理：移除 Vercel preview 的 sandbox env（或窄化成只綁該分支）、刪 Neon preview branch、Paddle sandbox webhook destination 移除或獨立

### Paddle production 上線清單（階段 2，未做）
production Vercel env 目前**完全沒有 PADDLE_*** 變數，merge `feature/paddle-sandbox` → main 前必補：
1. `vercel env add PADDLE_API_KEY production`（production key `pdl_apikey_*`）
2. `vercel env add NEXT_PUBLIC_PADDLE_CLIENT_TOKEN production`（live_*）
3. `vercel env add NEXT_PUBLIC_PADDLE_ENV production` value=`production`
4. `vercel env add PADDLE_WEBHOOK_SECRET production`（取自 production Paddle Dashboard）
5. 4 個 production Price ID：
   - `NEXT_PUBLIC_PADDLE_PRICE_PRO_MONTHLY` = `pri_01kp3nbts21fh1saqfxgat7kgb`
   - `NEXT_PUBLIC_PADDLE_PRICE_PRO_YEARLY` = `pri_01kp3nerfqeama1ga5b54vgpk6`
   - `NEXT_PUBLIC_PADDLE_PRICE_TEAM_MONTHLY` = `pri_01kp3nhjp1xw9g1jyxvxynhtp4`
   - `NEXT_PUBLIC_PADDLE_PRICE_TEAM_YEARLY` = `pri_01kp3nnjdzkj64jv7ra0ygtaf1`
6. 更新 Paddle **Production** Dashboard webhook destination 指到 `https://quizflow-psi.vercel.app/api/webhook`（與 sandbox 那條不同個）
