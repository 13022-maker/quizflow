import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const openUserProfileMock = vi.fn();
vi.mock('@clerk/nextjs', () => ({
  useClerk: () => ({ openUserProfile: openUserProfileMock }),
}));

// eslint-disable-next-line import/first -- mock 必須在 import 目標元件之前設定好
import { AdaptiveExportButtons } from './AdaptiveExportButtons';

describe('AdaptiveExportButtons', () => {
  beforeEach(() => {
    openUserProfileMock.mockClear();
  });

  it('下載 CSV 是一般連結，href 與 download 屬性正確', () => {
    render(<AdaptiveExportButtons csvHref="/api/x/export-csv" sheetHref="/api/x/export-sheet" />);

    const link = screen.getByRole('link', { name: /下載 CSV/ });

    expect(link).toHaveAttribute('href', '/api/x/export-csv');
    expect(link).toHaveAttribute('download');
  });

  it('匯出成功時開新分頁顯示試算表', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ url: 'https://docs.google.com/spreadsheets/d/xyz' }),
    }));

    render(<AdaptiveExportButtons csvHref="/csv" sheetHref="/sheet" />);
    await userEvent.click(screen.getByRole('button', { name: /匯出到 Google Sheet/ }));

    expect(openSpy).toHaveBeenCalledWith('https://docs.google.com/spreadsheets/d/xyz', '_blank');

    openSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('後端回 409 時顯示提示，點「重新連接」呼叫 openUserProfile 帶正確 scope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409 }));

    render(<AdaptiveExportButtons csvHref="/csv" sheetHref="/sheet" />);
    await userEvent.click(screen.getByRole('button', { name: /匯出到 Google Sheet/ }));

    expect(await screen.findByText(/尚未連接 Google 帳號/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '重新連接' }));

    expect(openUserProfileMock).toHaveBeenCalledWith({
      additionalOAuthScopes: { google: ['https://www.googleapis.com/auth/spreadsheets'] },
    });

    vi.unstubAllGlobals();
  });

  it('其他錯誤時顯示「匯出失敗」', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    render(<AdaptiveExportButtons csvHref="/csv" sheetHref="/sheet" />);
    await userEvent.click(screen.getByRole('button', { name: /匯出到 Google Sheet/ }));

    expect(await screen.findByText('匯出失敗，請重試')).toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
