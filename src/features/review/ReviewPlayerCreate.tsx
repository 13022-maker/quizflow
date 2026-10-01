'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ReviewTeamState } from '@/services/review/types';

const TEXTAREA_CLASS = 'w-full rounded-md border border-input bg-background px-3 py-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
const AUTOSAVE_DEBOUNCE_MS = 1500;

type ActionResult = { ok: true } | { ok: false; error: string };

// 後端錯誤碼轉成學生看得懂的繁中訊息；不在表上的字串（例如 Zod 的「草稿最多 2000 字」）
// 本身就已經是可讀的繁中，直接原樣顯示
const SAVE_ERROR_MESSAGES: Record<string, string> = {
  NOT_TEAM_LEADER: '你已經不是隊長了，請重新整理頁面',
  ALREADY_SUBMITTED: '已經送出過了',
  NOT_CREATING_PHASE: '目前不在創作階段，無法儲存',
};

function saveErrorText(error: string): string {
  return SAVE_ERROR_MESSAGES[error] ?? error;
}

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
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // flush() 必須存「當下最新」的內容，用 ref 同步避免抓到舊的 closure 值
  const valueRef = useRef(initialValue);

  // 回傳給外部的 setValue：維持 referential stable，才能安全放進 useEffect 依賴陣列
  const setValueSynced = useCallback((next: string) => {
    valueRef.current = next;
    setValue(next);
  }, []);

  const handleChange = (next: string) => {
    setValueSynced(next);
    setStatus('idle');
    setError(null); // 每次輸入先清掉上一次的錯誤提示
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(async () => {
      timerRef.current = null;
      setStatus('saving');
      const result = await onSave(next);
      setStatus(result.ok ? 'saved' : 'idle');
      setError(result.ok ? null : result.error);
    }, AUTOSAVE_DEBOUNCE_MS);
  };

  // 取消還在等待的 debounce，立刻把當前內容存一次並回傳結果。
  // 給「打完字馬上按送出」用：不先 flush 的話最後一段編輯會卡在 debounce 裡，
  // 等送出鎖定後才觸發，然後被 ALREADY_SUBMITTED 擋掉而遺失。
  const flush = async (): Promise<ActionResult> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setStatus('saving');
    const result = await onSave(valueRef.current);
    setStatus(result.ok ? 'saved' : 'idle');
    setError(result.ok ? null : result.error);
    return result;
  };

  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
  }, []);

  return { value, setValue: setValueSynced, status, error, handleChange, flush };
}

export function ReviewPlayerCreate({ state, onSaveDraft, onVoteLeader, onSaveFinalAnswer, onSubmitFinal }: Props) {
  const isLeader = state.leaderId === state.me.id;
  const isSubmitted = state.submission?.submittedAt != null;

  const myDraftBox = useAutosaveTextarea(state.myDraft, onSaveDraft);
  const finalAnswerBox = useAutosaveTextarea(state.submission?.content ?? '', onSaveFinalAnswer);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'submitting' | 'error'>('idle');
  // 送出成功後下一次輪詢（最多 2 秒）才會把 submittedAt 帶回來，這段空窗期先用本地旗標
  // 當成已鎖定，否則按鈕還在、再按一次就會跳假的「送出失敗」
  const [justSubmitted, setJustSubmitted] = useState(false);
  const showSubmitted = isSubmitted || justSubmitted;

  const serverFinalAnswer = state.submission?.content ?? '';
  const resyncFinalAnswer = finalAnswerBox.setValue;
  const wasLeaderRef = useRef(isLeader);

  // 隊長中途換人時，新隊長本地的文字框還停在 mount 當下的值（通常是空字串），
  // 直接送出會蓋掉前任隊長已整合好的內容。只在「剛從非隊長變成隊長」那一刻把文字框
  // 同步成 DB 現值；已經是隊長時不同步，否則每次輪詢都會蓋掉他正在打的字。
  useEffect(() => {
    const justPromoted = isLeader && !wasLeaderRef.current;
    wasLeaderRef.current = isLeader;
    if (justPromoted) {
      // 只改畫面上的值，不呼叫 handleChange，避免多打一次沒必要的寫入
      resyncFinalAnswer(serverFinalAnswer);
    }
  }, [isLeader, serverFinalAnswer, resyncFinalAnswer]);

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
    // 先把 debounce 裡還沒寫進 DB 的最後一段編輯存掉，再送出鎖定
    const flushed = await finalAnswerBox.flush();
    if (!flushed.ok) {
      // 存檔失敗就不送出（錯誤原因已由 finalAnswerBox.error 顯示在狀態列）
      setSubmitStatus('error');
      return;
    }
    const result = await onSubmitFinal();
    if (!result.ok) {
      setSubmitStatus('error');
      return;
    }
    setJustSubmitted(true);
    setSubmitStatus('idle');
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
        <p className={`text-xs ${myDraftBox.error ? 'text-destructive' : 'text-muted-foreground'}`}>
          {myDraftBox.error
            ? `⚠️ ${saveErrorText(myDraftBox.error)}`
            : myDraftBox.status === 'saving' ? '儲存中⋯' : myDraftBox.status === 'saved' ? '已儲存' : ' '}
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
                    disabled={showSubmitted || !m.content}
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
                disabled={showSubmitted}
                placeholder="挑一份草稿當基底，微調後送出⋯"
                className={TEXTAREA_CLASS}
              />
              <p className={`text-xs ${finalAnswerBox.error ? 'text-destructive' : 'text-muted-foreground'}`}>
                {finalAnswerBox.error
                  ? `⚠️ ${saveErrorText(finalAnswerBox.error)}`
                  : finalAnswerBox.status === 'saving' ? '儲存中⋯' : finalAnswerBox.status === 'saved' ? '已儲存' : ' '}
              </p>
              {showSubmitted
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
              {showSubmitted
                ? '✅ 已送出，等待老師進入下一階段'
                : `隊長 ${allMembers.find(m => m.id === state.leaderId)?.nickname ?? ''} 正在整理最終答案⋯`}
            </section>
          )}
    </div>
  );
}
