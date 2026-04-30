/**
 * TrialBanner — Dashboard 顯示 Pro 試用倒數 / 已到期提示
 * 僅在 (a) 沒有付費訂閱 且 (b) 有試用紀錄 時顯示
 */

import Link from 'next/link';

import { getUserPlanId } from '@/libs/Plan';
import { getTrialStatus } from '@/libs/trial';
import { PLAN_ID } from '@/utils/AppConfig';

type Props = {
  clerkUserId: string;
};

export async function TrialBanner({ clerkUserId }: Props) {
  // 已付費用戶不顯示試用 banner
  const planId = await getUserPlanId(clerkUserId);
  if (planId === PLAN_ID.PREMIUM || planId === PLAN_ID.ENTERPRISE || planId === PLAN_ID.PUBLISHER) {
    return null;
  }

  const trial = await getTrialStatus(clerkUserId);
  if (!trial) {
    return null;
  }

  // 試用中：只在剩 ≤ 7 天才顯示 banner（避免每天都看到干擾）
  if (trial.inTrial) {
    if (trial.daysLeft > 7) {
      return null;
    }
    const urgent = trial.daysLeft <= 3;
    return (
      <div
        className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${
          urgent
            ? 'border-amber-300 bg-amber-50'
            : 'border-primary/30 bg-primary/5'
        }`}
      >
        <div className="flex items-center gap-3">
          <span className="text-xl" aria-hidden="true">
            {urgent ? '⏰' : '🎁'}
          </span>
          <div>
            <p className={`text-sm font-semibold ${urgent ? 'text-amber-800' : 'text-foreground'}`}>
              Pro 試用剩
              {' '}
              {trial.daysLeft}
              {' '}
              天
            </p>
            <p className="text-xs text-muted-foreground">
              試用期結束後會自動降級為免費方案
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
