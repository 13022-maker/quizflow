/**
 * TrialPill — 工作頁面（測驗列表 / quiz editor）顯示輕量試用倒數
 *
 * 與 TrialBanner 差異：
 *   - 試用「全期」都顯示（TrialBanner 只在 ≤7 天才顯示）
 *   - 樣式為 inline-flex pill，不占整列
 *   - 同樣支援 ≤3 天紅色警示與到期灰色
 */

import Link from 'next/link';

import { getOrgPlanId } from '@/libs/Plan';
import { getTrialStatus } from '@/libs/trial';
import { PLAN_ID } from '@/utils/AppConfig';

type Props = {
  clerkUserId: string;
  orgId: string | null | undefined;
};

export async function TrialPill({ clerkUserId, orgId }: Props) {
  // 已付費用戶：完全不顯示 pill
  const planId = await getOrgPlanId(orgId ?? '');
  if (planId === PLAN_ID.PREMIUM || planId === PLAN_ID.ENTERPRISE || planId === PLAN_ID.PUBLISHER) {
    return null;
  }

  // 沒試用紀錄（未走過 isProOrAbove）：不顯示
  const trial = await getTrialStatus(clerkUserId);
  if (!trial) {
    return null;
  }

  const baseClass
    = 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors';

  // 試用中
  if (trial.inTrial) {
    const urgent = trial.daysLeft <= 3;
    const stateClass = urgent
      ? 'bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-200'
      : 'bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15';
    const icon = urgent ? '⏰' : '🎁';
    return (
      <Link href="/dashboard/billing" className={`${baseClass} ${stateClass}`}>
        <span aria-hidden="true">{icon}</span>
        <span>
          Pro 試用
          {urgent ? '剩' : ' '}
          {trial.daysLeft}
          {' '}
          天
        </span>
      </Link>
    );
  }

  // 試用已到期
  return (
    <Link
      href="/dashboard/billing"
      className={`${baseClass} border border-border bg-muted text-muted-foreground hover:bg-muted/80`}
    >
      <span aria-hidden="true">🔒</span>
      <span>試用已結束</span>
    </Link>
  );
}
