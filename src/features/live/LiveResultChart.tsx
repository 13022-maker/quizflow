'use client';

import type { LiveAnswerStat, LiveQuestionOption } from '@/services/live/types';

type Props = {
  options: LiveQuestionOption[];
  stats: LiveAnswerStat[];
  correctAnswers?: string[]; // 傳入代表要高亮正解
};

// 單題作答分布長條圖
export function LiveResultChart({ options, stats, correctAnswers }: Props) {
  const countMap = new Map(stats.map(s => [s.optionId, s.count]));
  const maxCount = Math.max(1, ...stats.map(s => s.count));
  const totalAnswered = stats.reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="space-y-3">
      {options.map((opt, i) => {
        const count = countMap.get(opt.id) ?? 0;
        const widthPct = (count / maxCount) * 100;
        const isCorrect = correctAnswers?.includes(opt.id) ?? false;
        return (
          <div key={opt.id} className="flex items-center gap-3">
            <span className="w-6 shrink-0 text-sm font-semibold text-muted-foreground">
              {String.fromCharCode(65 + i)}
            </span>
            <div className="relative flex-1 overflow-hidden rounded-lg bg-muted">
              <div
                className={`h-10 transition-all ${
                  isCorrect ? 'bg-green-500' : 'bg-blue-400'
                }`}
                style={{ width: `${widthPct}%` }}
              />
              <div className="absolute inset-0 flex items-center justify-between px-3">
                <span className="text-sm font-medium">
                  {opt.text}
                  {isCorrect && <span className="ml-1 text-green-700">✓</span>}
                </span>
                <span className="text-sm font-semibold">
                  {count}
                </span>
              </div>
            </div>
          </div>
        );
      })}
      <p className="text-center text-xs text-muted-foreground">
        共
        {' '}
        {totalAnswered}
        {' '}
        份作答
      </p>
    </div>
  );
}
