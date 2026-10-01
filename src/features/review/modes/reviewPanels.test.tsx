// 前後端契約測試：學生端三種批閱題型面板實際點擊後送出的 responseData，
// 必須通過 server 端同一題型 handler 的 responseSchema（否則學生按送出只會看到 400）。
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { getModeHandler } from '@/services/review/modes';
import type { ReviewSampleForClient } from '@/services/review/types';

import { ErrorSpotReviewPanel } from './ErrorSpotMode';
import { JudgmentReviewPanel } from './JudgmentMode';
import { RankingReviewPanel } from './RankingMode';
import type { ReviewPanelProps } from './types';

function baseProps(sample: ReviewSampleForClient, onSubmit: ReviewPanelProps['onSubmit']): ReviewPanelProps {
  return {
    sample,
    sampleCount: 3,
    myResponse: null,
    myComment: null,
    myResponsesBySample: {},
    teammates: [],
    onSubmit,
    submitting: false,
  };
}

function expectAcceptedByServer(mode: 'judgment' | 'error_spot' | 'ranking', payload: unknown) {
  const parsed = getModeHandler(mode).responseSchema!.safeParse(payload);

  expect(parsed.success).toBe(true);
}

describe('學生端批閱面板 → server responseSchema 契約', () => {
  it('對錯判斷：選「有錯」+ 第 2 個錯因送出 → {isCorrect:false, reasonIndex:1}', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    const sample = { id: 7, content: '250×40=100 公升', orderIndex: 0, isAiAnswer: false, clientData: { reasonOptions: ['計算錯誤', '單位換算錯'] } };
    render(<JudgmentReviewPanel {...baseProps(sample, onSubmit)} />);

    await userEvent.click(screen.getByRole('button', { name: /有錯/ }));
    await userEvent.click(screen.getByRole('radio', { name: '單位換算錯' }));
    await userEvent.click(screen.getByRole('button', { name: '送出判斷' }));

    expect(onSubmit).toHaveBeenCalledWith({ isCorrect: false, reasonIndex: 1 }, null);

    expectAcceptedByServer('judgment', onSubmit.mock.calls[0]![0]);
  });

  it('挑錯標註：點第 3 句送出 → {selectedSegmentIndexes:[2]}', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    const sample = { id: 8, content: '', orderIndex: 0, isAiAnswer: false, clientData: { segments: ['我先算面積。', '長乘寬等於 20。', '所以周長是 20。'] } };
    render(<ErrorSpotReviewPanel {...baseProps(sample, onSubmit)} />);

    await userEvent.click(screen.getByRole('button', { name: /所以周長是 20/ }));
    await userEvent.click(screen.getByRole('button', { name: '送出作答' }));

    expect(onSubmit).toHaveBeenCalledWith({ selectedSegmentIndexes: [2] }, null);

    expectAcceptedByServer('error_spot', onSubmit.mock.calls[0]![0]);
  });

  it('排序比較：選第 2 名並寫短評送出 → {rank:2}', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    const sample = { id: 9, content: '普通的答案', orderIndex: 0, isAiAnswer: false, clientData: null };
    render(<RankingReviewPanel {...baseProps(sample, onSubmit)} />);

    await userEvent.click(screen.getByRole('radio', { name: '2' }));
    await userEvent.type(screen.getByPlaceholderText(/為什麼排這個名次/), '細節不夠');
    await userEvent.click(screen.getByRole('button', { name: '送出名次' }));

    expect(onSubmit).toHaveBeenCalledWith({ rank: 2 }, '細節不夠');

    expectAcceptedByServer('ranking', onSubmit.mock.calls[0]![0]);
  });
});
