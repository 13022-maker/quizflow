'use client';

/**
 * 課前重點摘要講義 Modal：老師在「建立新練習」選好學科後，點按鈕開啟，
 * 顯示 AI 根據該學科知識點圖譜生成的重點摘要（本課概述＋知識點重點＋教學建議）。
 */
import { marked } from 'marked';
import { useEffect, useState } from 'react';

import { getOrGenerateAdaptiveSummary, regenerateAdaptiveSummary } from '@/actions/adaptiveActions';

type Status = 'loading' | 'ready' | 'error';

export function PreLessonSummaryModal({
  subjectId,
  subjectName,
  onClose,
}: {
  subjectId: string;
  subjectName: string;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<Status>('loading');
  const [markdown, setMarkdown] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [regenerating, setRegenerating] = useState(false);

  async function load() {
    setStatus('loading');
    const result = await getOrGenerateAdaptiveSummary(subjectId);
    if ('error' in result) {
      setErrorMessage(result.error);
      setStatus('error');
      return;
    }
    setMarkdown(result.markdown);
    setStatus('ready');
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在 subjectId 變動時重新載入，load 每次 render 都是新函式
  }, [subjectId]);

  async function handleRegenerate() {
    setRegenerating(true);
    const result = await regenerateAdaptiveSummary(subjectId);
    if ('error' in result) {
      setErrorMessage(result.error);
      setStatus('error');
    } else {
      setMarkdown(result.markdown);
      setStatus('ready');
    }
    setRegenerating(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-xl bg-background p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {subjectName}
            {' '}
            課前重點摘要
          </h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {status === 'loading' && (
            <p className="py-8 text-center text-sm text-muted-foreground">生成中，請稍候…</p>
          )}
          {status === 'error' && (
            <div className="py-8 text-center text-sm text-destructive">
              <p>{errorMessage}</p>
              <button
                type="button"
                onClick={load}
                className="mt-3 rounded-lg border px-3 py-1.5 text-sm hover:bg-muted"
              >
                重試
              </button>
            </div>
          )}
          {status === 'ready' && (
            <div
              className="prose prose-sm max-w-none"
              // 內容全部是 AI 生成，非使用者輸入，沿用 AdaptiveLearnClient.tsx 既有的 marked 渲染慣例
              dangerouslySetInnerHTML={{ __html: String(marked.parse(markdown)) }}
            />
          )}
        </div>

        {status === 'ready' && (
          <div className="mt-4 flex justify-end gap-2 border-t pt-3">
            <button
              type="button"
              onClick={handleRegenerate}
              disabled={regenerating}
              className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
            >
              {regenerating ? '生成中…' : '重新生成'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90"
            >
              關閉
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
