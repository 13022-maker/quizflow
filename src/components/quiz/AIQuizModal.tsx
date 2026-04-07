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
type QuestionType = 'mc' | 'tf' | 'fill' | 'short';
type Difficulty   = 'easy' | 'medium' | 'hard';
type Mode         = 'text' | 'file';

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
  quizId?: string;
  onImport: (questions: GeneratedQuestion[], title: string) => void;
  onClose: () => void;
}

// ─── Constants ────────────────────────────────────────────
const QUESTION_TYPES = [
  { value: 'mc'    as QuestionType, emoji: '🔘', label: '選擇題', sub: '四選一' },
  { value: 'tf'    as QuestionType, emoji: '⭕', label: '是非題', sub: '○ / ✕' },
  { value: 'fill'  as QuestionType, emoji: '✏️', label: '填空題', sub: '填入答案' },
  { value: 'short' as QuestionType, emoji: '📝', label: '簡答題', sub: '短文作答' },
];

const DIFFICULTIES: { value: Difficulty; label: string }[] = [
  { value: 'easy',   label: '入門' },
  { value: 'medium', label: '普通' },
  { value: 'hard',   label: '進階' },
];

const FILE_EMOJIS: Record<string, string> = {
  pdf: '📕', doc: '📘', docx: '📘',
  jpg: '🖼', jpeg: '🖼', png: '🖼', webp: '🖼', gif: '🖼',
};

function fmtSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

// ─── Component ────────────────────────────────────────────
export default function AIQuizModal({ onImport, onClose }: Props) {
  // Mode
  const [mode, setMode] = useState<Mode>('text');

  // Shared settings
  const [types, setTypes]           = useState<QuestionType[]>(['mc']);
  const [count, setCount]           = useState(10);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');

  // Text mode
  const [topic, setTopic] = useState('');

  // File mode
  const [file, setFile]         = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef                 = useRef<HTMLInputElement>(null);

  // State
  const [loading, setLoading] = useState(false);
  const [step, setStep]       = useState('');
  const [error, setError]     = useState('');
  const [result, setResult]   = useState<GeneratedResult | null>(null);

  // ── Helpers ──
  function toggleType(t: QuestionType) {
    setTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  }

  function handleFile(f: File) { setFile(f); setResult(null); setError(''); }

  // ── Generate ──
  async function generate() {
    if (!types.length) { setError('請至少選擇一種題型'); return; }
    if (mode === 'text' && !topic.trim()) { setError('請輸入主題或課文內容'); return; }
    if (mode === 'file' && !file) { setError('請上傳一份教材檔案'); return; }

    setLoading(true); setError(''); setResult(null);

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
        if (!res.ok) throw new Error((data as { error?: string }).error || '命題失敗');
      } else {
        setStep('讀取檔案…');
        const fd = new FormData();
        fd.append('file', file!);
        fd.append('types', JSON.stringify(types));
        fd.append('count', String(count));
        fd.append('difficulty', difficulty);
        setStep('AI 分析內容中…');
        const res = await fetch('/api/ai/generate-from-file', { method: 'POST', credentials: 'include', body: fd });
        data = await res.json();
        if (!res.ok) throw new Error((data as { error?: string }).error || '命題失敗');
      }

      setResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '命題失敗，請重試');
    } finally {
      setLoading(false); setStep('');
    }
  }

  const ext = file?.name.split('.').pop()?.toLowerCase() ?? '';
  const canGenerate = types.length > 0 && (mode === 'text' ? topic.trim().length > 0 : !!file);

  // ─── Render ────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
      <div
        className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col"
        style={{ maxHeight: '92vh' }}
      >

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🤖</span>
            <div>
              <h2 className="text-base font-bold text-gray-900 leading-tight">AI 出題</h2>
              <p className="text-xs text-gray-400">自動生成試卷，省時省力</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 text-lg transition-colors"
          >×</button>
        </div>

        {/* ── Mode tabs ── */}
        <div className="px-5 pb-3 flex-shrink-0">
          <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
            <button
              onClick={() => { setMode('text'); setResult(null); setError(''); }}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                mode === 'text'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              ✍️ 輸入主題
            </button>
            <button
              onClick={() => { setMode('file'); setResult(null); setError(''); }}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                mode === 'file'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              📂 上傳講義
            </button>
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-4">

          {/* ── TEXT MODE ── */}
          {mode === 'text' && (
            <div>
              <label className="block text-xs font-bold text-amber-700 uppercase tracking-widest mb-2">
                主題或課文內容
              </label>
              <textarea
                value={topic}
                onChange={e => setTopic(e.target.value)}
                placeholder="輸入考試主題，例如：「台灣的地形與氣候」&#10;或直接貼上課文內容讓 AI 根據內容出題…"
                rows={5}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 placeholder-gray-300 resize-none focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
              />
            </div>
          )}

          {/* ── FILE MODE ── */}
          {mode === 'file' && (
            <div>
              <label className="block text-xs font-bold text-amber-700 uppercase tracking-widest mb-2">
                上傳教材檔案
              </label>
              {!file ? (
                <div
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
                  className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                    dragOver
                      ? 'border-amber-400 bg-amber-50'
                      : 'border-gray-200 hover:border-amber-300 hover:bg-amber-50/50'
                  }`}
                >
                  <input
                    ref={fileRef} type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.gif"
                    className="hidden"
                    onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
                  />
                  <div className="text-4xl mb-2">📂</div>
                  <p className="text-sm font-semibold text-gray-700 mb-1">點擊或拖曳上傳</p>
                  <p className="text-xs text-gray-400">PDF（1MB 以下）· JPG · PNG</p>
                </div>
              ) : (
                <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                  <span className="text-2xl">{FILE_EMOJIS[ext] ?? '📄'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{file.name}</p>
                    <p className="text-xs text-gray-500 font-mono">{fmtSize(file.size)}</p>
                  </div>
                  <button
                    onClick={() => { setFile(null); setResult(null); }}
                    className="text-gray-400 hover:text-red-500 text-xl w-6 h-6 flex items-center justify-center transition-colors"
                  >×</button>
                </div>
              )}
            </div>
          )}

          {/* ── Question types ── */}
          <div>
            <label className="block text-xs font-bold text-amber-700 uppercase tracking-widest mb-2">
              選擇題型（可複選）
            </label>
            <div className="grid grid-cols-2 gap-2">
              {QUESTION_TYPES.map(t => {
                const checked = types.includes(t.value);
                return (
                  <button
                    key={t.value}
                    onClick={() => toggleType(t.value)}
                    className={`flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all ${
                      checked
                        ? 'border-amber-400 bg-amber-50'
                        : 'border-gray-200 hover:border-amber-300'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center text-xs font-bold flex-shrink-0 transition-colors ${
                      checked ? 'bg-amber-500 border-amber-500 text-white' : 'border-gray-300'
                    }`}>
                      {checked && '✓'}
                    </div>
                    <span className="text-lg">{t.emoji}</span>
                    <div>
                      <p className="text-sm font-bold text-gray-800 leading-tight">{t.label}</p>
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
              <label className="block text-xs font-bold text-amber-700 uppercase tracking-widest mb-2">
                每種題型出幾題
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range" min={1} max={20} value={count}
                  onChange={e => setCount(Number(e.target.value))}
                  className="flex-1 accent-amber-500 h-1.5"
                />
                <span className="text-lg font-bold text-amber-600 w-6 text-center tabular-nums">
                  {count}
                </span>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-amber-700 uppercase tracking-widest mb-2">
                難度等級
              </label>
              <div className="flex gap-1">
                {DIFFICULTIES.map(d => (
                  <button
                    key={d.value}
                    onClick={() => setDifficulty(d.value)}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold border-2 transition-all ${
                      difficulty === d.value
                        ? 'bg-gray-900 text-white border-gray-900'
                        : 'border-gray-200 text-gray-600 hover:border-gray-400'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Error ── */}
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              {error}
            </div>
          )}

          {/* ── Result preview ── */}
          {result && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <p className="text-sm font-bold text-green-800 mb-1">✅ 命題完成！</p>
              <p className="text-xs text-green-700 mb-0.5">📋 {result.title}</p>
              <p className="text-xs text-green-600">共 {result.questions.length} 題，確認後匯入編輯器</p>
            </div>
          )}
        </div>

        {/* ── Footer CTA ── */}
        <div className="px-5 pb-5 pt-2 flex-shrink-0 border-t border-gray-100">
          {!result ? (
            <button
              onClick={generate}
              disabled={!canGenerate || loading}
              className="w-full py-4 rounded-2xl font-bold text-white text-base transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed"
              style={{
                background: (!canGenerate || loading)
                  ? '#d1d5db'
                  : 'linear-gradient(135deg, #f59e0b, #d97706)',
              }}
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  {step || 'AI 命題中…'}
                </>
              ) : (
                <><span>🤖</span> 開始 AI 命題</>
              )}
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => { setResult(null); }}
                className="flex-1 py-3 rounded-2xl border-2 border-gray-200 text-gray-600 font-bold text-sm hover:bg-gray-50 transition-colors"
              >
                重新命題
              </button>
              <button
                onClick={() => onImport(result.questions, result.title)}
                className="flex-[2] py-3 rounded-2xl font-bold text-white text-sm transition-all"
                style={{ background: 'linear-gradient(135deg, #1f2937, #374151)' }}
              >
                ✓ 匯入 {result.questions.length} 題
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
