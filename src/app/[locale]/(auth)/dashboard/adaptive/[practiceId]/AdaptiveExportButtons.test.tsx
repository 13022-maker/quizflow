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

  it('匯出成功時開新分頁並顯示可點擊的試算表連結，且 fetch 呼叫正確的 URL 與 method', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ url: 'https://docs.google.com/spreadsheets/d/xyz' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdaptiveExportButtons csvHref="/csv" sheetHref="/sheet" />);
    await userEvent.click(screen.getByRole('button', { name: /匯出到 Google Sheet/ }));

    // 斷言 fetch 實際呼叫的 URL 與 method，避免元件改成錯誤的 endpoint 或動詞時測試還誤判通過
    expect(fetchMock).toHaveBeenCalledWith('/sheet', { method: 'POST' });
    // 就算瀏覽器把這次 window.open 當成不在使用者手勢窗口內而擋掉，畫面上也要留一個可點的連結
    expect(await screen.findByRole('link', { name: /開啟試算表/ })).toHaveAttribute(
      'href',
      'https://docs.google.com/spreadsheets/d/xyz',
    );
    expect(openSpy).toHaveBeenCalledWith('https://docs.google.com/spreadsheets/d/xyz', '_blank', 'noopener');

    openSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('後端回 409 時顯示提示，點「重新連接」呼叫 openUserProfile 帶正確 scope', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409 });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdaptiveExportButtons csvHref="/csv" sheetHref="/sheet" />);
    await userEvent.click(screen.getByRole('button', { name: /匯出到 Google Sheet/ }));

    expect(fetchMock).toHaveBeenCalledWith('/sheet', { method: 'POST' });
    expect(await screen.findByText(/尚未連接 Google 帳號/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '重新連接' }));

    expect(openUserProfileMock).toHaveBeenCalledWith({
      additionalOAuthScopes: { google: ['https://www.googleapis.com/auth/spreadsheets'] },
    });

    vi.unstubAllGlobals();
  });

  it('其他錯誤時顯示「匯出失敗」', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdaptiveExportButtons csvHref="/csv" sheetHref="/sheet" />);
    await userEvent.click(screen.getByRole('button', { name: /匯出到 Google Sheet/ }));

    expect(fetchMock).toHaveBeenCalledWith('/sheet', { method: 'POST' });
    expect(await screen.findByText('匯出失敗，請重試')).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('從 done 狀態再次點擊匯出仍可正常運作（不會卡住）', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ url: 'https://docs.google.com/spreadsheets/d/xyz' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdaptiveExportButtons csvHref="/csv" sheetHref="/sheet" />);
    const button = screen.getByRole('button', { name: /匯出到 Google Sheet/ });

    await userEvent.click(button);

    expect(await screen.findByRole('link', { name: /開啟試算表/ })).toBeInTheDocument();

    // 再點一次應該重新走一次完整流程，而不是卡在 done 狀態
    await userEvent.click(button);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('link', { name: /開啟試算表/ })).toBeInTheDocument();

    openSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});
