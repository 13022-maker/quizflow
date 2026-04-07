# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## 專案簡介
QuizFlow 是專為**台灣老師**設計的測驗 SaaS 平台。
老師可以快速建立測驗、發佈分享連結，學生**無需登入**即可作答，系統自動批改並顯示成績與詳解。

**核心差異化功能（Pro 方案）**：
使用 **Gemma 4 E4B**（本地運行於 Ollama）進行**多模態 AI 出題**，支援上傳文字、PDF、圖片、影片、語音等素材，自動生成高品質測驗題（選擇題、是非題、問答題、填空題等）並附上詳細解析。

## 技術架構
- **Framework**: Next.js 14 App Router + TypeScript
- **Auth**: Clerk（以 Organization 為 tenant 單位，`ownerId = orgId`）
- **Database**: Drizzle ORM（開發環境使用 PGlite in-memory，正式環境使用 PostgreSQL）
- **UI**: Tailwind CSS + Shadcn UI（基於 Radix primitives）
- **i18n**: next-intl（預設語系為 `zh` 繁體中文，支援 `en`）
- **AI 多模態**: Gemma 4 E4B（透過 Ollama 本地運行）

## 常用指令
```bash
npm run dev                    # 啟動開發伺服器
npm run build                  # 正式建置
npm run lint                   # ESLint 檢查
npm run check-types            # TypeScript 型別檢查
npm run test                   # 執行測試

# 資料庫相關
npm run db:generate            # 生成 migration（修改 Schema 後執行）
npm run db:migrate             # 執行 migration
npm run db:studio              # 開啟 Drizzle Studio
AI 出題核心規則（最重要）

AI 出題功能僅限 Pro 方案使用（Free 方案最多建立 3 個測驗）
必須使用 Gemma 4 E4B 本地模型（模型名稱：gemma4:e4b）
所有與 AI 相關的呼叫必須放在 src/lib/ai/ 目錄下
禁止在 Client Component 直接呼叫 Ollama，必須透過 Server Action
多模態提示必須遵守 Gemma 4 最佳實踐：
先放置 <image>、<audio> 等多模態內容，再接文字指令
明確要求輸出結構化格式（JSON），包含題目、選項、正確答案、解析
建議使用 Thinking Mode（step by step）提升生成品質與準確度

開發規則與慣例

語言規則：
UI 文字與程式碼註解使用繁體中文
變數名稱、函式名稱、路由、檔案名稱一律使用英文

Server Actions：所有寫入操作必須先驗證 orgId，使用 Zod 進行輸入驗證
i18n：新增翻譯 key 時，必須同時更新 src/locales/zh.json 與 src/locales/en.json
資料庫變更：修改 src/models/Schema.ts 後，務必執行 npm run db:generate
提示詞管理：重要的 Gemma 4 提示詞建議統一放在 src/lib/ai/prompts.ts

目前完成進度
✅ 已完成

品牌設定、雙語支援、定價方案
資料模型（quiz、question、response、answer）
測驗 CRUD + 拖曳排序功能
學生公開作答頁面（/quiz/[quizId]）與自動批改

🔥 下一步優先順序（依序開發）

成績 Dashboard（老師查看每份測驗的統計與答對率）
Free Plan 限制（建立第 4 個測驗時阻擋並引導升級）
AI 多模態出題功能（Pro 限定，使用 Gemma 4 E4B）
綠界 ECPay 金流整合

重要設定檔

檔案用途src/utils/AppConfig.ts定價方案、功能限制、語系設定src/libs/Env.ts環境變數驗證src/models/Schema.tsDrizzle 所有資料表定義src/locales/zh.json主要翻譯檔（繁體中文）src/lib/ai/Gemma 4 相關程式碼與提示詞
環境變數（開發環境）
開發時只需 .env.local，DATABASE_URL 可省略（會自動使用 PGlite）：
envCLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
STRIPE_SECRET_KEY=any_fake_value
