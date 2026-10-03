// 開 Live Mode 選玩法對話框：經典預設（呼叫參數與原本一鍵開場完全相同）、搶答帶組數、錯誤顯示在框內
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { LiveStartDialog } from './LiveStartDialog';

const push = vi.fn();
const createLiveGame = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/actions/liveActions', () => ({ createLiveGame: (...args: unknown[]) => createLiveGame(...args) }));

describe('LiveStartDialog', () => {
  beforeEach(() => {
    push.mockReset();
    createLiveGame.mockReset();
  });

  it('預設經典模式：直接按開始 → createLiveGame({ quizId }) 並導向主控台', async () => {
    createLiveGame.mockResolvedValue({ ok: true, gameId: 42, gamePin: 'ABC123' });
    render(<LiveStartDialog quizId={7} onClose={() => {}} />);

    expect(screen.getByRole('radio', { name: /經典模式/ })).toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: '開始' }));

    expect(createLiveGame).toHaveBeenCalledWith({ quizId: 7 });
    expect(push).toHaveBeenCalledWith('/dashboard/live/host/42');
  });

  it('小組搶答：預設 4 組，＋ 兩次 → 6 組，最多 8 組', async () => {
    createLiveGame.mockResolvedValue({ ok: true, gameId: 43, gamePin: 'ABC124' });
    render(<LiveStartDialog quizId={7} onClose={() => {}} />);

    await userEvent.click(screen.getByRole('radio', { name: /小組搶答/ }));

    expect(screen.getByText('4 組')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '增加組數' }));
    await userEvent.click(screen.getByRole('button', { name: '增加組數' }));
    await userEvent.click(screen.getByRole('button', { name: '開始' }));

    // 4 + 1 + 1 = 6
    expect(createLiveGame).toHaveBeenCalledWith({ quizId: 7, gameMode: 'team_buzzer', teamCount: 6 });
  });

  it('組數下限 2：減到 2 後按鈕停用', async () => {
    render(<LiveStartDialog quizId={7} onClose={() => {}} />);
    await userEvent.click(screen.getByRole('radio', { name: /小組搶答/ }));
    const minus = screen.getByRole('button', { name: '減少組數' });
    await userEvent.click(minus);
    await userEvent.click(minus);

    // 4 − 1 − 1 = 2
    expect(screen.getByText('2 組')).toBeInTheDocument();
    expect(minus).toBeDisabled();
  });

  it('建立失敗：錯誤訊息顯示在對話框內，不導頁', async () => {
    createLiveGame.mockResolvedValue({ error: '此測驗沒有可用於小組搶答的題目（僅支援單選、複選、是非題，聽力題不適用）' });
    render(<LiveStartDialog quizId={7} onClose={() => {}} />);
    await userEvent.click(screen.getByRole('radio', { name: /小組搶答/ }));
    await userEvent.click(screen.getByRole('button', { name: '開始' }));

    expect(screen.getByText(/沒有可用於小組搶答的題目/)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
