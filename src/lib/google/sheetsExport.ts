/**
 * Google Sheets API v4 直接 REST 呼叫（不裝 googleapis 套件，理由見 plan Global Constraints）。
 * accessToken 由呼叫端（export-sheet route）透過 Clerk 拿到，這裡只負責建表與寫入。
 */

export class GoogleSheetsError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GoogleSheetsError';
    this.status = status;
  }
}

export type GoogleSheetResult = { spreadsheetUrl: string };

type CreateSpreadsheetResponse = { spreadsheetId: string; spreadsheetUrl: string };

export async function createGoogleSheet(
  accessToken: string,
  title: string,
  header: string[],
  rows: string[][],
  fetchFn: typeof fetch = fetch,
): Promise<GoogleSheetResult> {
  const createRes = await fetchFn('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ properties: { title } }),
  });
  if (!createRes.ok) {
    const errBody = await createRes.text();
    throw new GoogleSheetsError(createRes.status, `建立試算表失敗：${errBody.slice(0, 300)}`);
  }
  const created = await createRes.json() as CreateSpreadsheetResponse;

  const updateRes = await fetchFn(
    `https://sheets.googleapis.com/v4/spreadsheets/${created.spreadsheetId}/values/A1?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ range: 'A1', majorDimension: 'ROWS', values: [header, ...rows] }),
    },
  );
  if (!updateRes.ok) {
    const errBody = await updateRes.text();
    throw new GoogleSheetsError(updateRes.status, `寫入試算表資料失敗：${errBody.slice(0, 300)}`);
  }

  return { spreadsheetUrl: created.spreadsheetUrl };
}
