'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { deleteSimPractice } from '@/actions/simActions';

export function DeleteSimButton({ id }: { id: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
      onClick={() => {
        // eslint-disable-next-line no-alert
        if (!window.confirm('確定要刪除此實作模擬？所有學生成績會一併刪除。')) {
          return;
        }
        startTransition(async () => {
          const res = await deleteSimPractice(id);
          if ('error' in res) {
            // eslint-disable-next-line no-alert
            window.alert(res.error);
            return;
          }
          router.push('/dashboard/sims');
        });
      }}
    >
      {pending ? '刪除中…' : '刪除'}
    </button>
  );
}
