'use client';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-lg border bg-card p-8 text-center">
      <p className="text-lg font-semibold">載入頁面時發生錯誤</p>
      <p className="mt-2 text-sm text-muted-foreground">
        {error.message || '未知錯誤，請重新載入頁面'}
      </p>
      {error.digest && (
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          錯誤代碼：
          {error.digest}
        </p>
      )}
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        重新載入
      </button>
    </div>
  );
}
