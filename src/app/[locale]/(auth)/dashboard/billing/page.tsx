import { auth } from '@clerk/nextjs/server';

import { getAiUsageRemaining } from '@/actions/aiUsageActions';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { getOrgPlanId } from '@/libs/Plan';
import { PLAN_ID, PricingPlanList } from '@/utils/AppConfig';

export const dynamic = 'force-dynamic';

export default async function BillingPage() {
  const { orgId } = await auth();

  // 未登入 fallback
  if (!orgId) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        請先登入以查看方案資訊。
      </div>
    );
  }

  const planId = await getOrgPlanId(orgId);
  const plan = PricingPlanList[planId] ?? PricingPlanList[PLAN_ID.FREE]!;
  const isPro = planId === PLAN_ID.PREMIUM || planId === PLAN_ID.ENTERPRISE;
  const aiUsage = await getAiUsageRemaining(orgId);

  return (
    <>
      <TitleBar title="方案與帳單" description="管理你的訂閱方案" />

      <div className="space-y-6 px-4">
        {/* 目前方案卡片 */}
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">目前方案</p>
              <p className="mt-1 text-2xl font-bold">
                {planId === PLAN_ID.ENTERPRISE
                  ? '學校方案'
                  : isPro
                    ? 'Pro 老師'
                    : '免費版'}
              </p>
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

        {/* 功能用量 */}
        <div className="rounded-lg border bg-card p-6">
          <h2 className="mb-4 text-lg font-semibold">使用狀況</h2>
          <div className="space-y-4">
            {/* 測驗數量 */}
            <UsageRow
              label="測驗數量上限"
              value={plan.features.website >= 999 ? '無限制' : `${plan.features.website} 份`}
            />
            {/* AI 出題次數 */}
            <div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">本月 AI 出題</span>
                <span className="font-medium">
                  {aiUsage.quota >= 999
                    ? '無限制'
                    : `${aiUsage.used} / ${aiUsage.quota} 次`}
                </span>
              </div>
              {aiUsage.quota < 999 && (
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full transition-all ${
                      aiUsage.remaining === 0 ? 'bg-red-500' : 'bg-primary'
                    }`}
                    style={{ width: `${Math.min(100, (aiUsage.used / aiUsage.quota) * 100)}%` }}
                  />
                </div>
              )}
            </div>
            {/* 團隊成員 */}
            <UsageRow
              label="團隊成員"
              value={plan.features.teamMember >= 999 ? '無限制' : `${plan.features.teamMember} 人`}
            />
          </div>
        </div>

        {/* 升級 / 管理訂閱 */}
        {!isPro
          ? (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-6">
                <h2 className="mb-2 text-lg font-semibold">升級至 Pro 方案</h2>
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
            )
          : (
              <div className="rounded-lg border bg-card p-6">
                <h2 className="mb-2 text-lg font-semibold">訂閱管理</h2>
                <p className="mb-4 text-sm text-muted-foreground">
                  你目前使用的是
                  {' '}
                  <strong>{planId === PLAN_ID.ENTERPRISE ? '學校方案' : 'Pro 老師'}</strong>
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
            )}

        {/* 方案比較表 */}
        <div className="rounded-lg border bg-card p-6">
          <h2 className="mb-4 text-lg font-semibold">方案比較</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">功能</th>
                  <th className="px-4 py-2 text-center font-medium">免費版</th>
                  <th className="px-4 py-2 text-center font-medium">Pro 老師</th>
                  <th className="px-4 py-2 text-center font-medium">學校方案</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                <CompareRow feature="測驗數量" free="10 份" pro="無限" enterprise="無限" />
                <CompareRow feature="AI 出題" free="10 次/月" pro="無限" enterprise="無限" />
                <CompareRow feature="團隊成員" free="1 人" pro="1 人" enterprise="最多 30 人" />
                <CompareRow feature="AI 班級分析" free="—" pro="✓" enterprise="✓" />
                <CompareRow feature="CSV 匯出" free="—" pro="✓" enterprise="✓" />
                <CompareRow feature="價格" free="免費" pro="NT$299/月" enterprise="NT$1,990/月" />
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

// 使用量列
function UsageRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

// 功能項目（勾選列表）
function FeatureItem({ text }: { text: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs text-primary">
        ✓
      </span>
      {text}
    </li>
  );
}

// 方案比較列
function CompareRow({ feature, free, pro, enterprise }: {
  feature: string;
  free: string;
  pro: string;
  enterprise: string;
}) {
  return (
    <tr>
      <td className="px-4 py-2 font-medium">{feature}</td>
      <td className="px-4 py-2 text-center text-muted-foreground">{free}</td>
      <td className="px-4 py-2 text-center">{pro}</td>
      <td className="px-4 py-2 text-center">{enterprise}</td>
    </tr>
  );
}
