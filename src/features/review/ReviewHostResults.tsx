'use client';

import Link from 'next/link';
import { useState } from 'react';

import { importReviewSubmissionToQuiz } from '@/actions/reviewImportActions';
import { Button } from '@/components/ui/button';
import { parseCreatedQuestion } from '@/services/review/createModes';

import { CreatedQuestionPreview } from './CreatedQuestionPreview';

type Props = {
  gameId: number;
  state: import('@/services/review/types').ReviewHostState;
  onEnd: () => void;
  pending: boolean;
};

// 「加入我的測驗」：每次按都新建一份測驗並匯入該組題目，成功後給編輯頁連結
function ImportToQuizButton({ gameId, teamId }: { gameId: number; teamId: number }) {
  const [status, setStatus] = useState<'idle' | 'pending' | 'done' | 'error'>('idle');
  const [quizId, setQuizId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleImport = async () => {
    setStatus('pending');
    setError(null);
    try {
      const result = await importReviewSubmissionToQuiz({ gameId, teamId });
      if (result.ok) {
        setQuizId(result.quizId);
        setStatus('done');
      } else {
        setError(result.error);
        setStatus('error');
      }
    } catch {
      setError('匯入失敗，請稍後再試');
      setStatus('error');
    }
  };

  if (status === 'done' && quizId !== null) {
    return (
      <p className="text-sm text-emerald-600">
        ✅ 已加入新測驗，
        <Link href={`/dashboard/quizzes/${quizId}/edit`} className="font-medium text-primary hover:underline">
          前往編輯測驗
        </Link>
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <Button variant="outline" size="sm" onClick={handleImport} disabled={status === 'pending'}>
        {status === 'pending' ? '加入中⋯' : '加入我的測驗'}
      </Button>
      {status === 'error' && error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function ReviewHostResults({ gameId, state, onEnd, pending }: Props) {
  const ranked = [...state.teams].sort((a, b) => b.score - a.score);
  const isQuestionMode = state.game.createMode === 'question';

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">排行榜</h1>
        <div className="flex items-center gap-4">
          <a href={`/api/review/${gameId}/export-csv`} className="text-sm text-primary hover:underline">
            匯出 CSV
          </a>
          {state.game.status !== 'ended' && (
            <Button variant="outline" size="sm" onClick={onEnd} disabled={pending}>
              結束活動
            </Button>
          )}
        </div>
      </div>

      <ol className="mt-6 space-y-3">
        {ranked.map((team, i) => {
          const detail = state.resultsDetail?.find(d => d.teamId === team.id);
          return (
            <li key={team.id} className="rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  #
                  {i + 1}
                  {' '}
                  {team.teamName}
                </span>
                <span className="text-lg font-bold">{team.score}</span>
              </div>
              {detail && (
                <div className="mt-2 text-xs text-muted-foreground">
                  <p>{detail.members.map(m => m.nickname).join('、')}</p>
                  <p className="mt-1">
                    準確度分
                    {detail.accuracyScore}
                    {' '}
                    · 速度加成
                    {detail.speedBonus}
                    {' '}
                    · 投票加成
                    {detail.voteBonus}
                    {' '}
                    （
                    {detail.votesReceived}
                    票）
                  </p>
                  <p className="mt-1">
                    隊長：
                    {detail.members.find(m => m.id === detail.leaderId)?.nickname ?? '（無）'}
                    {detail.autoSubmitted ? '（系統自動送出）' : ''}
                  </p>
                  <p className="mt-1">
                    共創已動手：
                    {detail.contributors.length === 0
                      ? '無記錄'
                      : detail.contributors.map(c => `${c.nickname}(${c.charCount}字)`).join('、')}
                  </p>
                  {isQuestionMode
                    ? (
                        <div className="mt-2 space-y-2 rounded-md border p-3 text-foreground">
                          <CreatedQuestionPreview
                            content={detail.submission ?? ''}
                            showAnswer
                            emptyText="（未提交題目）"
                          />
                          {/* 只有完整合法的題目才能匯入（伺服器端也會再檢查一次） */}
                          {parseCreatedQuestion(detail.submission ?? '') && (
                            <ImportToQuizButton gameId={gameId} teamId={team.id} />
                          )}
                        </div>
                      )
                    : (
                        <p className="mt-2 whitespace-pre-wrap text-foreground">
                          {detail.submission ?? '（未提交創作答案）'}
                        </p>
                      )}
                  {detail.samples.length > 0 && (
                    <table className="mt-3 w-full text-left">
                      <thead>
                        <tr className="border-b">
                          <th className="py-1 pr-2 font-medium">範例</th>
                          <th className="py-1 pr-2 font-medium">小組</th>
                          <th className="py-1 pr-2 font-medium">標準</th>
                          <th className="py-1 text-right font-medium">得分</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.samples.map((s, idx) => (
                          <tr key={s.sampleId} className="border-b last:border-0">
                            <td className="py-1 pr-2">
                              #
                              {idx + 1}
                            </td>
                            <td className="py-1 pr-2">{s.responseCount === 0 ? '（未作答）' : s.teamSummary}</td>
                            <td className="py-1 pr-2">{s.refSummary}</td>
                            <td className="py-1 text-right">{s.accuracyScore}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
