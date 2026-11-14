// 學生端搶答畫面：各狀態下搶答鈕可不可以按、顯示什麼文字。
// 時間以 state.buzzer.serverNow 為準（元件用 useServerNow 校正），所以只要讓題目開始時間
// 相對 serverNow 前後移動就能決定狀態，不需要 fake timers。
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import type { LiveBuzzEntry, LivePlayerState } from '@/services/live/types';

import { LiveBuzzerPlayer } from './LiveBuzzerPlayer';

const SERVER_NOW = Date.parse('2026-10-03T08:00:30.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

const ME = 11;
const TEAMMATE = 12;

function entry(p: Partial<LiveBuzzEntry> & Pick<LiveBuzzEntry, 'teamId' | 'playerId' | 'result' | 'order'>): LiveBuzzEntry {
  const grantedMs = p.result === 'answering' ? SERVER_NOW - 5_000 : null; // 已作答 5 秒 → 剩 15 − 5 = 10 秒
  return {
    id: p.order,
    teamName: `第 ${p.teamId} 組`,
    nickname: `p${p.playerId}`,
    buzzedAt: iso(SERVER_NOW - 6_000),
    answerGrantedAt: grantedMs ? iso(grantedMs) : null,
    answerDeadlineAt: grantedMs ? iso(grantedMs + 15_000) : null,
    ...p,
  };
}

function makeState(opts: {
  startedAgoMs: number;
  buzzes?: LiveBuzzEntry[];
  status?: LivePlayerState['game']['status'];
  myTeamId?: number | null;
  correctAnswers?: string[];
}): LivePlayerState {
  const myTeamId = opts.myTeamId === undefined ? 1 : opts.myTeamId;
  return {
    game: {
      id: 1,
      title: '搶答測驗',
      status: opts.status ?? 'playing',
      gameMode: 'team_buzzer',
      currentQuestionIndex: 0,
      questionStartedAt: iso(SERVER_NOW - opts.startedAgoMs),
      questionDuration: 20,
      totalQuestions: 3,
    },
    me: { id: ME, nickname: `p${ME}`, score: 0, correctCount: 0, rank: 1 },
    currentQuestion: {
      id: 101,
      type: 'single_choice',
      body: '台灣最高的山是？',
      imageUrl: null,
      audioUrl: null,
      audioDurationSec: null,
      options: [{ id: 'a', text: '雪山' }, { id: 'b', text: '玉山' }],
    },
    myAnswer: null,
    lastResult: opts.correctAnswers ? { correctAnswers: opts.correctAnswers, answerStats: [] } : null,
    leaderboard: [],
    buzzer: {
      serverNow: iso(SERVER_NOW),
      readingMs: 3_000,
      answerMs: 15_000,
      teams: [
        { id: 1, name: '第 1 組', orderIndex: 0, score: 50, members: [] },
        { id: 2, name: '第 2 組', orderIndex: 1, score: -50, members: [] },
      ],
      myTeam: myTeamId === null ? null : { id: 1, name: '第 1 組', score: 50 },
      buzzes: opts.buzzes ?? [],
      myStats: { buzzWonCount: 0, buzzCorrectCount: 0 },
    },
  };
}

function renderPlayer(state: LivePlayerState, onBuzz = vi.fn().mockResolvedValue({ ok: true })) {
  const onAnswer = vi.fn().mockResolvedValue({ ok: true });
  render(<LiveBuzzerPlayer state={state} onBuzz={onBuzz} onAnswer={onAnswer} busy={false} />);
  return { onBuzz, onAnswer };
}

const buzzButton = () => screen.getByTestId('buzz-button');
const status = () => screen.getByTestId('buzz-status');

describe('學生搶答鈕各狀態', () => {
  it('顯示我是第幾組與組分', () => {
    renderPlayer(makeState({ startedAgoMs: 10_000 }));

    expect(screen.getByText('第 1 組')).toBeInTheDocument();
    expect(screen.getByText(/組分\s*50/)).toBeInTheDocument();
  });

  it('看題倒數中：灰色不可按，顯示秒數（開始 1 秒 → 剩 3 − 1 = 2 秒）', () => {
    renderPlayer(makeState({ startedAgoMs: 1_000 }));

    expect(buzzButton()).toBeDisabled();
    expect(buzzButton()).toHaveTextContent('看題中 2');
  });

  it('開放搶答：可按，按下呼叫 onBuzz(題目 id)', async () => {
    const { onBuzz } = renderPlayer(makeState({ startedAgoMs: 10_000 }));

    expect(buzzButton()).toBeEnabled();
    expect(buzzButton()).toHaveTextContent('搶答！');

    await userEvent.click(buzzButton());

    expect(onBuzz).toHaveBeenCalledWith(101);
  });

  it('他組作答中、我組還沒搶：仍可按（排隊）', () => {
    renderPlayer(makeState({ startedAgoMs: 10_000, buzzes: [entry({ teamId: 2, playerId: 21, result: 'answering', order: 1 })] }));

    // 第 2 組已作答 5 秒 → 剩 15 − 5 = 10 秒
    expect(status()).toHaveTextContent('第 2 組正在作答⋯（剩 10 秒）');
    expect(buzzButton()).toBeEnabled();
    expect(buzzButton()).toHaveTextContent('搶答排隊');
  });

  it('我組已搶、排隊第 1：不可按', () => {
    renderPlayer(makeState({
      startedAgoMs: 10_000,
      buzzes: [
        entry({ teamId: 2, playerId: 21, result: 'answering', order: 1 }),
        entry({ teamId: 1, playerId: TEAMMATE, result: 'queued', order: 2 }),
      ],
    }));

    expect(buzzButton()).toBeDisabled();
    expect(buzzButton()).toHaveTextContent('第 2 個搶到');
    expect(status()).toHaveTextContent('你們是第 2 個搶到，等待第 2 組作答');
    expect(status()).toHaveTextContent('前一組答錯或逾時，就輪到你們作答');
  });

  it('隊友搶到正在作答：不可按、看不到選項', () => {
    renderPlayer(makeState({ startedAgoMs: 10_000, buzzes: [entry({ teamId: 1, playerId: TEAMMATE, result: 'answering', order: 1 })] }));

    expect(buzzButton()).toBeDisabled();
    expect(status()).toHaveTextContent('輪到你們作答！p12 正在作答（剩 10 秒）');
    expect(screen.queryByRole('button', { name: /玉山/ })).not.toBeInTheDocument();
  });

  it('我是作答者：顯示選項與倒數，選完送出呼叫 onAnswer', async () => {
    const { onAnswer } = renderPlayer(makeState({ startedAgoMs: 10_000, buzzes: [entry({ teamId: 1, playerId: ME, result: 'answering', order: 1 })] }));

    expect(screen.queryByTestId('buzz-button')).not.toBeInTheDocument();
    expect(screen.getByText('🙋 輪到你們作答！')).toBeInTheDocument();
    expect(screen.getByText('由你代表第 1 組作答，答對 +100、答錯 −50')).toBeInTheDocument();
    expect(screen.getByText(/剩 10 秒/)).toBeInTheDocument();

    const submit = screen.getByRole('button', { name: '送出答案' });

    expect(submit).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: /玉山/ }));
    await userEvent.click(submit);

    expect(onAnswer).toHaveBeenCalledWith(101, 'b');
  });

  it('我組已答錯：不可按', () => {
    renderPlayer(makeState({ startedAgoMs: 30_000, buzzes: [entry({ teamId: 1, playerId: ME, result: 'wrong', order: 1 })] }));

    expect(buzzButton()).toBeDisabled();
    expect(status()).toHaveTextContent('你們答錯了 −50，等待其他組');
  });

  it('揭曉：顯示正解與答對的組，不可按', () => {
    renderPlayer(makeState({
      startedAgoMs: 30_000,
      status: 'showing_result',
      correctAnswers: ['b'],
      buzzes: [entry({ teamId: 2, playerId: 21, result: 'correct', order: 1 })],
    }));

    expect(buzzButton()).toBeDisabled();
    expect(status()).toHaveTextContent('🎉 第 2 組答對！+100');
    expect(screen.getByText(/正解：B\. 玉山/)).toBeInTheDocument();
  });

  it('還沒分組：不可按並提示', () => {
    renderPlayer(makeState({ startedAgoMs: 10_000, myTeamId: null }));

    expect(buzzButton()).toBeDisabled();
    expect(screen.getByText(/分組中/)).toBeInTheDocument();
  });

  it('按下搶答：server 還沒回應前就鎖住並顯示「已按下，等待確認」（樂觀狀態）', async () => {
    const pending = vi.fn(() => new Promise<{ ok: true }>(() => {})); // 永遠不回應
    renderPlayer(makeState({ startedAgoMs: 10_000 }), pending);

    await userEvent.click(buzzButton());

    expect(pending).toHaveBeenCalledTimes(1);
    expect(buzzButton()).toBeDisabled();
    expect(buzzButton()).toHaveTextContent('確認中⋯');
    expect(status()).toHaveTextContent('已按下，等待確認⋯');
  });

  it('搶答被拒：解鎖按鈕並顯示原因', async () => {
    const rejected = vi.fn().mockResolvedValue({ ok: false, error: '看題時間還沒結束，3 秒後才能搶答' });
    renderPlayer(makeState({ startedAgoMs: 10_000 }), rejected);

    await userEvent.click(buzzButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('看題時間還沒結束，3 秒後才能搶答');
    expect(buzzButton()).toBeEnabled();
    expect(buzzButton()).toHaveTextContent('搶答！');
  });
});

describe('學生端即時搶答順序與提示', () => {
  it('列出全部搶答順序（第 1 / 2 / 3），標出自己這組', () => {
    renderPlayer(makeState({
      startedAgoMs: 10_000,
      buzzes: [
        entry({ teamId: 2, playerId: 21, result: 'answering', order: 1 }),
        entry({ teamId: 1, playerId: TEAMMATE, result: 'queued', order: 2 }),
        entry({ teamId: 3, playerId: 31, result: 'queued', order: 3 }),
      ],
    }));

    const items = within(screen.getByTestId('buzz-order-list')).getAllByTestId('buzz-order-item');

    expect(items.map(li => li.textContent)).toEqual([
      '第 1第 2 組p21作答中',
      '第 2第 1 組（你們）p12排隊中',
      '第 3第 3 組p31排隊中',
    ]);
  });

  it('看題倒數中不顯示搶答順序', () => {
    renderPlayer(makeState({ startedAgoMs: 1_000 }));

    expect(screen.queryByLabelText('搶答順序')).not.toBeInTheDocument();
  });

  it('他組答錯、作答權交給下一組 → 最新動態「第 2 組答錯 −50，換第 3 組作答」', () => {
    renderPlayer(makeState({
      startedAgoMs: 30_000,
      buzzes: [
        entry({ teamId: 2, playerId: 21, result: 'wrong', order: 1 }),
        entry({ teamId: 3, playerId: 31, result: 'answering', order: 2 }),
      ],
    }));

    expect(screen.getByTestId('buzz-feed')).toHaveTextContent('第 2 組答錯 −50，換第 3 組作答');
    expect(status()).toHaveTextContent('第 3 組正在作答⋯（剩 10 秒）');
  });

  it('他組答錯、沒人排隊 → 「第 2 組答錯 −50，重新開放搶答！」且可以搶', () => {
    renderPlayer(makeState({ startedAgoMs: 30_000, buzzes: [entry({ teamId: 2, playerId: 21, result: 'wrong', order: 1 })] }));

    expect(screen.getByTestId('buzz-feed')).toHaveTextContent('第 2 組答錯 −50，重新開放搶答！');
    expect(buzzButton()).toBeEnabled();
  });

  it('前一組逾時、輪到我們 → 「第 2 組逾時 −50，換你們作答」＋作答區', () => {
    renderPlayer(makeState({
      startedAgoMs: 30_000,
      buzzes: [
        entry({ teamId: 2, playerId: 21, result: 'timeout', order: 1 }),
        entry({ teamId: 1, playerId: ME, result: 'answering', order: 2 }),
      ],
    }));

    expect(screen.getByTestId('buzz-feed')).toHaveTextContent('第 2 組逾時 −50，換你們作答');
    expect(screen.getByRole('button', { name: '送出答案' })).toBeInTheDocument();
  });

  it('我組答錯、作答權交給第 2 組 → 「你們答錯了 −50，換第 2 組作答」', () => {
    renderPlayer(makeState({
      startedAgoMs: 30_000,
      buzzes: [
        entry({ teamId: 1, playerId: ME, result: 'wrong', order: 1 }),
        entry({ teamId: 2, playerId: 21, result: 'answering', order: 2 }),
      ],
    }));

    expect(status()).toHaveTextContent('你們答錯了 −50，換第 2 組作答');
    expect(screen.queryByTestId('buzz-feed')).not.toBeInTheDocument(); // 不重複顯示
  });

  it('我組答對 → 「你們答對了！+100」', () => {
    renderPlayer(makeState({
      startedAgoMs: 30_000,
      status: 'showing_result',
      correctAnswers: ['b'],
      buzzes: [entry({ teamId: 1, playerId: ME, result: 'correct', order: 1 })],
    }));

    expect(status()).toHaveTextContent('🎉 你們答對了！+100');
  });

  it('我組答錯、別組答對 → 揭曉時一併提醒我組 −50', () => {
    renderPlayer(makeState({
      startedAgoMs: 30_000,
      status: 'showing_result',
      correctAnswers: ['b'],
      buzzes: [
        entry({ teamId: 1, playerId: ME, result: 'wrong', order: 1 }),
        entry({ teamId: 2, playerId: 21, result: 'correct', order: 2 }),
      ],
    }));

    expect(status()).toHaveTextContent('🎉 第 2 組答對！+100（你們這題答錯 −50）');
  });
});
