'use client';

import { useRouter } from 'next/navigation';

import { deleteAdaptivePractice } from '@/actions/adaptiveActions';

export function DeletePracticeButton({ id }: { id: number }) {
  const router = useRouter();

  return (
    <button
      type="button"
      className="rounded-lg px-3 py-2 text-sm font-medium text-red-500 transition-colors hover:bg-red-50"
      onClick={async () => {
        // eslint-disable-next-line no-alert
        if (window.confirm('確定要刪除此練習？學生進度與學習日誌會一併刪除。')) {
          await deleteAdaptivePractice(id);
          router.push('/dashboard/adaptive');
        }
      }}
    >
      刪除練習
    </button>
  );
}
