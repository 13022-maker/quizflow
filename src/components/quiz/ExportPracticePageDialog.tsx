'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';

type Props = {
  quizId: number;
  totalQuestions: number;
  onClose: () => void;
};

export function ExportPracticePageDialog({ quizId, totalQuestions, onClose }: Props) {
  const [start, setStart] = useState(1);
  const [end, setEnd] = useState(totalQuestions);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [doneMsg, setDoneMsg] = useState('');

  const handleExport = async () => {
    setError('');
    setDoneMsg('');
    if (start < 1 || end > totalQuestions || start > end) {
      setError(`題號範圍不合法，請輸入 1 ~ ${totalQuestions} 之間的範圍`);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/quizzes/${quizId}/export-practice-page?start=${start}&end=${end}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? '匯出失敗');
        return;
      }
      const imported = res.headers.get('X-Export-Imported');
      const skipped = res.headers.get('X-Export-Skipped');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // 檔名由 Content-Disposition 決定，這裡給個保底名稱以防瀏覽器解析不到
      a.download = 'practice-page.html';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setDoneMsg(
        skipped && Number(skipped) > 0
          ? `✅ 已下載，成功匯入 ${imported} 題（略過 ${skipped} 題不支援的題型：多選/簡答/排序/克漏字/聽力）`
          : `✅ 已下載，共 ${imported} 題`,
      );
    } catch {
      setError('匯出失敗，請稍後再試');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold">匯出成靜態練習頁</h2>
          <button type="button" onClick={onClose} className="text-2xl text-gray-400 hover:text-gray-600">×</button>
        </div>

        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            產生一份獨立的 HTML 練習頁（免登入、不計時，答題立即顯示對錯），下載後可放到任何網頁空間分享。目前只支援單選題與是非題，其他題型會自動略過。
          </p>

          <div className="flex items-center gap-3">
            <label className="flex-1 text-sm font-medium">
              從第幾題
              <input
                type="number"
                min={1}
                max={totalQuestions}
                value={start}
                onChange={e => setStart(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </label>
            <span className="mt-5 text-gray-400">～</span>
            <label className="flex-1 text-sm font-medium">
              到第幾題
              <input
                type="number"
                min={1}
                max={totalQuestions}
                value={end}
                onChange={e => setEnd(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </label>
          </div>
          <p className="text-xs text-gray-400">
            共
            {' '}
            {totalQuestions}
            {' '}
            題，預設匯出全部
          </p>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {doneMsg && <p className="text-sm text-green-700">{doneMsg}</p>}

          <Button onClick={handleExport} disabled={loading} className="w-full">
            {loading ? '匯出中…' : '🌐 下載練習頁'}
          </Button>
        </div>
      </div>
    </div>
  );
}
