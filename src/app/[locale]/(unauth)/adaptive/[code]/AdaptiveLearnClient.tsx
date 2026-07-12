'use client';

/**
 * 適性學習 — 學生作答介面（免登入）
 * 入口：輸入姓名＋學號（localStorage 記住，重整免重填；同學號自動續學）
 * 作答循環：GET next-step（ndjson 串流）→ 依 type 切換畫面 → 回報結果 → 再取 next-step
 *   - item      → 選項題（伺服器判對錯 → 標色＋解析 → 下一題）
 *   - lesson    → 補強課文（串流邊生成邊渲染）＋劃線提問＋「我讀完了」
 *   - completed → 完課畫面
 * 側欄顯示各知識點精熟度，每次狀態變更後刷新。
 */
import { marked } from 'marked';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { KnowledgeDiagnosis } from '@/libs/adaptive/engine';
import type { NextStep } from '@/libs/adaptive/tutor';

/** 劃線問答的一則對話（前端顯示用） */
type QaExchange = {
  highlightedText: string;
  question: string;
  answer: string;
};

type Identity = {
  studentKey: string;
  displayName: string;
};

/** 課文 Markdown 容器樣式（QuizFlow 沒裝 typography plugin，用 arbitrary variants 排版） */
const LESSON_BODY_CLASS
  = 'text-sm leading-6 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-bold '
  + '[&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-semibold '
  + '[&_p]:mb-2 [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 '
  + '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 '
  + '[&_code]:font-mono [&_code]:text-[0.85em] '
  + '[&_table]:my-2 [&_table]:border-collapse [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1 '
  + '[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground';

export function AdaptiveLearnClient({
  code,
  title,
  subjectName,
}: {
  code: string;
  title: string;
  subjectName: string;
}) {
  const storageKey = `adaptive-id-${code}`; // 每個練習記住各自的身分

  // 身分：null = 尚未加入（顯示入口表單）
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [joining, setJoining] = useState(false);
  const [storageChecked, setStorageChecked] = useState(false);

  const [step, setStep] = useState<NextStep | null>(null);
  const [diagnosis, setDiagnosis] = useState<KnowledgeDiagnosis[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState(''); // 課文串流生成中的即時內容
  const [error, setError] = useState<string | null>(null);

  // 作答狀態：提示次數與題目顯示時間（計算 responseTimeSec）
  const [hintsUsed, setHintsUsed] = useState(0);
  const itemShownAt = useRef<number>(Date.now());

  // 判題回饋：伺服器回傳的對錯與正解（null = 本題尚未作答）
  const [feedback, setFeedback] = useState<{
    selectedIndex: number;
    isCorrect: boolean;
    answerIndex: number;
    explanation?: string;
  } | null>(null);
  const [grading, setGrading] = useState(false); // 判題請求進行中（鎖住選項避免連點）

  // 劃線問答狀態
  const [exchanges, setExchanges] = useState<QaExchange[]>([]);
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);

  // 讀取上次的身分（重整免重填；仍會重新走註冊 API 續學）
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as Identity;
        setNameInput(parsed.displayName);
        setKeyInput(parsed.studentKey);
      }
    } catch {
      // localStorage 不可用（隱私模式等）時照常顯示空白表單
    }
    setStorageChecked(true);
  }, [storageKey]);

  /** 刷新側欄診斷 */
  const refreshDiagnosis = useCallback(async (studentKey: string) => {
    const res = await fetch(
      `/api/adaptive/${code}/diagnosis?student=${encodeURIComponent(studentKey)}`,
    );
    if (res.ok) {
      const data = (await res.json()) as { diagnosis: KnowledgeDiagnosis[] };
      setDiagnosis(data.diagnosis);
    }
  }, [code]);

  /**
   * 取得下一步學習活動（ndjson 串流）：
   * 卡關生成課文時 delta 事件逐段送達、邊收邊渲染；派題／完課直接收到 step。
   */
  const fetchNextStep = useCallback(async (studentKey: string) => {
    setLoading('正在準備下一步…');
    setStreamingText('');
    setError(null);
    try {
      const res = await fetch(
        `/api/adaptive/${code}/next-step?student=${encodeURIComponent(studentKey)}`,
      );
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      // 逐行解析 ndjson：緩衝不完整的行，收滿一行才 JSON.parse
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      const handleLine = (line: string) => {
        if (!line.trim()) {
          return;
        }
        const msg = JSON.parse(line) as
          | { type: 'delta'; text: string }
          | { type: 'step'; step: NextStep }
          | { type: 'error'; error: string };
        if (msg.type === 'delta') {
          accumulated += msg.text;
          setStreamingText(accumulated);
          setLoading(null); // 開始串流後改顯示即時課文，不再顯示 loading
        } else if (msg.type === 'step') {
          setStep(msg.step);
          // 重置每題／每篇課文的狀態
          setHintsUsed(0);
          setFeedback(null);
          itemShownAt.current = Date.now();
          if (msg.step.type === 'lesson') {
            setExchanges([]);
            setSelectedText(null);
            setQuestion('');
          }
        } else {
          throw new Error(msg.error);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // 最後一段可能是不完整的行，留到下一輪
        for (const line of lines) {
          handleLine(line);
        }
      }
      if (buffer.trim()) {
        handleLine(buffer); // 收尾：處理最後一行
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStreamingText(''); // 串流結束，改由完整的 step 呈現課文
      setLoading(null);
    }
  }, [code]);

  /** 加入練習：註冊（冪等，舊生續學）→ 存身分 → 開始作答 */
  async function join() {
    const displayName = nameInput.trim();
    const studentKey = keyInput.trim();
    if (!displayName || !studentKey || joining) {
      return;
    }
    setJoining(true);
    setError(null);
    try {
      const res = await fetch(`/api/adaptive/${code}/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ studentKey, displayName }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const id: Identity = { studentKey, displayName };
      try {
        localStorage.setItem(storageKey, JSON.stringify(id));
      } catch {
        // 存不進去就算了，只影響重整後要重填
      }
      setIdentity(id);
      await Promise.all([refreshDiagnosis(studentKey), fetchNextStep(studentKey)]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setJoining(false);
    }
  }

  /** 作答：送出所選選項 → 伺服器判對錯 → 顯示回饋（按「下一題」才前進） */
  async function submitAnswer(selectedIndex: number) {
    if (!identity || step?.type !== 'item' || grading || feedback) {
      return;
    }
    const responseTimeSec = Math.max(1, Math.round((Date.now() - itemShownAt.current) / 1000));
    setGrading(true);
    setError(null);
    try {
      const res = await fetch(`/api/adaptive/${code}/answers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          studentKey: identity.studentKey,
          itemId: step.dispatch.item.id,
          selectedIndex,
          hintsUsed,
          responseTimeSec,
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        isCorrect: boolean;
        answerIndex: number;
        explanation?: string;
      };
      setFeedback({
        selectedIndex,
        isCorrect: data.isCorrect,
        answerIndex: data.answerIndex,
        explanation: data.explanation,
      });
      void refreshDiagnosis(identity.studentKey); // 精熟度即時反映在側欄
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGrading(false);
    }
  }

  /** 下一題：清除回饋並取下一步（可能派新題，也可能觸發補強課文） */
  async function nextItem() {
    if (!identity) {
      return;
    }
    setFeedback(null);
    await fetchNextStep(identity.studentKey);
  }

  /** 課文區放開滑鼠：抓取選取文字作為劃線段落 */
  function handleLessonMouseUp() {
    const text = window.getSelection()?.toString().trim();
    if (text) {
      setSelectedText(text);
    }
  }

  /** 送出劃線提問（即時回答，可在同篇課文內追問） */
  async function askAnnotation() {
    if (!identity || !selectedText || !question.trim() || asking) {
      return;
    }
    setAsking(true);
    setError(null);
    try {
      const res = await fetch(`/api/adaptive/${code}/annotations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          studentKey: identity.studentKey,
          highlightedText: selectedText,
          question: question.trim(),
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { answer: string };
      setExchanges(prev => [
        ...prev,
        { highlightedText: selectedText, question: question.trim(), answer: data.answer },
      ]);
      setQuestion('');
      setSelectedText(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAsking(false);
    }
  }

  /** 我讀完了：套用學習轉移 → 恢復派題 */
  async function completeLesson() {
    if (!identity) {
      return;
    }
    setLoading('正在記錄你的學習成果…');
    try {
      const res = await fetch(`/api/adaptive/${code}/lesson-complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ studentKey: identity.studentKey }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      await Promise.all([
        refreshDiagnosis(identity.studentKey),
        fetchNextStep(identity.studentKey),
      ]);
    } catch (e) {
      setError((e as Error).message);
      setLoading(null);
    }
  }

  // ---------- 入口表單（尚未加入） ----------
  if (!identity) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <h1 className="text-xl font-bold">
          🎯
          {' '}
          {title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {subjectName}
          {' '}
          · 適性練習：系統會依你的程度出題，卡關時 AI 導師會為你補課。
        </p>
        <div className="mt-6 flex flex-col gap-3 rounded-lg border p-5">
          <div className="flex flex-col gap-1">
            <label htmlFor="adaptive-name" className="text-sm font-medium">姓名</label>
            <input
              id="adaptive-name"
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              maxLength={30}
              placeholder="王小明"
              className="h-10 rounded-md border px-3 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="adaptive-key" className="text-sm font-medium">學號／座號</label>
            <input
              id="adaptive-key"
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void join()}
              maxLength={30}
              placeholder="例如：10130"
              className="h-10 rounded-md border px-3 text-sm"
            />
            <p className="text-xs text-muted-foreground">下次輸入相同學號會從上次進度繼續。</p>
          </div>
          {error && (
            <p className="text-sm text-red-600">
              ⚠️
              {' '}
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={() => void join()}
            disabled={!storageChecked || joining || !nameInput.trim() || !keyInput.trim()}
            className="h-10 rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {joining ? '正在載入你的學習進度…' : '開始學習 →'}
          </button>
        </div>
      </div>
    );
  }

  // ---------- 作答主畫面 ----------
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold">
          🎒
          {' '}
          {identity.displayName}
          {' '}
          的學習頁
        </h1>
        <span className="rounded bg-muted px-2 py-0.5 text-xs">{subjectName}</span>
        <span className="text-sm text-muted-foreground">{title}</span>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_260px]">
        <main className="min-w-0">
          {error && (
            <div className="mb-4 rounded-lg border border-red-300 p-4 text-sm">
              ⚠️
              {' '}
              {error}
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => void fetchNextStep(identity.studentKey)}
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
                >
                  重試
                </button>
              </div>
            </div>
          )}

          {loading && (
            <div className="rounded-lg border p-6 text-sm text-muted-foreground">
              ⏳
              {' '}
              {loading}
            </div>
          )}

          {/* 課文串流生成中：導師邊寫、學生邊看 */}
          {streamingText && (
            <div className="rounded-lg border p-5">
              <span className="rounded bg-muted px-2 py-0.5 text-xs">✍️ 導師正在為你撰寫補強課文…</span>
              <div
                className={`mt-3 ${LESSON_BODY_CLASS}`}
                // 內容來自自家 API（Claude 生成的 Markdown），非使用者輸入
                dangerouslySetInnerHTML={{ __html: String(marked.parse(streamingText)) }}
              />
            </div>
          )}

          {/* 作答畫面 */}
          {!loading && !streamingText && step?.type === 'item' && (
            <div className="rounded-lg border p-5">
              <div className="flex flex-wrap gap-1.5">
                <span className="rounded bg-muted px-2 py-0.5 text-xs">
                  題目
                  {' '}
                  {step.dispatch.item.id}
                </span>
                <span className="rounded bg-muted px-2 py-0.5 text-xs">
                  難度
                  {' '}
                  {step.dispatch.item.difficulty.toFixed(1)}
                </span>
                {step.dispatch.isRemediation && (
                  <span className="rounded bg-muted px-2 py-0.5 text-xs">🔁 補強</span>
                )}
              </div>
              <p className="my-3.5 text-base">{step.dispatch.item.prompt}</p>
              <p className="text-xs text-muted-foreground">
                派題診斷：
                {step.dispatch.reason}
              </p>

              {/* 選項（單選）：點選即送出，伺服器判對錯後鎖定並標色 */}
              <div className="my-3.5 flex flex-col gap-2">
                {step.dispatch.item.options.map((opt, i) => {
                  let cls = 'w-full rounded-lg border px-4 py-2.5 text-left text-sm leading-relaxed';
                  if (feedback) {
                    if (i === feedback.answerIndex) {
                      cls += ' border-green-500 bg-green-50';
                    } else if (i === feedback.selectedIndex) {
                      cls += ' border-red-500 bg-red-50';
                    }
                  } else {
                    cls += ' hover:border-primary';
                  }
                  return (
                    <button
                      key={opt}
                      type="button"
                      className={cls}
                      disabled={grading || feedback !== null}
                      onClick={() => void submitAnswer(i)}
                    >
                      <span className="mr-2.5 font-bold text-primary">
                        {String.fromCharCode(65 + i)}
                      </span>
                      {opt}
                    </button>
                  );
                })}
              </div>

              {/* 作答前才能看提示（用了會降低本題的精熟度收益） */}
              {!feedback && (
                <button
                  type="button"
                  onClick={() => setHintsUsed(n => n + 1)}
                  disabled={grading}
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
                >
                  💡 看提示（已用
                  {' '}
                  {hintsUsed}
                  {' '}
                  次）
                </button>
              )}
              {!feedback && hintsUsed > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  （MVP 示意：提示內容之後由正式題庫提供；使用提示會降低本題的精熟度收益）
                </p>
              )}

              {/* 判題回饋：對錯、正解、解析，按下一題才前進 */}
              {feedback && (
                <div
                  className={`mt-3.5 rounded-lg border p-4 ${
                    feedback.isCorrect ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'
                  }`}
                >
                  <strong className="text-sm">
                    {feedback.isCorrect
                      ? '✅ 答對了！'
                      : `❌ 答錯了，正確答案是 ${String.fromCharCode(65 + feedback.answerIndex)}`}
                  </strong>
                  {feedback.explanation && (
                    <p className="mt-2 text-sm">{feedback.explanation}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => void nextItem()}
                    className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    下一題 →
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 課文閱讀畫面 */}
          {!loading && !streamingText && step?.type === 'lesson' && (
            <div className="rounded-lg border p-5">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded bg-muted px-2 py-0.5 text-xs">📖 補強課文</span>
                <span className="text-xs text-muted-foreground">
                  看不懂的地方，用滑鼠選取文字即可劃線提問
                </span>
              </div>
              {/* onMouseUp 用來抓「劃線選取」的文字，是文字選取而非點擊互動，
                  沒有對應的鍵盤操作可替代，故停用靜態元素互動規則 */}
              {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
              <div
                className={LESSON_BODY_CLASS}
                onMouseUp={handleLessonMouseUp}
                // 內容來自自家 API（Claude 生成的 Markdown），非使用者輸入
                dangerouslySetInnerHTML={{ __html: String(marked.parse(step.lesson.content)) }}
              />

              <div className="mt-4 text-sm">
                <strong>【思考題】</strong>
                <ul className="mt-1 list-disc pl-5">
                  {step.lesson.thoughtQuestions.map(q => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </div>

              {/* 已完成的問答對話 */}
              {exchanges.map(ex => (
                <div
                  key={`${ex.highlightedText}-${ex.question}`}
                  className="mt-3 rounded-lg bg-muted/60 p-3 text-sm"
                >
                  <div>
                    ✏️
                    {' '}
                    <span className="rounded bg-yellow-100 px-1">
                      「
                      {ex.highlightedText}
                      」
                    </span>
                    {' '}
                    {ex.question}
                  </div>
                  <div className="mt-1.5">
                    💬
                    {' '}
                    {ex.answer}
                  </div>
                </div>
              ))}

              {/* 劃線提問輸入框 */}
              {selectedText && (
                <div className="mt-3 rounded-lg border p-3 text-sm">
                  <div>
                    ✏️ 你劃線了：
                    <span className="rounded bg-yellow-100 px-1">
                      「
                      {selectedText}
                      」
                    </span>
                  </div>
                  <input
                    value={question}
                    onChange={e => setQuestion(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && void askAnnotation()}
                    placeholder="想問什麼？導師會即時回答（可連續追問）"
                    disabled={asking}
                    className="mt-2 h-9 w-full rounded-md border px-3 text-sm"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void askAnnotation()}
                      disabled={asking || !question.trim()}
                      className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      {asking ? '導師思考中…' : '送出提問'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedText(null)}
                      disabled={asking}
                      className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => void completeLesson()}
                className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                ✅ 我讀完了
              </button>
            </div>
          )}

          {/* 完課畫面 */}
          {!loading && !streamingText && step?.type === 'completed' && (
            <div className="rounded-lg border p-8 text-center">
              <h2 className="text-lg font-bold">🎓 恭喜！所有知識點皆已精熟</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                課程完成——老師可以在班級儀表板看到你的完整學習軌跡。
              </p>
            </div>
          )}
        </main>

        {/* 側欄：知識點精熟度 */}
        <aside className="h-fit rounded-lg border p-4">
          <strong className="text-sm">學習進度</strong>
          {diagnosis.map(d => (
            <DiagnosisRow key={d.knowledgeId} d={d} />
          ))}
        </aside>
      </div>
    </div>
  );
}

const STATUS_META = {
  mastered: { label: '✅ 已精熟', bar: 'bg-green-500' },
  learning: { label: '📖 學習中', bar: 'bg-blue-500' },
  locked: { label: '🔒 鎖定中', bar: 'bg-gray-400' },
} as const;

/** 側欄單一知識點：狀態＋精熟度進度條＋作答次數 */
function DiagnosisRow({ d }: { d: KnowledgeDiagnosis }) {
  const meta = STATUS_META[d.status];
  return (
    <div className="mt-3 border-t pt-3 text-sm first:border-t-0">
      <div className="flex items-center justify-between">
        <span>{d.name}</span>
        <span className="text-xs">{meta.label}</span>
      </div>
      <div className="my-1.5 h-1.5 overflow-hidden rounded bg-muted">
        <div
          className={`h-full ${meta.bar}`}
          style={{ width: `${Math.round(d.mastery * 100)}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>
          精熟度
          {' '}
          {(d.mastery * 100).toFixed(0)}
          %
        </span>
        <span>
          作答
          {' '}
          {d.attempts}
          {' '}
          次
        </span>
      </div>
    </div>
  );
}
