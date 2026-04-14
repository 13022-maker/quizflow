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

### 🔥 下一步優先順序（依序開發）
1. ECPay 金流整合（5月上線，參考 Quizlet 結帳設計：30天免費試用、年繳方案、折扣碼）
2. 免費試用機制（Pro 功能 30 天體驗，到期自動降級）
3. 多語系擴展（日語、韓語、英語、簡體中文）
4. 遊戲化測驗（WebSocket 即時競賽、排行榜、積分系統）
5. Playwright E2E 測試覆蓋核心流程

## 技術債與技術決策

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

### Paddle Sandbox 測試分支
`feature/paddle-sandbox` 分支專門綁 Paddle Sandbox 環境（非正式交易）。
Vercel preview env 需設：PADDLE_API_KEY（sandbox）、NEXT_PUBLIC_PADDLE_ENV=sandbox、4 個 sandbox Price ID、PADDLE_WEBHOOK_SECRET（待 webhook 建立後取得）。
smoke test 完成後此分支可刪除。
