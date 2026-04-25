'use client';

/**
 * 老師端口說題作答列表
 *
 * 每個 speaking 題目摺疊成一張卡片，展開後列出每位學生的：
 *   - 學生姓名 / Email + 提交時間
 *   - 錄音播放器（answer.audioUrl）
 *   - 三維分數 + 加權 overall
 *   - 逐字稿
 *   - AI 回饋
 *
 * 設計：純 client component，資料由 page server-side 撈好序列化進來
 */

import { useState } from 'react';

export type SpeechAssessment = {
  transcript: string;
  pronunciationScore: number;
  fluencyScore: number;
  contentScore: number;
  overallScore: number;
  feedback: string;
  language: string;
};

export type SpeechSubmission = {
  responseId: number;
  studentName: string | null;
  studentEmail: string | null;
  submittedAt: string; // ISO
  audioUrl: string | null;
  assessment: SpeechAssessment | null;
};

export type SpeechQuestionGroup = {
  questionId: number;
  questionBody: string;
  submissions: SpeechSubmission[];
};

export function SpeechSubmissionsList({ groups }: { groups: SpeechQuestionGroup[] }) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set(groups.map(g => g.questionId)));

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (groups.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
        目前尚無口說題作答
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((g, idx) => {
        const isOpen = expanded.has(g.questionId);
        const avgOverall = g.submissions.length > 0
          ? Math.round(
            g.submissions.reduce((sum, s) => sum + (s.assessment?.overallScore ?? 0), 0)
            / g.submissions.length,
          )
          : null;
        return (
          <div key={g.questionId} className="overflow-hidden rounded-xl border bg-white">
            <button
              type="button"
              onClick={() => toggle(g.questionId)}
              className="flex w-full items-start gap-3 px-5 py-4 text-left hover:bg-muted/30"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-purple-100 text-xs font-bold text-purple-700">
                Q
                {idx + 1}
              </span>
              <div className="flex-1">
                <p className="line-clamp-2 text-sm font-medium">{g.questionBody}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {g.submissions.length}
                  {' '}
                  位學生作答
                  {avgOverall !== null && (
                    <span className="ml-2">
                      · 平均分數
                      {' '}
                      <span className="font-semibold text-purple-600">{avgOverall}</span>
                    </span>
                  )}
                </p>
              </div>
              <span className={`mt-1 text-xs text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}>▼</span>
            </button>

            {isOpen && (
              <div className="space-y-3 border-t bg-purple-50/30 px-5 py-4">
                {g.submissions.length === 0
                  ? (
                      <p className="text-center text-xs text-muted-foreground">尚無作答</p>
                    )
                  : (
                      g.submissions.map(sub => (
                        <SubmissionCard key={sub.responseId} submission={sub} />
                      ))
                    )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SubmissionCard({ submission }: { submission: SpeechSubmission }) {
  const { studentName, studentEmail, submittedAt, audioUrl, assessment } = submission;
  const displayName = studentName || studentEmail || '匿名學生';

  return (
    <div className="space-y-2 rounded-lg border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{displayName}</p>
          {studentEmail && studentName && (
            <p className="text-xs text-muted-foreground">{studentEmail}</p>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {new Date(submittedAt).toLocaleString('zh-TW')}
        </p>
      </div>

      {audioUrl
        ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <audio controls src={audioUrl} className="w-full" />
          )
        : (
            <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-700">⚠️ 未保存錄音檔</p>
          )}

      {assessment
        ? (
            <>
              <div className="grid grid-cols-4 gap-2">
                <ScoreCell label="總分" value={assessment.overallScore} primary />
                <ScoreCell label="發音" value={assessment.pronunciationScore} />
                <ScoreCell label="流暢度" value={assessment.fluencyScore} />
                <ScoreCell label="內容" value={assessment.contentScore} />
              </div>

              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">逐字稿</p>
                <p className="mt-0.5 rounded bg-gray-50 px-3 py-2 text-sm text-gray-800">
                  {assessment.transcript || '（未辨識到內容）'}
                </p>
              </div>

              {assessment.feedback && (
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">AI 回饋</p>
                  <p className="mt-0.5 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    💬 {assessment.feedback}
                  </p>
                </div>
              )}
            </>
          )
        : (
            <p className="rounded bg-gray-50 px-3 py-2 text-xs text-muted-foreground">尚未評分</p>
          )}
    </div>
  );
}

function ScoreCell({
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
    <div className={`rounded-md border px-2 py-1.5 text-center ${tone} ${primary ? 'ring-2 ring-purple-200' : ''}`}>
      <p className="text-[10px] font-medium uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-base font-bold tabular-nums">{value}</p>
    </div>
  );
}
