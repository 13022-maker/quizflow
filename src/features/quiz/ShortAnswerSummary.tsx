// 簡答題答案匯總（老師成績頁用）
// Phase B：顯示 AI 評分結果（徽章 + 評語 + 信心度）
// Phase C：加老師複核 toggle（✓ 給分 / ✗ 扣分），server action 重算 response.score
// Phase D：批次複核（全部接受 AI 判定）+ 低信心 flag（confidence < 0.7 標紅 + 篩選）

'use client';

import { useMemo, useState, useTransition } from 'react';

import { acceptAllAiGradesForQuestion, gradeShortAnswerByTeacher } from '@/actions/responseActions';

const LOW_CONFIDENCE_THRESHOLD = 0.7;

type GradingMeta = {
  reason: string;
  confidence: number;
  aiScore: number;
  gradedBy: 'ai' | 'teacher' | 'teacher_confirmed';
  gradedAt: string;
} | null;

type AnswerItem = {
  answerId: number;
  studentName: string | null;
  studentEmail: string | null;
  answer: string;
  submittedAtFormatted: string | null;
  isCorrect: boolean | null;
  gradingMeta: GradingMeta;
  appealStatus: string | null;
  appealReason: string | null;
  appealCreatedAtFormatted: string | null;
};

type Group = {
  question: { id: number; body: string; points: number };
  answers: AnswerItem[];
};

type Labels = {
  empty_placeholder: string;
  anonymous: string;
  no_answers: string;
  ai_graded: string;
  teacher_graded: string;
  teacher_confirmed: string;
  pending: string;
  mark_correct: string;
  mark_wrong: string;
  saving: string;
  low_confidence: string;
  filter_all: string;
  filter_low_confidence: string;
  filter_pending: string;
  filter_appealed: string;
  appeal_badge: string;
  appeal_reason_label: string;
  accept_all_ai: string;
  accept_all_ai_confirm: string;
  accept_all_ai_none: string;
  accept_all_ai_done: string;
};

type Props = {
  groups: Group[];
  labels: Labels;
};

type FilterMode = 'all' | 'low_confidence' | 'pending_review' | 'appealed';

function isLowConfidence(meta: GradingMeta): boolean {
  return meta?.gradedBy === 'ai' && (meta.confidence ?? 0) < LOW_CONFIDENCE_THRESHOLD;
}

// 篩選邏輯：把該答案歸入哪幾個 filter bucket
function matchesFilter(answer: AnswerItem, mode: FilterMode): boolean {
  if (mode === 'all') {
    return true;
  }
  if (mode === 'low_confidence') {
    return isLowConfidence(answer.gradingMeta);
  }
  if (mode === 'pending_review') {
    // 「待老師複核」= AI 尚未被老師確認過（gradedBy='ai'），含正常信心也算
    return answer.gradingMeta?.gradedBy === 'ai';
  }
  if (mode === 'appealed') {
    return answer.appealStatus === 'pending';
  }
  return true;
}

// 計算該答案目前實得分（rendering 用，邏輯需與 server 端 computeAwardedPoints 一致）
function getAwardedPoints(a: AnswerItem, questionPoints: number): number {
  if (a.gradingMeta?.gradedBy === 'teacher') {
    return a.isCorrect === true ? questionPoints : 0;
  }
  return a.gradingMeta?.aiScore ?? 0;
}

function AnswerRow({ answer, questionPoints, labels }: {
  answer: AnswerItem;
  questionPoints: number;
  labels: Labels;
}) {
  const [isPending, startTransition] = useTransition();
  const isEmpty = answer.answer.trim().length === 0;
  const studentLabel = answer.studentName ?? answer.studentEmail ?? labels.anonymous;
  const meta = answer.gradingMeta;
  const gradedBy = meta?.gradedBy;
  const isTeacherGraded = gradedBy === 'teacher';
  const isTeacherConfirmed = gradedBy === 'teacher_confirmed';
  const awardedPoints = getAwardedPoints(answer, questionPoints);
  const lowConfidence = isLowConfidence(meta);
  const isAppealed = answer.appealStatus === 'pending';

  const handleGrade = (newIsCorrect: boolean) => {
    startTransition(async () => {
      try {
        await gradeShortAnswerByTeacher({
          answerId: answer.answerId,
          isCorrect: newIsCorrect,
        });
        // server action 已 revalidatePath，列表會自動更新
      } catch (err) {
        // eslint-disable-next-line no-alert
        alert(err instanceof Error ? err.message : '儲存失敗');
      }
    });
  };

  // 徽章顏色：依目前 isCorrect 狀態
  const badgeClass = answer.isCorrect === true
    ? 'bg-green-100 text-green-800'
    : answer.isCorrect === false
      ? 'bg-red-100 text-red-800'
      : 'bg-gray-100 text-gray-600';

  // 評分來源徽章文字
  const gradedByLabel = isTeacherGraded
    ? labels.teacher_graded
    : isTeacherConfirmed
      ? labels.teacher_confirmed
      : `${labels.ai_graded}（信心 ${Math.round((meta?.confidence ?? 0) * 100)}%）`;

  // 視覺優先級：申訴 > 低信心 > 一般
  const rowBg = isAppealed
    ? 'bg-blue-50/70 border-l-4 border-l-blue-400'
    : lowConfidence
      ? 'bg-amber-50/60'
      : '';

  return (
    <li className={`px-4 py-3 ${rowBg}`}>
      {/* header：學生 + 時間 */}
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{studentLabel}</span>
        {answer.submittedAtFormatted && <span>{answer.submittedAtFormatted}</span>}
      </div>

      {/* 學生答案 */}
      <p className="whitespace-pre-wrap break-words text-sm">
        {isEmpty
          ? <span className="italic text-muted-foreground">{labels.empty_placeholder}</span>
          : answer.answer}
      </p>

      {/* 評分狀態 + AI 評語 */}
      {meta && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass}`}>
            <span>
              {answer.isCorrect === true ? '✓' : answer.isCorrect === false ? '✗' : '⋯'}
            </span>
            <span>
              {awardedPoints}
              {' / '}
              {questionPoints}
              {' 分'}
            </span>
          </span>
          <span className="text-xs text-muted-foreground">{gradedByLabel}</span>
          {lowConfidence && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
              ⚠️
              {' '}
              {labels.low_confidence}
            </span>
          )}
          {meta.reason && !isTeacherGraded && (
            <span className="text-xs italic text-muted-foreground">
              「
              {meta.reason}
              」
            </span>
          )}
        </div>
      )}

      {/* 學生申訴：藍色 callout 顯示申訴理由（老師複核後自動 resolved 即不顯示） */}
      {isAppealed && (
        <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
          <p className="text-xs font-semibold text-blue-800">
            📣
            {' '}
            {labels.appeal_badge}
            {answer.appealCreatedAtFormatted && (
              <span className="ml-2 font-normal text-blue-600">
                {answer.appealCreatedAtFormatted}
              </span>
            )}
          </p>
          {answer.appealReason && (
            <p className="mt-1 text-sm text-blue-900">
              <span className="text-blue-600">
                {labels.appeal_reason_label}
                ：
              </span>
              {answer.appealReason}
            </p>
          )}
        </div>
      )}

      {/* 老師複核 toggle */}
      <div className="mt-2 flex items-center gap-1">
        <button
          type="button"
          disabled={isPending}
          onClick={() => handleGrade(true)}
          className={`rounded px-2 py-1 text-xs font-medium transition ${
            isTeacherGraded && answer.isCorrect === true
              ? 'bg-green-600 text-white'
              : 'border bg-background text-foreground hover:bg-green-50 hover:text-green-700'
          } disabled:opacity-50`}
        >
          ✓
          {' '}
          {labels.mark_correct}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => handleGrade(false)}
          className={`rounded px-2 py-1 text-xs font-medium transition ${
            isTeacherGraded && answer.isCorrect === false
              ? 'bg-red-600 text-white'
              : 'border bg-background text-foreground hover:bg-red-50 hover:text-red-700'
          } disabled:opacity-50`}
        >
          ✗
          {' '}
          {labels.mark_wrong}
        </button>
        {isPending && (
          <span className="ml-2 text-xs text-muted-foreground">{labels.saving}</span>
        )}
      </div>
    </li>
  );
}

function QuestionGroup({ group, index, filter, labels }: {
  group: Group;
  index: number;
  filter: FilterMode;
  labels: Labels;
}) {
  const [isPending, startTransition] = useTransition();
  const visible = useMemo(
    () => group.answers.filter(a => matchesFilter(a, filter)),
    [group.answers, filter],
  );

  // 該題還有多少筆是 gradedBy='ai'（決定批次按鈕是否亮起）
  const pendingAiCount = group.answers.filter(
    a => a.gradingMeta?.gradedBy === 'ai',
  ).length;

  const handleAcceptAll = () => {
    if (pendingAiCount === 0) {
      // eslint-disable-next-line no-alert
      alert(labels.accept_all_ai_none);
      return;
    }
    // eslint-disable-next-line no-alert
    const ok = window.confirm(
      labels.accept_all_ai_confirm.replace('{count}', String(pendingAiCount)),
    );
    if (!ok) {
      return;
    }
    startTransition(async () => {
      try {
        const res = await acceptAllAiGradesForQuestion({ questionId: group.question.id });
        // eslint-disable-next-line no-alert
        alert(labels.accept_all_ai_done.replace('{count}', String(res.affected)));
      } catch (err) {
        // eslint-disable-next-line no-alert
        alert(err instanceof Error ? err.message : '操作失敗');
      }
    });
  };

  return (
    <div className="overflow-hidden rounded-lg border">
      {/* 題目標頭 */}
      <div className="border-b bg-muted/50 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="text-sm">
            <span className="mr-2 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-800">
              Q
              {index + 1}
            </span>
            <span className="font-medium">{group.question.body}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              ·
              {' '}
              {group.answers.length}
              {' 筆 · 滿分 '}
              {group.question.points}
              {' 分'}
            </span>
          </p>
          {/* 批次接受 AI 判定 */}
          <button
            type="button"
            disabled={isPending || pendingAiCount === 0}
            onClick={handleAcceptAll}
            className="shrink-0 rounded-md border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-green-50 hover:text-green-700 disabled:cursor-not-allowed disabled:opacity-50"
            title={pendingAiCount === 0 ? labels.accept_all_ai_none : ''}
          >
            ✓
            {' '}
            {labels.accept_all_ai}
            {' '}
            (
            {pendingAiCount}
            )
          </button>
        </div>
      </div>

      {/* 學生答案列表 */}
      {group.answers.length === 0
        ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              {labels.no_answers}
            </p>
          )
        : visible.length === 0
          ? (
              <p className="px-4 py-6 text-center text-xs italic text-muted-foreground">
                （此題在目前篩選下沒有符合的作答）
              </p>
            )
          : (
              <ul className="divide-y">
                {visible.map(answer => (
                  <AnswerRow
                    key={answer.answerId}
                    answer={answer}
                    questionPoints={group.question.points}
                    labels={labels}
                  />
                ))}
              </ul>
            )}
    </div>
  );
}

export function ShortAnswerSummary({ groups, labels }: Props) {
  const [filter, setFilter] = useState<FilterMode>('all');

  // 跨題統計各 filter bucket 數量（顯示在 chip 上）
  const counts = useMemo(() => {
    let lowConf = 0;
    let pending = 0;
    let appealed = 0;
    for (const g of groups) {
      for (const a of g.answers) {
        if (isLowConfidence(a.gradingMeta)) {
          lowConf += 1;
        }
        if (a.gradingMeta?.gradedBy === 'ai') {
          pending += 1;
        }
        if (a.appealStatus === 'pending') {
          appealed += 1;
        }
      }
    }
    return { lowConf, pending, appealed };
  }, [groups]);

  const chipClass = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs font-medium transition ${
      active
        ? 'bg-foreground text-background'
        : 'border bg-background text-muted-foreground hover:bg-muted'
    }`;

  return (
    <div className="space-y-4">
      {/* 篩選列 */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={chipClass(filter === 'all')}
        >
          {labels.filter_all}
        </button>
        <button
          type="button"
          onClick={() => setFilter('low_confidence')}
          className={chipClass(filter === 'low_confidence')}
        >
          {labels.filter_low_confidence}
          {' '}
          (
          {counts.lowConf}
          )
        </button>
        <button
          type="button"
          onClick={() => setFilter('pending_review')}
          className={chipClass(filter === 'pending_review')}
        >
          {labels.filter_pending}
          {' '}
          (
          {counts.pending}
          )
        </button>
        <button
          type="button"
          onClick={() => setFilter('appealed')}
          className={`${chipClass(filter === 'appealed')} ${counts.appealed > 0 ? 'ring-2 ring-blue-400' : ''}`}
        >
          📣
          {' '}
          {labels.filter_appealed}
          {' '}
          (
          {counts.appealed}
          )
        </button>
      </div>

      {groups.map((group, idx) => (
        <QuestionGroup
          key={group.question.id}
          group={group}
          index={idx}
          filter={filter}
          labels={labels}
        />
      ))}
    </div>
  );
}
