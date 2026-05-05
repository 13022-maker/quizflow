import Link from 'next/link';

// 市集空狀態 CTA:把「找不到」轉成「自己生」,導使用者到對應 AI 入口
// type='quiz' → /dashboard/quizzes/new?ai=1[&prefill=...] (走 AiPrefillTrigger 自動建立)
// type='vocab' → /dashboard/vocab/new[?title=...] (僅 prefill 卡集名稱,單字仍由使用者輸入)
type Props = {
  type: 'quiz' | 'vocab';
  prefill: string;
};

export function MarketplaceEmptyCTA({ type, prefill }: Props) {
  const isQuiz = type === 'quiz';
  const heading = isQuiz ? '目前還沒有符合條件的測驗' : '目前還沒有符合條件的單字卡集';

  // 副標依 type + prefill 有無分四種文案
  const subtitle = (() => {
    if (isQuiz) {
      return prefill
        ? `要不要讓 AI 幫你生一份「${prefill}」？`
        : '換個篩選條件,或讓 AI 幫你生一份新的測驗';
    }
    return prefill
      ? `要不要建一份「${prefill}」的單字卡？輸入單字後 AI 幫你補釋義`
      : '換個篩選條件,或自己建一組新的單字卡';
  })();

  // CTA 連結:Quiz 永遠帶 ?ai=1 進 trigger 模式;Vocab 只帶 ?title 預填卡集名稱
  const href = (() => {
    if (isQuiz) {
      const params = new URLSearchParams({ ai: '1' });
      if (prefill) {
        params.set('prefill', prefill);
      }
      return `/dashboard/quizzes/new?${params.toString()}`;
    }
    return prefill
      ? `/dashboard/vocab/new?title=${encodeURIComponent(prefill)}`
      : '/dashboard/vocab/new';
  })();

  const buttonLabel = isQuiz ? '✨ 用 AI 立即生成' : '✨ 開始建立單字卡';

  return (
    <div className="rounded-xl border-2 border-dashed border-violet-200 bg-violet-50/40 px-6 py-12 text-center">
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-violet-100 text-violet-600">
        <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
        </svg>
      </div>
      <p className="text-lg font-medium text-foreground">{heading}</p>
      <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
      <Link
        href={href}
        className="mt-6 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-violet-700"
      >
        {buttonLabel}
      </Link>
    </div>
  );
}
