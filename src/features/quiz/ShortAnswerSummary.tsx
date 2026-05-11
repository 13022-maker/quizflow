// 簡答題答案匯總（老師成績頁用）
// Phase B：顯示 AI 評分結果（徽章 + 評語 + 信心度）
// Phase C：加老師複核 toggle（✓ 給分 / ✗ 扣分），server action 重算 response.score

'use client';

import { useTransition } from 'react';

import { gradeShortAnswerByTeacher } from '@/actions/responseActions';

type GradingMeta = {
  reason: string;
  confidence: number;
  aiScore: number;
  gradedBy: 'ai' | 'teacher';
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
  pending: string;
  mark_correct: string;
  mark_wrong: string;
  saving: string;
};

type Props = {
  groups: Group[];
  labels: Labels;
};

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
  const isTeacherGraded = meta?.gradedBy === 'teacher';
  const awardedPoints = getAwardedPoints(answer, questionPoints);

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

  return (
    <li className="px-4 py-3">
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
          <span className="text-xs text-muted-foreground">
            {isTeacherGraded
              ? labels.teacher_graded
              : `${labels.ai_graded}（信心 ${Math.round((meta.confidence ?? 0) * 100)}%）`}
          </span>
          {meta.reason && !isTeacherGraded && (
            <span className="text-xs italic text-muted-foreground">
              「
              {meta.reason}
              」
            </span>
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

export function ShortAnswerSummary({ groups, labels }: Props) {
  return (
    <div className="space-y-4">
      {groups.map(({ question, answers }, idx) => (
        <div key={question.id} className="overflow-hidden rounded-lg border">
          {/* 題目標頭 */}
          <div className="border-b bg-muted/50 px-4 py-3">
            <p className="text-sm">
              <span className="mr-2 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-800">
                Q
                {idx + 1}
              </span>
              <span className="font-medium">{question.body}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                ·
                {' '}
                {answers.length}
                {' 筆 · 滿分 '}
                {question.points}
                {' 分'}
              </span>
            </p>
          </div>

          {/* 學生答案列表 */}
          {answers.length === 0
            ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  {labels.no_answers}
                </p>
              )
            : (
                <ul className="divide-y">
                  {answers.map(answer => (
                    <AnswerRow
                      key={answer.answerId}
                      answer={answer}
                      questionPoints={question.points}
                      labels={labels}
                    />
                  ))}
                </ul>
              )}
        </div>
      ))}
    </div>
  );
}
