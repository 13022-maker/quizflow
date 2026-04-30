# Pro 試用機制 4 個缺口修補 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修補 QuizFlow 既有 30 天 Pro 試用機制的 4 個漏洞：AI quota 沒走 trial（明天 5/1 必爆）、起算點 lazy 不夠精確、billing 頁不顯示試用狀態、到期 banner 永久顯示。

**Architecture:** 4 個獨立 Fix，無新檔、無 DB migration。Fix 1 修一個 server action，Fix 4 把 dashboard layout 從 sync 轉 async 加 eager trigger，Fix 2 把 billing page 改成試用狀態四分支顯示，Fix 3 給 TrialBanner 到期分支加 7 天時限。

**Tech Stack:** Next.js 14 App Router、TypeScript、Drizzle ORM、Clerk、next-intl、existing helpers (`isProOrAbove`、`ensureTrialRecord`、`getTrialStatus`)。

**Spec:** `docs/superpowers/specs/2026-04-30-pro-trial-fixes-design.md`

---

## File Structure

| 檔案 | 動作 | 責任 |
|------|------|------|
| `src/actions/aiUsageActions.ts` | modify | Fix 1：兩個 function 開頭加 `isProOrAbove` short-circuit、刪 hardcoded hack |
| `src/app/[locale]/(auth)/dashboard/layout.tsx` | modify | Fix 4：sync → async、swap `useTranslations` → `getTranslations`、加 `auth()` + `ensureTrialRecord()` |
| `src/app/[locale]/(auth)/dashboard/billing/page.tsx` | modify | Fix 2：加 `getTrialStatus` 查詢、目前方案卡片改四分支顯示、CTA 條件改 |
| `src/features/dashboard/TrialBanner.tsx` | modify | Fix 3：到期分支起手加 7 天時限檢查 |

無新建檔案，無 DB schema 變動。

## 實作順序

依 spec「實作順序」段：**Fix 1 → Fix 4 → Fix 2 → Fix 3**。

每 Task 結束都跑 `npm run check-types` 與 `npm run lint`，通過再 commit。

---

## Task 1: Fix 1 — AI quota 走 isProOrAbove

**Files:**
- Modify: `src/actions/aiUsageActions.ts:5-8`（import 區）
- Modify: `src/actions/aiUsageActions.ts:34-38`（刪 hardcoded hack）
- Modify: `src/actions/aiUsageActions.ts:24-32`（`checkAndIncrementAiUsage` 開頭加 short-circuit）
- Modify: `src/actions/aiUsageActions.ts:96-107`（`getAiUsageRemaining` 開頭加 short-circuit）

- [ ] **Step 1.1: 讀檔確認現狀**

```bash
cat -n src/actions/aiUsageActions.ts | head -50
```
預期看到：L5 import `getUserPlanId`、L34-38 是 `2026 年 4 月` hack。

- [ ] **Step 1.2: 改 import 區加 `isProOrAbove`**

把 L6 既有的 `import { getUserPlanId } from '@/libs/Plan';` 改成：

```ts
import { getUserPlanId, isProOrAbove } from '@/libs/Plan';
```

- [ ] **Step 1.3: `checkAndIncrementAiUsage` 加 short-circuit、刪 hack**

把 L24-38 區塊（從 `export async function checkAndIncrementAiUsage` 到 hardcoded hack 結尾）改成：

```ts
export async function checkAndIncrementAiUsage(userId: string): Promise<
  | { allowed: true; remaining: number }
  | { allowed: false; reason: string; remaining: number }
> {
  // VIP 白名單不限制
  const { isVipUser } = await import('@/libs/vip');
  if (await isVipUser()) {
    return { allowed: true, remaining: 999 };
  }

  // 試用中老師享 Pro 待遇（與 isProOrAbove 一致）
  if (await isProOrAbove(userId)) {
    return { allowed: true, remaining: 999 };
  }

  // 取得方案
  const planId = await getUserPlanId(userId);
```

注意：`vip.ts` 維持 dynamic import（既有 pattern，不一起改），但新加的 `isProOrAbove` 用 static import（已在 Step 1.2 加好）。

- [ ] **Step 1.4: `getAiUsageRemaining` 加 short-circuit**

把 L96-107（function 起手到 quota >= 999 short-circuit 之間）改成：

```ts
export async function getAiUsageRemaining(userId: string): Promise<{
  quota: number;
  used: number;
  remaining: number;
}> {
  // 試用中老師享 Pro 待遇（與 isProOrAbove 一致）
  if (await isProOrAbove(userId)) {
    return { quota: 999, used: 0, remaining: 999 };
  }

  const planId = await getUserPlanId(userId);
  const plan = PricingPlanList[planId] ?? PricingPlanList[PLAN_ID.FREE]!;
  const quota = plan.features.aiQuota;

  if (quota >= 999) {
    return { quota: 999, used: 0, remaining: 999 };
  }
```

- [ ] **Step 1.5: 跑型別與 lint 檢查**

```bash
npm run check-types && npm run lint -- src/actions/aiUsageActions.ts
```
預期：兩條都 pass。

- [ ] **Step 1.6: 手動驗證（可選但建議）**

啟動 dev server：
```bash
npm run dev
```
登入測試帳號（無 subscription、user_trial 已存在且未到期）→ 點 AI 出題 11 次。預期：第 11 次仍可出題（不被擋）。
再用 Drizzle Studio（`npm run db:studio` 或直接修 PGlite）把 user_trial.ends_at 改成過去 → 重新整理 → 第 11 次應被擋（顯示「本月 AI 出題次數已達上限」）。

PGlite 環境若不便操作可跳過此步，靠後續整合測試把關。

- [ ] **Step 1.7: Commit**

```bash
git add src/actions/aiUsageActions.ts
git commit -m "$(cat <<'EOF'
fix(trial): AI quota 改走 isProOrAbove，試用中老師獲無限配額

Fix 1 of 4 缺口修補。aiUsageActions 兩個 function 開頭加 isProOrAbove
short-circuit，刪除 2026-04 hardcoded hack（5/1 後會擋住所有試用中老師）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Fix 4 — Dashboard layout eager trigger trial

**Files:**
- Modify: `src/app/[locale]/(auth)/dashboard/layout.tsx`（整檔）

關鍵：spec 寫「layout 已經是 async server component」是錯的——當前是 sync function 用 `useTranslations`（React hook）。本 task 把它轉 async、swap 到 `getTranslations`、加入 trial 觸發。

- [ ] **Step 2.1: 讀檔確認現狀**

```bash
cat -n src/app/[locale]/(auth)/dashboard/layout.tsx
```
預期：L19 是 `export default function DashboardLayout(props: ...)`（sync），L20 用 `useTranslations('DashboardLayout')`。

- [ ] **Step 2.2: 把整個 default export 改成 async + getTranslations + ensureTrialRecord**

把 L1-5 既有的 import 改為：

```ts
import { auth } from '@clerk/nextjs/server';
import { getTranslations } from 'next-intl/server';

import { InAppBrowserBanner } from '@/components/InAppBrowserBanner';
import { DashboardHeader } from '@/features/dashboard/DashboardHeader';
import { ensureTrialRecord } from '@/libs/trial';
```

注意：`useTranslations` import 拿掉（async 元件不能用 hook），`getTranslations` 已經在 generateMetadata 用了，這裡共用。

把 L19-57 的 `export default function DashboardLayout(...)` 整段改成：

```ts
export default async function DashboardLayout(props: { children: React.ReactNode }) {
  const t = await getTranslations('DashboardLayout');

  // 進入 dashboard 即起算 30 天 Pro 試用（idempotent，第 2 次以後純 SELECT）
  const { userId } = await auth();
  if (userId) {
    await ensureTrialRecord(userId);
  }

  return (
    <>
      <div className="shadow-md">
        <div className="mx-auto flex max-w-screen-xl items-center justify-between px-3 py-4">
          <DashboardHeader
            menu={[
              {
                href: '/dashboard',
                label: t('home'),
              },
              {
                href: '/dashboard/quizzes',
                label: t('quizzes'),
              },
              {
                href: '/dashboard/vocab',
                label: '單字卡',
              },
              {
                href: '/marketplace',
                label: '市集',
              },
            ]}
          />
        </div>
      </div>

      <div className="min-h-[calc(100vh-72px)] bg-muted">
        <div className="mx-auto max-w-screen-xl px-3 pb-16 pt-6">
          <InAppBrowserBanner />
          {props.children}
        </div>
      </div>
    </>
  );
}

export const dynamic = 'force-dynamic';
```

差異重點：
- function 加 `async`
- `useTranslations` → `await getTranslations`（記得 await）
- 多一段 `auth()` + `ensureTrialRecord(userId)`
- L7-17 的 `generateMetadata` **保持原樣**（已經是 async + getTranslations）

- [ ] **Step 2.3: 跑型別與 lint 檢查**

```bash
npm run check-types && npm run lint -- src/app/[locale]/\(auth\)/dashboard/layout.tsx
```
預期 pass。常見錯誤：忘記把 useTranslations import 拿掉（會 unused-import）。

- [ ] **Step 2.4: 手動驗證**

```bash
npm run dev
```
1. 用一個 user_trial 表中沒有紀錄的新用戶登入（或臨時 `DELETE FROM user_trial WHERE clerk_user_id = '...'`）
2. 進 `/dashboard` 任一子頁
3. Drizzle Studio 重整 → 該用戶在 user_trial 表應有新紀錄、`ends_at` ≈ 今天 + 30 天
4. dashboard 渲染應正常（header、菜單、子頁內容都在）

- [ ] **Step 2.5: Commit**

```bash
git add src/app/[locale]/\(auth\)/dashboard/layout.tsx
git commit -m "$(cat <<'EOF'
feat(trial): dashboard layout eager trigger ensureTrialRecord

Fix 4 of 4 缺口修補。把 dashboard layout 從 sync 轉 async，把
useTranslations swap 成 getTranslations，加 auth() + ensureTrialRecord
讓試用 30 天從進 dashboard 起算，而非首次點 Pro 功能。
新用戶 sign up 後純逛 dashboard 一週的場景不再「失算」7 天試用。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Fix 2 — Billing 頁四分支顯示試用狀態

**Files:**
- Modify: `src/app/[locale]/(auth)/dashboard/billing/page.tsx:1-7`（import）
- Modify: `src/app/[locale]/(auth)/dashboard/billing/page.tsx:22-25`（plan/trial 取值區）
- Modify: `src/app/[locale]/(auth)/dashboard/billing/page.tsx:33-55`（目前方案卡片）
- Modify: `src/app/[locale]/(auth)/dashboard/billing/page.tsx:96-147`（CTA / 訂閱管理區）

- [ ] **Step 3.1: 讀檔確認現狀**

```bash
cat -n src/app/[locale]/\(auth\)/dashboard/billing/page.tsx
```
預期：L5 import `getUserPlanId`、L24 是 `const isPro = planId === ...`、L96 是 `{!isPro ? (升級 CTA) : (訂閱管理)}`。

- [ ] **Step 3.2: import 加 `getTrialStatus`**

把 L5 既有的 `import { getUserPlanId } from '@/libs/Plan';` 改成：

```ts
import { getUserPlanId } from '@/libs/Plan';
import { getTrialStatus } from '@/libs/trial';
```

- [ ] **Step 3.3: 取值區加 trial 查詢與分支判定**

把 L22-25 區塊改成：

```ts
  const planId = await getUserPlanId(userId);
  const plan = PricingPlanList[planId] ?? PricingPlanList[PLAN_ID.FREE]!;
  const isPaidPro = planId === PLAN_ID.PREMIUM || planId === PLAN_ID.ENTERPRISE || planId === PLAN_ID.PUBLISHER;
  const trial = await getTrialStatus(userId);
  const isTrialing = !isPaidPro && trial?.inTrial === true;
  const trialExpired = !isPaidPro && trial !== null && trial.inTrial === false;
  const aiUsage = await getAiUsageRemaining(userId);

  // 副標日期 format
  const trialEndsAtLabel = trial?.endsAt
    ? trial.endsAt.toLocaleDateString('zh-TW')
    : '';
```

注意：`isPro`（舊變數名）改成 `isPaidPro` 以區分「真付費 Pro」vs「試用中假 Pro」。後面所有 `isPro` 引用都要對應改。

- [ ] **Step 3.4: 「目前方案」卡片改四分支顯示**

把 L33-55（目前方案卡片整段）改成：

```tsx
        {/* 目前方案卡片 */}
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">目前方案</p>
              <p className="mt-1 text-2xl font-bold">
                {isPaidPro
                  ? planId === PLAN_ID.ENTERPRISE
                    ? '學校方案'
                    : planId === PLAN_ID.PUBLISHER
                      ? '書商方案'
                      : 'Pro 老師'
                  : isTrialing
                    ? 'Pro 老師（試用中）'
                    : '免費版'}
              </p>
              {isTrialing && (
                <p className="mt-1 text-xs text-muted-foreground">
                  試用剩
                  {' '}
                  {trial!.daysLeft}
                  {' '}
                  天 ·
                  {' '}
                  {trialEndsAtLabel}
                  {' '}
                  結束
                </p>
              )}
              {trialExpired && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Pro 試用已於
                  {' '}
                  {trialEndsAtLabel}
                  {' '}
                  結束
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold tabular-nums">
                <span className="mr-0.5 text-base font-medium text-muted-foreground">NT$</span>
                {plan.price.toLocaleString()}
                <span className="ml-1 text-base font-normal text-muted-foreground">/月</span>
              </p>
            </div>
          </div>
        </div>
```

設計要點：
- 試用中價格仍顯示 `plan.price`（=0，因為 `planId === 'free'`），這跟「試用免費」一致，OK
- 副標只在「試用中」或「試用過期」才出現，「真 Pro」與「從未試用」都不顯示副標

- [ ] **Step 3.5: CTA / 訂閱管理區條件改**

把 L96-147 那塊 `{!isPro ? (升級 CTA) : (訂閱管理)}` 改成：

```tsx
        {/* 升級 / 管理訂閱 */}
        {isPaidPro
          ? (
              <div className="rounded-lg border bg-card p-6">
                <h2 className="mb-2 text-lg font-semibold">訂閱管理</h2>
                <p className="mb-4 text-sm text-muted-foreground">
                  你目前使用的是
                  {' '}
                  <strong>
                    {planId === PLAN_ID.ENTERPRISE
                      ? '學校方案'
                      : planId === PLAN_ID.PUBLISHER
                        ? '書商方案'
                        : 'Pro 老師'}
                  </strong>
                  {' '}
                  方案。
                </p>
                {/* TODO: 串接 Paddle Customer Portal（管理訂閱、取消、變更付款方式） */}
                <button
                  type="button"
                  disabled
                  className="rounded-lg border border-destructive/30 px-5 py-2 text-sm text-destructive opacity-60"
                >
                  管理訂閱（開發中）
                </button>
              </div>
            )
          : (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-6">
                <h2 className="mb-2 text-lg font-semibold">
                  {isTrialing ? '升級正式 Pro' : '升級至 Pro 方案'}
                </h2>
                <p className="mb-4 text-sm text-muted-foreground">
                  解鎖無限 AI 出題、無限測驗數量，以及更多進階功能。
                </p>
                <ul className="mb-5 space-y-2 text-sm">
                  <FeatureItem text="無限 AI 出題（每月不限次數）" />
                  <FeatureItem text="無限測驗數量" />
                  <FeatureItem text="班級 AI 分析報表" />
                  <FeatureItem text="CSV 成績匯出" />
                </ul>
                {/* TODO: 串接 Paddle Checkout overlay（hooks/useCheckout） */}
                <button
                  type="button"
                  disabled
                  className="w-full rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground opacity-60"
                >
                  即將推出 — NT$299/月
                </button>
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  付款功能開發中，敬請期待
                </p>
              </div>
            )}
```

差異重點：
- 條件 `!isPro` → `isPaidPro`（用付費 Pro 才顯訂閱管理）
- 升級 CTA 標題在試用中時改成「升級正式 Pro」
- disabled 「即將推出」按鈕**保持原樣**（spec 明示 Paddle production 上線後再處理）

- [ ] **Step 3.6: AI 使用率區塊不需動，確認即可**

跑：
```bash
grep -n "aiUsage.quota >= 999" src/app/[locale]/\(auth\)/dashboard/billing/page.tsx
```
預期看到既有 L71 那條 ternary 仍存在。試用中用戶因 Fix 1 此處自動命中「無限制」分支。

- [ ] **Step 3.7: 跑型別與 lint 檢查**

```bash
npm run check-types && npm run lint -- src/app/[locale]/\(auth\)/dashboard/billing/page.tsx
```

- [ ] **Step 3.8: 手動驗證 4 種狀態**

`npm run dev` 後，靠 Drizzle Studio 造資料分別驗：

| 狀態 | DB 條件 | 預期 billing 顯示 |
|------|--------|------------------|
| 真 Pro | subscription 表 plan='pro' status='active' | 「Pro 老師」、無副標、訂閱管理區 |
| 試用中 | 無 subscription、user_trial.ends_at 未來 | 「Pro 老師（試用中）」、副標「試用剩 N 天 · YYYY/MM/DD 結束」、升級 CTA 標題「升級正式 Pro」、AI 用量「無限制」 |
| 試用已過期 | 無 subscription、user_trial.ends_at 過去 | 「免費版」、副標「Pro 試用已於 YYYY/MM/DD 結束」、原升級 CTA、AI 用量「N / 10」 |
| 從未試用 | 無 subscription、user_trial 表沒紀錄 | 「免費版」、無副標、原升級 CTA、AI 用量「N / 10」 |

注意「從未試用」狀態因 Fix 4 已 eager trigger，正常用戶不會再有此狀態；測試時暫時把 layout.tsx 的 ensureTrialRecord 那行註解掉，再 DELETE 該用戶的 user_trial 紀錄即可重現。驗證完恢復。

- [ ] **Step 3.9: Commit**

```bash
git add src/app/[locale]/\(auth\)/dashboard/billing/page.tsx
git commit -m "$(cat <<'EOF'
feat(billing): billing 頁加試用狀態四分支顯示

Fix 2 of 4 缺口修補。把 isPro 拆成 isPaidPro / isTrialing / trialExpired
三個獨立判定，依此選擇目前方案標題、副標、升級 CTA 文案。
試用中用戶不再被誤顯為「免費版」。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Fix 3 — TrialBanner 到期後 7 天就收掉

**Files:**
- Modify: `src/features/dashboard/TrialBanner.tsx:69-88`（試用已到期分支起手）

- [ ] **Step 4.1: 讀檔確認現狀**

```bash
cat -n src/features/dashboard/TrialBanner.tsx | sed -n '60,90p'
```
預期：L69-88 是試用已到期分支（最後 return 的 div）。

- [ ] **Step 4.2: 加 daysSinceEnd 檢查**

把 L69 之前（試用結束分支起手位置，現在是直接 return JSX）改成：

```tsx
  // 試用已到期：限期 7 天顯示，之後讓 AiQuotaBanner 接手提醒
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const daysSinceEnd = trial.endsAt
    ? Math.floor((Date.now() - trial.endsAt.getTime()) / MS_PER_DAY)
    : 0;
  if (daysSinceEnd > 7) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-muted bg-muted/40 p-4">
      {/* 既有「Pro 試用已結束」內容不動 */}
      ...
    </div>
  );
```

完整修改後該檔案的最後一段（從 L69 開始）長這樣：

```tsx
  // 試用已到期：限期 7 天顯示，之後讓 AiQuotaBanner 接手提醒
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const daysSinceEnd = trial.endsAt
    ? Math.floor((Date.now() - trial.endsAt.getTime()) / MS_PER_DAY)
    : 0;
  if (daysSinceEnd > 7) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-muted bg-muted/40 p-4">
      <div className="flex items-center gap-3">
        <span className="text-xl" aria-hidden="true">🔒</span>
        <div>
          <p className="text-sm font-semibold text-foreground">Pro 試用已結束</p>
          <p className="text-xs text-muted-foreground">
            已自動降級為免費方案，升級解鎖無限測驗與 AI 出題
          </p>
        </div>
      </div>
      <Link
        href="/dashboard/billing"
        className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        升級 Pro
      </Link>
    </div>
  );
}
```

- [ ] **Step 4.3: 跑型別與 lint 檢查**

```bash
npm run check-types && npm run lint -- src/features/dashboard/TrialBanner.tsx
```

- [ ] **Step 4.4: 手動驗證 3 種狀態**

`npm run dev` 後，到 `/dashboard` 看 banner：

| 狀態 | DB 條件 | 預期 banner |
|------|--------|------------|
| 試用中（剩 ≤7 天） | user_trial.ends_at = 今天 + 5 天 | 倒數 banner（既有邏輯） |
| 剛到期 6 天內 | user_trial.ends_at = 今天 - 6 天 | 🔒「Pro 試用已結束」 |
| 到期 8 天 | user_trial.ends_at = 今天 - 8 天 | banner **完全消失** |

- [ ] **Step 4.5: Commit**

```bash
git add src/features/dashboard/TrialBanner.tsx
git commit -m "$(cat <<'EOF'
fix(trial-banner): 到期 banner 限期 7 天顯示

Fix 3 of 4 缺口修補。原邏輯只要 trial 過期就永久顯示「🔒 Pro 試用已結束」
banner，6 個月後還在干擾用戶。改為計算 daysSinceEnd > 7 即 return null，
之後讓 AiQuotaBanner（free 用戶用到 60% quota 才出現）接手提醒。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 整合驗證 + 更新 CLAUDE.md TODO

- [ ] **Step 5.1: 整合測試（4 個 Fix 一起跑）**

`npm run dev`，依序確認：

1. 新用戶 sign up → 進 dashboard → user_trial 表自動有紀錄、endsAt = +30 天 ✅ Fix 4
2. 該用戶連續呼叫 AI 出題 11 次 → 不被擋 ✅ Fix 1
3. 該用戶看 `/dashboard/billing` → 顯示「Pro 老師（試用中）」+ 副標倒數 + AI 用量「無限制」 ✅ Fix 2
4. 把該用戶 user_trial.ends_at 改成 8 天前 → 重訪 `/dashboard` → 鎖頭 banner 消失 ✅ Fix 3

- [ ] **Step 5.2: 更新 CLAUDE.md「下一步優先順序」**

把 CLAUDE.md L240（原文）：
```
2. 免費試用機制（Pro 功能 30 天體驗，到期自動降級）
```

改成：
```
2. ~~免費試用機制（Pro 功能 30 天體驗，到期自動降級）~~ — 2026-04-30 完成 4 缺口修補（Fix 1-4，spec: docs/superpowers/specs/2026-04-30-pro-trial-fixes-design.md）
```

並把這條從「🔥 下一步優先順序」清單往下移、或標 ✅ 完成；後續 list 第 3、4、5 條編號上推。

- [ ] **Step 5.3: Commit CLAUDE.md 更新**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(claude.md): mark 試用機制 4 缺口修補完成

實作完成 Fix 1-4：AI quota 走 trial、dashboard layout eager trigger、
billing 頁顯示試用狀態、到期 banner 限期 7 天。
Spec: docs/superpowers/specs/2026-04-30-pro-trial-fixes-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5.4: 最終 status 檢查**

```bash
git status && git log --oneline -6
```
預期：working tree clean、最近 5 commits 是 Task 1-5 的 commit 加上 spec commit。

---

## 風險與回滾

每個 Task 都單獨 commit，回滾單一 Task 用：
```bash
git revert <commit-sha>
```

若 Task 2 (Fix 4 layout 轉 async) 出意外（例如 next-intl context 異常），優先嘗試把
`getTranslations` 換回 `useTranslations` 並把 function 改回 sync——但此時 `auth()` +
`ensureTrialRecord()` 就無法在 layout 跑，需移到 `dashboard/page.tsx`（覆蓋率不全，
直跳 `/dashboard/quizzes` 會漏，但能跑）。如真遇到再評估。

DB schema 完全不動，無 rollback migration 需求。

## Out of Scope（提醒實作者勿擴張）

spec「不在本 spec 範圍」段已列。本 plan 不處理：

- Email 試用提醒
- Admin UI 重置試用
- 試用過期 grace period
- 30 天天數調整
- TrialBanner / billing 文案 i18n migration
- Paddle production 上線後 disabled 按鈕修
- 試用結束後 free quiz 額度溢出處理（10 份上限）
- VIP 在 billing 頁顯示「Pro」客製化
- `ensureTrialRecord` race condition（onConflictDoNothing 長期 fix）
