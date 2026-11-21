'use client';

import { QUIZ_MODEL_OPTIONS, type QuizModelChoice, resolveQuizModelChoice } from '@/lib/ai/quizModelOptions';

type Props = {
  /** Pro 或以上（含 30 天試用），與 server 端 canUseClaude() 判定一致 */
  isPro: boolean;
  value: QuizModelChoice;
  onChange: (model: QuizModelChoice) => void;
};

/**
 * 出題 AI 模型選擇（檔案 / 連結模式共用）
 *
 * Free 用戶選 Claude 會被 server 靜默改走 Gemini，所以非 Pro 時 Claude 按鈕 disabled
 * 並標示 Pro 徽章，畫面上固定顯示 Gemini 為選中。
 */
export function AIModelPicker({ isPro, value, onChange }: Props) {
  const selected = resolveQuizModelChoice(value, isPro);
  const base = 'flex items-start gap-2 rounded-xl border-2 p-3 text-left transition-all';
  const active = 'border-amber-500 bg-amber-50';
  const idle = 'border-gray-200 hover:border-amber-300';

  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        aria-pressed={selected === 'gemini'}
        onClick={() => onChange('gemini')}
        className={`${base} ${selected === 'gemini' ? active : idle}`}
      >
        <span className="text-lg">⚡</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-800">{QUIZ_MODEL_OPTIONS.gemini.label}</p>
          <p className="text-xs text-gray-400">快速省錢 · 預設</p>
        </div>
      </button>
      <button
        type="button"
        aria-pressed={selected === 'claude'}
        disabled={!isPro}
        onClick={() => onChange('claude')}
        className={`${base} ${
          !isPro
            ? 'cursor-not-allowed border-gray-200 bg-gray-50 opacity-60'
            : selected === 'claude'
              ? active
              : idle
        }`}
      >
        <span className="text-lg">🤖</span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
            {QUIZ_MODEL_OPTIONS.claude.label}
            {!isPro && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">Pro</span>
            )}
          </p>
          <p className="text-xs text-gray-400">{isPro ? '品質優 · 較慢' : 'Pro 方案可選 Claude'}</p>
        </div>
      </button>
    </div>
  );
}
