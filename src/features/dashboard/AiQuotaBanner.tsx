/**
 * AiQuotaBanner — 顯示 AI 功能的月配額使用狀態（接近上限時顯示升級提示）
 * feature:
 *   - 'question_generation'（預設）：AI 出題（Free 10 次/月，Pro 無限）
 *   - 'essay_grading'：AI 申論題/作文批改（Pro 500 份/月，Free 不開放）
 * 觸發條件：
 *  - question_generation：Free 方案 + 使用率 >= 60%
 *  - essay_grading：Pro 方案 + 使用率 >= 60%，或 Free 時直接顯示 Pro 升級提示
 * 視覺：60~79% 綠、80~94% 琥珀、95%+ 紅
 */

import Link from 'next/link';

import { type AiFeature, getAiUsageRemaining } from '@/actions/aiUsageActions';
import { getOrgPlanId } from '@/libs/Plan';
import { PLAN_ID } from '@/utils/AppConfig';

type Props = {
  orgId: string | null | undefined;
  feature?: AiFeature;
};

export async function AiQuotaBanner({ orgId, feature = 'question_generation' }: Props) {
  if (!orgId) {
    return null;
  }

  const planId = await getOrgPlanId(orgId);
  const isPaid = planId === PLAN_ID.PREMIUM || planId === PLAN_ID.ENTERPRISE;

  // 出題功能：付費方案隱藏
  if (feature === 'question_generation' && isPaid) {
    return null;
  }

  // 批改功能：若 Free 方案，直接顯示「升級 Pro 才可使用」
  if (feature === 'essay_grading' && !isPaid) {
    return (
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-xl" aria-hidden="true">✨</span>
            <div>
              <p className="text-sm font-semibold text-foreground">AI 作文批改為 Pro 方案專屬</p>
              <p className="text-xs text-muted-foreground">升級即可每月 AI 批改 500 份作文，省下每週批改時間</p>
            </div>
          </div>
          <Link
            href="/dashboard/billing"
            className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            升級 Pro
          </Link>
        </div>
      </div>
    );
  }

  const usage = await getAiUsageRemaining(orgId, feature);
  if (usage.quota >= 999) {
    return null;
  }

  const pct = usage.quota > 0 ? (usage.used / usage.quota) * 100 : 0;
  if (pct < 60) {
    return null;
  }

  const level: 'info' | 'warn' | 'danger'
    = pct >= 95 ? 'danger' : pct >= 80 ? 'warn' : 'info';

  const styles = {
    info: 'border-primary/30 bg-primary/5',
    warn: 'border-amber-300 bg-amber-50',
    danger: 'border-red-300 bg-red-50',
  }[level];

  const icon = level === 'danger' ? '🚨' : level === 'warn' ? '⚡' : '📊';

  const isEssay = feature === 'essay_grading';
  const featureLabel = isEssay ? 'AI 批改' : 'AI 出題';
  const unitLabel = isEssay ? '份' : '次';

  const title = level === 'danger'
    ? `本月 ${featureLabel} 已用 ${usage.used} / ${usage.quota} ${unitLabel}`
    : `本月 ${featureLabel} 還剩 ${usage.remaining} ${unitLabel}`;

  const subtitle = isEssay
    ? '達到上限後下月 1 日自動重置；需要更多額度請聯絡 enterprise@quizflow.tw'
    : level === 'danger'
      ? '升級 Pro 即可無限使用 AI 出題，不再卡額度'
      : 'Pro 方案 AI 出題無上限，年繳平均每月只要 NT$208';

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
        {!isEssay && (
          <Link
            href="/dashboard/billing"
            className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            升級 Pro
          </Link>
        )}
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
