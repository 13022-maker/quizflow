'use client';

import { AlertCircle, Copy, Download, Loader, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';

import { createQuizWithBloomQuestions, type BloomQuestion } from '@/actions/bloomActions';

// Bloom 認知層級中文對應
const BLOOM_LABELS: Record<string, string> = {
  remember: '記憶 Remember',
  understand: '理解 Understand',
  apply: '應用 Apply',
  analyze: '分析 Analyze',
  evaluate: '評估 Evaluate',
  create: '創造 Create',
};

const BLOOM_LEVELS = [
  { key: 'remember', label: '記憶 (Remember)', description: '回憶事實和基本概念', keywords: ['定義', '列舉', '復述'], difficulty: 1 },
  { key: 'understand', label: '理解 (Understand)', description: '解釋概念的意義', keywords: ['解釋', '分類', '舉例'], difficulty: 2 },
  { key: 'apply', label: '應用 (Apply)', description: '在新情境中使用知識', keywords: ['應用', '計算', '執行'], difficulty: 3 },
  { key: 'analyze', label: '分析 (Analyze)', description: '分解並比較成分', keywords: ['比較', '對比', '區分'], difficulty: 4 },
  { key: 'evaluate', label: '評估 (Evaluate)', description: '判斷和決定', keywords: ['評估', '批判', '判斷'], difficulty: 5 },
  { key: 'create', label: '創造 (Create)', description: '組合成新想法', keywords: ['設計', '發明', '建構'], difficulty: 6 },
];

const SYSTEM_PROMPT_DISPLAY = `你是台灣教育專家，幫助教師生成高品質的自動評量題目。

根據 Bloom's Taxonomy（布魯姆分類法）設計題目，確保題目符合認知層級要求，
使用台灣教育術語和例子，支援多種題型（單選、簡答）。

輸出格式：JSON，每題包含 bloom_level、difficulty、content、
options、correct_answer、explanation、learning_objective。`;

type BloomOutput = {
  metadata?: { topic?: string };
  questions: BloomQuestion[];
};

export function BloomQuizGenerator() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [activeTab, setActiveTab] = useState<'generator' | 'bloom' | 'prompt'>('generator');
  const [contentInput, setContentInput] = useState('');
  const [selectedDifficulty, setSelectedDifficulty] = useState('mixed');
  const [numQuestions, setNumQuestions] = useState(5);
  const [questionType, setQuestionType] = useState('mixed');

  const [output, setOutput] = useState<BloomOutput | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const [copiedIndex, setCopiedIndex] = useState<string | number | null>(null);
  const [importError, setImportError] = useState('');

  // AI 出題
  const handleGenerate = useCallback(async () => {
    if (!contentInput.trim()) {
      setGenError('請先輸入教學內容');
      return;
    }
    setGenError('');
    setImportError('');
    setOutput(null);
    setIsGenerating(true);

    try {
      const res = await fetch('/api/ai/bloom-studio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: contentInput, difficulty: selectedDifficulty, numQuestions, questionType }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGenError(data.error ?? '生成失敗，請重試');
        return;
      }
      setOutput(data);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : '生成失敗，請重試');
    } finally {
      setIsGenerating(false);
    }
  }, [contentInput, selectedDifficulty, numQuestions, questionType]);

  // 下載 JSON
  const handleDownload = useCallback(() => {
    if (!output) return;
    const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bloom-questions.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [output]);

  // 複製
  const copyToClipboard = useCallback((text: string, key: string | number) => {
    void navigator.clipboard.writeText(text);
    setCopiedIndex(key);
    setTimeout(() => setCopiedIndex(null), 2000);
  }, []);

  // 匯入 QuizFlow
  const handleImport = useCallback(() => {
    if (!output?.questions?.length) return;
    setImportError('');
    const topic = output.metadata?.topic ?? contentInput.slice(0, 50);
    const title = `Bloom 出題 — ${topic}`.slice(0, 100);

    startTransition(async () => {
      const result = await createQuizWithBloomQuestions(title, output.questions);
      if ('error' in result) {
        setImportError(result.error);
        return;
      }
      router.push(`/dashboard/quizzes/${result.quizId}/edit`);
    });
  }, [output, contentInput, router]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="mx-auto max-w-6xl">
        {/* 標題 */}
        <div className="mb-8">
          <div className="mb-2 flex items-center gap-3">
            <Zap className="size-8 text-indigo-600" />
            <h1 className="text-3xl font-bold text-gray-900">Bloom 題目生成器</h1>
          </div>
          <p className="text-gray-600">基於 Bloom's Taxonomy 自動生成高品質測驗題目</p>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex gap-4 border-b border-gray-300">
          {([
            { key: 'generator', label: '🎯 題目生成器' },
            { key: 'bloom', label: '📚 Bloom 分類參考' },
            { key: 'prompt', label: '💡 系統 Prompt' },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`px-6 py-3 font-semibold transition ${
                activeTab === tab.key
                  ? 'border-b-2 border-indigo-600 text-indigo-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab: 題目生成器 */}
        {activeTab === 'generator' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <div className="space-y-6 rounded-lg bg-white p-6 shadow-lg">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-gray-700">
                    📝 教學內容（貼上 PDF 文字、YouTube 摘要或課程筆記）
                  </label>
                  <textarea
                    value={contentInput}
                    onChange={(e) => setContentInput(e.target.value)}
                    placeholder="例如：介紹光合作用的過程，包括光反應和暗反應..."
                    className="h-40 w-full resize-none rounded-lg border border-gray-300 p-4 text-sm focus:border-transparent focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-gray-700">難度分布</label>
                    <select
                      value={selectedDifficulty}
                      onChange={(e) => setSelectedDifficulty(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 p-2 text-sm focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="mixed">均勻分配</option>
                      <option value="easy">偏簡單</option>
                      <option value="medium">中等</option>
                      <option value="hard">偏困難</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-gray-700">題數</label>
                    <input
                      type="number"
                      min="1"
                      max="20"
                      value={numQuestions}
                      onChange={(e) => setNumQuestions(Math.min(20, parseInt(e.target.value) || 1))}
                      className="w-full rounded-lg border border-gray-300 p-2 text-sm focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-gray-700">題型</label>
                    <select
                      value={questionType}
                      onChange={(e) => setQuestionType(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 p-2 text-sm focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="mixed">混合</option>
                      <option value="multiple_choice">單選題</option>
                      <option value="short_answer">簡答題</option>
                    </select>
                  </div>
                </div>

                {genError && (
                  <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-600">
                    <AlertCircle className="size-4 shrink-0" />
                    {genError}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => void handleGenerate()}
                  disabled={isGenerating}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-3 font-bold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isGenerating ? <><Loader className="size-5 animate-spin" /> 生成中...</> : <><Zap className="size-5" /> 生成測驗題目</>}
                </button>
              </div>
            </div>

            {/* 提示面板 */}
            <div className="h-fit rounded-lg bg-white p-6 shadow-lg">
              <div className="mb-4 rounded border-l-4 border-blue-400 bg-blue-50 p-4">
                <p className="text-sm text-blue-800">
                  <strong>💡 提示：</strong>內容越詳細，生成的題目越精準。建議包含：
                  <ul className="mt-2 space-y-1 text-xs">
                    <li>• 主要概念定義</li>
                    <li>• 具體例子</li>
                    <li>• 學習重點</li>
                  </ul>
                </p>
              </div>
              <div className="space-y-2 text-sm text-gray-600">
                <h3 className="font-semibold text-gray-900">生成策略</h3>
                {['自動標記 Bloom 認知層級', '計算難度分數 (1-6)', '生成詳細解釋', '定義學習目標'].map((item) => (
                  <div key={item} className="flex items-start gap-2">
                    <span className="font-bold text-green-600">✓</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Tab: Bloom 分類參考 */}
        {activeTab === 'bloom' && (
          <div className="rounded-lg bg-white p-8 shadow-lg">
            <h2 className="mb-6 text-2xl font-bold text-gray-900">Bloom's Taxonomy — 認知層級分類</h2>
            <div className="space-y-6">
              {BLOOM_LEVELS.map((level) => (
                <div key={level.key} className="rounded-r-lg border-l-4 border-indigo-500 bg-gray-50 py-4 pl-6">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-lg font-bold text-gray-900">{level.label}</h3>
                    <span className="rounded-full bg-indigo-600 px-3 py-1 text-sm font-semibold text-white">
                      難度 {level.difficulty}
                    </span>
                  </div>
                  <p className="mb-3 text-gray-700">{level.description}</p>
                  <div className="flex flex-wrap gap-2">
                    {level.keywords.map((kw) => (
                      <span key={kw} className="rounded-full bg-indigo-100 px-3 py-1 text-sm text-indigo-700">{kw}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab: 系統 Prompt */}
        {activeTab === 'prompt' && (
          <div className="rounded-lg bg-white p-8 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">系統 Prompt</h2>
              <button
                type="button"
                onClick={() => copyToClipboard(SYSTEM_PROMPT_DISPLAY, 'system')}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white transition hover:bg-indigo-700"
              >
                <Copy className="size-4" />
                {copiedIndex === 'system' ? '已複製' : '複製'}
              </button>
            </div>
            <pre className="max-h-96 overflow-auto rounded-lg bg-gray-900 p-6 text-sm text-gray-100">
              {SYSTEM_PROMPT_DISPLAY}
            </pre>
          </div>
        )}

        {/* 生成結果 */}
        {output?.questions?.length ? (
          <div className="mt-8 rounded-lg bg-white p-8 shadow-lg">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-2xl font-bold text-gray-900">
                📊 生成結果（共 {output.questions.length} 題）
              </h2>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleDownload}
                  className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  <Download className="size-4" />
                  下載 JSON
                </button>
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={isPending}
                  className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isPending ? <Loader className="size-4 animate-spin" /> : <Zap className="size-4" />}
                  {isPending ? '建立中...' : '建立 QuizFlow 測驗'}
                </button>
              </div>
            </div>

            {importError && (
              <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-600">
                <AlertCircle className="size-4 shrink-0" />
                {importError}
              </div>
            )}

            <div className="space-y-6">
              {output.questions.map((q, idx) => (
                <div key={q.id ?? idx} className="rounded-lg border border-gray-200 p-6 transition hover:shadow-md">
                  <div className="mb-4 flex items-start justify-between">
                    <h3 className="text-lg font-bold text-gray-900">題目 {idx + 1}</h3>
                    <div className="flex gap-2">
                      <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700">
                        {BLOOM_LABELS[q.bloom_level] ?? q.bloom_level}
                      </span>
                      <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700">
                        難度 {q.difficulty}
                      </span>
                    </div>
                  </div>

                  <div className="mb-4 rounded-lg bg-gray-50 p-4">
                    <p className="mb-3 font-medium text-gray-900">{q.content}</p>
                    {q.options && q.options.length > 0 && (
                      <div className="space-y-2">
                        {q.options.map((option, oIdx) => (
                          <div
                            key={oIdx}
                            className={`rounded border-2 p-3 ${
                              oIdx === q.correct_answer
                                ? 'border-green-300 bg-green-50'
                                : 'border-gray-300 bg-white'
                            }`}
                          >
                            <span className="mr-2 font-medium text-gray-500">
                              {String.fromCharCode(65 + oIdx)}.
                            </span>
                            {option}
                            {oIdx === q.correct_answer && (
                              <span className="ml-2 text-green-600">✓</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {q.type === 'short_answer' && (
                      <div className="mt-2 rounded border border-green-300 bg-green-50 p-2 text-sm text-green-800">
                        <strong>參考答案：</strong>{String(q.correct_answer)}
                      </div>
                    )}
                  </div>

                  <div className="mb-3 grid grid-cols-2 gap-4">
                    <div className="rounded bg-blue-50 p-3">
                      <p className="mb-1 text-xs text-gray-600">學習目標</p>
                      <p className="text-sm font-medium text-gray-900">{q.learning_objective}</p>
                    </div>
                    <div className="rounded bg-purple-50 p-3">
                      <p className="mb-1 text-xs text-gray-600">預估時間</p>
                      <p className="text-sm font-medium text-gray-900">{q.estimated_time_minutes ?? 2} 分鐘</p>
                    </div>
                  </div>

                  <div className="rounded border-l-4 border-yellow-400 bg-yellow-50 p-4">
                    <p className="text-sm text-yellow-800">
                      <strong>解釋：</strong>{q.explanation}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-lg bg-gray-100 p-4">
              <button
                type="button"
                onClick={() => copyToClipboard(JSON.stringify(output, null, 2), 'json')}
                className="flex items-center gap-2 rounded bg-indigo-600 px-4 py-2 text-sm text-white transition hover:bg-indigo-700"
              >
                <Copy className="size-4" />
                {copiedIndex === 'json' ? '已複製 JSON' : '複製全部 JSON'}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
