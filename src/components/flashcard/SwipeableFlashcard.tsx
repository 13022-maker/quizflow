'use client';

import { AlertCircle, RotateCcw, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ---------- 型別定義 ----------
export type FlashcardLang = 'zh' | 'en' | 'hak';
export type RatingAction = 'again' | 'good' | 'easy';

// 單語內容：單字、發音、分類標籤、是否有 TTS、發音標記類型（如白話字）
export type FlashcardLangContent = {
  word: string;
  pron: string;
  pill: string;
  tts: boolean;
  pronClass?: 'poj';
};

// 完整單字卡資料：三語（國語／英語／客語）+ 意思 + 例句 + 跨語對照
export type FlashcardData = {
  id: string;
  zh: FlashcardLangContent;
  en: FlashcardLangContent;
  hak: FlashcardLangContent;
  meaning: string;
  example: string;
  cross: { en: string; hak: string };
};

type SwipeableFlashcardProps = {
  cards: FlashcardData[];
  initialLang?: FlashcardLang;
  // 要顯示的語言 tab；預設 zh + en（客語暫時隱藏，等之後跟閩南語一起做）
  langs?: FlashcardLang[];
  onRate?: (cardId: string, action: RatingAction) => void;
  onComplete?: (stats: { known: number; again: number }) => void;
  onPlayAudio?: (text: string, lang: FlashcardLang) => void;
  trial?: boolean;
  title?: string;
};

// 滑動判定門檻（位移 px / 速度 px-per-ms）
const SWIPE_THRESHOLD = 90;
const VELOCITY_THRESHOLD = 0.5;

// 預設要顯示的語言 tab；客語暫時隱藏，等之後跟閩南語一起做
const DEFAULT_LANGS: FlashcardLang[] = ['zh', 'en'];

// ---------- 主元件 ----------
export function SwipeableFlashcard({
  cards,
  initialLang = 'zh',
  langs = DEFAULT_LANGS,
  onRate,
  onComplete,
  onPlayAudio,
  trial = false,
  title = '單字卡',
}: SwipeableFlashcardProps) {
  // initialLang 如果不在 langs 內，fallback 到 langs[0]
  const [lang, setLang] = useState<FlashcardLang>(
    langs.includes(initialLang) ? initialLang : (langs[0] ?? 'zh'),
  );
  const [idx, setIdx] = useState(0);
  const [known, setKnown] = useState(0);
  const [again, setAgain] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [drag, setDrag] = useState({ x: 0, y: 0, snapping: false, flying: false });
  const [history, setHistory] = useState<Array<{
    idx: number;
    action: RatingAction;
    known: number;
    again: number;
  }>>([]);
  const [mode, setMode] = useState<'swipe' | 'button'>('swipe');

  const startRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const movedRef = useRef(false);
  const total = cards.length;
  const done = idx >= total;

  const current = cards[idx];
  const next1 = cards[idx + 1];
  const next2 = cards[idx + 2];

  // 換卡時重置拖曳與翻牌狀態
  useEffect(() => {
    setDrag({ x: 0, y: 0, snapping: false, flying: false });
    setFlipped(false);
  }, [idx]);

  // 全部複習完通知外部
  useEffect(() => {
    if (done && total > 0) {
      onComplete?.({ known, again });
    }
  }, [done, known, again, total, onComplete]);

  // ---------- 依拖曳方向判定動作 ----------
  const computeAction = (dx: number, dy: number, vx: number, vy: number): RatingAction | null => {
    if (dy < -SWIPE_THRESHOLD || (dy < -40 && vy > VELOCITY_THRESHOLD && Math.abs(dy) > Math.abs(dx))) {
      return 'easy';
    }
    if (dx < -SWIPE_THRESHOLD || (dx < -40 && vx > VELOCITY_THRESHOLD)) {
      return 'again';
    }
    if (dx > SWIPE_THRESHOLD || (dx > 40 && vx > VELOCITY_THRESHOLD)) {
      return 'good';
    }
    return null;
  };

  const applyAction = useCallback((action: RatingAction) => {
    if (!current) {
      return;
    }
    setHistory(h => [...h, { idx, action, known, again }]);
    if (action === 'again') {
      setAgain(a => a + 1);
    } else {
      setKnown(k => k + 1);
    }
    onRate?.(current.id, action);

    // 飛出動畫之後切下一張
    let endX = 0;
    let endY = 0;
    if (action === 'again') {
      endX = -500;
      endY = 80;
    } else if (action === 'good') {
      endX = 500;
      endY = 80;
    } else if (action === 'easy') {
      endX = 0;
      endY = -700;
    }

    setDrag({ x: endX, y: endY, snapping: false, flying: true });
    setTimeout(() => setIdx(i => i + 1), 380);
  }, [current, idx, known, again, onRate]);

  // ---------- 指標事件 ----------
  const onPointerDown = (clientX: number, clientY: number) => {
    if (mode !== 'swipe' || done) {
      return;
    }
    startRef.current = { x: clientX, y: clientY, t: Date.now() };
    movedRef.current = false;
    setDrag(d => ({ ...d, snapping: false }));
  };

  const onPointerMove = (clientX: number, clientY: number) => {
    if (!startRef.current) {
      return;
    }
    const dx = clientX - startRef.current.x;
    const dy = clientY - startRef.current.y;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
      movedRef.current = true;
    }
    setDrag({ x: dx, y: dy, snapping: false, flying: false });
  };

  const onPointerUp = () => {
    if (!startRef.current) {
      return;
    }
    const { t } = startRef.current;
    const dx = drag.x;
    const dy = drag.y;
    startRef.current = null;

    // 沒位移視為點擊 → 翻牌
    if (!movedRef.current) {
      setFlipped(f => !f);
      setDrag({ x: 0, y: 0, snapping: false, flying: false });
      return;
    }

    const elapsed = Math.max(Date.now() - t, 1);
    const vx = Math.abs(dx) / elapsed;
    const vy = Math.abs(dy) / elapsed;
    const action = computeAction(dx, dy, vx, vy);

    if (action) {
      applyAction(action);
    } else {
      // 滑回原位
      setDrag({ x: 0, y: 0, snapping: true, flying: false });
      setTimeout(() => setDrag(d => ({ ...d, snapping: false })), 350);
    }
  };

  // 全域滑鼠監聽，桌機可拖出卡片範圍
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (startRef.current) {
        onPointerMove(e.clientX, e.clientY);
      }
    };
    const handleUp = () => {
      if (startRef.current) {
        onPointerUp();
      }
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag.x, drag.y]);

  // ---------- Undo ----------
  const undo = () => {
    const last = history[history.length - 1];
    if (!last) {
      return;
    }
    setHistory(h => h.slice(0, -1));
    setIdx(last.idx);
    setKnown(last.known);
    setAgain(last.again);
  };

  // ---------- 印章透明度（依拖曳量計算） ----------
  const { stampLeft, stampRight, stampUp } = useMemo(() => {
    const ax = Math.abs(drag.x);
    let l = 0;
    let r = 0;
    let u = 0;
    if (drag.y < -40 && Math.abs(drag.y) > ax) {
      u = Math.min(Math.abs(drag.y) / SWIPE_THRESHOLD, 1);
    } else if (drag.x < -20) {
      l = Math.min(ax / SWIPE_THRESHOLD, 1);
    } else if (drag.x > 20) {
      r = Math.min(ax / SWIPE_THRESHOLD, 1);
    }
    return { stampLeft: l, stampRight: r, stampUp: u };
  }, [drag.x, drag.y]);

  const rotation = drag.x / 18;
  const transform = drag.flying || drag.snapping || drag.x !== 0 || drag.y !== 0
    ? `translate(${drag.x}px, ${drag.y}px) rotate(${rotation}deg)`
    : '';

  const transitionClass = drag.flying
    ? 'transition-[transform,opacity] duration-[450ms] ease-[cubic-bezier(0.5,0,0.75,0)]'
    : drag.snapping
      ? 'transition-transform duration-[350ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]'
      : '';

  // ---------- Render ----------
  if (total === 0) {
    return <div className="py-12 text-center text-slate-400">沒有單字</div>;
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-6">
      {/* Header */}
      <div className="flex items-center justify-between py-3">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={undo}
            disabled={history.length === 0}
            className="flex size-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"
            aria-label="返回上一張"
          >
            <RotateCcw size={16} />
          </button>
          <div>
            <div className="font-serif text-[17px] font-bold text-slate-900">{title}</div>
            <div className="mt-0.5 text-[11px] text-slate-400">
              {mode === 'swipe' ? '滑動評估 · 點擊翻牌' : '點按鈕評估 · 點卡片翻牌'}
            </div>
          </div>
        </div>
        {trial && (
          <div className="rounded-full bg-slate-800 px-2 py-1 text-[10px] font-semibold tracking-wider text-slate-100">
            試用版
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-3.5 flex gap-1.5 rounded-2xl border border-slate-200 bg-white p-1">
        {langs.map((l) => {
          const labels = { zh: '國語', en: 'English', hak: '客語' };
          const hasTTS = current ? current[l].tts : true;
          return (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              className={`flex-1 rounded-xl py-2 text-[13px] font-semibold transition ${
                lang === l ? 'bg-slate-900 text-white' : 'text-slate-500'
              }`}
            >
              {labels[l]}
              <span
                className={`ml-1.5 inline-block size-1.5 rounded-full align-middle ${
                  hasTTS ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
            </button>
          );
        })}
      </div>

      {/* Progress */}
      <div className="mb-1.5 flex items-center justify-between text-[11px] tabular-nums text-slate-400">
        <span>
          {Math.min(idx + 1, total)}
          {' '}
          /
          {' '}
          {total}
        </span>
        <span>
          記住
          {known}
          {' '}
          · 待加強
          {again}
        </span>
      </div>
      <div className="mb-3.5 h-1 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-600 to-blue-400 transition-[width] duration-500"
          style={{ width: `${(idx / total) * 100}%` }}
        />
      </div>

      {/* TTS Notice */}
      {lang === 'hak' && (
        <div className="mb-2.5 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
          <AlertCircle size={13} />
          <span>客語語音製作中 · 請參考白話字拼音</span>
        </div>
      )}

      {/* Hint bar (swipe mode) */}
      {mode === 'swipe' && !done && (
        <div className="mb-3 grid grid-cols-3 gap-2 text-[11px] font-semibold text-slate-400">
          <div className="rounded-xl border border-slate-200 bg-white py-2 text-center">
            <div className="text-sm text-red-500">←</div>
            <div className="text-slate-600">重來</div>
            <div className="text-[9px] text-slate-400">1 分</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white py-2 text-center">
            <div className="text-sm text-blue-600">↑</div>
            <div className="text-slate-600">簡單</div>
            <div className="text-[9px] text-slate-400">4 天</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white py-2 text-center">
            <div className="text-sm text-emerald-600">→</div>
            <div className="text-slate-600">良好</div>
            <div className="text-[9px] text-slate-400">1 天</div>
          </div>
        </div>
      )}

      {/* Card stack */}
      <div className="relative mb-3.5 h-[400px]" style={{ perspective: '1200px' }}>
        {done && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-3xl border border-slate-200 bg-white p-8 text-center">
            <div className="text-5xl">🎉</div>
            <div className="font-serif text-[22px] font-bold text-slate-900">複習完成！</div>
            <div className="mt-2 flex gap-4 text-[13px] text-slate-500">
              <div>
                <b className="block text-lg text-slate-900">{known}</b>
                記住
              </div>
              <div>
                <b className="block text-lg text-slate-900">{again}</b>
                待加強
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setIdx(0);
                setKnown(0);
                setAgain(0);
                setHistory([]);
              }}
              className="mt-4 rounded-xl bg-slate-900 px-6 py-3 text-[13px] font-semibold text-white"
            >
              再來一輪
            </button>
          </div>
        )}
        {!done && (
          <>
            {/* Behind cards */}
            {next2 && (
              <CardFace
                card={next2}
                lang={lang}
                langs={langs}
                flipped={false}
                style={{
                  transform: 'scale(0.88) translateY(22px)',
                  opacity: 0.3,
                  zIndex: 1,
                }}
              />
            )}
            {next1 && (
              <CardFace
                card={next1}
                lang={lang}
                langs={langs}
                flipped={false}
                style={{
                  transform: 'scale(0.94) translateY(12px)',
                  opacity: 0.6,
                  zIndex: 2,
                }}
              />
            )}
            {/* Top card：拖曳手勢用 mouse/touch；鍵盤使用者改用「按鈕模式」 */}
            {current && (
              // eslint-disable-next-line jsx-a11y/no-static-element-interactions
              <div
                className={`absolute inset-0 ${transitionClass} ${drag.flying ? 'opacity-0' : ''}`}
                style={{
                  transform,
                  zIndex: 3,
                  cursor: startRef.current ? 'grabbing' : 'grab',
                  touchAction: 'none',
                }}
                onTouchStart={(e) => {
                  const t = e.touches[0];
                  if (t) {
                    onPointerDown(t.clientX, t.clientY);
                  }
                }}
                onTouchMove={(e) => {
                  const t = e.touches[0];
                  if (t) {
                    onPointerMove(t.clientX, t.clientY);
                  }
                  if (movedRef.current) {
                    e.preventDefault();
                  }
                }}
                onTouchEnd={onPointerUp}
                onMouseDown={e => onPointerDown(e.clientX, e.clientY)}
              >
                {/* Stamps */}
                <div
                  className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-2xl border-4 border-red-500 bg-red-50/85 px-7 py-4 text-2xl font-extrabold tracking-widest text-red-500"
                  style={{ opacity: stampLeft, transform: 'translate(-50%, -50%) rotate(-15deg)' }}
                >
                  重來
                </div>
                <div
                  className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-2xl border-4 border-emerald-500 bg-emerald-50/85 px-7 py-4 text-2xl font-extrabold tracking-widest text-emerald-500"
                  style={{ opacity: stampRight, transform: 'translate(-50%, -50%) rotate(15deg)' }}
                >
                  良好
                </div>
                <div
                  className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 rounded-2xl border-4 border-blue-600 bg-blue-50/85 px-7 py-4 text-2xl font-extrabold tracking-widest text-blue-600"
                  style={{ opacity: stampUp, transform: 'translate(-50%, -85%)' }}
                >
                  簡單
                </div>

                <CardFace
                  card={current}
                  lang={lang}
                  langs={langs}
                  flipped={flipped}
                  onPlayAudio={onPlayAudio}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Button mode controls */}
      {mode === 'button' && !done && (
        <div className="mb-3 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => applyAction('again')}
            className="rounded-xl border-[1.5px] border-red-200 bg-white py-3 text-[13px] font-bold text-red-500"
          >
            重來
          </button>
          <button
            type="button"
            onClick={() => applyAction('good')}
            className="rounded-xl border-[1.5px] border-emerald-200 bg-emerald-50 py-3 text-[13px] font-bold text-emerald-600"
          >
            良好
          </button>
          <button
            type="button"
            onClick={() => applyAction('easy')}
            className="rounded-xl border-[1.5px] border-blue-200 bg-white py-3 text-[13px] font-bold text-blue-600"
          >
            簡單
          </button>
        </div>
      )}

      {/* Mode toggle */}
      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => setMode(m => (m === 'swipe' ? 'button' : 'swipe'))}
          className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-500"
        >
          <span className="size-1.5 rounded-full bg-emerald-500" />
          {mode === 'swipe' ? '滑動模式' : '按鈕模式'}
        </button>
      </div>
    </div>
  );
}

// ---------- 卡片正反面元件 ----------
type CardFaceProps = {
  card: FlashcardData;
  lang: FlashcardLang;
  flipped: boolean;
  // 哪些語言需要顯示（控制背面「其他語言」對照行的顯示）
  langs?: FlashcardLang[];
  onPlayAudio?: (text: string, lang: FlashcardLang) => void;
  style?: React.CSSProperties;
};

function CardFace({ card, lang, flipped, langs = DEFAULT_LANGS, onPlayAudio, style }: CardFaceProps) {
  const content = card[lang];
  const wordSizeClass = lang === 'en' ? 'text-[44px] tracking-tight' : 'text-[56px] tracking-wider';
  const pronClass = content.pronClass === 'poj' ? 'italic tracking-wider' : 'tracking-[0.15em]';

  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-md"
      style={{ ...style }}
    >
      <div
        className="duration-[550ms] ease-[cubic-bezier(0.4,0.2,0.2,1)] relative size-full transition-transform [transform-style:preserve-3d]"
        style={{ transform: flipped ? 'rotateY(180deg)' : 'rotateY(0)' }}
      >
        {/* Front */}
        <div className="absolute inset-0 flex flex-col p-6 [backface-visibility:hidden]">
          <div className="self-start rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {content.pill}
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <div className={`font-serif font-bold leading-tight text-slate-900 ${wordSizeClass}`}>
              {content.word}
            </div>
            <div className={`text-[18px] font-medium text-slate-500 ${pronClass}`}>
              {content.pron}
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (content.tts) {
                  onPlayAudio?.(content.word, lang);
                }
              }}
              disabled={!content.tts}
              className={`mt-2 inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-[13px] font-semibold transition ${
                content.tts
                  ? 'bg-blue-50 text-blue-600 active:scale-95'
                  : 'cursor-not-allowed bg-amber-50 text-amber-700'
              }`}
            >
              <Volume2 size={14} />
              {content.tts ? '播放發音' : '音訊製作中'}
            </button>
          </div>
          <div className="border-t border-dashed border-slate-200 pt-2.5 text-center text-[11px] text-slate-400">
            點一下翻牌 · 看意思與例句
          </div>
        </div>

        {/* Back */}
        <div className="absolute inset-0 flex flex-col p-6 [backface-visibility:hidden] [transform:rotateY(180deg)]">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">意思</div>
          <div className="mb-3.5 font-serif text-[20px] font-medium leading-snug text-slate-900">
            {card.meaning}
          </div>
          {(langs.includes('en') || langs.includes('hak')) && (
            <>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">其他語言</div>
              <div className="mb-3 flex flex-col gap-2">
                {langs.includes('en') && (
                  <div className="flex items-baseline gap-2.5 text-[13px]">
                    <span className="min-w-[36px] text-[9px] font-bold uppercase tracking-wider text-slate-400">EN</span>
                    <span className="flex-1 text-slate-900">{card.cross.en}</span>
                  </div>
                )}
                {langs.includes('hak') && (
                  <div className="flex items-baseline gap-2.5 text-[13px]">
                    <span className="min-w-[36px] text-[9px] font-bold uppercase tracking-wider text-slate-400">客</span>
                    <span className="flex-1 text-slate-900">{card.cross.hak}</span>
                  </div>
                )}
              </div>
            </>
          )}
          <div className="mt-auto rounded-xl border-l-[3px] border-blue-600 bg-slate-50 p-3 text-[12px] leading-relaxed text-slate-600">
            <span className="mb-1 block text-[9px] font-bold uppercase tracking-widest text-slate-400">例句</span>
            {card.example}
          </div>
        </div>
      </div>
    </div>
  );
}
