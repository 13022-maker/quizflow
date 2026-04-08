'use client';

import { useState } from 'react';

type QuestionStat = { question: string; correctRate: number };

type AnalysisResult = {
  summary: string;
  suggestions: string[];
};

export function ClassAIAnalysis({
  quizTitle,
  questionStats,
}: {
  quizTitle: string;
  questionStats: QuestionStat[];
}) {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleAnalyze = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/ai/analyze-class-performance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quizTitle, questionStats }),
      });
      const data = await res.json();
      if (data.summary) {
        setResult(data);
      } else {
        setError(data.error ?? '分析失敗，請稍後再試');
      }
    } catch {
      setError('分析失敗，請稍後再試');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border bg-indigo-50/60 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-indigo-900">AI 班級整體建議</h2>
        {!result && (
          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {loading ? '分析中…' : '分析全班表現'}
          </button>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      {loading && (
        <p className="text-sm text-indigo-700">AI 正在分析全班作答資料，請稍候…</p>
      )}

      {result && (
        <div className="space-y-4">
          {/* 摘要 */}
          <p className="text-sm leading-relaxed text-indigo-900">{result.summary}</p>

          {/* 建議清單 */}
          {result.suggestions.length > 0 && (
            <ul className="space-y-2">
              {result.suggestions.map((s, i) => (
                <li key={i} className="flex items-start gap-2 rounded-md bg-white px-4 py-2.5 text-sm shadow-sm">
                  <span className="shrink-0 font-bold text-indigo-600">
                    {i + 1}
                    .
                  </span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          )}

          {/* 重新分析按鈕 */}
          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="text-xs text-indigo-600 hover:underline"
          >
            重新分析
          </button>
        </div>
      )}
    </div>
  );
}
