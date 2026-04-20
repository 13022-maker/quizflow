'use client';

import { useState, useTransition } from 'react';

import { publishToMarketplace, unpublishFromMarketplace } from '@/actions/marketplaceActions';
import { Button } from '@/components/ui/button';
import { GRADE_LEVELS, MARKETPLACE_CATEGORIES } from '@/utils/MarketplaceConfig';

type Props = {
  quizId: number;
  isMarketplace: boolean;
  initialCategory?: string | null;
  initialGradeLevel?: string | null;
  initialTags?: string[] | null;
  onClose: () => void;
};

export function PublishMarketplaceDialog({
  quizId,
  isMarketplace,
  initialCategory,
  initialGradeLevel,
  initialTags,
  onClose,
}: Props) {
  const [category, setCategory] = useState(initialCategory ?? '');
  const [gradeLevel, setGradeLevel] = useState(initialGradeLevel ?? '');
  const [tagsInput, setTagsInput] = useState((initialTags ?? []).join(', '));
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const handlePublish = () => {
    if (!category || !gradeLevel) {
      setError('請選擇科目和年級');
      return;
    }
    startTransition(async () => {
      const tags = tagsInput
        .split(/[,，、]/)
        .map(t => t.trim())
        .filter(Boolean);
      const res = await publishToMarketplace({ quizId, category, gradeLevel, tags });
      if (res?.error) {
        setError(res.error);
      } else {
        onClose();
      }
    });
  };

  const handleUnpublish = () => {
    startTransition(async () => {
      await unpublishFromMarketplace(quizId);
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {isMarketplace ? '管理市集上架' : '分享到題庫市集'}
          </h2>
          <button type="button" onClick={onClose} className="text-2xl text-gray-400 hover:text-gray-600">×</button>
        </div>

        {isMarketplace
          ? (
              <div className="space-y-4">
                <div className="rounded-lg bg-green-50 p-4 text-sm text-green-700">
                  ✅ 此測驗已上架到題庫市集
                </div>
                <Button variant="outline" onClick={handleUnpublish} disabled={isPending} className="w-full">
                  {isPending ? '處理中…' : '從市集下架'}
                </Button>
              </div>
            )
          : (
              <div className="space-y-4">
                <p className="text-sm text-gray-500">
                  分享後，其他老師可以在題庫市集瀏覽並複製你的測驗。
                </p>

                <div>
                  <label className="mb-1 block text-sm font-medium">
                    科目 *
                    <select
                      value={category}
                      onChange={e => setCategory(e.target.value)}
                      className="mt-1 w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="">請選擇</option>
                      {MARKETPLACE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium">
                    適用年級 *
                    <select
                      value={gradeLevel}
                      onChange={e => setGradeLevel(e.target.value)}
                      className="mt-1 w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="">請選擇</option>
                      {GRADE_LEVELS.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </label>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium">
                    標籤（選填，逗號分隔）
                    <input
                      value={tagsInput}
                      onChange={e => setTagsInput(e.target.value)}
                      placeholder="例如：期中考、三角函數、第三章"
                      className="mt-1 w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </label>
                </div>

                {error && <p className="text-sm text-red-600">{error}</p>}

                <Button onClick={handlePublish} disabled={isPending} className="w-full">
                  {isPending ? '上架中…' : '📤 分享到市集'}
                </Button>
              </div>
            )}
      </div>
    </div>
  );
}
