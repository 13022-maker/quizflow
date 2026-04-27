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
type QuestionType = 'mc' | 'tf' | 'fill' | 'short' | 'rank' | 'listening';
type Difficulty = 'easy' | 'medium' | 'hard';
type Mode = 'text' | 'file' | 'url';

type GeneratedQuestion = {
  type: QuestionType;
  question: string;
  options?: string[];
  answer: string | string[];
  explanation?: string;
  listeningText?: string; // 聽力題要念的口語化文字
  audioUrl?: string; // 聽力題 TTS 生成的音檔 URL
};

type GeneratedResult = {
  title: string;
  questions: GeneratedQuestion[];
};

type Props = {
  quizId?: string;
  defaultTopic?: string;
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
  { value: 'listening' as QuestionType, emoji: '🎧', label: '聽力題', sub: 'AI 語音 + 選擇' },
];

const DIFFICULTIES: { value: Difficulty; label: string }[] = [
  { value: 'easy', label: '入門' },
  { value: 'medium', label: '普通' },
  { value: 'hard', label: '進階' },
];

// 常見情境範本：一鍵填入主題 + 題型設定，破解使用者面對空白畫布的遲疑
type Template = {
  emoji: string;
  label: string;
  topic: string;
  types: QuestionType[];
  count: number;
  difficulty: Difficulty;
};

const TEMPLATES: Template[] = [
  { emoji: '📐', label: '國中數學', topic: '國中數學 — 一元一次方程式的解法與應用', types: ['mc', 'fill'], count: 10, difficulty: 'medium' },
  { emoji: '🌏', label: '社會地理', topic: '國中社會 — 台灣的地形與氣候特色', types: ['mc', 'tf'], count: 10, difficulty: 'medium' },
  { emoji: '📖', label: '國文閱讀', topic: '高中國文 — 古文閱讀測驗（出處、字義、文意理解）', types: ['mc', 'short'], count: 8, difficulty: 'medium' },
  { emoji: '🧪', label: '自然科學', topic: '國中自然 — 光合作用的過程與影響因素', types: ['mc', 'fill'], count: 10, difficulty: 'easy' },
  { emoji: '🇬🇧', label: '英文文法', topic: '高中英文 — 現在完成式與過去式的比較與應用', types: ['mc', 'fill'], count: 12, difficulty: 'medium' },
  { emoji: '📜', label: '歷史', topic: '國中歷史 — 清領時期的台灣社會與經濟發展', types: ['mc', 'tf'], count: 10, difficulty: 'medium' },
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
export default function AIQuizModal({ defaultTopic, onImport, onClose }: Props) {
  // Mode
  const [mode, setMode] = useState<Mode>('text');

  // Shared settings
  const [types, setTypes] = useState<QuestionType[]>(['mc']);
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');

  const hasListening = types.includes('listening');
  const maxCount = hasListening ? 5 : 20;
  const effectiveCount = Math.min(count, maxCount);

  // Text mode
  const [topic, setTopic] = useState(defaultTopic ?? '');

  // 命題框架（108 課綱 / PISA / 會考 / Bloom / CEFR）：空字串 = 不指定（預設行為，prompt 不變）
  const [framework, setFramework] = useState<string>('');

  // URL mode（YouTube / Google Docs）
  const [sourceUrl, setSourceUrl] = useState('');

  // File mode
  // 支援多檔上傳（多張照片）；PDF / 音檔仍維持單檔（覆寫）
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // PDF 頁數範圍
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [startPage, setStartPage] = useState(1);
  const [endPage, setEndPage] = useState(1);
  const [pageLoading, setPageLoading] = useState(false);

  // AI 模型選擇（僅檔案模式會用到，預設 Gemini 省錢快速）
  const [model, setModel] = useState<'gemini' | 'claude'>('gemini');

  // 聽力題 TTS 參數
  const [ttsVoice, setTtsVoice] = useState('zh-tw-female');
  const [ttsSpeed, setTtsSpeed] = useState('normal');
  const [ttsGenerating, setTtsGenerating] = useState(false);
  const [ttsProgress, setTtsProgress] = useState('');

  // State
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState('');
  const [upgradeRequired, setUpgradeRequired] = useState(false);
  const [result, setResult] = useState<GeneratedResult | null>(null);
  const stepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const STEP_MESSAGES = [
    'AI 分析主題中…',
    '理解內容重點…',
    '設計題目架構…',
    '生成選項與解析…',
    '檢查題目品質…',
    '即將完成，請稍候…',
  ];

  function startStepTimer() {
    let idx = 0;
    setStep(STEP_MESSAGES[0]!);
    stepTimerRef.current = setInterval(() => {
      idx++;
      if (idx < STEP_MESSAGES.length) {
        setStep(STEP_MESSAGES[idx]!);
      }
    }, 4000);
  }

  function stopStepTimer() {
    if (stepTimerRef.current) {
      clearInterval(stepTimerRef.current);
      stepTimerRef.current = null;
    }
    setStep('');
  }

  // ── Helpers ──
  function applyTemplate(tpl: Template) {
    setTopic(tpl.topic);
    setTypes(tpl.types);
    setCount(tpl.count);
    setDifficulty(tpl.difficulty);
    setError('');
    setResult(null);
  }

  function toggleType(t: QuestionType) {
    setTypes((prev) => {
      if (prev.includes(t)) {
        return prev.filter(x => x !== t);
      }
      // 聽力題與其他題型互斥：選聽力就清其他，選其他就清聽力
      if (t === 'listening') {
        return ['listening'];
      }
      return [...prev.filter(x => x !== 'listening'), t];
    });
  }

  // Vercel Serverless request body 上限約 4.5MB
  const MAX_UPLOAD_SIZE = 4.5 * 1024 * 1024;

  const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

  function isImageFile(f: File) {
    const e = f.name.split('.').pop()?.toLowerCase() ?? '';
    return IMAGE_EXTS.includes(e);
  }

  // 將新選取 / 拖入的檔案加入 state
  // - 若挑到 PDF 或音檔：以「單檔模式」覆寫整個清單（PDF 需選頁數、音檔單獨處理）
  // - 若全是圖片：累加到現有清單，支援多張照片一起出題
  async function handleFiles(incoming: File[]) {
    setResult(null);
    setError('');

    if (incoming.length === 0) {
      return;
    }

    const nonImage = incoming.find(f => !isImageFile(f));

    if (nonImage) {
      // 單檔模式：PDF / 音檔
      setPdfPageCount(null);
      setFiles([nonImage]);

      if (nonImage.size > MAX_UPLOAD_SIZE) {
        const sizeMB = (nonImage.size / 1024 / 1024).toFixed(1);
        setError(`檔案較大（${sizeMB}MB），請選擇較少頁數，系統會自動裁切後上傳`);
      }

      const isPdf = nonImage.name.split('.').pop()?.toLowerCase() === 'pdf';
      if (!isPdf) {
        return;
      }

      setPageLoading(true);
      try {
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        const arrayBuffer = await nonImage.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
        const total = pdf.numPages;
        setPdfPageCount(total);
        setStartPage(1);
        setEndPage(Math.min(10, total));
      } catch {
        setPdfPageCount(null);
      } finally {
        setPageLoading(false);
      }
      return;
    }

    // 全為圖片：累加到現有圖片清單（若目前已有 PDF/音檔則改為覆寫為新圖片清單）
    setPdfPageCount(null);
    setFiles((prev) => {
      const prevAllImages = prev.every(isImageFile);
      const merged = prevAllImages ? [...prev, ...incoming] : [...incoming];

      const total = merged.reduce((sum, f) => sum + f.size, 0);
      if (total > MAX_UPLOAD_SIZE) {
        const sizeMB = (total / 1024 / 1024).toFixed(1);
        setError(`檔案較大（共 ${sizeMB}MB），可能超過上傳上限，請減少張數或壓縮圖片`);
      }
      return merged;
    });
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
    if (mode === 'file' && files.length === 0) {
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
    startStepTimer();

    try {
      let data: GeneratedResult;

      if (mode === 'text') {
        const res = await fetch('/api/ai/generate-questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            topic,
            types,
            count: effectiveCount,
            difficulty,
            // 命題框架選填：空字串時不送（server 端會視為未指定）
            framework: framework || undefined,
          }),
        });
        if (!res.ok) {
          let errMsg = '命題失敗';
          try {
            const errData = await res.json();
            if (errData.upgradeRequired) {
              setUpgradeRequired(true);
            }
            if (errData.error) {
              errMsg = errData.error;
            }
          } catch { /* 回應非 JSON */ }
          throw new Error(errMsg);
        }
        data = await res.json();
      } else if (mode === 'file') {
        setStep('讀取檔案…');
        const fd = new FormData();

        const firstFile = files[0]!;
        const firstExt = firstFile.name.split('.').pop()?.toLowerCase() ?? '';
        const isPdf = firstExt === 'pdf';
        const allImagesNow = files.every(isImageFile);

        if (isPdf && pdfPageCount !== null && firstFile.size > MAX_UPLOAD_SIZE) {
          // 大 PDF 前端先裁切，避免超過 Vercel 4.5MB 限制
          setStep('裁切 PDF 中…');
          const { PDFDocument } = await import('pdf-lib');
          const srcBytes = await firstFile.arrayBuffer();
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
          const trimmedFile = new File([trimmedBytes as BlobPart], firstFile.name, { type: 'application/pdf' });
          fd.append('file', trimmedFile);
        } else if (allImagesNow) {
          // 多張圖片：全部 append 到同一個 'file' 欄位，server 用 getAll('file') 取出
          for (const f of files) {
            fd.append('file', f);
          }
        } else {
          // PDF（不需裁切）或音檔：單檔上傳
          fd.append('file', firstFile);
          if (isPdf && pdfPageCount !== null) {
            fd.append('startPage', String(startPage));
            fd.append('endPage', String(endPage));
          }
        }

        fd.append('types', JSON.stringify(types));
        fd.append('count', String(effectiveCount));
        fd.append('difficulty', difficulty);
        fd.append('model', model);
        setStep('AI 分析內容中…');
        const res = await fetch('/api/ai/generate-from-file', { method: 'POST', credentials: 'include', body: fd });
        if (!res.ok) {
          let errMsg = '命題失敗';
          try {
            const errData = await res.json();
            if (errData.upgradeRequired) {
              setUpgradeRequired(true);
            }
            if (errData.error) {
              errMsg = errData.error;
            }
          } catch { /* 回應非 JSON */ }
          throw new Error(errMsg);
        }
        data = await res.json();
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
            count: effectiveCount,
            difficulty,
            model,
          }),
        });
        if (!res.ok) {
          let errMsg = '命題失敗';
          try {
            const errData = await res.json();
            if (errData.upgradeRequired) {
              setUpgradeRequired(true);
            }
            if (errData.error) {
              errMsg = errData.error;
            }
          } catch { /* 回應非 JSON */ }
          throw new Error(errMsg);
        }
        data = await res.json();
      }

      // 聽力題自動呼叫 TTS 生成音檔
      const listeningQs = data.questions?.filter((q: GeneratedQuestion) => q.type === 'listening') ?? [];
      if (listeningQs.length > 0) {
        setTtsGenerating(true);
        let done = 0;
        setTtsProgress(`音檔生成中 (0/${listeningQs.length})...`);
        await Promise.all(
          listeningQs.map(async (q: GeneratedQuestion) => {
            const ttsText = q.listeningText || q.question;
            if (!ttsText) {
              done++;
              return;
            }
            try {
              const res = await fetch('/api/ai/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: ttsText, voice: ttsVoice, speed: ttsSpeed }),
              });
              if (res.ok) {
                const ttsData = await res.json();
                q.audioUrl = ttsData.url;
                if (!q.listeningText) {
                  q.listeningText = ttsText;
                }
              }
            } catch {
              // TTS 失敗不阻擋匯入，老師可事後手動上傳音檔
            }
            done++;
            setTtsProgress(`音檔生成中 (${done}/${listeningQs.length})...`);
          }),
        );
        setTtsGenerating(false);
        setTtsProgress('');
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
      stopStepTimer();
      setLoading(false);
    }
  }

  const totalFileSize = files.reduce((sum, f) => sum + f.size, 0);
  const allImages = files.length > 0 && files.every(isImageFile);
  const canGenerate = types.length > 0
    && (mode === 'text'
      ? topic.trim().length > 0
      : mode === 'file'
        ? files.length > 0
        : sourceUrl.trim().length > 0);

  // 按鈕 disabled 時告訴使用者還缺什麼，避免誤以為是 bug

  const disabledReason = !types.length
    ? '請至少選擇一種題型'
    : mode === 'text' && !topic.trim()
      ? '請輸入主題，或點上方範例快速開始'
      : mode === 'file' && files.length === 0
        ? '請上傳一份教材檔案'
        : mode === 'url' && !sourceUrl.trim()
          ? '請貼入 YouTube 或 Google Docs 連結'
          : '';

  // ─── Render ────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        className="flex w-full flex-col rounded-t-3xl bg-white shadow-2xl sm:max-w-lg sm:rounded-2xl"
        style={{ maxHeight: '92vh' }}
      >

        {/* ── Header ── */}
        <div className="flex shrink-0 items-center justify-between px-5 pb-3 pt-5">
          <div className="flex items-center gap-2.5">
            <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-xl shadow-md shadow-amber-200/60">
              🤖
            </div>
            <div>
              <h2 className="text-base font-bold leading-tight">
                <span className="bg-gradient-to-r from-amber-600 to-amber-800 bg-clip-text text-transparent">AI 出題</span>
              </h2>
              <p className="text-xs text-gray-500">自動生成試卷，省時省力</p>
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
            <div className="space-y-3">
              {/* 快速範本：一鍵填入主題 + 題型，破解空白畫布焦慮 */}
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-widest text-amber-700">
                  ✨ 快速範例（點選即可套用）
                </p>
                {/* 改 flex-wrap：手機自動換行，避免最後一個 chip 被橫向截斷 */}
                <div className="flex flex-wrap gap-2">
                  {/* 命題框架（108 課綱 / PISA / 會考 / Bloom / CEFR）：選後 server 端 prompt prepend 對應指令；非空時 chip 加深底色 */}
                  <select
                    value={framework}
                    onChange={e => setFramework(e.target.value)}
                    className={`flex shrink-0 cursor-pointer items-center rounded-full border px-3 py-1.5 text-xs font-semibold transition-all hover:-translate-y-0.5 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-300 ${
                      framework
                        ? 'border-amber-500 bg-amber-200 text-amber-900'
                        : 'border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-400 hover:bg-amber-100'
                    }`}
                    title="命題框架（選填）：套用 108 課綱、PISA、會考、Bloom 認知層次、CEFR 英文分級等出題風格"
                  >
                    <option value="">📚 命題框架</option>
                    <optgroup label="108 課綱素養 — 國中">
                      <option value="108-jhs-math">國中數學（素養）</option>
                      <option value="108-jhs-chinese">國中國文（素養）</option>
                      <option value="108-jhs-social">國中社會（素養）</option>
                      <option value="108-jhs-science">國中自然（素養）</option>
                      <option value="108-jhs-english">國中英文（素養）</option>
                      <option value="108-jhs-history">國中歷史（素養）</option>
                    </optgroup>
                    <optgroup label="108 課綱素養 — 高中">
                      <option value="108-shs-math">高中數學（素養）</option>
                      <option value="108-shs-chinese">高中國文（素養）</option>
                      <option value="108-shs-english">高中英文（素養）</option>
                      <option value="108-shs-history">高中歷史（素養）</option>
                      <option value="108-shs-geography">高中地理（素養）</option>
                      <option value="108-shs-science">高中自然（素養）</option>
                    </optgroup>
                    <optgroup label="PISA 國際素養">
                      <option value="pisa">PISA 風格（情境化、跨領域）</option>
                    </optgroup>
                    <optgroup label="國中教育會考">
                      <option value="jhs-exam">會考風格（五選一、難度均勻）</option>
                    </optgroup>
                    <optgroup label="Bloom 認知層次">
                      <option value="bloom-remember">記憶 Remember（事實回憶）</option>
                      <option value="bloom-understand">理解 Understand（概念解釋）</option>
                      <option value="bloom-apply">應用 Apply（情境運用）</option>
                      <option value="bloom-analyze">分析 Analyze（拆解結構）</option>
                      <option value="bloom-evaluate">評鑑 Evaluate（判斷批判）</option>
                      <option value="bloom-create">創造 Create（產出新方案）</option>
                    </optgroup>
                    <optgroup label="CEFR 英文分級">
                      <option value="cefr-a1">A1 入門</option>
                      <option value="cefr-a2">A2 基礎</option>
                      <option value="cefr-b1">B1 中級</option>
                      <option value="cefr-b2">B2 中高級</option>
                    </optgroup>
                    <optgroup label="TOCFL 華語文（國家華語測驗推動工作委員會）">
                      <option value="tocfl-a1">A1 萌芽級（約 480 詞）</option>
                      <option value="tocfl-a2">A2 基礎級（約 1,000 詞）</option>
                      <option value="tocfl-b1">B1 進階級（約 2,600 詞）</option>
                      <option value="tocfl-b2">B2 高階級（約 4,000 詞）</option>
                      <option value="tocfl-c1">C1 流利級（約 6,000 詞）</option>
                      <option value="tocfl-c2">C2 精通級（約 8,000 詞）</option>
                      <option value="tocfl-8000">📚 TOCFL 8,000 詞表（全集詞彙運用題）</option>
                    </optgroup>
                  </select>

                  {TEMPLATES.map(tpl => (
                    <button
                      key={tpl.label}
                      type="button"
                      onClick={() => applyTemplate(tpl)}
                      className="flex shrink-0 items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 transition-all hover:-translate-y-0.5 hover:border-amber-400 hover:bg-amber-100 hover:shadow-sm"
                    >
                      <span className="text-sm">{tpl.emoji}</span>
                      {tpl.label}
                    </button>
                  ))}
                </div>
              </div>
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
            </div>
          )}

          {/* ── FILE MODE ── */}
          {mode === 'file' && (
            <div>
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-amber-700">
                上傳教材檔案
              </label>
              {/* 隱藏的 file input：可多選圖片，PDF / 音檔則為單檔 */}
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.mp3,.wav,.m4a,.ogg,.aac,.flac"
                className="hidden"
                onChange={(e) => {
                  const list = Array.from(e.target.files ?? []);
                  if (list.length > 0) {
                    handleFiles(list);
                  }
                  // reset 讓重複選同一張也能觸發
                  e.target.value = '';
                }}
              />
              {/* eslint-disable-next-line style/multiline-ternary */}
              {files.length === 0 ? (
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
                    const list = Array.from(e.dataTransfer.files);
                    if (list.length > 0) {
                      handleFiles(list);
                    }
                  }}
                  className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-all ${
                    dragOver
                      ? 'border-amber-400 bg-amber-50'
                      : 'border-gray-200 hover:border-amber-300 hover:bg-amber-50/50'
                  }`}
                >
                  <div className="mb-2 text-4xl">📂</div>
                  <p className="mb-1 text-sm font-semibold text-gray-700">點擊或拖曳上傳（圖片可多選）</p>
                  <p className="text-xs text-gray-400">PDF · JPG · PNG · 音檔</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* 檔案清單 */}
                  <div className="space-y-2">
                    {files.map((f, idx) => {
                      const fExt = f.name.split('.').pop()?.toLowerCase() ?? '';
                      return (
                        <div
                          key={`${f.name}-${f.size}-${idx}`}
                          className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3"
                        >
                          <span className="text-2xl">{FILE_EMOJIS[fExt] ?? '📄'}</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-gray-800">{f.name}</p>
                            <p className="font-mono text-xs text-gray-500">{fmtSize(f.size)}</p>
                          </div>
                          <button
                            onClick={() => {
                              setFiles(prev => prev.filter((_, i) => i !== idx));
                              setResult(null);
                              if (fExt === 'pdf') {
                                setPdfPageCount(null);
                              }
                            }}
                            className="flex size-6 items-center justify-center text-xl text-gray-400 transition-colors hover:text-red-500"
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {/* 多張圖片時顯示總大小 + 加圖按鈕 */}
                  {allImages && (
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>
                        共
                        {' '}
                        {files.length}
                        {' '}
                        張，總計
                        {' '}
                        {fmtSize(totalFileSize)}
                      </span>
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        className="rounded-full border border-amber-300 bg-white px-3 py-1 font-semibold text-amber-700 transition-colors hover:bg-amber-50"
                      >
                        + 再加幾張
                      </button>
                    </div>
                  )}

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
                          type="text"
                          inputMode="numeric"
                          value={startPage}
                          onChange={e => setStartPage(Number(e.target.value) || 1)}
                          onBlur={() => {
                            const v = Math.max(1, Math.min(startPage, pdfPageCount));
                            setStartPage(v);
                            if (endPage < v) {
                              setEndPage(v);
                            }
                          }}
                          className="w-16 rounded-lg border border-gray-300 px-2 py-1.5 text-center text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                        <span className="shrink-0 text-gray-600">頁到第</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={endPage}
                          onChange={e => setEndPage(Number(e.target.value) || 1)}
                          onBlur={() => {
                            const v = Math.max(startPage, Math.min(endPage, pdfPageCount));
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

          {/* ── 聽力題 TTS 參數（選了聽力題時顯示） ── */}
          {types.includes('listening') && (
            <div className="space-y-3">
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-amber-700">
                聽力語音設定
              </label>
              <div className="grid grid-cols-2 gap-2">
                {/* 語音 */}
                <div>
                  <p className="mb-1 text-xs text-gray-500">語音</p>
                  <select
                    value={ttsVoice}
                    onChange={e => setTtsVoice(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
                  >
                    <optgroup label="中文（台灣）">
                      <option value="zh-tw-female">女聲（溫柔自然）</option>
                      <option value="zh-tw-male">男聲（沉穩清晰）</option>
                    </optgroup>
                    <optgroup label="中文（大陸）">
                      <option value="zh-cn-female">女聲</option>
                      <option value="zh-cn-male">男聲</option>
                    </optgroup>
                    <optgroup label="English">
                      <option value="en-female">Female</option>
                      <option value="en-male">Male</option>
                    </optgroup>
                    <optgroup label="客語">
                      <option value="hak">客語（四縣腔）</option>
                    </optgroup>
                  </select>
                </div>
                {/* 語速 */}
                <div>
                  <p className="mb-1 text-xs text-gray-500">語速</p>
                  <select
                    value={ttsSpeed}
                    onChange={e => setTtsSpeed(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
                  >
                    <option value="normal">正常語速</option>
                    <option value="slow">慢速（適合初學者）</option>
                  </select>
                </div>
              </div>
              {/* TOCFL 分級提示 */}
              <p className="text-xs text-gray-400">
                💡 搭配上方難度設定：簡單≈TOCFL A1-A2，中等≈B1-B2，困難≈C1
              </p>
            </div>
          )}

          {/* ── AI 模型選擇（檔案模式 + 連結模式顯示） ── */}
          {((mode === 'file' && files.length > 0) || (mode === 'url' && sourceUrl.trim())) && (
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
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {QUESTION_TYPES.map((t) => {
                const checked = types.includes(t.value);
                // 聽力題選中時，其他題型按鈕 disabled；其他題型選中時，聽力題按鈕 disabled
                const isListeningSelected = types.includes('listening');
                const hasNonListening = types.some(x => x !== 'listening');
                const disabled = (t.value === 'listening' && hasNonListening)
                  || (t.value !== 'listening' && isListeningSelected);
                return (
                  <button
                    key={t.value}
                    onClick={() => toggleType(t.value)}
                    disabled={disabled}
                    className={`flex items-center gap-2 rounded-2xl border-2 p-2.5 text-left transition-all sm:gap-3 sm:p-3 ${
                      checked
                        ? 'border-amber-400 bg-amber-50 shadow-sm shadow-amber-100'
                        : disabled
                          ? 'cursor-not-allowed border-gray-200 bg-gray-50 opacity-40'
                          : 'border-gray-200 hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-md'
                    }`}
                  >
                    <div className={`flex size-5 shrink-0 items-center justify-center rounded-md border-2 text-xs font-bold transition-colors ${
                      checked ? 'border-amber-500 bg-amber-500 text-white' : 'border-gray-300'
                    }`}
                    >
                      {checked && '✓'}
                    </div>
                    <span className="shrink-0 text-lg">{t.emoji}</span>
                    {/* min-w-0 + break-keep 防止 Chinese label 被切成單字一行 */}
                    <div className="min-w-0 flex-1">
                      <p className="break-keep text-sm font-bold leading-tight text-gray-800">{t.label}</p>
                      <p className="break-keep text-xs text-gray-400">{t.sub}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Count + Difficulty ── */}
          {/* 手機 < 640px 上下堆疊，避免 slider 數字徽章與右欄按鈕擠壓重疊 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-amber-700">
                每種題型出幾題
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={maxCount}
                  value={effectiveCount}
                  onChange={e => setCount(Number(e.target.value))}
                  className="h-2 flex-1 accent-amber-500"
                />
                <span className="inline-flex min-w-[2.5rem] items-center justify-center rounded-lg bg-amber-50 px-2 py-1 text-base font-bold tabular-nums text-amber-600">
                  {effectiveCount}
                </span>
              </div>
              {hasListening && (
                <p className="mt-1 text-xs text-amber-600">聽力題上限 5 題</p>
              )}
            </div>
            <div>
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-amber-700">
                難度等級
              </label>
              <div className="flex gap-1.5">
                {DIFFICULTIES.map(d => (
                  <button
                    key={d.value}
                    onClick={() => setDifficulty(d.value)}
                    className={`flex-1 rounded-lg border-2 py-2 text-xs font-bold transition-all ${
                      difficulty === d.value
                        ? 'border-gray-900 bg-gray-900 text-white shadow-sm'
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
          {!result && disabledReason && !loading && (
            <p className="mb-2 text-center text-xs text-gray-500">
              ⬆️
              {' '}
              {disabledReason}
            </p>
          )}
          {!result
            ? (
                <button
                  onClick={generate}
                  disabled={!canGenerate || loading || ttsGenerating}
                  className={`flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold text-white transition-all disabled:cursor-not-allowed ${
                    (!canGenerate || loading)
                      ? 'bg-gray-300'
                      : 'animate-gradient-shift bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 bg-[length:200%_auto] shadow-lg shadow-amber-500/30 hover:shadow-xl hover:shadow-amber-500/40'
                  }`}
                >
                  {loading
                    ? (
                        <>
                          <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                          {ttsProgress || step || 'AI 命題中…'}
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
                    className="flex-[2] rounded-2xl bg-gradient-to-br from-gray-800 to-gray-900 py-3 text-sm font-bold text-white shadow-md transition-all hover:shadow-lg"
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
