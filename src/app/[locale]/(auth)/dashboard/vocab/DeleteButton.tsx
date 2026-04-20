'use client';

import { deleteVocabSet } from '@/actions/vocabActions';

export function DeleteVocabButton({ id }: { id: number }) {
  return (
    <button
      type="button"
      className="rounded-lg px-3 py-2 text-sm font-medium text-red-500 transition-colors hover:bg-red-50"
      onClick={async () => {
        // eslint-disable-next-line no-alert
        if (window.confirm('確定要刪除此單字卡集？')) {
          await deleteVocabSet(id);
        }
      }}
    >
      刪除
    </button>
  );
}
