/**
 * AiQuotaBanner — 免費方案老師使用 AI 出題額度接近上限時顯示升級提示
 * 觸發條件：
 *  - 方案為免費
 *  - 本月 AI 出題使用率 >= 60%
 * 視覺：60~79% 綠、80~94% 琥珀、95%+ 紅
 */

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { getAiUsageRemaining } from '@/actions/aiUsageActions';
import { getOrgPlanId } from '@/libs/Plan';
import { PLAN_ID } from '@/utils/AppConfig';

type Props = {
  orgId: string | null | undefined;
};

export async function AiQuotaBanner({ orgId }: Props) {
  if (!orgId) return null;

  const planId = await getOrgPlanId(orgId);
  // 付費方案不顯示
  if (planId === PLAN_ID.PREMIUM || planId === PLAN_ID.ENTERPRISE) {
    return null;
  }

  const usage = await getAiUsageRemaining(orgId);
  if (usage.quota >= 999) return null;

  const pct = usage.quota > 0 ? (usage.used / usage.quota) * 100 : 0;
  if (pct < 60) return null;

  const level: 'info' | 'warn' | 'danger'
    = pct >= 95 ? 'danger' : pct >= 80 ? 'warn' : 'info';

  const styles = {
    info: 'border-primary/30 bg-primary/5',
    warn: 'border-amber-300 bg-amber-50',
    danger: 'border-red-300 bg-red-50',
  }[level];

  const icon = level === 'danger' ? '🚨' : level === 'warn' ? '⚡' : '📊';

  const t = await getTranslations('AiQuota');
  const title = level === 'danger'
    ? t('title_danger', { used: usage.used, quota: usage.quota })
    : t('title_warn', { remaining: usage.remaining });

  const subtitle = level === 'danger'
    ? t('subtitle_danger')
    : t('subtitle_warn');

  const barColor = {
    info: 'bg-primary',
    warn: 'bg-amber-500',
    danger: 'bg-red-500',
  }[level];

  return (
    <div className={`rounded-xl border p-4 ${styles}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-xl" aria-hidden="true">{icon}</span>
          <div>
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <Link
          href="/dashboard/billing"
          className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {t('cta')}
        </Link>
      </div>
      {/* 進度條 */}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-background/70">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}
