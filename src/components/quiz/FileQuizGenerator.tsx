'use client';

import { useRef, useState } from 'react';

type QuestionType = 'mc' | 'tf' | 'fill' | 'short';

type GeneratedQuestion = {
  type: QuestionType;
  question: string;
  options?: string[];
  answer: string;
  explanation?: string;
};

type GeneratedResult = {
  title: string;
  questions: GeneratedQuestion[];
};

type Props = {
  onImport: (questions: GeneratedQuestion[], title: string) => void;
  onClose: () => void;
};

const TYPE_CONFIG = [
  { value: 'mc' as QuestionType, label: '選擇題', sub: '4選1' },
  { value: 'tf' as QuestionType, label: '是非題', sub: '○/✕' },
  { value: 'fill' as QuestionType, label: '填空題', sub: '___' },
  { value: 'short' as QuestionType, label: '簡答題', sub: '文字作答' },
];

const FILE_ICONS: Record<string, string> = {
  pdf: '📕',
  doc: '📘',
  docx: '📘',
  jpg: '🖼',
  jpeg: '🖼',
  png: '🖼',
  webp: '🖼',
  gif: '🖼',
};

function formatSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Vercel Serverless request body 上限 ~4.5MB，超過就要在前端裁切
const MAX_UPLOAD_SIZE = 4.5 * 1024 * 1024;

export default function FileQuizGenerator({ onImport, onClose }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [types, setTypes] = useState<QuestionType[]>(['mc']);
  const [count, setCount] = useState(5);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<GeneratedResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // PDF 頁數範圍選擇器
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [startPage, setStartPage] = useState(1);
  const [endPage, setEndPage] = useState(1);
  const [pageLoading, setPageLoading] = useState(false);

  async function handleFile(f: File) {
    setFile(f);
    setResult(null);
    setError('');
    setPdfPageCount(null);

    // 大檔案顯示黃色警告（不阻擋，讓用戶選頁數後前端裁切再上傳）
    if (f.size > MAX_UPLOAD_SIZE) {
      const sizeMB = (f.size / 1024 / 1024).toFixed(1);
      setError(`檔案較大（${sizeMB}MB），請選擇較少頁數，系統會自動裁切後上傳`);
    }

    // 僅 PDF 才讀取頁數
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
      // 讀頁數失敗就不顯示選擇器，讓後端直接處理
      setPdfPageCount(null);
    } finally {
      setPageLoading(false);
    }
  }

  function toggleType(t: QuestionType) {
    setTypes(prev =>
      prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t],
    );
  }

  async function generate() {
    if (!file || !types.length) {
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const fd = new FormData();

      // 大 PDF 且已讀到頁數：前端先裁切成小 PDF 再上傳（繞過 Vercel 4.5MB body 限制）
      const isPdf = file.name.split('.').pop()?.toLowerCase() === 'pdf';
      if (isPdf && pdfPageCount !== null && file.size > MAX_UPLOAD_SIZE) {
        const { PDFDocument } = await import('pdf-lib');
        const srcBytes = await file.arrayBuffer();
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
        const trimmedFile = new File([trimmedBytes], file.name, { type: 'application/pdf' });
        fd.append('file', trimmedFile);
        // 裁切過的檔案已只含選中頁面，不需再傳 startPage/endPage
      } else {
        fd.append('file', file);
        // 未裁切：傳頁數範圍讓 server 端裁切
        if (pdfPageCount !== null) {
          fd.append('startPage', String(startPage));
          fd.append('endPage', String(endPage));
        }
      }

      fd.append('types', JSON.stringify(types));
      fd.append('count', String(count));
      fd.append('difficulty', difficulty);

      const res = await fetch('/api/ai/generate-from-file', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '命題失敗');
      }
      setResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '命題失敗，請重試');
    } finally {
      setLoading(false);
    }
  }

  const ext = file?.name.split('.').pop()?.toLowerCase() || '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">📂 上傳講義自動命題</h2>
            <p className="mt-0.5 text-xs text-gray-500">支援 PDF、Word、圖片</p>
          </div>
          <button onClick={onClose} className="text-2xl leading-none text-gray-400 hover:text-gray-600">×</button>
        </div>

        <div className="space-y-5 p-6">

          {/* Upload */}
          {!file
            ? (
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
                <div
                  className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${dragOver ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:border-amber-400 hover:bg-amber-50'}`}
                  onClick={() => inputRef.current?.click()}
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
                >
                  <input
                    ref={inputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.gif"
                    onChange={(e) => {
                      if (e.target.files?.[0]) {
                        handleFile(e.target.files[0]);
                      }
                    }}
                  />
                  <div className="mb-3 text-4xl">📂</div>
                  <p className="mb-1 font-semibold text-gray-700">點擊或拖曳上傳教材</p>
                  <p className="text-xs text-gray-400">PDF · DOCX · JPG · PNG</p>
                </div>
              )
            : (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <span className="text-2xl">{FILE_ICONS[ext] || '📄'}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-800">{file.name}</p>
                      <p className="font-mono text-xs text-gray-500">{formatSize(file.size)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setFile(null);
                        setPdfPageCount(null);
                        setError('');
                      }}
                      className="text-xl text-gray-400 hover:text-red-500"
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

          {/* Question types */}
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-amber-700">選擇題型（可複選）</p>
            <div className="grid grid-cols-2 gap-2">
              {TYPE_CONFIG.map(t => (
                <button
                  key={t.value}
                  onClick={() => toggleType(t.value)}
                  className={`flex items-center gap-2 rounded-xl border-2 p-3 text-left transition-all ${types.includes(t.value) ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:border-amber-300'}`}
                >
                  <div className={`flex size-5 shrink-0 items-center justify-center rounded border-2 text-xs font-bold transition-colors ${types.includes(t.value) ? 'border-amber-500 bg-amber-500 text-white' : 'border-gray-300'}`}>
                    {types.includes(t.value) && '✓'}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{t.label}</p>
                    <p className="text-xs text-gray-400">{t.sub}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Count + Difficulty */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-amber-700">每種題型題數</p>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={20}
                  value={count}
                  onChange={e => setCount(Number(e.target.value))}
                  className="flex-1 accent-amber-500"
                />
                <span className="w-6 text-center font-mono font-bold text-amber-700">{count}</span>
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-amber-700">難度等級</p>
              <div className="flex gap-1">
                {(['easy', 'medium', 'hard'] as const).map(d => (
                  <button
                    key={d}
                    onClick={() => setDifficulty(d)}
                    className={`flex-1 rounded-lg border py-1.5 text-xs font-semibold transition-colors ${difficulty === d ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}
                  >
                    {{ easy: '簡單', medium: '中等', hard: '困難' }[d]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Error */}
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

          {/* Generate / Import buttons */}
          {!result
            ? (
                <button
                  onClick={generate}
                  disabled={!file || !types.length || loading}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-3 font-bold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  {loading
                    ? (
                        <>
                          <span className="animate-spin">⏳</span>
                          {' '}
                          AI 分析中，請稍候…
                        </>
                      )
                    : (
                        <>
                          <span>✨</span>
                          {' '}
                          開始 AI 命題
                        </>
                      )}
                </button>
              )
            : (
                <div className="space-y-3">
                  <div className="rounded-xl border border-green-200 bg-green-50 p-4">
                    <p className="mb-1 font-semibold text-green-800">
                      ✅ 命題完成：
                      {result.title}
                    </p>
                    <p className="text-sm text-green-700">
                      共生成
                      {result.questions.length}
                      {' '}
                      題，確認匯入後會自動加入編輯器
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setResult(null)}
                      className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                    >
                      重新命題
                    </button>
                    <button
                      onClick={() => onImport(result.questions, result.title)}
                      className="flex-2 grow rounded-xl bg-gray-900 py-2.5 text-sm font-semibold text-white hover:bg-gray-800"
                    >
                      ✓ 匯入
                      {' '}
                      {result.questions.length}
                      {' '}
                      題到編輯器
                    </button>
                  </div>
                </div>
              )}

        </div>
      </div>
    </div>
  );
}
