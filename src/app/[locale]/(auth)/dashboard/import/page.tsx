'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { importLessonPackage } from '@/actions/lessonPackageActions';
import { Button } from '@/components/ui/button';

export default function ImportLessonPackagePage() {
  const router = useRouter();
  const [rawJson, setRawJson] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<{ path: string; message: string }[]>([]);
  const [result, setResult] = useState<Extract<Awaited<ReturnType<typeof importLessonPackage>>, { quizzes: unknown }> | null>(null);

  const handleSubmit = async () => {
    if (!rawJson.trim()) {
      return;
    }
    setSubmitting(true);
    setError('');
    setDetail([]);
    setResult(null);

    const res = await importLessonPackage(rawJson);

    if ('error' in res) {
      if (res.error === 'PRO_REQUIRED' || res.error === 'QUOTA_EXCEEDED') {
        router.push('/dashboard/billing');
        return;
      }
      setError(res.error);
      setDetail(res.detail ?? []);
      setSubmitting(false);
      return;
    }

    setResult(res);
    setSubmitting(false);
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <Link href="/dashboard/quizzes" className="text-sm text-muted-foreground hover:text-foreground">
          ← 返回測驗列表
        </Link>
        <h1 className="mt-2 text-xl font-bold">批次匯入備課包</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          把
          <code className="rounded bg-gray-100 px-1">docs/prompts/lesson-prep-assistant.md</code>
          的 prompt 貼到外部 AI 聊天工具，把產出的 JSON 貼在下面，一次建立 6 份測驗 + 1 個單字卡集。
        </p>
      </div>

      {!result && (
        <>
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
