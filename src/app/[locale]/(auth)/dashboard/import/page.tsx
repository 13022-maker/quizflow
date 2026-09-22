'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { importLessonPackage } from '@/actions/lessonPackageActions';
import { Button } from '@/components/ui/button';
import {
  buildLessonPrepPrompt,
  DEFAULT_LESSON_PREP_STAGES,
  type LessonPrepQuestionType,
  type LessonPrepStageConfig,
} from '@/lib/ai/lessonPrepPromptBuilder';

const ALL_TYPES: LessonPrepQuestionType[] = ['mc', 'tf', 'short', 'rank', 'cloze'];

const TYPE_DISPLAY: Record<LessonPrepQuestionType, string> = {
  mc: '單選 (mc)',
  tf: '是非 (tf)',
  short: '簡答 (short)',
  rank: '排序 (rank)',
  cloze: '克漏字 (cloze)',
};

export default function ImportLessonPackagePage() {
  const router = useRouter();
  const [rawJson, setRawJson] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<{ path: string; message: string }[]>([]);
  const [result, setResult] = useState<Extract<Awaited<ReturnType<typeof importLessonPackage>>, { quizzes: unknown }> | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [copied, setCopied] = useState(false);
  const [stages, setStages] = useState<LessonPrepStageConfig[]>(DEFAULT_LESSON_PREP_STAGES);

  const prompt = useMemo(() => buildLessonPrepPrompt(stages), [stages]);
  const hasInvalidStage = stages.some(s => s.count > 0 && s.types.length === 0);
  const hasAnyActiveStage = stages.some(s => s.count > 0 && s.types.length > 0);
  const promptValid = !hasInvalidStage && hasAnyActiveStage;

  const updateStageCount = (index: number, count: number) => {
    setStages(prev => prev.map((s, i) => (i === index ? { ...s, count: Math.max(0, Math.min(10, count)) } : s)));
  };

  const toggleStageType = (index: number, type: LessonPrepQuestionType) => {
    setStages(prev => prev.map((s, i) => {
      if (i !== index) {
        return s;
      }
      const has = s.types.includes(type);
      return { ...s, types: has ? s.types.filter(t => t !== type) : [...s.types, type] };
    }));
  };

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 瀏覽器拒絕剪貼簿權限時靜默失敗，老師仍可從下方文字區塊手動選取複製
    }
  };

  const handleSubmit = async () => {
    if (!rawJson.trim()) {
      return;
    }
    setSubmitting(true);
    setError('');
    setDetail([]);
    setResult(null);

    try {
      const res = await importLessonPackage(rawJson);

      if ('error' in res) {
        if (res.error === 'PRO_REQUIRED' || res.error === 'QUOTA_EXCEEDED') {
          router.push('/dashboard/billing');
          return;
        }
        setError(res.error);
        setDetail(res.detail ?? []);
        return;
      }

      setResult(res);
    } catch {
      setError('匯入失敗，請重試');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <Link href="/dashboard/quizzes" className="text-sm text-muted-foreground hover:text-foreground">
          ← 返回測驗列表
        </Link>
        <h1 className="mt-2 text-xl font-bold">批次匯入備課包</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          展開下方區塊可調整每個階段的題型／題數，複製 prompt 貼到外部 AI 聊天工具（例如 Claude.ai 網頁版），把產出的 JSON 貼在下面的欄位，一次建立測驗 + 1 個單字卡集。
        </p>
      </div>

      {!result && (
        <>
          <div className="mb-4 rounded-xl border bg-gray-50">
            <button
              type="button"
              onClick={() => setShowPrompt(prev => !prev)}
              className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
            >
              <span>
                {showPrompt ? '▾' : '▸'}
                {' '}
                查看 / 複製 Prompt
              </span>
            </button>
            {showPrompt && (
              <div className="border-t px-4 py-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">依需求調整各階段題型／題數（題數設 0 代表跳過該階段）</p>
                <div className="mb-3 space-y-2">
                  {stages.map((stage, i) => (
                    <div key={stage.key} className="rounded-lg border bg-white p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-medium">{stage.label}</span>
                        <label className="flex items-center gap-1 text-xs text-muted-foreground">
                          題數
                          <input
                            type="number"
                            min={0}
                            max={10}
                            value={stage.count}
                            onChange={e => updateStageCount(i, Number(e.target.value) || 0)}
                            className="w-14 rounded border px-1 py-0.5 text-center"
                          />
                        </label>
                      </div>
                      <div className="flex flex-wrap gap-3">
                        {ALL_TYPES.map(t => (
                          <label key={t} className="flex items-center gap-1 text-xs">
                            <input
                              type="checkbox"
                              checked={stage.types.includes(t)}
                              onChange={() => toggleStageType(i, t)}
                            />
                            {TYPE_DISPLAY[t]}
                          </label>
                        ))}
                      </div>
                      {stage.count > 0 && stage.types.length === 0 && (
                        <p className="mt-1 text-xs text-red-500">這個階段有題數，至少要勾一個題型</p>
                      )}
                    </div>
                  ))}
                </div>

                {!hasAnyActiveStage && (
                  <p className="mb-3 text-xs text-red-500">至少要有一個階段的題數大於 0</p>
                )}

                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCopyPrompt}
                  disabled={!promptValid}
                  className="mb-3"
                >
                  {copied ? '已複製 ✓' : '複製 Prompt'}
                </Button>
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 font-mono text-xs">{prompt}</pre>
              </div>
            )}
          </div>

          <textarea
            value={rawJson}
            onChange={e => setRawJson(e.target.value)}
            placeholder="貼上 AI 產生的完整 JSON"
            rows={14}
            className="w-full resize-none rounded-xl border px-4 py-3 font-mono text-xs placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
              <p className="font-medium">{error}</p>
              {detail.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {detail.map(d => (
                    <li key={d.path}>
                      {d.path}
                      ：
                      {d.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <Button
            onClick={handleSubmit}
            disabled={submitting || !rawJson.trim()}
            className="mt-4 w-full"
          >
            {submitting ? '匯入中…' : '批次匯入'}
          </Button>
        </>
      )}

      {result && (
        <div className="space-y-6">
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">
            匯入完成，共建立
            {' '}
            {result.quizzes.length}
            {' '}
            份測驗 + 1 個單字卡集。
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold">測驗</h2>
            <ul className="space-y-1">
              {result.quizzes.map(q => (
                <li key={q.id}>
                  <Link href={`/dashboard/quizzes/${q.id}/edit`} className="text-sm text-blue-600 hover:underline">
                    {q.title}
                    {' '}
                    ↗
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold">單字卡集</h2>
            <Link href="/dashboard/vocab" className="text-sm text-blue-600 hover:underline">
              {result.vocabTitle}
              {' '}
              ↗
            </Link>
          </div>

          {(result.teacherNotes.flow || result.teacherNotes.misconceptions?.length || result.teacherNotes.afterClass) && (
            <div className="rounded-lg border bg-gray-50 p-4 text-sm">
              <p className="mb-2 font-semibold text-amber-600">⚠️ 教學筆記只顯示這一次，請自行複製保存</p>
              {result.teacherNotes.flow && (
                <pre className="mb-3 whitespace-pre-wrap font-sans">{result.teacherNotes.flow}</pre>
              )}
              {result.teacherNotes.misconceptions && result.teacherNotes.misconceptions.length > 0 && (
                <ul className="mb-3 list-disc space-y-1 pl-5">
                  {result.teacherNotes.misconceptions.map(m => <li key={m}>{m}</li>)}
                </ul>
              )}
              {result.teacherNotes.afterClass && <p>{result.teacherNotes.afterClass}</p>}
            </div>
          )}

          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              setResult(null);
              setRawJson('');
            }}
          >
            再匯入一份
          </Button>
        </div>
      )}
    </div>
  );
}
