'use client';

import { useRef, useState } from 'react';

type QuestionType = 'mc' | 'tf' | 'fill' | 'short';

interface GeneratedQuestion {
  type: QuestionType;
  question: string;
  options?: string[];
  answer: string;
  explanation?: string;
}

interface GeneratedResult {
  title: string;
  questions: GeneratedQuestion[];
}

interface Props {
  onImport: (questions: GeneratedQuestion[], title: string) => void;
  onClose: () => void;
}

const TYPE_CONFIG = [
  { value: 'mc' as QuestionType, label: '選擇題', sub: '4選1' },
  { value: 'tf' as QuestionType, label: '是非題', sub: '○/✕' },
  { value: 'fill' as QuestionType, label: '填空題', sub: '___' },
  { value: 'short' as QuestionType, label: '簡答題', sub: '文字作答' },
];

const FILE_ICONS: Record<string, string> = {
  pdf: '📕', doc: '📘', docx: '📘',
  jpg: '🖼', jpeg: '🖼', png: '🖼', webp: '🖼', gif: '🖼',
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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

  function handleFile(f: File) {
    setFile(f);
    setResult(null);
    setError('');
  }

  function toggleType(t: QuestionType) {
    setTypes(prev =>
      prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]
    );
  }

  async function generate() {
    if (!file || !types.length) return;
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('types', JSON.stringify(types));
      fd.append('count', String(count));
      fd.append('difficulty', difficulty);

      const res = await fetch('/api/ai/generate-from-file', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '命題失敗');
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-bold text-gray-900">📂 上傳講義自動命題</h2>
            <p className="text-xs text-gray-500 mt-0.5">支援 PDF、Word、圖片</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="p-6 space-y-5">

          {/* Upload */}
          {!file ? (
            <div
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${dragOver ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:border-amber-400 hover:bg-amber-50'}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            >
              <input ref={inputRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.gif" onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
              <div className="text-4xl mb-3">📂</div>
              <p className="font-semibold text-gray-700 mb-1">點擊或拖曳上傳教材</p>
              <p className="text-xs text-gray-400">PDF · DOCX · JPG · PNG</p>
            </div>
          ) : (
            <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
              <span className="text-2xl">{FILE_ICONS[ext] || '📄'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800 truncate">{file.name}</p>
                <p className="text-xs text-gray-500 font-mono">{formatSize(file.size)}</p>
              </div>
              <button onClick={() => setFile(null)} className="text-gray-400 hover:text-red-500 text-xl">×</button>
            </div>
          )}

          {/* Question types */}
          <div>
            <p className="text-xs font-bold text-amber-700 uppercase tracking-widest mb-2">選擇題型（可複選）</p>
            <div className="grid grid-cols-2 gap-2">
              {TYPE_CONFIG.map(t => (
                <button
                  key={t.value}
                  onClick={() => toggleType(t.value)}
                  className={`flex items-center gap-2 p-3 rounded-xl border-2 text-left transition-all ${types.includes(t.value) ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:border-amber-300'}`}
                >
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center text-xs font-bold flex-shrink-0 transition-colors ${types.includes(t.value) ? 'bg-amber-500 border-amber-500 text-white' : 'border-gray-300'}`}>
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
              <p className="text-xs font-bold text-amber-700 uppercase tracking-widest mb-2">每種題型題數</p>
              <div className="flex items-center gap-2">
                <input
                  type="range" min={1} max={20} value={count}
                  onChange={e => setCount(Number(e.target.value))}
                  className="flex-1 accent-amber-500"
                />
                <span className="font-mono font-bold text-amber-700 w-6 text-center">{count}</span>
              </div>
            </div>
            <div>
              <p className="text-xs font-bold text-amber-700 uppercase tracking-widest mb-2">難度等級</p>
              <div className="flex gap-1">
                {(['easy', 'medium', 'hard'] as const).map(d => (
                  <button
                    key={d}
                    onClick={() => setDifficulty(d)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${difficulty === d ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}
                  >
                    {{ easy: '簡單', medium: '中等', hard: '困難' }[d]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Error */}
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</div>}

          {/* Generate / Import buttons */}
          {!result ? (
            <button
              onClick={generate}
              disabled={!file || !types.length || loading}
              className="w-full py-3 rounded-xl font-bold text-white bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <><span className="animate-spin">⏳</span> AI 分析中，請稍候…</>
              ) : (
                <><span>✨</span> 開始 AI 命題</>
              )}
            </button>
          ) : (
            <div className="space-y-3">
              <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
                <p className="font-semibold text-green-800 mb-1">✅ 命題完成：{result.title}</p>
                <p className="text-sm text-green-700">共生成 {result.questions.length} 題，確認匯入後會自動加入編輯器</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setResult(null)}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-semibold hover:bg-gray-50 text-sm"
                >
                  重新命題
                </button>
                <button
                  onClick={() => onImport(result.questions, result.title)}
                  className="flex-2 flex-grow py-2.5 rounded-xl bg-gray-900 text-white font-semibold hover:bg-gray-800 text-sm"
                >
                  ✓ 匯入 {result.questions.length} 題到編輯器
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
