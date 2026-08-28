'use client';

/**
 * AI 生成學科表單：呼叫 generateAdaptiveSubject（約 1～3 分鐘）。
 * 生成期間鎖住按鈕並顯示提示；成功後顯示摘要並提供「回去建立練習」入口。
 * 教材來源二選一：貼文字（走 server action）或上傳 PDF/圖片（走 API route，
 * 因為 Server Action 預設 body 上限 1MB，檔案上傳需要走 Route Handler）。
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { generateAdaptiveSubject } from '@/actions/adaptiveActions';
import { validateSubjectUploadFiles } from '@/libs/adaptive/subjectFileValidation';

type Result = {
  id: number;
  name: string;
  knowledgeCount: number;
  itemCount: number;
};

type Mode = 'text' | 'file';

// Vercel Serverless request body 上限 ~4.5MB，超過就要在前端裁切（比照 FileQuizGenerator.tsx）
const MAX_UPLOAD_SIZE = 4.5 * 1024 * 1024;

function getExt(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function NewSubjectForm() {
  const router = useRouter();
  const [topic, setTopic] = useState('');
  const [material, setMaterial] = useState('');
  const [mode, setMode] = useState<Mode>('text');
  const [files, setFiles] = useState<File[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // PDF 頁數範圍選擇器（只有上傳單一 PDF 時才會用到）
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [startPage, setStartPage] = useState(1);
  const [endPage, setEndPage] = useState(1);
  const [pageLoading, setPageLoading] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  async function handleFiles(fileList: File[]) {
    if (fileList.length === 0) {
      return;
    }
    setResult(null);
    setError(null);
    setPdfPageCount(null);

    // 前端先擋一次，跟 route 端共用同一份規則（Task 4），減少無效上傳來回
    const validation = validateSubjectUploadFiles(fileList.map(f => f.name));
    if (!validation.ok) {
      setError(validation.error);
      return;
    }

    setFiles(fileList);

    const first = fileList[0]!;
    const firstIsPdf = getExt(first.name) === 'pdf';
    if (first.size > MAX_UPLOAD_SIZE) {
      const sizeMB = (first.size / 1024 / 1024).toFixed(1);
      setError(`檔案較大（${sizeMB}MB），請選擇較少頁數，系統會自動裁切後上傳`);
    }

    if (!firstIsPdf) {
      return;
    }

    setPageLoading(true);
    try {
      // 用 minified 進入點：非壓縮 pdf.mjs 會被 Sentry wrapping loader 包壞
      const pdfjsLib = await import('pdfjs-dist/build/pdf.min.mjs');
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      const arrayBuffer = await first.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
      const total = pdf.numPages;
      setPdfPageCount(total);
      setStartPage(1);
      setEndPage(Math.min(10, total));
    } catch {
      setPdfPageCount(null);
      setError('無法自動讀取這份 PDF 的頁數，若頁數超過 20 頁，生成可能會被拒絕。建議重新整理頁面再試一次，或改上傳較短的檔案。');
    } finally {
      setPageLoading(false);
    }
  }

  async function submit() {
    if (!topic.trim() || generating) {
      return;
    }
    if (mode === 'file' && files.length === 0) {
      return;
    }

    setGenerating(true);
    setError(null);
    setResult(null);

    try {
      if (mode === 'text') {
        const res = await generateAdaptiveSubject({
          topic: topic.trim(),
          material: material.trim() || undefined,
        });
        if ('error' in res) {
          setError(res.error);
          return;
        }
        setResult(res);
        router.refresh(); // 讓清單頁的學科下拉即時更新
        return;
      }

      const fd = new FormData();
      fd.append('topic', topic.trim());

      const first = files[0]!;
      const isPdf = getExt(first.name) === 'pdf';

      // 大 PDF 且已讀到頁數：前端先裁切成小 PDF 再上傳（繞過 Vercel 4.5MB body 限制）
      if (isPdf && pdfPageCount !== null && first.size > MAX_UPLOAD_SIZE) {
        const { PDFDocument } = await import('pdf-lib');
        const srcBytes = await first.arrayBuffer();
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
        const trimmedFile = new File([trimmedBytes as BlobPart], first.name, { type: 'application/pdf' });
        fd.append('file', trimmedFile);
      } else {
        for (const f of files) {
          fd.append('file', f);
        }
        if (isPdf && pdfPageCount !== null) {
          fd.append('startPage', String(startPage));
          fd.append('endPage', String(endPage));
        }
      }

      const apiRes = await fetch('/api/ai/generate-subject-from-file', { method: 'POST', body: fd });
      const data = await apiRes.json();
      if (!apiRes.ok) {
        throw new Error(data.error || '生成失敗');
      }
      setResult(data);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  // 生成成功：顯示摘要
  if (result) {
    return (
      <div className="rounded-lg border p-6">
        <h2 className="text-lg font-semibold">✅ 學科已生成</h2>
        <p className="mt-2 text-sm">
          <strong>{result.name}</strong>
          {' '}
          — 共
          {' '}
          {result.knowledgeCount}
          {' '}
          個知識點、
          {result.itemCount}
          {' '}
          道題目。
        </p>
        <div className="mt-4 flex gap-2">
          <Link
            href="/dashboard/adaptive"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            用它建立練習 →
          </Link>
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setTopic('');
              setMaterial('');
              setFiles([]);
              setPdfPageCount(null);
            }}
            className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            再生成一個
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border p-6">
      <div className="flex flex-col gap-1">
        <label htmlFor="subject-topic" className="text-sm font-medium">單元主題</label>
        <input
          id="subject-topic"
          value={topic}
          onChange={e => setTopic(e.target.value)}
          maxLength={100}
          disabled={generating}
          placeholder="例如：二次函數、Python 字典、細胞分裂"
          className="h-10 rounded-md border px-3 text-sm"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => switchMode('text')}
          disabled={generating}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${mode === 'text' ? 'border-primary bg-primary/10 text-primary' : 'border-gray-200 text-gray-500'}`}
        >
          貼文字
        </button>
        <button
          type="button"
          onClick={() => switchMode('file')}
          disabled={generating}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${mode === 'file' ? 'border-primary bg-primary/10 text-primary' : 'border-gray-200 text-gray-500'}`}
        >
          上傳檔案
        </button>
      </div>

      {mode === 'text'
        ? (
            <div className="flex flex-col gap-1">
              <label htmlFor="subject-material" className="text-sm font-medium">
                教材內容（選填）
              </label>
              <textarea
                id="subject-material"
                value={material}
                onChange={e => setMaterial(e.target.value)}
                maxLength={20000}
                disabled={generating}
                rows={6}
                placeholder="貼上課本段落或講義文字，AI 會依此劃分知識點與出題範圍（不填則依主題自由發揮）。"
                className="rounded-md border px-3 py-2 text-sm"
              />
            </div>
          )
        : (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">教材檔案</span>
              {files.length === 0
                ? (
                    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
                    <div
                      className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-colors ${dragOver ? 'border-primary bg-primary/5' : 'border-gray-200 hover:border-primary/60'}`}
                      onClick={() => inputRef.current?.click()}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOver(true);
                      }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOver(false);
                        void handleFiles(Array.from(e.dataTransfer.files));
                      }}
                    >
                      <input
                        ref={inputRef}
                        type="file"
                        multiple
                        className="hidden"
                        accept=".pdf,.png,.jpg,.jpeg,.webp,.gif"
                        disabled={generating}
                        onChange={(e) => {
                          if (e.target.files?.length) {
                            void handleFiles(Array.from(e.target.files));
                          }
                        }}
                      />
                      <div className="mb-2 text-3xl">📂</div>
                      <p className="text-sm font-medium text-gray-700">點擊或拖曳上傳 PDF 或圖片</p>
                      <p className="mt-1 text-xs text-gray-400">單一 PDF，或多張圖片</p>
                    </div>
                  )
                : (
                    <div className="space-y-2">
                      {files.map(f => (
                        <div key={f.name} className="flex items-center gap-3 rounded-lg border p-2.5">
                          <span className="text-xl">{getExt(f.name) === 'pdf' ? '📕' : '🖼'}</span>
                          <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
                          <span className="font-mono text-xs text-gray-500">{formatSize(f.size)}</span>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          setFiles([]);
                          setPdfPageCount(null);
                          setError(null);
                        }}
                        disabled={generating}
                        className="text-xs text-gray-400 hover:text-red-500"
                      >
                        移除，重新選擇
                      </button>

                      {pageLoading && (
                        <p className="text-xs text-gray-400">⏳ 讀取 PDF 頁數中…</p>
                      )}
                      {pdfPageCount !== null && (
                        <div className="space-y-2 rounded-lg border bg-gray-50 p-3">
                          <p className="text-xs font-bold text-gray-700">
                            📄 共
                            {' '}
                            {pdfPageCount}
                            {' '}
                            頁，選擇要生成的範圍
                          </p>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
                            <span className="text-gray-600">從第</span>
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
                              className="w-16 rounded-lg border px-2 py-1.5 text-center text-sm"
                            />
                            <span className="text-gray-600">頁到第</span>
                            <input
                              type="number"
                              min={startPage}
                              max={pdfPageCount}
                              value={endPage}
                              onChange={(e) => {
                                const v = Math.max(startPage, Math.min(Number(e.target.value), pdfPageCount));
                                setEndPage(v);
                              }}
                              className="w-16 rounded-lg border px-2 py-1.5 text-center text-sm"
                            />
                            <span className="text-gray-600">頁</span>
                          </div>
                          <p className="text-xs text-gray-400">建議不超過 20 頁，避免超過 AI 限制</p>
                        </div>
                      )}
                    </div>
                  )}
            </div>
          )}

      {error && (
        <p className="text-sm text-red-600">
          ⚠️
          {' '}
          {error}
        </p>
      )}

      {generating && (
        <p className="text-sm text-muted-foreground">
          ⏳ AI 正在設計知識圖譜與題目，約需 1～3 分鐘，請不要關閉此頁…
        </p>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={generating || !topic.trim() || (mode === 'file' && files.length === 0)}
        className="h-10 rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {generating ? '生成中…' : '✨ 開始生成'}
      </button>
    </div>
  );
}
