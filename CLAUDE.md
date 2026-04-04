# QuizFlow 專案規則

## 專案簡介
QuizFlow 是一個給台灣老師使用的測驗 SaaS 平台，老師可以出題、學生可以作答、系統自動批改並顯示成績 dashboard。

## 技術架構
- Framework: Next.js 14 + TypeScript
- Auth: Clerk（多租戶，以 Organization 為 tenant 單位）
- DB: Drizzle ORM + PostgreSQL（開發用 PGlite in-memory，正式用 pg + DATABASE_URL）
- UI: Tailwind CSS + Shadcn UI
- 金流: 綠界 ECPay（不用 Stripe，目前用假值）
- 部署: Vercel

## 常用指令

```bash
npm run dev          # 啟動開發伺服器
npm run build        # 正式建置
npm run lint         # ESLint 檢查
npm run check-types  # TypeScript 型別檢查
npm run test         # 單元測試（Vitest）
npm run db:generate  # 根據 src/models/Schema.ts 產生 migration
npm run db:migrate   # 套用 migration 到正式 DB（需 .env.production）
```

## 定價方案
- Free：最多 3 個測驗，1 位老師帳號
- Pro：$9/月，無限測驗 + AI 出題 + 班級管理
- Enterprise：$29/月，學校帳號 + 多老師 + 數據報表

## 語言
- 介面優先繁體中文
- 程式碼註解用繁體中文
- API 路由和變數名稱用英文

---

## 目前完成進度

### ✅ 品牌與設定
- AppConfig、Hero、DemoBanner 全部改成 QuizFlow
- 定價方案設定（Free / Pro / Enterprise）
- 繁體中文（zh）為預設語系，同時支援英文（en）

### ✅ 資料模型（src/models/Schema.ts）
- `quiz` — 測驗（ownerId = Clerk orgId，status: draft/published/closed）
- `question` — 題目（type: single_choice/multiple_choice/true_false/short_answer，options/correctAnswers JSONB，position 排序）
- `response` — 學生作答記錄（studentName, studentEmail, score, totalPoints）
- `answer` — 每題的作答內容（answer JSONB, isCorrect）
- Migrations: `migrations/0000_init-db.sql`、`migrations/0001_luxuriant_daredevil.sql`

### ✅ Server Actions
| 檔案 | 功能 |
|---|---|
| `src/actions/quizActions.ts` | `createQuiz`, `updateQuiz`, `deleteQuiz` |
| `src/actions/questionActions.ts` | `createQuestion`, `updateQuestion`, `deleteQuestion`, `reorderQuestions` |
| `src/actions/responseActions.ts` | `submitQuizResponse`（批改 + 寫入 response/answer）|

### ✅ 老師後台（需登入，`/dashboard/*`）
| 檔案 | 說明 |
|---|---|
| `src/app/[locale]/(auth)/dashboard/page.tsx` | Dashboard 首頁 |
| `src/app/[locale]/(auth)/dashboard/quizzes/page.tsx` | 測驗列表（Server Component + DataTable）|
| `src/app/[locale]/(auth)/dashboard/quizzes/new/page.tsx` | 建立測驗 |
| `src/app/[locale]/(auth)/dashboard/quizzes/[id]/edit/page.tsx` | 出題編輯器（含拖曳排序）|

### ✅ 出題編輯器相關元件（`src/features/quiz/`）
| 檔案 | 說明 |
|---|---|
| `QuizForm.tsx` | 建立測驗表單 |
| `QuizTable.tsx` | 測驗列表表格（Client wrapper）|
| `QuizTableColumns.tsx` | 表格欄位定義 + 刪除操作 |
| `QuizEditor.tsx` | 主編輯器：DnD 排序、題目 CRUD、狀態切換、inline 標題編輯 |
| `QuestionCard.tsx` | 單題卡片（@dnd-kit/sortable）|
| `QuestionForm.tsx` | 題目新增/編輯表單（4 種題型、動態選項、正確答案標記）|

### ✅ 學生作答（公開，不需登入，`/quiz/*`）
| 檔案 | 說明 |
|---|---|
| `src/app/[locale]/quiz/[quizId]/page.tsx` | 作答頁（只顯示 published 測驗）|
| `src/features/quiz/QuizTaker.tsx` | 作答介面 + 即時成績畫面（含逐題對照）|

---

## 下一步（依序）
1. 成績 Dashboard — 老師查看每份測驗的作答統計、每題答對率
2. Free plan 限制 — 建立第 4 個測驗時擋住並提示升級
3. AI 出題功能（Pro 限定）— 呼叫 Claude API 自動生題
4. 綠界 ECPay 金流整合

---

## 架構模式

### Auth 流程
- `/dashboard/*`、`/onboarding/*`、`/api/*` 需要登入
- 登入但未選 Organization → 強制導向 `/onboarding/organization-selection`
- `ownerId` 一律用 `auth().orgId`

### Server Actions 模式
```ts
'use server';
const { orgId } = await auth();
// Zod 驗證 → Drizzle 寫 DB → revalidatePath 或 redirect
```

### Client Component 呼叫 Server Action
```ts
const [isPending, startTransition] = useTransition();
startTransition(async () => { await someAction(data); });
// 需要刷新資料時 → router.refresh()
```

### i18n
- Server Component：`const t = await getTranslations('Namespace')`
- Client Component：`const t = useTranslations('Namespace')`
- 翻譯 key 必須同時加入 `zh.json` 和 `en.json`

### UI 元件慣例
- `<TitleBar>` — 頁面標題列
- `<DashboardSection>` — 白底卡片區塊
- `<MessageState>` — 空白狀態引導畫面
- `<DataTable>` — 通用資料表格（需搭配 `ColumnDef<T>[]`）
- 表單：react-hook-form + zodResolver + Shadcn `<Form>` 元件

## 重要設定檔
- `src/utils/AppConfig.ts` — 全站設定、Locale、定價方案
- `src/libs/Env.ts` — 所有環境變數（啟動時驗證）
- `src/models/Schema.ts` — Drizzle schema，所有資料表在此，改完要跑 `db:generate`
- `src/locales/zh.json` / `en.json` — 翻譯字串

## 環境變數（正式環境）
```
DATABASE_URL=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
STRIPE_SECRET_KEY=          # 暫用假值，待換 ECPay
STRIPE_WEBHOOK_SECRET=      # 暫用假值
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
BILLING_PLAN_ENV=prod
```
