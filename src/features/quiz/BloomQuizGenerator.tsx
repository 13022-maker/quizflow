'use client';

import { AlertCircle, Download, Loader, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';

import { createQuizWithBloomQuestions, type BloomQuestion } from '@/actions/bloomActions';

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
根據 Bloom's Taxonomy 設計題目，確保題目符合認知層級要求，
使用台灣教育術語和例子，支援單選題與簡答題。

輸出格式：JSON，每題包含 bloom_level、difficulty、content、
options、correct_answer、explanation、learning_objective。`;

// 題型卡片
const QUESTION_TYPE_CARDS = [
  { value: 'multiple_choice', icon: '🔘', label: '選擇題', desc: '四選一' },
  { value: 'short_answer', icon: '✏️', label: '簡答題', desc: '短文作答' },
  { value: 'mixed', icon: '✨', label: '混合', desc: '自動分配' },
];

// 難度按鈕
const DIFFICULTY_BTNS = [
  { value: 'easy', label: '入門' },
  { value: 'mixed', label: '均勻' },
  { value: 'hard', label: '進階' },
];

type BloomOutput = { metadata?: { topic?: string }; questions: BloomQuestion[] };

export function BloomQuizGenerator() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<'generator' | 'bloom' | 'prompt'>('generator');

  // 表單狀態
  const [contentInput, setContentInput] = useState('');
  const [questionType, setQuestionType] = useState('multiple_choice');
  const [difficulty, setDifficulty] = useState('mixed');
  const [numQuestions, setNumQuestions] = useState(10);

  // 結果狀態
  const [output, setOutput] = useState<BloomOutput | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const [importError, setImportError] = useState('');

  const handleGenerate = useCallback(async () => {
    if (!contentInput.trim()) { setGenError('請先輸入教學內容'); return; }
    setGenError(''); setImportError(''); setOutput(null); setIsGenerating(true);
    try {
      const res = await fetch('/api/ai/bloom-studio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: contentInput, difficulty, numQuestions, questionType }),
      });
      // 先取 text，再嘗試解析 JSON，讓錯誤訊息更清楚
      const text = await res.text();
      let data: BloomOutput & { error?: string };
      try {
        data = JSON.parse(text);
      } catch {
        setGenError(`伺服器回應非 JSON（前 200 字）：${text.slice(0, 200)}`);
        return;
      }
      if (!res.ok) { setGenError(data.error ?? '生成失敗，請重試'); return; }
      setOutput(data);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : '網路錯誤，請重試');
    } finally {
      setIsGenerating(false);
    }
  }, [contentInput, difficulty, numQuestions, questionType]);

  const handleDownload = useCallback(() => {
    if (!output) return;
    const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'bloom-questions.json'; a.click();
    URL.revokeObjectURL(url);
  }, [output]);

  const handleImport = useCallback(() => {
    if (!output?.questions?.length) return;
    setImportError('');
    const topic = output.metadata?.topic ?? contentInput.slice(0, 50);
    const title = `Bloom 出題 — ${topic}`.slice(0, 100);
    startTransition(async () => {
      const result = await createQuizWithBloomQuestions(title, output.questions);
      if ('error' in result) { setImportError(result.error); return; }
      router.push(`/dashboard/quizzes/${result.quizId}/edit`);
    });
  }, [output, contentInput, router]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="mx-auto max-w-3xl">

        {/* Tabs */}
        <div className="mb-6 flex gap-1 rounded-xl bg-white p-1 shadow-sm">
          {([
            { key: 'generator', label: '🎯 題目生成器' },
            { key: 'bloom', label: '📚 Bloom 分類參考' },
            { key: 'prompt', label: '💡 系統 Prompt' },
          ] as const).map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition ${
                activeTab === tab.key
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab: 題目生成器 */}
        {activeTab === 'generator' && (
          <div className="space-y-4">
            {/* 輸入區 */}
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <p className="mb-2 text-sm font-semibold text-gray-700">
                📝 教學內容（貼上 PDF 文字、YouTube 摘要或課程筆記）
              </p>
              <textarea
                value={contentInput}
                onChange={e => setContentInput(e.target.value)}
                placeholder="例如：介紹光合作用的過程，包括光反應和暗反應..."
                className="h-36 w-full resize-none rounded-xl border border-gray-200 p-3 text-sm placeholder:text-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </div>

            {/* 題型選擇 */}
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <p className="mb-3 text-sm font-semibold text-gray-700">選擇題型</p>
              <div className="grid grid-cols-3 gap-3">
                {QUESTION_TYPE_CARDS.map(card => (
                  <button
                    key={card.value}
                    type="button"
                    onClick={() => setQuestionType(card.value)}
                    className={`flex flex-col items-start gap-0.5 rounded-xl border-2 p-4 text-left transition ${
                      questionType === card.value
                        ? 'border-amber-400 bg-amber-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="mb-1 flex w-full items-center justify-between">
                      <span className="text-xl">{card.icon}</span>
                      <span className={`size-4 rounded-full border-2 ${
                        questionType === card.value
                          ? 'border-amber-500 bg-amber-500'
                          : 'border-gray-300'
                      }`} />
                    </div>
                    <span className="text-sm font-bold text-gray-900">{card.label}</span>
                    <span className="text-xs text-gray-400">{card.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 題數 + 難度 */}
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <div className="mb-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-700">每種題型出幾題</p>
                  <span className="rounded-lg bg-amber-100 px-3 py-1 text-sm font-bold text-amber-700">{numQuestions}</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="20"
                  value={numQuestions}
                  onChange={e => setNumQuestions(Number(e.target.value))}
                  className="h-2 w-full cursor-pointer appearance-none rounded-full bg-gray-200 accent-amber-500"
                />
                <div className="mt-1 flex justify-between text-xs text-gray-400">
                  <span>1</span><span>20</span>
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-semibold text-gray-700">難度等級</p>
                <div className="flex gap-2">
                  {DIFFICULTY_BTNS.map(btn => (
                    <button
                      key={btn.value}
                      type="button"
                      onClick={() => setDifficulty(btn.value)}
                      className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition ${
                        difficulty === btn.value
                          ? 'bg-gray-900 text-white'
                          : 'border border-gray-200 bg-white text-gray-600 hover:border-gray-400'
                      }`}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 錯誤提示 */}
            {genError && (
              <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-600">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span className="break-all">{genError}</span>
              </div>
            )}

            {/* 生成按鈕 */}
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={isGenerating || !contentInput.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gray-900 py-4 text-base font-bold text-white transition hover:bg-gray-800 disabled:opacity-40"
            >
              {isGenerating
                ? <><Loader className="size-5 animate-spin" /> 生成中...</>
                : <><Zap className="size-5" /> 🤖 開始 AI 命題</>}
            </button>
          </div>
        )}

        {/* Tab: Bloom 分類參考 */}
        {activeTab === 'bloom' && (
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="mb-5 text-xl font-bold text-gray-900">Bloom's Taxonomy — 認知層級分類</h2>
            <div className="space-y-4">
              {BLOOM_LEVELS.map(level => (
                <div key={level.key} className="rounded-xl border-l-4 border-indigo-500 bg-gray-50 py-3 pl-4">
                  <div className="mb-1 flex items-center justify-between">
                    <h3 className="font-bold text-gray-900">{level.label}</h3>
                    <span className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-semibold text-white">難度 {level.difficulty}</span>
                  </div>
                  <p className="mb-2 text-sm text-gray-600">{level.description}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {level.keywords.map(kw => (
                      <span key={kw} className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs text-indigo-700">{kw}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab: 系統 Prompt */}
        {activeTab === 'prompt' && (
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-xl font-bold text-gray-900">系統 Prompt</h2>
            <pre className="max-h-96 overflow-auto rounded-xl bg-gray-900 p-5 text-sm text-gray-100">{SYSTEM_PROMPT_DISPLAY}</pre>
          </div>
        )}

        {/* 生成結果 */}
        {output?.questions?.length ? (
          <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-bold text-gray-900">📊 生成結果（共 {output.questions.length} 題）</h2>
              <div className="flex gap-2">
                <button type="button" onClick={handleDownload}
                  className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50">
                  <Download className="size-4" /> 下載 JSON
                </button>
                <button type="button" onClick={handleImport} disabled={isPending}
                  className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-indigo-700 disabled:opacity-50">
                  {isPending ? <Loader className="size-4 animate-spin" /> : <Zap className="size-4" />}
                  {isPending ? '建立中...' : '建立 QuizFlow 測驗'}
                </button>
              </div>
            </div>

            {importError && (
              <div className="mb-4 flex items-center gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-600">
                <AlertCircle className="size-4 shrink-0" />{importError}
              </div>
            )}

            <div className="space-y-4">
              {output.questions.map((q, idx) => (
                <div key={q.id ?? idx} className="rounded-xl border border-gray-100 p-5">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <span className="font-bold text-gray-900">題目 {idx + 1}</span>
                    <div className="flex gap-1.5">
                      <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
                        {BLOOM_LABELS[q.bloom_level] ?? q.bloom_level}
                      </span>
                      <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-700">
                        難度 {q.difficulty}
                      </span>
                    </div>
                  </div>

                  <p className="mb-3 text-sm font-medium text-gray-900">{q.content}</p>

                  {q.options && q.options.length > 0 && (
                    <div className="mb-3 space-y-2">
                      {q.options.map((opt, oIdx) => (
                        <div key={oIdx}
                          className={`rounded-lg border p-2.5 text-sm ${
                            oIdx === q.correct_answer
                              ? 'border-green-300 bg-green-50 text-green-800'
                              : 'border-gray-100 bg-gray-50 text-gray-700'
                          }`}>
                          <span className="mr-2 font-semibold">{String.fromCharCode(65 + oIdx)}.</span>
                          {opt}
                          {oIdx === q.correct_answer && <span className="ml-2">✓</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {q.type === 'short_answer' && (
                    <div className="mb-3 rounded-lg border border-green-200 bg-green-50 p-2.5 text-sm text-green-800">
                      <strong>參考答案：</strong>{String(q.correct_answer)}
                    </div>
                  )}

                  <div className="mb-2 grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-blue-50 p-2.5">
                      <p className="mb-0.5 text-xs text-gray-500">學習目標</p>
                      <p className="text-sm text-gray-900">{q.learning_objective}</p>
                    </div>
                    <div className="rounded-lg bg-purple-50 p-2.5">
                      <p className="mb-0.5 text-xs text-gray-500">預估時間</p>
                      <p className="text-sm text-gray-900">{q.estimated_time_minutes ?? 2} 分鐘</p>
                    </div>
                  </div>

                  <div className="rounded-lg border-l-4 border-amber-400 bg-amber-50 p-3 text-sm text-amber-800">
                    <strong>解釋：</strong>{q.explanation}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
