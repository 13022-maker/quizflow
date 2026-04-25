'use client';

/**
 * 口說題作答元件（學生端）
 *
 * 核心功能：
 *   1. MediaRecorder API 錄音（最長 60 秒，自動停止）
 *   2. 錄完可預覽回放、可重錄
 *   3. 送 /api/ai/grade-speech 拿到逐字稿 + 三維度分數 + 文字回饋
 *   4. 評量結果透過 onAssessment callback 傳回父層，由 QuizTaker 在 submit 時一併送 server
 *
 * 資料流：
 *   - 錄音完成 → 上傳評分 → 將結果存到父層 answers state（學生看不到正解）
 *   - 父層在最終 submit 時把 audioUrl + assessment 一起傳給 submitQuizResponse
 *
 * 注意：MediaRecorder 在 iOS Safari < 14.5 不支援，需要 polyfill 或提供「上傳音檔」備援
 */

import { useEffect, useRef, useState } from 'react';

export type SpeechAssessmentResult = {
  audioUrl: string;
  transcript: string;
  durationSeconds: number;
  language: string;
  scores: {
    pronunciation: number;
    fluency: number;
    content: number;
    overall: number;
  };
  feedback: string;
};

type Props = {
  questionId: number;
  prompt: string;
  /** 老師選填的參考答案，給 AI 評分用 */
  referenceText?: string | null;
  /** 評量語言；老師可在出題時設定，預設 en */
  language?: 'zh-TW' | 'zh-CN' | 'en' | 'ja' | 'ko';
  /** 最長錄音秒數，預設 60 */
  maxDurationSeconds?: number;
  /** 已存的評量結果（換頁回來用） */
  initial?: SpeechAssessmentResult;
  /** 評量完成 callback；父層存到 answers state */
  onAssessment: (result: SpeechAssessmentResult | null) => void;
};

const MIME_CANDIDATES = ['audio/webm', 'audio/mp4', 'audio/ogg'];

function pickSupportedMime(): string {
  if (typeof MediaRecorder === 'undefined') {
    return '';
  }
  for (const m of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) {
      return m;
    }
  }
  return '';
}

export function SpeakingQuestion({
  questionId,
  prompt,
  referenceText,
  language = 'en',
  maxDurationSeconds = 60,
  initial,
  onAssessment,
}: Props) {
  const [recording, setRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SpeechAssessmentResult | null>(initial ?? null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const supportedMime = useRef<string>('');

  useEffect(() => {
    supportedMime.current = pickSupportedMime();
  }, []);

  // 卸載時釋放資源
  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach(t => t.stop());
      if (recordedUrl) {
        URL.revokeObjectURL(recordedUrl);
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecording(false);
  };

  const startRecording = async () => {
    setError('');
    setResult(null);
    onAssessment(null);
    setRecordedBlob(null);
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl);
    }
    setRecordedUrl(null);
    setElapsed(0);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('此瀏覽器不支援錄音功能，請改用 Chrome / Edge / Safari');
      return;
    }
    if (!supportedMime.current) {
      setError('此瀏覽器不支援 MediaRecorder，請更新瀏覽器或改用 Chrome / Edge');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream, { mimeType: supportedMime.current });
      recorderRef.current = mr;
      chunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: supportedMime.current });
        setRecordedBlob(blob);
        setRecordedUrl(URL.createObjectURL(blob));
      };

      mr.start();
      setRecording(true);

      // 計時 + 自動停止
      const startTs = Date.now();
      timerRef.current = setInterval(() => {
        const sec = Math.floor((Date.now() - startTs) / 1000);
        setElapsed(sec);
        if (sec >= maxDurationSeconds) {
          stopRecording();
        }
      }, 200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '無法存取麥克風';
      setError(`啟動錄音失敗：${msg}`);
    }
  };

  const handleGrade = async () => {
    if (!recordedBlob) {
      return;
    }
    setError('');
    setGrading(true);
    try {
      const form = new FormData();
      form.append('audio', recordedBlob, 'speech.webm');
      form.append('prompt', prompt);
      form.append('language', language);
      if (referenceText) {
        form.append('referenceText', referenceText);
      }
      const res = await fetch('/api/ai/grade-speech', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? `${res.status} ${res.statusText}`);
      }
      const next: SpeechAssessmentResult = {
        audioUrl: json.audioUrl,
        transcript: json.transcript ?? '',
        durationSeconds: json.durationSeconds ?? 0,
        language: json.language ?? language,
        scores: {
          pronunciation: json.scores?.pronunciation ?? 0,
          fluency: json.scores?.fluency ?? 0,
          content: json.scores?.content ?? 0,
          overall: json.scores?.overall ?? 0,
        },
        feedback: json.feedback ?? '',
      };
      setResult(next);
      onAssessment(next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '評分失敗';
      setError(msg);
    } finally {
      setGrading(false);
    }
  };

  const handleReset = () => {
    setResult(null);
    setRecordedBlob(null);
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl);
    }
    setRecordedUrl(null);
    setElapsed(0);
    setError('');
    onAssessment(null);
  };

  return (
    <div className="space-y-3 rounded-xl border bg-purple-50/30 p-4">
      <div className="flex items-center gap-2 text-xs text-purple-700">
        <span className="font-semibold">🎤 口說題</span>
        <span className="text-purple-500">
          請錄音回答（最長
          {' '}
          {maxDurationSeconds}
          {' '}
          秒）
        </span>
      </div>

      {/* 錄音控制區 */}
      {!result && (
        <div className="flex flex-wrap items-center gap-2">
          {!recording && !recordedBlob && (
            <button
              type="button"
              onClick={startRecording}
              className="inline-flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-600"
            >
              <span className="size-2 rounded-full bg-white" />
              開始錄音
            </button>
          )}
          {recording && (
            <button
              type="button"
              onClick={stopRecording}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-gray-900"
            >
              <span className="size-2 animate-pulse rounded-sm bg-red-400" />
              停止（
              {elapsed}
              s）
            </button>
          )}
          {!recording && recordedBlob && (
            <>
              <button
                type="button"
                onClick={startRecording}
                className="rounded-lg border px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                🔄 重錄
              </button>
              <button
                type="button"
                onClick={handleGrade}
                disabled={grading}
                className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-purple-700 disabled:opacity-50"
              >
                {grading ? '評分中…' : '🤖 送 AI 評分'}
              </button>
            </>
          )}
        </div>
      )}

      {/* 錄音預覽 */}
      {recordedUrl && !result && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio controls src={recordedUrl} className="w-full" />
      )}

      {/* 錄音中視覺指示 */}
      {recording && (
        <div className="flex items-center gap-2 text-xs text-red-600">
          <span className="size-2 animate-pulse rounded-full bg-red-500" />
          錄音中…
          {' '}
          {elapsed}
          {' '}
          /
          {' '}
          {maxDurationSeconds}
          {' '}
          秒
        </div>
      )}

      {/* 錯誤訊息 */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          ⚠️
          {' '}
          {error}
        </div>
      )}

      {/* 評分結果 */}
      {result && (
        <div className="space-y-3 rounded-lg border border-purple-200 bg-white p-4">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-semibold text-purple-700">AI 評分結果</p>
            <button
              type="button"
              onClick={handleReset}
              className="text-xs text-gray-400 hover:text-gray-600 hover:underline"
            >
              重錄
            </button>
          </div>

          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls src={result.audioUrl} className="w-full" />

          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            <ScoreBadge label="總分" value={result.scores.overall} primary />
            <ScoreBadge label="發音" value={result.scores.pronunciation} />
            <ScoreBadge label="流暢度" value={result.scores.fluency} />
            <ScoreBadge label="內容" value={result.scores.content} />
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-gray-500">逐字稿</p>
            <p className="rounded bg-gray-50 px-3 py-2 text-sm text-gray-800">
              {result.transcript || '（未辨識到內容）'}
            </p>
          </div>

          {result.feedback && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-500">老師建議</p>
              <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
                💬
                {' '}
                {result.feedback}
              </p>
            </div>
          )}

          <p className="text-[10px] text-gray-400">
            說話時長
            {' '}
            {result.durationSeconds.toFixed(1)}
            {' '}
            秒 · 評量語言
            {' '}
            {result.language}
            {' '}
            · 題號 #
            {questionId}
          </p>
        </div>
      )}
    </div>
  );
}

function ScoreBadge({
  label,
  value,
  primary = false,
}: {
  label: string;
  value: number;
  primary?: boolean;
}) {
  const tone
    = value >= 80
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : value >= 60
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-red-50 text-red-700 border-red-200';
  return (
    <div className={`rounded-lg border px-2 py-1.5 ${tone} ${primary ? 'ring-2 ring-purple-200' : ''}`}>
      <p className="text-[10px] font-medium uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}
