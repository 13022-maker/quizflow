'use client';

/** 每 10 秒重新整理 server component 資料（教師儀表板即時看到學生進度） */
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function AutoRefresh({ intervalMs = 10_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);

  return null;
}
