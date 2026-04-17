'use client';

/**
 * AIQuizModal.tsx
 * QuizFlow — AI 出題統一面板
 *
 * 使用方式：
 *   import AIQuizModal from '@/components/quiz/AIQuizModal';
 *   <AIQuizModal quizId={id} onImport={handleImport} onClose={() => setOpen(false)} />
 *
 * onImport 回傳格式：
 *   { type, question, options?, answer, explanation? }[]
 */

import { useRef, useState } from 'react';

// ─── Types ───────────────────────────────────────────────
type QuestionType = 'mc' | 'tf' | 'fill' | 'short' | 'rank';
type Difficulty = 'easy' | 'medium' | 'hard';
type Mode = 'text' | 'file' | 'url';

type GeneratedQuestion = {
  type: QuestionType;
  question: string;
  options?: string[];
  // rank 題的 answer 是字串陣列；其他題型是字串
  answer: string | string[];
  explanation?: string;
};

type GeneratedResult = {
  title: string;
  questions: GeneratedQuestion[];
};

type Props = {
  quizId?: string;
  onImport: (questions: GeneratedQuestion[], title: string) => void;
  onClose: () => void;
};

// ─── Constants ────────────────────────────────────────────
const QUESTION_TYPES = [
  { value: 'mc' as QuestionType, emoji: '🔘', label: '選擇題', sub: '四選一' },
  { value: 'tf' as QuestionType, emoji: '⭕', label: '是非題', sub: '○ / ✕' },
  { value: 'fill' as QuestionType, emoji: '✏️', label: '填空題', sub: '填入答案' },
  { value: 'short' as QuestionType, emoji: '📝', label: '簡答題', sub: '短文作答' },
  { value: 'rank' as QuestionType, emoji: '🔢', label: '排序題', sub: '依序排列' },
];

const DIFFICULTIES: { value: Difficulty; label: string }[] = [
  { value: 'easy', label: '入門' },
  { value: 'medium', label: '普通' },
  { value: 'hard', label: '進階' },
];

const FILE_EMOJIS: Record<string, string> = {
  pdf: '📕',
  doc: '📘',
  docx: '📘',
  jpg: '🖼',
  jpeg: '🖼',
  png: '🖼',
  webp: '🖼',
  gif: '🖼',
};

function fmtSize(b: number) {
  if (b < 1024) {
    return `${b} B`;
  }
  if (b < 1048576) {
    return `${(b / 1024).toFixed(1)} KB`;
  }
  return `${(b / 1048576).toFixed(1)} MB`;
}

// ─── Component ────────────────────────────────────────────
export default function AIQuizModal({ onImport, onClose }: Props) {
  // Mode
  const [mode, setMode] = useState<Mode>('text');

  // Shared settings
  const [types, setTypes] = useState<QuestionType[]>(['mc']);
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');

  // Text mode
  const [topic, setTopic] = useState('');

  // URL mode（YouTube / Google Docs）
  const [sourceUrl, setSourceUrl] = useState('');

  // File mode
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // PDF 頁數範圍
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [startPage, setStartPage] = useState(1);
  const [endPage, setEndPage] = useState(1);
  const [pageLoading, setPageLoading] = useState(false);

  // AI 模型選擇（僅檔案模式會用到，預設 Gemini 省錢快速）
  const [model, setModel] = useState<'gemini' | 'claude'>('gemini');

  // State
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState('');
  const [upgradeRequired, setUpgradeRequired] = useState(false); // quota 超限時顯示升級按鈕
  const [result, setResult] = useState<GeneratedResult | null>(null);

  // ── Helpers ──
  function toggleType(t: QuestionType) {
    setTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  }

  // Vercel Serverless request body 上限約 4.5MB
  const MAX_UPLOAD_SIZE = 4.5 * 1024 * 1024;

  async function handleFile(f: File) {
    setResult(null);
    setError('');
    setPdfPageCount(null);
    setFile(f);

    // 大檔案顯示黃色警告，但不阻擋 — 讓用戶選頁數後前端裁切再上傳
    if (f.size > MAX_UPLOAD_SIZE) {
      const sizeMB = (f.size / 1024 / 1024).toFixed(1);
      setError(`檔案較大（${sizeMB}MB），請選擇較少頁數，系統會自動裁切後上傳`);
    }

    // PDF 才讀取頁數
    const isPdf = f.name.split('.').pop()?.toLowerCase() === 'pdf';
    if (!isPdf) {
      return;
    }

    setPageLoading(true);
    try {
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      const arrayBuffer = await f.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
      const total = pdf.numPages;
      setPdfPageCount(total);
      setStartPage(1);
      setEndPage(Math.min(10, total));
    } catch {
      // 讀取失敗就不顯示範圍選擇器，讓後端直接處理
      setPdfPageCount(null);
    } finally {
      setPageLoading(false);
    }
  }

  // ── Generate ──
  async function generate() {
    if (!types.length) {
      setError('請至少選擇一種題型');
      return;
    }
    if (mode === 'text' && !topic.trim()) {
      setError('請輸入主題或課文內容');
      return;
    }
    if (mode === 'file' && !file) {
      setError('請上傳一份教材檔案');
      return;
    }
    if (mode === 'url' && !sourceUrl.trim()) {
      setError('請貼入 YouTube 或 Google Docs 連結');
      return;
    }

    setLoading(true);
    setError('');
    setUpgradeRequired(false);
    setResult(null);

    try {
      let data: GeneratedResult;

      if (mode === 'text') {
        setStep('AI 分析主題中…');
        const res = await fetch('/api/ai/generate-questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ topic, types, count, difficulty }),
        });
        data = await res.json();
        if (!res.ok) {
          if ((data as { upgradeRequired?: boolean }).upgradeRequired) {
            setUpgradeRequired(true);
          }
          throw new Error((data as { error?: string }).error || '命題失敗');
        }
      } else if (mode === 'file') {
        setStep('讀取檔案…');
        const fd = new FormData();

        // 大 PDF 且有選頁數範圍：前端先裁切成小 PDF 再上傳，避免超過 Vercel 4.5MB 限制
        const isPdf = file!.name.split('.').pop()?.toLowerCase() === 'pdf';
        if (isPdf && pdfPageCount !== null && file!.size > MAX_UPLOAD_SIZE) {
          setStep('裁切 PDF 中…');
          const { PDFDocument } = await import('pdf-lib');
          const srcBytes = await file!.arrayBuffer();
          const srcDoc = await PDFDocument.load(srcBytes);
          const newDoc = await PDFDocument.create();
          const safeStart = Math.max(1, startPage);
          const safeEnd = Math.min(endPage, pdfPageCount);
          const indices = Array.from(
            { length: safeEnd - safeStart + 1 },
            (_, i) => safeStart - 1 + i,
          );
          const copiedPages = await newDoc.copyPages(srcDoc, indices);
          copiedPages.forEach(page => newDoc.addPage(page));
          const trimmedBytes = await newDoc.save();
          const trimmedFile = new File([trimmedBytes], file!.name, { type: 'application/pdf' });
          fd.append('file', trimmedFile);
          // 裁切後的 PDF 已經只包含選中頁面，不需要再傳 startPage/endPage
        } else {
          fd.append('file', file!);
          // 未裁切的檔案：傳頁數範圍讓 server 端裁切（小檔案走原本邏輯）
          if (pdfPageCount !== null) {
            fd.append('startPage', String(startPage));
            fd.append('endPage', String(endPage));
          }
        }

        fd.append('types', JSON.stringify(types));
        fd.append('count', String(count));
        fd.append('difficulty', difficulty);
        fd.append('model', model);
        setStep('AI 分析內容中…');
        const res = await fetch('/api/ai/generate-from-file', { method: 'POST', credentials: 'include', body: fd });
        data = await res.json();
        if (!res.ok) {
          if ((data as { upgradeRequired?: boolean }).upgradeRequired) {
            setUpgradeRequired(true);
          }
          throw new Error((data as { error?: string }).error || '命題失敗');
        }
      } else {
        // URL 模式（YouTube / Google Docs）
        setStep('抓取連結內容中…');
        const res = await fetch('/api/ai/generate-from-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            url: sourceUrl.trim(),
            types,
            count,
            difficulty,
            model,
          }),
        });
        data = await res.json();
        if (!res.ok) {
          if ((data as { upgradeRequired?: boolean }).upgradeRequired) {
            setUpgradeRequired(true);
          }
          throw new Error((data as { error?: string }).error || '命題失敗');
        }
      }

      setResult(data);
    } catch (e: unknown) {
      // AI 伺服器忙碌（503 + retryable）時顯示特定提示
      const msg = e instanceof Error ? e.message : '命題失敗，請重試';
      if (msg.includes('忙碌') || msg.includes('overloaded')) {
        setError('AI 伺服器目前忙碌，已自動重試，請再按一次');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
      setStep('');
    }
  }

  const ext = file?.name.split('.').pop()?.toLowerCase() ?? '';
  const canGenerate = types.length > 0
    && (mode === 'text'
      ? topic.trim().length > 0
      : mode === 'file'
        ? !!file
        : sourceUrl.trim().length > 0);

  // ─── Render ────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        className="flex w-full flex-col rounded-t-3xl bg-white shadow-2xl sm:max-w-lg sm:rounded-2xl"
        style={{ maxHeight: '92vh' }}
      >

        {/* ── Header ── */}
        <div className="flex shrink-0 items-center justify-between px-5 pb-3 pt-5">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🤖</span>
            <div>
              <h2 className="text-base font-bold leading-tight text-gray-900">AI 出題</h2>
              <p className="text-xs text-gray-400">自動生成試卷，省時省力</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-full bg-gray-100 text-lg text-gray-500 transition-colors hover:bg-gray-200"
          >
            ×
          </button>
        </div>

        {/* ── Mode tabs ── */}
        <div className="shrink-0 px-5 pb-3">
          <div className="flex gap-1 rounded-xl bg-gray-100 p-1">
            <button
              onClick={() => {
                setMode('text');
                setResult(null);
                setError('');
              }}
              className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-all ${
                mode === 'text'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              ✍️ 輸入主題
            </button>
            <button
              onClick={() => {
                setMode('file');
                setResult(null);
                setError('');
              }}
              className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-all ${
                mode === 'file'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              📂 上傳講義
            </button>
            <button
              onClick={() => {
                setMode('url');
                setResult(null);
                setError('');
              }}
              className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-all ${
                mode === 'url'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              🔗 連結
            </button>
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-5">

          {/* ── URL MODE ── */}
          {mode === 'url' && (
            <div className="space-y-3">
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-widest text-amber-700">
                  貼入 YouTube 或 Google Docs 連結
                </p>
                <input
                  type="url"
                  value={sourceUrl}
                  onChange={e => setSourceUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=... 或 https://docs.google.com/document/d/..."
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm placeholder:text-gray-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
                />
              </div>
              <div className="flex gap-2 text-xs text-gray-400">
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-600">YouTube</span>
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-600">Google 文件</span>
                <span className="text-gray-300">｜</span>
                <span>自動偵測連結類型並抓取內容</span>
              </div>
            </div>
          )}

          {/* ── TEXT MODE ── */}
          {mode === 'text' && (
            <div>
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-amber-700">
                主題或課文內容
              </label>
              <textarea
                value={topic}
                onChange={e => setTopic(e.target.value)}
                placeholder="輸入考試主題，例如：「台灣的地形與氣候」&#10;或直接貼上課文內容讓 AI 根據內容出題…"
                rows={5}
                className="w-full resize-none rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-800 placeholder:text-gray-300 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
          )}

          {/* ── FILE MODE ── */}
          {mode === 'file' && (
            <div>
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-amber-700">
                上傳教材檔案
              </label>
              {/* eslint-disable-next-line style/multiline-ternary */}
              {!file ? (
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
                <div
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const f = e.dataTransfer.files[0];
                    if (f) {
                      handleFile(f);
                    }
                  }}
                  className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-all ${
                    dragOver
                      ? 'border-amber-400 bg-amber-50'
                      : 'border-gray-200 hover:border-amber-300 hover:bg-amber-50/50'
                  }`}
                >
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.mp3,.wav,.m4a,.ogg,.aac,.flac"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.[0]) {
                        handleFile(e.target.files[0]);
                      }
                    }}
                  />
                  <div className="mb-2 text-4xl">📂</div>
                  <p className="mb-1 text-sm font-semibold text-gray-700">點擊或拖曳上傳</p>
                  <p className="text-xs text-gray-400">PDF（1MB 以下）· JPG · PNG</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* 檔案資訊列 */}
                  <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <span className="text-2xl">{FILE_EMOJIS[ext] ?? '📄'}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-800">{file.name}</p>
                      <p className="font-mono text-xs text-gray-500">{fmtSize(file.size)}</p>
                    </div>
                    <button
                      onClick={() => {
                        setFile(null);
                        setResult(null);
                        setPdfPageCount(null);
                      }}
                      className="flex size-6 items-center justify-center text-xl text-gray-400 transition-colors hover:text-red-500"
                    >
                      ×
                    </button>
                  </div>

                  {/* PDF 頁數範圍選擇器 */}
                  {pageLoading && (
                    <p className="flex items-center gap-1 text-xs text-gray-400">
                      <span className="inline-block animate-spin">⏳</span>
                      {' '}
                      讀取 PDF 頁數中…
                    </p>
                  )}
                  {pdfPageCount !== null && (
                    <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:px-4">
                      <p className="text-xs font-bold text-gray-700">
                        📄 共
                        {' '}
                        {pdfPageCount}
                        {' '}
                        頁，選擇要命題的範圍
                      </p>
                      {/* 手機版改兩行顯示，避免一排塞不下 */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
                        <span className="shrink-0 text-gray-600">從第</span>
                        <input
                          type="number"
                          min={1}
                          max={pdfPageCount}
                          value={startPage}
                          onChange={(e) => {
                            const v = Math.max(1, Math.min(Number(e.target.value), pdfPageCount));
                            setStartPage(v);
                            if (endPage < v) {
                              setEndPage(v);
                            }
                          }}
                          className="w-16 rounded-lg border border-gray-300 px-2 py-1.5 text-center text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                        <span className="shrink-0 text-gray-600">頁到第</span>
                        <input
                          type="number"
                          min={startPage}
                          max={pdfPageCount}
                          value={endPage}
                          onChange={(e) => {
                            const v = Math.max(startPage, Math.min(Number(e.target.value), pdfPageCount));
                            setEndPage(v);
                          }}
                          className="w-16 rounded-lg border border-gray-300 px-2 py-1.5 text-center text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                        <span className="shrink-0 text-gray-600">頁</span>
                        <span className="text-xs font-semibold text-amber-600">
                          （共
                          {' '}
                          {endPage - startPage + 1}
                          {' '}
                          頁）
                        </span>
                      </div>
                      <p className="text-xs text-gray-400">
                        建議每次命題不超過 20 頁，避免超過 AI 限制
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── AI 模型選擇（檔案模式 + 連結模式顯示） ── */}
          {((mode === 'file' && file) || (mode === 'url' && sourceUrl.trim())) && (
            <div>
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-amber-700">
                AI 模型
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setModel('gemini')}
                  className={`flex items-start gap-2 rounded-xl border-2 p-3 text-left transition-all ${model === 'gemini' ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:border-amber-300'}`}
                >
                  <span className="text-lg">⚡</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-800">Gemini 2.5 Flash</p>
                    <p className="text-xs text-gray-400">快速省錢 · 預設</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setModel('claude')}
                  className={`flex items-start gap-2 rounded-xl border-2 p-3 text-left transition-all ${model === 'claude' ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:border-amber-300'}`}
                >
                  <span className="text-lg">🤖</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-800">Claude Sonnet 4</p>
                    <p className="text-xs text-gray-400">品質優 · 較慢</p>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* ── Question types ── */}
          <div>
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
            <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-amber-700">
              選擇題型（可複選）
            </label>
            <div className="grid grid-cols-2 gap-2">
              {QUESTION_TYPES.map((t) => {
                const checked = types.includes(t.value);
                return (
                  <button
                    key={t.value}
                    onClick={() => toggleType(t.value)}
                    className={`flex items-center gap-3 rounded-xl border-2 p-3 text-left transition-all ${
                      checked
                        ? 'border-amber-400 bg-amber-50'
                        : 'border-gray-200 hover:border-amber-300'
                    }`}
                  >
                    <div className={`flex size-5 shrink-0 items-center justify-center rounded-md border-2 text-xs font-bold transition-colors ${
                      checked ? 'border-amber-500 bg-amber-500 text-white' : 'border-gray-300'
                    }`}
                    >
                      {checked && '✓'}
                    </div>
                    <span className="text-lg">{t.emoji}</span>
                    <div>
                      <p className="text-sm font-bold leading-tight text-gray-800">{t.label}</p>
                      <p className="text-xs text-gray-400">{t.sub}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Count + Difficulty ── */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-amber-700">
                每種題型出幾題
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={20}
                  value={count}
                  onChange={e => setCount(Number(e.target.value))}
                  className="h-1.5 flex-1 accent-amber-500"
                />
                <span className="w-6 text-center text-lg font-bold tabular-nums text-amber-600">
                  {count}
                </span>
              </div>
            </div>
            <div>
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-amber-700">
                難度等級
              </label>
              <div className="flex gap-1">
                {DIFFICULTIES.map(d => (
                  <button
                    key={d.value}
                    onClick={() => setDifficulty(d.value)}
                    className={`flex-1 rounded-lg border-2 py-2 text-xs font-bold transition-all ${
                      difficulty === d.value
                        ? 'border-gray-900 bg-gray-900 text-white'
                        : 'border-gray-200 text-gray-600 hover:border-gray-400'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Error / Warning ── */}
          {error && (
            <div className={`rounded-xl border px-4 py-3 text-sm ${
              error.includes('較大')
                ? 'border-amber-300 bg-amber-50 text-amber-700'
                : 'border-red-200 bg-red-50 text-red-600'
            }`}
            >
              <p>{error}</p>
              {upgradeRequired && (
                <button
                  onClick={() => {
                    window.location.href = '/dashboard/billing';
                  }}
                  className="mt-2 w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-amber-600"
                >
                  升級至 Pro 方案
                </button>
              )}
            </div>
          )}

          {/* ── Result preview ── */}
          {result && (
            <div className="rounded-xl border border-green-200 bg-green-50 p-4">
              <p className="mb-1 text-sm font-bold text-green-800">✅ 命題完成！</p>
              <p className="mb-0.5 text-xs text-green-700">
                📋
                {result.title}
              </p>
              <p className="text-xs text-green-600">
                共
                {result.questions.length}
                {' '}
                題，確認後匯入編輯器
              </p>
            </div>
          )}
        </div>

        {/* ── Footer CTA ── */}
        <div className="shrink-0 border-t border-gray-100 px-5 pb-5 pt-2">
          {!result
            ? (
                <button
                  onClick={generate}
                  disabled={!canGenerate || loading}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold text-white transition-all disabled:cursor-not-allowed"
                  style={{
                    background: (!canGenerate || loading)
                      ? '#d1d5db'
                      : 'linear-gradient(135deg, #f59e0b, #d97706)',
                  }}
                >
                  {loading
                    ? (
                        <>
                          <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                          {step || 'AI 命題中…'}
                        </>
                      )
                    : (
                        <>
                          <span>🤖</span>
                          {' '}
                          開始 AI 命題
                        </>
                      )}
                </button>
              )
            : (
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setResult(null);
                    }}
                    className="flex-1 rounded-2xl border-2 border-gray-200 py-3 text-sm font-bold text-gray-600 transition-colors hover:bg-gray-50"
                  >
                    重新命題
                  </button>
                  <button
                    onClick={() => onImport(result.questions, result.title)}
                    className="flex-[2] rounded-2xl py-3 text-sm font-bold text-white transition-all"
                    style={{ background: 'linear-gradient(135deg, #1f2937, #374151)' }}
                  >
                    ✓ 匯入
                    {' '}
                    {result.questions.length}
                    {' '}
                    題
                  </button>
                </div>
              )}
        </div>

      </div>
    </div>
  );
}
