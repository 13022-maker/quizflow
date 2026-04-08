import Link from 'next/link';

// 顯示在新增測驗頁：免費方案已達上限時的升級提示畫面
export function QuizLimitWall({ current, limit }: { current: number; limit: number }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-12 text-center">
      {/* 圖示 */}
      <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-full bg-amber-100">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="size-8 text-amber-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      </div>

      {/* 標題 */}
      <h1 className="text-2xl font-bold">測驗名額已用完</h1>
      <p className="mt-2 text-muted-foreground">
        免費方案最多可建立
        {' '}
        <strong>{limit}</strong>
        {' '}
        份測驗，您已建立
        {' '}
        <strong>{current}</strong>
        {' '}
        份。
      </p>

      {/* 額度進度條 */}
      <div className="mx-auto mt-6 max-w-xs">
        <div className="mb-1 flex justify-between text-sm text-muted-foreground">
          <span>已使用</span>
          <span className="font-medium text-foreground">
            {current}
            {' '}
            /
            {' '}
            {limit}
          </span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-amber-500"
            style={{ width: '100%' }}
          />
        </div>
      </div>

      {/* Pro 方案優勢 */}
      <div className="mt-8 rounded-xl border bg-card p-6 text-left">
        <p className="mb-4 font-semibold">升級 Pro 方案解鎖：</p>
        <ul className="space-y-2.5 text-sm">
          {[
            '無限測驗，想建幾份就建幾份',
            'AI 自動出題（上傳 PDF、圖片即可）',
            '班級整體學習分析報告',
            '匯出 CSV 成績單',
          ].map(feature => (
            <li key={feature} className="flex items-center gap-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-green-100 text-xs text-green-700">✓</span>
              {feature}
            </li>
          ))}
        </ul>

        <div className="mt-5 flex items-center justify-between">
          <div>
            <span className="text-2xl font-bold">$9</span>
            <span className="text-sm text-muted-foreground"> / 月</span>
          </div>
          <Link
            href="/dashboard/billing"
            className="rounded-lg bg-primary px-5 py-2 font-medium text-primary-foreground hover:bg-primary/90"
          >
            立即升級
          </Link>
        </div>
      </div>

      {/* 返回連結 */}
      <Link
        href="/dashboard/quizzes"
        className="mt-6 inline-block text-sm text-muted-foreground hover:underline"
      >
        ← 返回我的測驗
      </Link>
    </div>
  );
}
