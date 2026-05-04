# 公開頁定價隱藏 Pro/Team 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 訪客 / Free 用戶 < 10 份只在公開頁看到 Free 方案；付費 Pro/Team/Publisher 或 quiz 數 ≥10 才看到完整三方案。

**Architecture:** 抽 server helper `getPricingVisibility()` 給兩個 pricing surface（landing 定價區塊 + `/zh/pricing`）共用。helper 內部拆「純函數 `evaluateVisibility`」+「async wrapper」對齊 `fork.ts` 模式，純邏輯獨立可測。

**Tech Stack:** Next.js 14 App Router、next-intl、Drizzle ORM、Clerk、vitest。

**Spec：** `docs/superpowers/specs/2026-05-04-pricing-paid-plans-gating-design.md`

---

## Task 1：建立 `evaluateVisibility` 純函數 + 4 分支單測（TDD）

**Files:**
- Create: `src/libs/PricingVisibility.ts`
- Create: `src/libs/PricingVisibility.test.ts`

- [ ] **Step 1：寫測試先（TDD red）**

建立 `src/libs/PricingVisibility.test.ts`：

```ts
// 4 分支純函數單測（對齊 src/libs/fork.test.ts 不接 DB 的風格）

import { describe, expect, it } from 'vitest';

import { PLAN_ID } from '@/utils/AppConfig';

import { evaluateVisibility } from './PricingVisibility';

describe('evaluateVisibility', () => {
  it('未登入訪客 → guest 分支，不顯示付費卡', () => {
    const result = evaluateVisibility({
      isAuthed: false,
      planId: PLAN_ID.FREE,
      quizCount: 0,
    });
    expect(result).toEqual({ showPaidPlans: false, reason: 'guest' });
  });

  it('已登入 PREMIUM → paid 分支，顯示完整方案', () => {
    const result = evaluateVisibility({
      isAuthed: true,
      planId: PLAN_ID.PREMIUM,
      quizCount: 0,
    });
    expect(result).toEqual({ showPaidPlans: true, reason: 'paid' });
  });

  it('已登入 ENTERPRISE → paid 分支，顯示完整方案', () => {
    const result = evaluateVisibility({
      isAuthed: true,
      planId: PLAN_ID.ENTERPRISE,
      quizCount: 0,
    });
    expect(result).toEqual({ showPaidPlans: true, reason: 'paid' });
  });

  it('已登入 PUBLISHER → paid 分支，顯示完整方案', () => {
    const result = evaluateVisibility({
      isAuthed: true,
      planId: PLAN_ID.PUBLISHER,
      quizCount: 0,
    });
    expect(result).toEqual({ showPaidPlans: true, reason: 'paid' });
  });

  it('已登入 FREE + quiz 數 = 10（剛達門檻）→ reached 分支', () => {
    const result = evaluateVisibility({
      isAuthed: true,
      planId: PLAN_ID.FREE,
      quizCount: 10,
    });
    expect(result).toEqual({ showPaidPlans: true, reason: 'reached' });
  });

  it('已登入 FREE + quiz 數 = 11（超過門檻）→ reached 分支', () => {
    const result = evaluateVisibility({
      isAuthed: true,
      planId: PLAN_ID.FREE,
      quizCount: 11,
    });
    expect(result).toEqual({ showPaidPlans: true, reason: 'reached' });
  });

  it('已登入 FREE + quiz 數 = 9（差一份）→ under 分支', () => {
    const result = evaluateVisibility({
      isAuthed: true,
      planId: PLAN_ID.FREE,
      quizCount: 9,
    });
    expect(result).toEqual({ showPaidPlans: false, reason: 'under' });
  });

  it('已登入 FREE + quiz 數 = 0 → under 分支', () => {
    const result = evaluateVisibility({
      isAuthed: true,
      planId: PLAN_ID.FREE,
      quizCount: 0,
    });
    expect(result).toEqual({ showPaidPlans: false, reason: 'under' });
  });
});
```

- [ ] **Step 2：跑測試確認失敗**

執行：

```bash
npx vitest run src/libs/PricingVisibility.test.ts
```

預期：FAIL — `Cannot find module './PricingVisibility'` 或 `evaluateVisibility is not a function`。

- [ ] **Step 3：建立 `src/libs/PricingVisibility.ts` 純函數**

```ts
/**
 * 定價頁可見性 helper（公開首頁定價區塊 + /zh/pricing 共用）
 *
 * 規則：付費（PREMIUM/ENTERPRISE/PUBLISHER）OR 帳號內 quiz 數 ≥ 10 → 顯示完整三方案
 * 否則只顯示 Free。
 *
 * 拆「純函數 evaluateVisibility」+「async wrapper getPricingVisibility」
 * 對齊 fork.ts 模式，純邏輯獨立可測。
 */

import { PLAN_ID } from '@/utils/AppConfig';

export type PricingVisibilityReason = 'guest' | 'under' | 'reached' | 'paid';

export type PricingVisibility = {
  showPaidPlans: boolean;
  reason: PricingVisibilityReason;
};

// quiz 數門檻（對齊 AppConfig Free website: 10）
export const QUIZ_THRESHOLD = 10;

const PAID_PLAN_IDS = new Set<string>([
  PLAN_ID.PREMIUM,
  PLAN_ID.ENTERPRISE,
  PLAN_ID.PUBLISHER,
]);

/**
 * 純函數：依輸入決定 showPaidPlans
 * 不接任何外部依賴，可獨立測試
 */
export function evaluateVisibility(input: {
  isAuthed: boolean;
  planId: string;
  quizCount: number;
}): PricingVisibility {
  if (!input.isAuthed) {
    return { showPaidPlans: false, reason: 'guest' };
  }
  if (PAID_PLAN_IDS.has(input.planId)) {
    return { showPaidPlans: true, reason: 'paid' };
  }
  if (input.quizCount >= QUIZ_THRESHOLD) {
    return { showPaidPlans: true, reason: 'reached' };
  }
  return { showPaidPlans: false, reason: 'under' };
}
```

- [ ] **Step 4：跑測試確認通過**

執行：

```bash
npx vitest run src/libs/PricingVisibility.test.ts
```

預期：PASS — 8 個測試全綠。

- [ ] **Step 5：commit**

```bash
git add src/libs/PricingVisibility.ts src/libs/PricingVisibility.test.ts
git commit -m "feat(pricing): evaluateVisibility 純函數 + 4 分支單測

純邏輯：未登入訪客 / 付費 (PREMIUM/ENTERPRISE/PUBLISHER) /
quiz ≥10 達門檻 / 不到門檻 4 分支判定 showPaidPlans。下一步
加 async wrapper 串 DB。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2：加 `getPricingVisibility` async wrapper（接 DB）

**Files:**
- Modify: `src/libs/PricingVisibility.ts`

- [ ] **Step 1：在 `PricingVisibility.ts` 末尾加 async wrapper**

在 `evaluateVisibility` 後面加上：

```ts
import { auth } from '@clerk/nextjs/server';
import { count, eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { getUserPlanId } from '@/libs/Plan';
import { quizSchema } from '@/models/Schema';

/**
 * server helper：拉 auth + planId + quiz count，呼叫 evaluateVisibility
 *
 * 注意：呼叫端的 server component 需配合 noStore() 或 dynamic = 'force-dynamic'
 * 避免 ISR 把單一用戶結果靜態快取給所有訪客。
 */
export async function getPricingVisibility(): Promise<PricingVisibility> {
  const { userId } = await auth();

  if (!userId) {
    return evaluateVisibility({ isAuthed: false, planId: PLAN_ID.FREE, quizCount: 0 });
  }

  const planId = await getUserPlanId(userId);

  // 已是付費方案就不用算 quiz 數，直接 paid 分支
  if (PAID_PLAN_IDS.has(planId)) {
    return evaluateVisibility({ isAuthed: true, planId, quizCount: 0 });
  }

  // Free（含試用中，因為 trial 不算 paid 訂閱）→ 算 quiz 數
  const [row] = await db
    .select({ total: count() })
    .from(quizSchema)
    .where(eq(quizSchema.ownerId, userId));

  return evaluateVisibility({
    isAuthed: true,
    planId,
    quizCount: row?.total ?? 0,
  });
}
```

把 `import` 整合到檔頂（auth、count/eq、db、getUserPlanId、quizSchema）。最終 import 排序對齊 `simple-import-sort`：

```ts
import { auth } from '@clerk/nextjs/server';
import { count, eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { getUserPlanId } from '@/libs/Plan';
import { quizSchema } from '@/models/Schema';
import { PLAN_ID } from '@/utils/AppConfig';
```

- [ ] **Step 2：跑單測確認沒破壞純函數測試**

執行：

```bash
npx vitest run src/libs/PricingVisibility.test.ts
```

預期：PASS — 8 個測試仍全綠（async wrapper 加進來不影響純函數測試）。

- [ ] **Step 3：跑型別檢查**

執行：

```bash
npm run check-types
```

預期：無 error。

- [ ] **Step 4：跑 lint 修 import 排序**

執行：

```bash
npx eslint --fix src/libs/PricingVisibility.ts
```

預期：無錯，import 順序自動修齊。

- [ ] **Step 5：commit**

```bash
git add src/libs/PricingVisibility.ts
git commit -m "feat(pricing): getPricingVisibility async wrapper 接 DB

未登入直接 guest;已登入查 getUserPlanId,付費跳過 quiz count
查詢直接 paid;Free / 試用中走 quiz 數判定。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3：Surface B（`/zh/pricing`）— 套 visibility gate

**Files:**
- Modify: `src/components/pricing/PricingSection.tsx`
- Modify: `src/app/[locale]/(unauth)/pricing/page.tsx`

- [ ] **Step 1：`PricingSection.tsx` 加 `showPaidPlans` prop 並過濾 PLANS**

修改 `src/components/pricing/PricingSection.tsx`，元件 signature 從 `export function PricingSection() {` 改為：

```tsx
export function PricingSection({ showPaidPlans }: { showPaidPlans: boolean }) {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('yearly');

  // showPaidPlans=false 時只顯示 Free（monthlyPrice === 0），true 時顯示完整 PLANS
  const visiblePlans = showPaidPlans ? PLANS : PLANS.filter(plan => plan.monthlyPrice === 0);
```

並把 render 的 `PLANS.map(...)` 改成 `visiblePlans.map(...)`：

```tsx
        <div className="grid gap-6 md:grid-cols-3 md:items-stretch">
          {visiblePlans.map(plan => (
            <PricingCard key={plan.name} plan={plan} billingCycle={billingCycle} />
          ))}
        </div>
```

注意：showPaidPlans=false 只剩一張卡時，仍用 grid-cols-3 佈局會讓單卡靠左。如果視覺上不夠好看，可在這個情境下改 layout：

```tsx
        <div className={`grid gap-6 md:items-stretch ${
          visiblePlans.length === 1 ? 'md:max-w-md md:mx-auto' : 'md:grid-cols-3'
        }`}>
```

採用後者讓單卡置中。

- [ ] **Step 2：`pricing/page.tsx` 改 server async + 注入 prop + dynamic**

修改 `src/app/[locale]/(unauth)/pricing/page.tsx`：

```tsx
import { getTranslations, unstable_setRequestLocale } from 'next-intl/server';

import { PricingSection } from '@/components/pricing/PricingSection';
import { getPricingVisibility } from '@/libs/PricingVisibility';
import { CTA } from '@/templates/CTA';
import { FAQ } from '@/templates/FAQ';
import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';

// 避免 ISR 把單一用戶結果靜態快取給所有訪客
export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: { locale: string } }) {
  const t = await getTranslations({
    locale: props.params.locale,
    namespace: 'PricingPage',
  });

  return {
    title: t('meta_title'),
    description: t('meta_description'),
  };
}

const PricingPage = async (props: { params: { locale: string } }) => {
  unstable_setRequestLocale(props.params.locale);
  const { showPaidPlans } = await getPricingVisibility();

  return (
    <>
      <Navbar />
      <PricingSection showPaidPlans={showPaidPlans} />
      <FAQ />
      <CTA />
      <Footer />
    </>
  );
};

export default PricingPage;
```

差異：
- 加 `export const dynamic = 'force-dynamic'`
- 元件改 `async`
- 加 `await getPricingVisibility()` 取 `showPaidPlans`
- `<PricingSection />` 加 prop

- [ ] **Step 3：型別檢查 + lint**

```bash
npm run check-types && npx eslint --fix src/components/pricing/PricingSection.tsx src/app/\[locale\]/\(unauth\)/pricing/page.tsx
```

預期：無 error。

- [ ] **Step 4：本機驗收 — 訪客模式只看到 Free 卡**

執行：

```bash
npm run dev
```

開無痕視窗 → `http://localhost:3000/zh/pricing` → 確認頁面只顯示「免費試用」一張卡，沒看到 Pro / 學校方案。

- [ ] **Step 5：本機驗收 — 已登入 9 份只 Free，10 份解鎖**

登入測試帳號（quiz 數 < 10）→ 重整 `/zh/pricing` → 只看到 Free。
手動建到 10 份（或用 SQL 直接 insert 補滿）→ 重整 → 看到完整 3 卡。

- [ ] **Step 6：commit**

```bash
git add src/components/pricing/PricingSection.tsx src/app/\[locale\]/\(unauth\)/pricing/page.tsx
git commit -m "feat(pricing): /zh/pricing 套 visibility gate

訪客 / Free <10 份只看到免費卡;付費或 ≥10 份顯示完整三方案。
單卡情境改置中佈局避免靠左空洞。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4：Surface A（landing `/` 定價區塊）— 套 visibility gate

**Files:**
- Modify: `src/templates/Pricing.tsx`
- Modify: `src/features/billing/PricingInformation.tsx`

- [ ] **Step 1：`PricingInformation.tsx` 加 `showPaidPlans` prop 並過濾 plans**

修改 `src/features/billing/PricingInformation.tsx`：

```tsx
import { useTranslations } from 'next-intl';

import { PricingCard } from '@/features/billing/PricingCard';
import { PricingFeature } from '@/features/billing/PricingFeature';
import { PLAN_ID, PricingPlanList } from '@/utils/AppConfig';

export const PricingInformation = (props: {
  buttonList: Record<string, React.ReactNode>;
  showPaidPlans: boolean;
}) => {
  const t = useTranslations('PricingPlan');

  // 書商方案（publisher）非自助購買，走 sales 流程，不顯示於公開定價頁
  const allPublic = Object.values(PricingPlanList).filter(plan => plan.id !== PLAN_ID.PUBLISHER);

  // showPaidPlans=false 時只顯示 FREE 卡
  const visiblePlans = props.showPaidPlans
    ? allPublic
    : allPublic.filter(plan => plan.id === PLAN_ID.FREE);

  return (
    <div className={`grid grid-cols-1 gap-x-6 gap-y-8 ${
      visiblePlans.length === 1 ? 'md:max-w-md md:mx-auto' : 'md:grid-cols-3'
    }`}>
      {visiblePlans.map(plan => (
        <PricingCard
          key={plan.id}
          planId={plan.id}
          price={plan.price}
          interval={plan.interval}
          button={props.buttonList[plan.id]}
        >
          <PricingFeature>
            {t('feature_team_member', {
              number: plan.features.teamMember,
            })}
          </PricingFeature>

          <PricingFeature>
            {t('feature_website', {
              number: plan.features.website,
            })}
          </PricingFeature>

          {/* AI 出題：Free (storage=0) 顯示「Pro 限定」，Pro 以上正常顯示 */}
          {plan.features.storage > 0 && (
            <PricingFeature>
              {t('feature_storage', {
                number: plan.features.storage,
              })}
            </PricingFeature>
          )}

          <PricingFeature>
            {t('feature_transfer')}
          </PricingFeature>

          <PricingFeature>{t('feature_email_support')}</PricingFeature>
        </PricingCard>
      ))}
    </div>
  );
};
```

差異：
- 加 `showPaidPlans: boolean` prop
- `publicPlans` 改名 `allPublic`，再加一層 `visiblePlans` 過濾
- grid layout 加單卡置中分支

- [ ] **Step 2：`templates/Pricing.tsx` 改 async server + getTranslations + 注入 prop**

修改 `src/templates/Pricing.tsx`：

```tsx
import Link from 'next/link';
import { unstable_noStore as noStore } from 'next/cache';
import { getTranslations } from 'next-intl/server';

import { buttonVariants } from '@/components/ui/buttonVariants';
import { PricingInformation } from '@/features/billing/PricingInformation';
import { Section } from '@/features/landing/Section';
import { getPricingVisibility } from '@/libs/PricingVisibility';
import { PLAN_ID } from '@/utils/AppConfig';

export const Pricing = async () => {
  // 避免 ISR 快取單一用戶結果給所有訪客
  noStore();

  const t = await getTranslations('Pricing');
  const { showPaidPlans } = await getPricingVisibility();

  return (
    <Section
      subtitle={t('section_subtitle')}
      title={t('section_title')}
      description={t('section_description')}
    >
      <PricingInformation
        showPaidPlans={showPaidPlans}
        buttonList={{
          [PLAN_ID.FREE]: (
            <Link
              className={buttonVariants({
                size: 'sm',
                className: 'mt-5 w-full',
              })}
              href="/sign-up"
            >
              {t('button_text')}
            </Link>
          ),
          [PLAN_ID.PREMIUM]: (
            <Link
              className={buttonVariants({
                size: 'sm',
                className: 'mt-5 w-full',
              })}
              href="/sign-up"
            >
              {t('button_text')}
            </Link>
          ),
          [PLAN_ID.ENTERPRISE]: (
            <Link
              className={buttonVariants({
                size: 'sm',
                className: 'mt-5 w-full',
              })}
              href="/sign-up"
            >
              {t('button_text')}
            </Link>
          ),
        }}
      />
    </Section>
  );
};
```

差異：
- 元件改 `async`
- import 從 `useTranslations` 換成 `getTranslations` 並加 `noStore` import
- 函數頂端加 `noStore()` 阻擋 ISR
- 加 `await getPricingVisibility()` 取 `showPaidPlans`
- `<PricingInformation>` 加 prop

- [ ] **Step 3：型別檢查 + lint**

```bash
npm run check-types && npx eslint --fix src/features/billing/PricingInformation.tsx src/templates/Pricing.tsx
```

預期：無 error。

- [ ] **Step 4：本機驗收 — 訪客 landing 只看到 Free 卡**

無痕視窗 `http://localhost:3000/zh` → 滾到定價區塊 → 只看到「免費試用」一張卡置中。

- [ ] **Step 5：本機驗收 — 已登入 ≥10 份解鎖**

登入測試帳號（≥10 份）→ 重整 `http://localhost:3000/zh` → 定價區塊看到完整 3 卡。
登入帳號 < 10 份 → 重整 → 只看到 Free 卡。

- [ ] **Step 6：commit**

```bash
git add src/features/billing/PricingInformation.tsx src/templates/Pricing.tsx
git commit -m "feat(pricing): landing 定價區塊套 visibility gate

訪客 / Free <10 份只看到免費卡;付費或 ≥10 份顯示完整三方案。
templates/Pricing 改 async + noStore() 避 ISR 快取。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5：整合驗收 + 跑全 lint/型別/測試

**Files:** 無（整合驗證）

- [ ] **Step 1：跑全測試確認沒踩雷**

```bash
npm run test -- --run
```

預期：所有測試 PASS（PricingVisibility 8 個 + 既有測試）。

- [ ] **Step 2：跑全型別檢查**

```bash
npm run check-types
```

預期：無 error。

- [ ] **Step 3：跑 lint**

```bash
npm run lint
```

預期：無 error。

- [ ] **Step 4：build 驗證（catch SSR / dynamic 配置錯誤）**

```bash
npm run build
```

預期：build success。注意 `pricing/page.tsx` 應顯示為 dynamic（Server Function），非 Static。

- [ ] **Step 5：手動端到端驗收（spec 第 116–120 行 5 個 scenario）**

啟動 dev server：

```bash
npm run dev
```

逐一驗證：
1. 無痕進 `/zh` 定價區塊與 `/zh/pricing` → 只看到 Free
2. 登入 quiz 9 份帳號 → 兩處仍只看到 Free
3. 把 quiz 補到 10 份 → 重整 → 兩處看到 Free + Pro + 學校方案
4. 登入付費 Pro 帳號 → 任何 quiz 數都看到完整三卡
5. Navbar「方案」連結 → 訪客 / 已登入 < 10 份點擊 → 進公開定價頁仍只看 Free

- [ ] **Step 6：擴充 CLAUDE.md「已完成」清單（如果用戶要求）**

預設**不動** CLAUDE.md（保持小範圍 commit），由用戶 review 後決定是否補一行進「已完成」清單。

---

## Self-Review Notes

- ✅ Spec 4 個分支邏輯都有對應 task（Task 1 純函數測 4 分支 + 額外邊界）
- ✅ 兩個 surface 都有獨立 task（Task 3 / Task 4）
- ✅ ISR 快取問題用 `noStore()`（Task 4）和 `dynamic = 'force-dynamic'`（Task 3）解決
- ✅ 不改 `dashboard/billing`（按 Q4 (a) 決議）
- ✅ 不改 `AppConfig` quota（已是 10）
- ✅ 不動 i18n（不顯示就不需新文字）
- ✅ 每個 task 都有獨立 commit 點，可分批 review

## Rollback 策略

每個 task 都是獨立 commit。回滾單獨任意 task：

```bash
git revert <commit-hash>
```

helper 檔案無 caller 時 dead code，不影響執行；先 revert Surface 改動，helper 留著無害。
