'use client';

import { useEffect, useRef, useState } from 'react';

import type { ReviewTeamState } from '@/services/review/types';

const TEXTAREA_CLASS = 'w-full rounded-md border border-input bg-background px-3 py-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
const AUTOSAVE_DEBOUNCE_MS = 1500;

type ActionResult = { ok: true } | { ok: false; error: string };

type Props = {
  state: ReviewTeamState;
  onSaveDraft: (content: string) => Promise<ActionResult>;
  onVoteLeader: (votedForPlayerId: number) => Promise<ActionResult>;
  onSaveFinalAnswer: (content: string) => Promise<ActionResult>;
  onSubmitFinal: () => Promise<ActionResult>;
};

// 沿用原本的 debounce autosave 邏輯，包成通用元件給「我的草稿」跟「隊長的
// 最終答案」共用，兩者除了文案跟 disabled 狀態以外行為一致
function useAutosaveTextarea(initialValue: string, onSave: (value: string) => Promise<ActionResult>) {
  const [value, setValue] = useState(initialValue);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (next: string) => {
    setValue(next);
    setStatus('idle');
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(async () => {
      setStatus('saving');
      const result = await onSave(next);
      setStatus(result.ok ? 'saved' : 'idle');
    }, AUTOSAVE_DEBOUNCE_MS);
  };

  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
  }, []);

  return { value, setValue, status, handleChange };
}

export function ReviewPlayerCreate({ state, onSaveDraft, onVoteLeader, onSaveFinalAnswer, onSubmitFinal }: Props) {
  const isLeader = state.leaderId === state.me.id;
  const isSubmitted = state.submission?.submittedAt != null;

  const myDraftBox = useAutosaveTextarea(state.myDraft, onSaveDraft);
  const finalAnswerBox = useAutosaveTextarea(state.submission?.content ?? '', onSaveFinalAnswer);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'submitting' | 'error'>('idle');

  const allMembers = [
    { id: state.me.id, nickname: state.me.nickname, content: myDraftBox.value },
    ...state.teammates.map((t) => {
      const draft = state.teammateDrafts.find(d => d.playerId === t.id);
      return { id: t.id, nickname: t.nickname, content: draft?.content ?? '' };
    }),
  ];

  const handleAdoptDraft = (content: string) => {
    finalAnswerBox.setValue(content);
    finalAnswerBox.handleChange(content);
  };

  const handleSubmitFinal = async () => {
    setSubmitStatus('submitting');
    const result = await onSubmitFinal();
    setSubmitStatus(result.ok ? 'idle' : 'error');
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-lg font-bold">共同創作延伸答案</h1>
        <p className="mt-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground">{state.topicPrompt}</p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">我的草稿</h2>
        <textarea
          value={myDraftBox.value}
          onChange={e => myDraftBox.handleChange(e.target.value)}
          rows={6}
          placeholder="先寫下你自己的延伸想法⋯"
          className={TEXTAREA_CLASS}
        />
        <p className="text-xs text-muted-foreground">
          {myDraftBox.status === 'saving' ? '儲存中⋯' : myDraftBox.status === 'saved' ? '已儲存' : ' '}
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">投給隊長</h2>
        <p className="text-xs text-muted-foreground">
          目前隊長：
          {allMembers.find(m => m.id === state.leaderId)?.nickname ?? '（尚未決定）'}
        </p>
        <div className="flex flex-wrap gap-2">
          {allMembers.map(m => (
            <button
              key={m.id}
              type="button"
              onClick={() => onVoteLeader(m.id)}
              className={`rounded-full border px-3 py-1 text-xs ${
                state.myLeaderVote === m.id ? 'border-primary bg-primary/10 text-primary' : 'border-input'
              }`}
            >
              {m.nickname}
              {m.id === state.me.id ? '（我）' : ''}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-lg border p-3">
        <h2 className="text-sm font-semibold">隊員草稿一覽</h2>
        {allMembers.map(m => (
          <div key={m.id} className="rounded-md bg-muted p-2 text-sm">
            <p className="text-xs font-medium text-muted-foreground">
              {m.nickname}
              {m.id === state.leaderId ? '（隊長）' : ''}
            </p>
            <p className="mt-1 whitespace-pre-wrap">{m.content || '（尚未撰寫）'}</p>
          </div>
        ))}
      </section>

      {isLeader
        ? (
            <section className="space-y-2 rounded-lg border border-primary p-3">
              <h2 className="text-sm font-semibold">整合送出（隊長專屬）</h2>
              <div className="flex flex-wrap gap-2">
                {allMembers.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={isSubmitted}
                    onClick={() => handleAdoptDraft(m.content)}
                    className="rounded-md border border-input px-2 py-1 text-xs disabled:opacity-50"
                  >
                    採用
                    {m.nickname}
                    的草稿
                  </button>
                ))}
              </div>
              <textarea
                value={finalAnswerBox.value}
                onChange={e => finalAnswerBox.handleChange(e.target.value)}
                rows={8}
                disabled={isSubmitted}
                placeholder="挑一份草稿當基底，微調後送出⋯"
                className={TEXTAREA_CLASS}
              />
              <p className="text-xs text-muted-foreground">
                {finalAnswerBox.status === 'saving' ? '儲存中⋯' : finalAnswerBox.status === 'saved' ? '已儲存' : ' '}
              </p>
              {isSubmitted
                ? <p className="text-sm font-medium text-emerald-600">✅ 已送出，等待老師進入下一階段</p>
                : (
                    <button
                      type="button"
                      onClick={handleSubmitFinal}
                      disabled={submitStatus === 'submitting'}
                      className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                    >
                      確認送出
                    </button>
                  )}
              {submitStatus === 'error' && <p className="text-xs text-destructive">送出失敗，請再試一次</p>}
            </section>
          )
        : (
            <section className="rounded-lg border p-3 text-sm text-muted-foreground">
              {isSubmitted
                ? '✅ 已送出，等待老師進入下一階段'
                : `隊長 ${allMembers.find(m => m.id === state.leaderId)?.nickname ?? ''} 正在整理最終答案⋯`}
            </section>
          )}
    </div>
  );
}
