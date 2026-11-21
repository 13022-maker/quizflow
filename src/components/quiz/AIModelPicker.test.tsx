// 出題 AI 模型選擇器：非 Pro（Free）時 Claude 選項 disabled + Pro 徽章，
// 避免 Free 選了 Claude 卻被 server（canUseClaude）靜默改走 Gemini；顯示名稱需與實際呼叫的模型一致
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { AIModelPicker } from './AIModelPicker';

describe('AIModelPicker', () => {
  it('顯示名稱與實際呼叫的模型一致（gemini-2.5-flash / claude-sonnet-4-6）', () => {
    render(<AIModelPicker isPro value="gemini" onChange={() => {}} />);

    expect(screen.getByRole('button', { name: /Gemini 2\.5 Flash/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Claude Sonnet 4\.6/ })).toBeInTheDocument();
  });

  it('Pro（含試用）：Claude 可選，點擊回傳 claude', async () => {
    const onChange = vi.fn();
    render(<AIModelPicker isPro value="gemini" onChange={onChange} />);

    const claude = screen.getByRole('button', { name: /Claude Sonnet 4\.6/ });

    expect(claude).toBeEnabled();

    await userEvent.click(claude);

    expect(onChange).toHaveBeenCalledWith('claude');
    expect(screen.queryByText('Pro 方案可選 Claude')).not.toBeInTheDocument();
  });

  it('Free：Claude disabled、顯示 Pro 徽章與說明，點擊不會切換', async () => {
    const onChange = vi.fn();
    render(<AIModelPicker isPro={false} value="gemini" onChange={onChange} />);

    const claude = screen.getByRole('button', { name: /Claude Sonnet 4\.6/ });

    expect(claude).toBeDisabled();
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByText('Pro 方案可選 Claude')).toBeInTheDocument();

    await userEvent.click(claude);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('Free 但 value 意外是 claude：畫面仍標示 Gemini 為選中', () => {
    render(<AIModelPicker isPro={false} value="claude" onChange={() => {}} />);

    expect(screen.getByRole('button', { name: /Gemini 2\.5 Flash/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Claude Sonnet 4\.6/ })).toHaveAttribute('aria-pressed', 'false');
  });
});
