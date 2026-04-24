// 老師即時監考牆 + 儀表板：tab 切換，共用 useQuizProctorState 訂閱
'use client';

import { useState } from 'react';

import type {
  ProctorQuestionStat,
  ProctorState,
  ProctorStudent,
} from '@/hooks/useQuizProctorState';
import { useQuizProctorState } from '@/hooks/useQuizProctorState';

type Tab = 'proctor' | 'dashboard';

export function LiveProctorDashboard({ quizId }: { quizId: number }) {
  const { state, error, warnStudent } = useQuizProctorState(quizId);
  const [tab, setTab] = useState<Tab>('proctor');

  if (error && !state) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <p className="text-sm text-destructive">{`載入失敗：${error}`}</p>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="mx-auto max-w-2xl p-6 text-center">
        <p className="text-sm text-muted-foreground">載入中⋯</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      {/* 標題列 */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            🔴 即時監考
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{state.quiz.title}</p>
        </div>
        <div className="flex gap-4 text-right text-xs text-muted-foreground">
          <span>
            作答中
            <span className="ml-1 text-lg font-bold text-foreground">
              {state.aggregate.inProgressCount}
            </span>
          </span>
          <span>
            已完成
            <span className="ml-1 text-lg font-bold text-foreground">
              {state.aggregate.submittedCount}
            </span>
          </span>
        </div>
      </div>

      {/* Tab 切換 */}
      <div className="mb-4 inline-flex gap-1 rounded-lg border bg-muted/40 p-1">
        <TabButton active={tab === 'proctor'} onClick={() => setTab('proctor')}>
          👁 監考牆
        </TabButton>
        <TabButton active={tab === 'dashboard'} onClick={() => setTab('dashboard')}>
          📊 儀表板
        </TabButton>
      </div>

      {tab === 'proctor'
        ? <ProctorGrid state={state} onWarn={warnStudent} />
        : <DashboardStats state={state} />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

// ── 監考牆 Grid ─────────────────────────────────────────────────

function ProctorGrid({
  state,
  onWarn,
}: {
  state: ProctorState;
  onWarn: (responseId: number, message?: string) => Promise<void>;
}) {
  const [lastWarnedId, setLastWarnedId] = useState<number | null>(null);

  if (state.students.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-12 text-center">
        <p className="text-sm text-muted-foreground">
          尚無學生進入作答。把測驗連結傳給學生即可即時看到此處。
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {state.students.map(s => (
        <StudentCard
          key={s.responseId}
          student={s}
          totalQuestions={state.quiz.totalQuestions}
          justWarned={lastWarnedId === s.responseId}
          onWarn={async () => {
            setLastWarnedId(s.responseId);
            await onWarn(s.responseId);
            setTimeout(() => setLastWarnedId(null), 2000);
          }}
        />
      ))}
    </div>
  );
}

function StudentCard({
  student,
  totalQuestions,
  justWarned,
  onWarn,
}: {
  student: ProctorStudent;
  totalQuestions: number;
  justWarned: boolean;
  onWarn: () => Promise<void>;
}) {
  const done = student.status === 'submitted';
  const progress = Math.max(0, student.lastAnsweredQuestionIndex + 1);
  const leaveLevel = student.leaveCount >= 3 ? 'danger' : student.leaveCount >= 1 ? 'warn' : 'ok';
  const borderColor = done
    ? 'border-emerald-200 bg-emerald-50/40'
    : leaveLevel === 'danger'
      ? 'border-red-300 bg-red-50/60'
      : leaveLevel === 'warn' ? 'border-amber-200 bg-amber-50/40' : 'border-border bg-card';

  return (
    <div className={`rounded-xl border-2 p-4 transition-colors ${borderColor}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{student.nickname}</p>
          <p className="text-[10px] text-muted-foreground">{`id ${student.tokenPrefix}`}</p>
        </div>
        <StatusBadge status={student.status} leaveLevel={leaveLevel} />
      </div>

      <div className="mt-3 space-y-1">
        <p className="text-xs text-muted-foreground">
          進度
          <span className="ml-1 font-mono font-bold text-foreground">
            {progress}
            {' '}
            /
            {' '}
            {totalQuestions}
          </span>
        </p>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${totalQuestions > 0 ? (progress / totalQuestions) * 100 : 0}%` }}
          />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {student.leaveCount > 0
            ? (
                <>
                  <span className={leaveLevel === 'danger' ? 'font-bold text-red-600' : 'text-amber-700'}>
                    ⚠ 離開
                    {' '}
                    {student.leaveCount}
                    {' '}
                    次
                  </span>
                </>
              )
            : '未離開'}
        </span>
        {done
          ? (
              <span className="font-medium text-emerald-700">
                {student.scorePercent !== null ? `${student.scorePercent}%` : '已提交'}
              </span>
            )
          : (
              <button
                type="button"
                onClick={() => void onWarn()}
                disabled={justWarned}
                className="rounded-md bg-red-500 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-red-600 disabled:opacity-60"
              >
                {justWarned ? '✓ 已發送' : '警告'}
              </button>
            )}
      </div>
    </div>
  );
}

function StatusBadge({
  status,
  leaveLevel,
}: {
  status: 'in_progress' | 'submitted';
  leaveLevel: 'ok' | 'warn' | 'danger';
}) {
  if (status === 'submitted') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
        ✅ 完成
      </span>
    );
  }
  const dot
    = leaveLevel === 'danger'
      ? 'bg-red-500'
      : leaveLevel === 'warn' ? 'bg-amber-400' : 'bg-emerald-500';
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-background px-2 py-0.5 text-[10px] font-medium">
      <span className={`size-1.5 rounded-full ${dot}`} />
      作答中
    </span>
  );
}

// ── 儀表板 ─────────────────────────────────────────────────────

function DashboardStats({ state }: { state: ProctorState }) {
  return (
    <div className="space-y-6">
      {/* Stat 卡 */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <StatCard value={String(state.aggregate.totalCount)} label="累計作答" />
        <StatCard value={String(state.aggregate.inProgressCount)} label="作答中" />
        <StatCard
          value={state.aggregate.avgScorePercent !== null ? `${state.aggregate.avgScorePercent}%` : '—'}
          label="平均答對率"
        />
      </div>

      {/* 題目熱圖 */}
      <section>
        <h2 className="mb-3 text-base font-semibold">每題即時答對率</h2>
        {state.perQuestionStats.length === 0
          ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                無題目資料
              </p>
            )
          : (
              <div className="space-y-2">
                {state.perQuestionStats.map(s => (
                  <QuestionRow key={s.questionId} stat={s} />
                ))}
              </div>
            )}
      </section>

      {/* 難題 Top 3 */}
      <section>
        <h2 className="mb-3 text-base font-semibold">🔥 難題 Top 3</h2>
        {state.hardQuestions.length === 0
          ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                尚無足夠資料
              </p>
            )
          : (
              <ol className="space-y-2">
                {state.hardQuestions.map((s, i) => (
                  <li
                    key={s.questionId}
                    className="flex items-start gap-3 rounded-lg border bg-card p-3"
                  >
                    <span className="text-lg">
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm">{s.body}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        答對率
                        {' '}
                        {Math.round((s.correctRate ?? 0) * 100)}
                        %（
                        {s.totalCorrect}
                        /
                        {s.totalAnswered}
                        ）
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
      </section>
    </div>
  );
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 text-center shadow-sm">
      <p className="text-2xl font-bold tracking-tight sm:text-3xl">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function QuestionRow({ stat }: { stat: ProctorQuestionStat }) {
  const rate = stat.correctRate;
  const percent = rate !== null ? Math.round(rate * 100) : null;
  // 顏色：>= 80% 綠、50-80% 黃、< 50% 紅、無資料灰
  const barColor
    = rate === null
      ? 'bg-muted'
      : rate >= 0.8
        ? 'bg-emerald-500'
        : rate >= 0.5 ? 'bg-amber-400' : 'bg-red-500';

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="line-clamp-2 flex-1 text-sm">
          <span className="mr-2 font-mono text-xs text-muted-foreground">
            Q
            {stat.position + 1}
          </span>
          {stat.body}
        </p>
        <span className="shrink-0 font-mono text-sm font-bold">
          {percent !== null ? `${percent}%` : '—'}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full transition-all ${barColor}`}
          style={{ width: `${percent ?? 0}%` }}
        />
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        {stat.totalAnswered}
        {' '}
        人作答
      </p>
    </div>
  );
}
