# Trial 改 21 天 + Pill UX 擴展設計

**Date**: 2026-04-25
**Status**: Approved, ready for implementation plan
**Owner**: feat/trial-21-days

## 背景

QuizFlow 已有 30 天 Pro 試用基礎設施（schema、lazy init、`isProOrAbove` 整合、Dashboard 大 banner）。商業面決定縮短為 **21 天** 以加速付費漏斗轉換。同時補強 UX：除 dashboard 外，**測驗列表頁與 quiz editor 也顯示輕量的試用倒數提示**，讓老師在工作頁面也能持續看到試用狀態而不流失轉換。

CLAUDE.md TODO 第 2 項「免費試用機制（Pro 30 天體驗，到期降級）」即此功能。

## Scope

包含：
- 把試用天數從 30 改成 21（只影響「未來新建」的 trial 紀錄）
- 新增 `TrialPill` 輕量元件（試用全期 + 到期顯示）
- 整合到 quiz 列表頁與 QuizEditor 頂部

不包含（保留下一刀）：
- Email 提醒（沒有現成 email 基礎設施，獨立工程）
- Backfill 既有 30 天紀錄（production 未上線，無 production 用戶）
- 試用結束後的 paywall / hardgate UX
- 重新試用機制
- Dashboard banner 樣式變更（維持現狀）

## 架構決策

### 兩個獨立元件，不合一

`TrialBanner` 和 `TrialPill` 顯示規則不同（banner ≤7 天才出現、pill 試用全期），合併會導致 props 變雜。各自 30–40 行容易讀；未來改 pricing 文字 / 紅色閾值改一個檔不影響另一個。

### Server Component 渲染

兩者皆 server component，直接呼叫 `getOrgPlanId` + `getTrialStatus`。已有 `TrialBanner` 用此模式，沿用。

## 實作細節

### 1. 試用天數 30 → 21

| 檔案 | 變更 |
|---|---|
| `src/libs/trial.ts:14` | `const TRIAL_DAYS = 30` → `21` |
| `src/libs/Plan.ts:78` | 註解「試用期內（30 天）」→「試用期內（21 天）」 |
| `src/models/Schema.ts:248` | 註解「30 天 Pro 試用」→「21 天 Pro 試用」 |
| `src/features/dashboard/TrialBanner.tsx` | 文字若有「30 天」字樣同步調整（檢查時順便） |

不寫 migration、不 backfill。已存在的 `user_trial.endsAt` 維持原 +30 天值。

### 2. 新元件 `src/features/dashboard/TrialPill.tsx`

Server component，介面：

```tsx
type Props = {
  clerkUserId: string;
  orgId: string | null | undefined;
};

export async function TrialPill({ clerkUserId, orgId }: Props): Promise<JSX.Element | null>;
```

**邏輯**：
1. `getOrgPlanId(orgId ?? '')` — 已付費（PREMIUM / ENTERPRISE / PUBLISHER）→ return null
2. `getTrialStatus(clerkUserId)` — 沒紀錄 → return null
3. 試用中 (`inTrial: true`) → 渲染綠色 pill；`daysLeft ≤ 3` 改紅色
4. 已到期 → 渲染灰色 pill「試用已結束」

**樣式**：

```tsx
// Pill 共用 className（容器不占整列、可放在 nav 旁邊）
const base = 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap';
// 三種狀態色
const normal = 'bg-primary/10 text-primary border border-primary/20';
const urgent = 'bg-amber-100 text-amber-800 border border-amber-300';
const expired = 'bg-muted text-muted-foreground border border-border';
```

**內容**：
- 試用中：`🎁 Pro 試用 {daysLeft} 天`（≤3 天用 `⏰` 並換 `urgent` 色）
- 到期：`🔒 試用已結束`
- 整個 pill `<Link href="/dashboard/billing">` 可點，導向升級頁

### 3. 整合點

**A. 測驗列表頁** — `src/app/[locale]/(auth)/dashboard/quizzes/page.tsx`

加在頁面標題列（既有 `<DashboardHeader />` 或頁面 H1 旁邊），`<TrialPill clerkUserId={userId} orgId={orgId} />`。

**B. Quiz Editor** — `src/features/quiz/QuizEditor.tsx` 頂部按鈕列旁邊

QuizEditor 是 client component；server-component 形式的 TrialPill 不能直接放在裡面。處理方式有兩個選項：

- **選項 1**：在 `src/app/[locale]/(auth)/dashboard/quizzes/[id]/edit/page.tsx`（server component 容器）渲染 `<TrialPill />`，傳到 QuizEditor 上方作為兄弟節點
- **選項 2**：把 TrialPill 拆成 client + server props（server fetch 成 plain object 傳給 client pill）

實作時優先 **選項 1**（不改 QuizEditor 內部結構），如果版面對齊有困難再考慮選項 2。

### 4. 不動

- DB schema、`ensureTrialRecord`、`getTrialStatus`、`isProOrAbove` ✅
- TrialBanner 與 dashboard 整合 ✅
- 既有 user_trial 紀錄 ✅

## 驗證

### 自動
1. `npm run check-types`：本刀變更乾淨（pre-existing schema 錯誤不算）
2. `npm run lint`：本刀變更 0 錯

### 手動本機 dev
從 Drizzle Studio 把測試帳號的 `user_trial.endsAt` 改成各種值跑 3 次：
1. `now() + 5 days`：dashboard 顯示綠色大 banner、quizzes 列表 + editor 顯示綠色 pill
2. `now() + 2 days`：dashboard 變紅色（urgent）大 banner、pill 變紅色（urgent）
3. `now() - 1 day`：dashboard 變灰色「已結束」、pill 也變灰色

### 確認新 21 天邏輯
拿全新 Clerk 帳號註冊登入，呼叫任何走 `isProOrAbove` 的入口（例如 AI 出題），DB 應出現 `endsAt = now() + 21 days` 的新紀錄。

### 部署後
push → preview，重複本機驗證 3 個天數場景。

## 提交

預計 1 個 commit：
- 訊息：`feat(trial): 試用期改 21 天 + 新增 TrialPill 整合到 quiz 列表 / editor`
- 檔案：trial.ts、Plan.ts、Schema.ts 註解、TrialPill.tsx（新）、quizzes/page.tsx、edit/page.tsx（或 QuizEditor 入口處）

## 風險與緩解

| 風險 | 緩解 |
|---|---|
| Drizzle migration 自動 detect 出 schema 註解差異 | 註解在 TypeScript code 不在 schema DDL，不會觸發 migration |
| QuizEditor 是 client component，直接放 server component pill 會錯 | 在父層 server page 渲染 pill 當兄弟節點（選項 1） |
| Pill 在小螢幕和按鈕擠在一起 | 使用 `flex-wrap` 容器 + `whitespace-nowrap` 在 pill 內，超過自動換行 |
| 既有用戶試用日期不一致（30 vs 21） | 接受 — production 未上線、樣本量為零 |
