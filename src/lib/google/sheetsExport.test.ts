import { describe, expect, it, vi } from 'vitest';

import { createGoogleSheet, GoogleSheetsError } from './sheetsExport';

describe('createGoogleSheet', () => {
  it('建立試算表並寫入資料，回傳 spreadsheetUrl', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          spreadsheetId: 'abc123',
          spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/abc123',
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const result = await createGoogleSheet(
      'token',
      '測試表',
      ['姓名'],
      [['小明']],
      fetchFn as unknown as typeof fetch,
    );

    expect(result).toEqual({ spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/abc123' });
    expect(fetchFn).toHaveBeenCalledTimes(2);

    // 第一次呼叫：建立試算表
    const [createUrl, createInit] = fetchFn.mock.calls[0]!;

    expect(createUrl).toBe('https://sheets.googleapis.com/v4/spreadsheets');
    expect(createInit.method).toBe('POST');
    expect(JSON.parse(createInit.body)).toEqual({ properties: { title: '測試表' } });

    // 第二次呼叫：寫入資料，帶正確的 spreadsheetId 與 range
    const [updateUrl, updateInit] = fetchFn.mock.calls[1]!;

    expect(updateUrl).toBe(
      'https://sheets.googleapis.com/v4/spreadsheets/abc123/values/A1?valueInputOption=RAW',
    );
    expect(updateInit.method).toBe('PUT');
    expect(JSON.parse(updateInit.body).values).toEqual([['姓名'], ['小明']]);
  });

  it('建立試算表失敗時 throw GoogleSheetsError 並帶狀態碼', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'insufficient scope',
    });

    await expect(
      createGoogleSheet('token', '測試表', ['姓名'], [], fetchFn as unknown as typeof fetch),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('寫入資料失敗時也 throw GoogleSheetsError', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          spreadsheetId: 'abc123',
          spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/abc123',
        }),
      })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'server error' });

    await expect(
      createGoogleSheet('token', '測試表', ['姓名'], [], fetchFn as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(GoogleSheetsError);
  });
});
