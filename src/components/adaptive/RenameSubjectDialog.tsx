'use client';

import { useState, useTransition } from 'react';

import { renameAdaptiveSubject } from '@/actions/adaptiveActions';
import { Button } from '@/components/ui/button';

type Props = {
  subjectId: number;
  initialName: string;
  onClose: () => void;
};

export function RenameSubjectDialog({ subjectId, initialName, onClose }: Props) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    if (!name.trim()) {
      setError('請輸入學科名稱');
      return;
    }
    startTransition(async () => {
      try {
        await renameAdaptiveSubject(subjectId, name.trim());
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : '重新命名失敗');
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold">重新命名學科</h2>
          <button type="button" onClick={onClose} className="text-2xl text-gray-400 hover:text-gray-600">×</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">
              學科名稱
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                maxLength={100}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </label>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button onClick={handleSave} disabled={isPending} className="w-full">
            {isPending ? '儲存中…' : '儲存'}
          </Button>
        </div>
      </div>
    </div>
  );
}
