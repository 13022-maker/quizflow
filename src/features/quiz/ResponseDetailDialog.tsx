'use client';

// 老師檢視單一學生作答 + AI 批改申論題的 Modal
// 從 ResultsResponseTable row click 觸發，lazy-load 該 response 的完整作答
import { useEffect, useState, useTransition } from 'react';

import {
  gradeEssayAnswerAction,
  updateEssayGradingAction,
} from '@/actions/essayGradingActions';
import { getResponseDetail, type ResponseDetail } from '@/actions/responseActions';

type Props = {
  responseId: number;
  onClose: () => void;
};

type ItemState = ResponseDetail['items'][number];

export function ResponseDetailDialog({ responseId, onClose }: Props) {
  const [detail, setDetail] = useState<ResponseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [gradingId, setGradingId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    getResponseDetail(responseId)
      .then((data) => {
        if (cancelled) {
          return;
        }
        if (!data) {
          setLoadError('找不到作答紀錄或無權限檢視');
          return;
        }
        setDetail(data);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        setLoadError(err instanceof Error ? err.message : '載入失敗');
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [responseId]);

  const showToast = (kind: 'ok' | 'err', msg: string) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 3500);
  };

  const handleGrade = async (item: ItemState) => {
    setGradingId(item.answerId);
    setToast(null);
    try {
      const res = await gradeEssayAnswerAction(item.answerId);
      if (res.status === 'ok') {
        // 更新本地狀態
        setDetail(prev =>
          prev
            ? {
                ...prev,
                items: prev.items.map(it =>
                  it.answerId === item.answerId
                    ? {
                        ...it,
                        aiGrading: res.grading,
                        awardedPoints: res.awardedPoints,
                        gradedAt: new Date().toISOString(),
                        gradedBy: 'ai',
                      }
                    : it,
                ),
              }
            : prev,
        );
        showToast('ok', `已批改，得 ${res.awardedPoints} 分`);
      } else if (res.status === 'quota_exceeded') {
        showToast('err', res.reason);
      } else if (res.status === 'pro_required') {
        showToast('err', '升級 Pro 方案即可使用 AI 批改');
      } else if (res.status === 'skipped') {
        showToast('err', res.reason);
      } else {
        showToast('err', res.error);
      }
    } finally {
      setGradingId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          onClose();
        }
      }}
      role="presentation"
    >
      <div
        className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-card shadow-2xl"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">
              {detail?.response.studentName || detail?.response.studentEmail || '學生作答'}
            </h2>
            {detail && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                分數
                {' '}
                <strong className="text-foreground">
                  {detail.response.score ?? '—'}
                </strong>
                {' / '}
                {detail.response.totalPoints ?? 0}
                {' · '}
                {new Date(detail.response.submittedAt).toLocaleString('zh-TW')}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉"
            className="ml-2 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>

        {/* Toast */}
        {toast && (
          <div
            className={`mx-6 mt-3 rounded-md px-3 py-2 text-sm ${
              toast.kind === 'ok'
                ? 'bg-green-50 text-green-700'
                : 'bg-red-50 text-red-700'
            }`}
          >
            {toast.msg}
          </div>
        )}

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {loading && <p className="text-sm text-muted-foreground">載入中…</p>}
          {loadError && <p className="text-sm text-destructive">{loadError}</p>}
          {detail && (
            <ul className="space-y-5">
              {detail.items.map((item, idx) => (
                <li key={item.answerId} className="rounded-lg border p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      Q
                      {idx + 1}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                      {item.questionPoints}
                      {' '}
                      分
                    </span>
                    {item.questionType === 'short_answer'
                      ? (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                            申論題
                          </span>
                        )
                      : item.isCorrect === true
                        ? (
                            <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">
                              ✓ 正確
                            </span>
                          )
                        : item.isCorrect === false
                          ? (
                              <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">
                                ✗ 錯誤
                              </span>
                            )
                          : null}
                  </div>

                  <p className="text-sm">{item.questionBody}</p>

                  {/* 學生作答 */}
                  <div className="mt-3 rounded-md bg-muted/50 p-3">
                    <p className="mb-1 text-xs font-medium text-muted-foreground">學生作答</p>
                    <p className="whitespace-pre-wrap text-sm">
                      {renderStudentAnswer(item)}
                    </p>
                  </div>

                  {item.questionType === 'short_answer' && (
                    <EssayGradingSection
                      item={item}
                      isGrading={gradingId === item.answerId}
                      onGrade={() => handleGrade(item)}
                      onUpdateLocal={next =>
                        setDetail(prev =>
                          prev
                            ? {
                                ...prev,
                                items: prev.items.map(it =>
                                  it.answerId === item.answerId ? { ...it, ...next } : it,
                                ),
                              }
                            : prev,
                        )}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function renderStudentAnswer(item: ItemState): string {
  if (typeof item.studentAnswer === 'string') {
    return item.studentAnswer || '（未作答）';
  }
  if (Array.isArray(item.studentAnswer)) {
    // 選擇題：找回 option text
    if (item.options) {
      const map = new Map(item.options.map(o => [o.id, o.text]));
      return item.studentAnswer.map(id => map.get(id) ?? id).join('、');
    }
    return item.studentAnswer.join('、');
  }
  return '（未作答）';
}

function EssayGradingSection({
  item,
  isGrading,
  onGrade,
  onUpdateLocal,
}: {
  item: ItemState;
  isGrading: boolean;
  onGrade: () => void;
  onUpdateLocal: (next: Partial<ItemState>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [pendingPoints, setPendingPoints] = useState<string>(
    item.awardedPoints?.toString() ?? '',
  );
  const [teacherFeedback, setTeacherFeedback] = useState<string>(
    item.teacherFeedback ?? '',
  );
  const [isSaving, startTransition] = useTransition();

  const studentText
    = typeof item.studentAnswer === 'string'
      ? item.studentAnswer
      : Array.isArray(item.studentAnswer)
        ? item.studentAnswer.join(' ')
        : '';
  const isEmpty = studentText.trim() === '';

  const handleSave = () => {
    const numericPoints = pendingPoints.trim() === '' ? null : Number(pendingPoints);
    if (numericPoints !== null && (Number.isNaN(numericPoints) || numericPoints < 0)) {
      return;
    }
    startTransition(async () => {
      const res = await updateEssayGradingAction(item.answerId, {
        points: numericPoints,
        teacherFeedback: teacherFeedback.trim() || null,
      });
      if (res.ok) {
        onUpdateLocal({
          awardedPoints: numericPoints,
          teacherFeedback: teacherFeedback.trim() || null,
          gradedAt: new Date().toISOString(),
          gradedBy: item.gradedBy === 'ai' ? 'ai+teacher' : 'teacher',
        });
        setEditing(false);
      }
    });
  };

  if (isEmpty) {
    return (
      <p className="mt-3 rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        學生未作答，無法批改
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      {!item.aiGrading && !item.gradedAt && (
        <button
          type="button"
          onClick={onGrade}
          disabled={isGrading}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
        >
          {isGrading ? '🤖 AI 批改中…' : '✨ AI 批改'}
        </button>
      )}

      {item.aiGrading && (
        <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-primary">
              🤖 AI 批改結果
              {' '}
              ·
              {' '}
              <span className="font-normal text-muted-foreground">
                {item.aiGrading.totalScore}
                {' / '}
                {item.aiGrading.maxScore}
                {' 分 · 本題得 '}
                <strong className="text-foreground">{item.awardedPoints ?? 0}</strong>
                {' / '}
                {item.questionPoints}
                {' 分'}
              </span>
            </p>
            {item.gradedBy === 'ai+teacher' && (
              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">
                老師已覆核
              </span>
            )}
          </div>

          {/* 四面向分數條 */}
          <div className="space-y-2">
            {item.aiGrading.criteriaScores.map((c, i) => {
              const pct = c.maxScore > 0 ? (c.score / c.maxScore) * 100 : 0;
              const color = pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500';
              return (
                // eslint-disable-next-line react/no-array-index-key
                <div key={i} className="text-xs">
                  <div className="mb-0.5 flex items-baseline justify-between gap-2">
                    <span className="font-medium">{c.name}</span>
                    <span className="shrink-0 font-mono text-muted-foreground">
                      {c.score}
                      {' / '}
                      {c.maxScore}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${color}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{c.feedback}</p>
                </div>
              );
            })}
          </div>

          {/* 整體評語 */}
          <div>
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">整體評語</p>
            <p className="whitespace-pre-wrap text-xs">{item.aiGrading.overallFeedback}</p>
          </div>

          {/* 逐句回饋 */}
          {item.aiGrading.sentenceFeedback.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-medium text-muted-foreground">逐句回饋</p>
              <ul className="space-y-1.5">
                {item.aiGrading.sentenceFeedback.map((s, i) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <li key={i} className="rounded border-l-2 border-primary/40 bg-background/60 px-2 py-1 text-[11px]">
                    <p className="text-muted-foreground">
                      「
                      {s.sentence}
                      」
                    </p>
                    <p className="mt-0.5">{s.comment}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* 老師覆核區 */}
      {item.gradedAt && !editing && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {item.teacherFeedback && (
            <p className="flex-1 rounded bg-blue-50 px-2 py-1 text-blue-800">
              <span className="font-medium">老師評語：</span>
              {item.teacherFeedback}
            </p>
          )}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="ml-auto text-muted-foreground hover:text-foreground"
          >
            ✏️ 覆核/調分
          </button>
        </div>
      )}

      {editing && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">本題得分</span>
            <input
              type="number"
              min={0}
              max={item.questionPoints}
              value={pendingPoints}
              onChange={e => setPendingPoints(e.target.value)}
              className="w-16 rounded border border-input bg-background px-2 py-1 text-sm"
            />
            <span className="text-muted-foreground">
              /
              {item.questionPoints}
            </span>
          </div>
          <textarea
            value={teacherFeedback}
            onChange={e => setTeacherFeedback(e.target.value)}
            rows={2}
            placeholder="老師的話（選填）"
            className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isSaving ? '儲存中…' : '儲存'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={isSaving}
              className="rounded border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
