# 適性學習匯出 Google Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 `/dashboard/adaptive/[practiceId]` 班級儀表板的「匯出班級成績」除了下載 CSV，也能一鍵建立一張新的 Google Sheet 並開啟。

**Architecture:** 借用 Clerk 既有的 Google 社群登入連線（方法 A，已與使用者確認），伺服器端用 Clerk 後端 SDK 取得該老師的 Google access token，直接呼叫 Google Sheets API v4（兩支 REST call：建立試算表 + 寫入資料），不引入 `googleapis` 套件。前端把匯出按鈕從單一 `<a>` 連結改成小型 client component，處理「Google 帳號未連接 Sheets 權限」的錯誤態並引導老師重新連接。

**Tech Stack:** Next.js 14 App Router、`@clerk/nextjs@^6.18.3`（`clerkClient().users.getUserOauthAccessToken` + `useClerk().openUserProfile`）、Drizzle ORM、Vitest + Testing Library。

**Spec:** `docs/superpowers/specs/2026-09-05-adaptive-export-google-sheet-design.md`

## Global Constraints

- 所有 API Route 最頂端加 `export const runtime = 'nodejs'`；所有回應用 `NextResponse.json()`（CLAUDE.md 規範）
- UI 文字、程式碼註解一律繁體中文；變數/函式/檔案名稱一律英文
- **不裝 `googleapis` npm 套件**——只需要兩支 REST call，直接 `fetch` 帶 `Authorization: Bearer <token>`，比照專案現有 Gemini/Claude 都是直接呼叫 REST API 的風格（`src/lib/ai/textModel.ts`）
- Google Sheets 讀寫 scope 固定字串：`https://www.googleapis.com/auth/spreadsheets`
- `clerkClient().users.getUserOauthAccessToken(userId, provider)` 的 `provider` 參數用純字串 `'google'`（**不是** `'oauth_google'`——那是 `OAuthStrategy`，只用在前端 `createExternalAccount`/`reauthorize` 這類發起 OAuth 導向的呼叫，跟後端讀 token 用的 provider 字串是兩回事，已對照 Clerk 官方文件範例確認）
- 回傳形狀是 `{ data: OauthAccessToken[] }`（`PaginatedResourceResponse`），要拿 `response.data[0]?.token`，不是直接回傳一個 token
- 本專案 `@clerk/nextjs@6.18.3` **沒有** export `@clerk/nextjs/types` 這個 subpath（已用 `node_modules` 實測確認），需要 Clerk 型別時改從 `@clerk/types` 引入
- 每次都建一張新的 Google Sheet（已與使用者確認，不做「固定更新同一張表」）
- 匯出要respect 現有的 `?start=&end=` 日期區間篩選（沿用 `src/libs/adaptive/dateRangeFilter.ts` 既有函式，不重寫）
- 本專案 route handler 一律沒有寫自動化測試（`export-csv/route.ts` 也沒有），跟 DB／Clerk／外部 API 耦合的部分維持這個慣例，用手動驗證取代；純函式（Sheets REST 呼叫組裝、React 元件互動）才寫 vitest／RTL 測試

---

### Task 1: 抽出共用的班級成績報表產生器

**Files:**
- Create: `src/libs/adaptive/classScoreReport.ts`
- Modify: `src/app/api/adaptive-practices/[practiceId]/export-csv/route.ts`

**Interfaces:**
- Produces: `buildClassScoreReport(practice: { id: number; subjectId: string }, dateRange: DateRange | null): Promise<{ header: string[]; rows: string[][] }>`（`DateRange` 型別 import 自既有的 `src/libs/adaptive/dateRangeFilter.ts`）
- Task 3（新的 export-sheet route）會 import 並使用這個函式

這是純粹的邏輯搬移（沒有行為變化），不寫新測試——原因見上面 Global Constraints；用「改動前後 CSV 輸出逐位元組相同」當驗證標準。

- [ ] **Step 1: 建立 `src/libs/adaptive/classScoreReport.ts`**

把 `export-csv/route.ts` 目前第 48–110 行「撈 states → 算診斷 → 依日期篩選 → 算分數 → 組 header/rows」的邏輯整段搬進來：

```ts
/**
 * 班級成績報表產生器 — CSV 匯出、Google Sheet 匯出共用
 * 只負責「撈資料 → 算分數 → 組成 header/rows 表格」，輸出格式（CSV 字串 / Sheets API）
 * 由呼叫端各自決定。
 */
import { eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { adaptiveStudentStateSchema } from '@/models/Schema';

import type { DateRange } from './dateRangeFilter';
import { filterActiveStudentKeys } from './dateRangeFilter';
import { getAdaptiveService } from './service';

// 知識點狀態中文標籤（與班級儀表板頁面 STATUS_META 對齊）
const STATUS_LABEL: Record<string, string> = {
  mastered: '已精熟',
  learning: '學習中',
  locked: '鎖定中',
};

export type ClassScoreReport = {
  header: string[];
  rows: string[][];
};

export async function buildClassScoreReport(
  practice: { id: number; subjectId: string },
  dateRange: DateRange | null,
): Promise<ClassScoreReport> {
  const service = await getAdaptiveService(practice.id, practice.subjectId);
  const states = await service.repo.list();
  const names = await service.repo.getDisplayNames();

  const students = await Promise.all(
    states.map(async s => ({
      studentKey: s.studentId,
      displayName: names.get(s.studentId) ?? s.studentId,
      diagnosis: await service.engine.getDiagnosis(s.studentId),
    })),
  );

  // 日期區間篩選（簡易版）：依 updated_at 判斷「這段期間有沒有活動過」
  const updatedAtRows = await db
    .select({
      studentKey: adaptiveStudentStateSchema.studentKey,
      updatedAt: adaptiveStudentStateSchema.updatedAt,
    })
    .from(adaptiveStudentStateSchema)
    .where(eq(adaptiveStudentStateSchema.practiceId, practice.id));
  const updatedAtByKey = new Map(updatedAtRows.map(r => [r.studentKey, r.updatedAt]));
  const activeKeys = filterActiveStudentKeys(updatedAtByKey, dateRange);
  const visibleStudents = activeKeys
    ? students.filter(s => activeKeys.has(s.studentKey))
    : students;

  // 知識點欄位以第一位學生的診斷排序為準（用未篩選的 students，避免篩選後
  // 第一位學生不同導致欄位順序跳動）
  const knowledgeColumns = students[0]?.diagnosis ?? [];

  // 學習後分數＝已解鎖知識點（已精熟＋學習中）的精熟度平均 ×100，排除鎖定中知識點
  const scoredStudents = visibleStudents.map((s) => {
    const unlocked = s.diagnosis.filter(d => d.status !== 'locked');
    return {
      ...s,
      score: unlocked.length > 0
        ? Math.round(
          (unlocked.reduce((sum, d) => sum + d.mastery, 0) / unlocked.length) * 100,
        )
        : null,
      totalAttempts: s.diagnosis.reduce((sum, d) => sum + d.attempts, 0),
    };
  });

  const header = ['姓名', '學號', ...knowledgeColumns.map(k => k.name), '學習後分數', '總作答次數'];
  const rows = scoredStudents.map((s) => {
    const knowledgeCells = s.diagnosis.map(d =>
      `${STATUS_LABEL[d.status] ?? d.status} ${Math.round(d.mastery * 100)}%（作答${d.attempts}次）`,
    );
    return [
      s.displayName,
      s.studentKey,
      ...knowledgeCells,
      s.score === null ? '—' : String(s.score),
      String(s.totalAttempts),
    ];
  });

  return { header, rows };
}
```

- [ ] **Step 2: 改寫 `export-csv/route.ts` 呼叫新函式**

把原本第 5、48–110 行的邏輯全部刪掉，改成：

```ts
import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { buildClassScoreReport } from '@/libs/adaptive/classScoreReport';
import { parseDateRangeParams } from '@/libs/adaptive/dateRangeFilter';
import { getAdaptiveService } from '@/libs/adaptive/service';
import { db } from '@/libs/DB';
import { adaptivePracticeSchema } from '@/models/Schema';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: { practiceId: string } },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  const practiceId = Number(params.practiceId);
  if (!Number.isInteger(practiceId)) {
    return NextResponse.json({ error: '無效的練習 ID' }, { status: 400 });
  }

  const [practice] = await db
    .select()
    .from(adaptivePracticeSchema)
    .where(
      and(
        eq(adaptivePracticeSchema.id, practiceId),
        eq(adaptivePracticeSchema.ownerId, userId),
      ),
    )
    .limit(1);

  if (!practice) {
    return NextResponse.json({ error: '找不到練習或無權限' }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const dateRange = parseDateRangeParams({
    start: searchParams.get('start') ?? undefined,
    end: searchParams.get('end') ?? undefined,
  });

  const { header, rows } = await buildClassScoreReport(practice, dateRange);
  const service = await getAdaptiveService(practice.id, practice.subjectId);

  const csvContent = [header, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const bom = '﻿';
  // 檔名同時帶練習標題與學科名稱（例如「資訊三戊_常數變數宣告_班級成績.csv」），
  // 避免同一班多個練習（不同單元）都叫同名檔案，下載後分不清楚是哪一份
  const safeTitle = practice.title.replace(/[^a-z0-9一-鿿]/gi, '_');
  // CJK Unified Ideographs: U+4E00-U+9FFF（同 safeTitle 的字元範圍，見 src/lib/cloze.ts CJK_PHRASE 前例）
  // eslint-disable-next-line regexp/no-obscure-range
  const safeSubject = service.subject.name.replace(/[^a-z0-9一-鿿]/gi, '_');
  const filename = `${safeTitle}_${safeSubject}_班級成績.csv`;

  return new Response(bom + csvContent, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
```

（`STATUS_LABEL` 常數已經搬進 `classScoreReport.ts`，這裡不用留一份重複的）

- [ ] **Step 3: 型別檢查與 lint**

Run: `npm run check-types && npx eslint --fix src/libs/adaptive/classScoreReport.ts "src/app/api/adaptive-practices/[practiceId]/export-csv/route.ts"`
Expected: 都沒有錯誤

- [ ] **Step 4: 手動驗證 CSV 輸出沒有跑掉**

```bash
npm run dev
```

瀏覽器登入後，開一個現有的適性練習儀表板頁（或用 UI 建一個新的、讓至少一位學生用 `/adaptive/<accessCode>` 加入），點「↓ 下載 CSV」，用文字編輯器打開下載的檔案，確認：
- 檔名格式仍是 `{練習標題}_{學科名稱}_班級成績.csv`
- 內容欄位（姓名、學號、各知識點欄、學習後分數、總作答次數）跟改動前一致
- 帶 `?start=&end=` 篩選時（點儀表板上的「本週」等快選）匯出的 CSV 只含篩選後的學生

- [ ] **Step 5: Commit**

```bash
git add src/libs/adaptive/classScoreReport.ts "src/app/api/adaptive-practices/[practiceId]/export-csv/route.ts"
git commit -m "refactor(adaptive): 抽出共用班級成績報表產生器 classScoreReport"
```

---

### Task 2: Google Sheets REST 客戶端

**Files:**
- Create: `src/lib/google/sheetsExport.ts`
- Test: `src/lib/google/sheetsExport.test.ts`

**Interfaces:**
- Consumes: 無（純函式，只依賴傳入的 `fetch` 實作）
- Produces:
  - `createGoogleSheet(accessToken: string, title: string, header: string[], rows: string[][], fetchFn?: typeof fetch): Promise<{ spreadsheetUrl: string }>`
  - `class GoogleSheetsError extends Error { status: number }`（Task 3 用 `err.status` 判斷是不是權限問題）

- [ ] **Step 1: 寫失敗測試**

建立 `src/lib/google/sheetsExport.test.ts`：

```ts
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
```

- [ ] **Step 2: 執行測試，確認失敗（模組還不存在）**

Run: `npx vitest run src/lib/google/sheetsExport.test.ts`
Expected: FAIL，錯誤訊息是找不到 `./sheetsExport` 模組

- [ ] **Step 3: 寫最小實作**

建立 `src/lib/google/sheetsExport.ts`：

```ts
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
      Authorization: `Bearer ${accessToken}`,
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
        Authorization: `Bearer ${accessToken}`,
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
```

- [ ] **Step 4: 執行測試，確認通過**

Run: `npx vitest run src/lib/google/sheetsExport.test.ts`
Expected: 3 個測試全部 PASS

- [ ] **Step 5: Lint + 型別檢查**

Run: `npx eslint --fix src/lib/google/sheetsExport.ts src/lib/google/sheetsExport.test.ts && npm run check-types`
Expected: 無錯誤

- [ ] **Step 6: Commit**

```bash
git add src/lib/google/sheetsExport.ts src/lib/google/sheetsExport.test.ts
git commit -m "feat(adaptive): 新增 Google Sheets REST 客戶端 createGoogleSheet"
```

---

### Task 3: 新增 export-sheet API route

**Files:**
- Create: `src/app/api/adaptive-practices/[practiceId]/export-sheet/route.ts`

**Interfaces:**
- Consumes:
  - `buildClassScoreReport` from Task 1（`src/libs/adaptive/classScoreReport.ts`）
  - `createGoogleSheet`、`GoogleSheetsError` from Task 2（`src/lib/google/sheetsExport.ts`）
  - `parseDateRangeParams`、`todayInTaipei` from 既有的 `src/libs/adaptive/dateRangeFilter.ts`
- Produces: `POST /api/adaptive-practices/[practiceId]/export-sheet?start=&end=`
  - 成功：`200 { url: string }`
  - 未連接／權限不足：`409 { error: 'GOOGLE_NOT_CONNECTED' }`
  - 其他：沿用 `export-csv` 既有的 401/400/404 錯誤格式；Sheets API 失敗回 `502 { error: string }`

此 route 依賴真實 Clerk session + DB，不寫自動化測試（跟 `export-csv/route.ts` 同慣例），用 Step 5 的手動驗證取代。

- [ ] **Step 1: 建立 route 檔案**

```ts
import { auth, clerkClient } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { buildClassScoreReport } from '@/libs/adaptive/classScoreReport';
import { parseDateRangeParams, todayInTaipei } from '@/libs/adaptive/dateRangeFilter';
import { getAdaptiveService } from '@/libs/adaptive/service';
import { db } from '@/libs/DB';
import { adaptivePracticeSchema } from '@/models/Schema';
import { createGoogleSheet, GoogleSheetsError } from '@/lib/google/sheetsExport';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: { practiceId: string } },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  const practiceId = Number(params.practiceId);
  if (!Number.isInteger(practiceId)) {
    return NextResponse.json({ error: '無效的練習 ID' }, { status: 400 });
  }

  const [practice] = await db
    .select()
    .from(adaptivePracticeSchema)
    .where(
      and(
        eq(adaptivePracticeSchema.id, practiceId),
        eq(adaptivePracticeSchema.ownerId, userId),
      ),
    )
    .limit(1);

  if (!practice) {
    return NextResponse.json({ error: '找不到練習或無權限' }, { status: 404 });
  }

  // 用 Clerk 既有的 Google 連線拿 access token；查無 token（從沒用 Google 登入過，
  // 或 scope 是舊的沒有 Sheets 權限）都算「未連接」，前端走同一套「重新連接」引導
  const clerk = await clerkClient();
  const tokenResponse = await clerk.users.getUserOauthAccessToken(userId, 'google');
  const accessToken = tokenResponse.data[0]?.token;
  if (!accessToken) {
    return NextResponse.json({ error: 'GOOGLE_NOT_CONNECTED' }, { status: 409 });
  }

  const { searchParams } = new URL(request.url);
  const dateRange = parseDateRangeParams({
    start: searchParams.get('start') ?? undefined,
    end: searchParams.get('end') ?? undefined,
  });

  const { header, rows } = await buildClassScoreReport(practice, dateRange);
  const service = await getAdaptiveService(practice.id, practice.subjectId);
  const title = `${practice.title}_${service.subject.name}_班級成績_${todayInTaipei()}`;

  try {
    const { spreadsheetUrl } = await createGoogleSheet(accessToken, title, header, rows);
    return NextResponse.json({ url: spreadsheetUrl });
  } catch (err) {
    if (err instanceof GoogleSheetsError && (err.status === 401 || err.status === 403)) {
      // token 存在但權限不足（scope 還沒補簽）→ 跟查無 token 走同一套「重新連接」流程
      return NextResponse.json({ error: 'GOOGLE_NOT_CONNECTED' }, { status: 409 });
    }
    console.error('[export-sheet] Google Sheets API 失敗', err);
    return NextResponse.json({ error: '匯出失敗，請重試' }, { status: 502 });
  }
}
```

- [ ] **Step 2: 型別檢查與 lint**

Run: `npm run check-types && npx eslint --fix "src/app/api/adaptive-practices/[practiceId]/export-sheet/route.ts"`
Expected: 無錯誤

- [ ] **Step 3: `npm run build` 確認新 route 能被 Next.js 正確辨識**

Run: `npm run build`
Expected: build 成功，輸出的路由列表包含 `ƒ /api/adaptive-practices/[practiceId]/export-sheet`

- [ ] **Step 4: 手動驗證「未連接」路徑（不需要完成 Google Cloud 設定就能測）**

```bash
npm run dev
```

瀏覽器登入 dev 環境（用任何登入方式，只要還沒對這個帳號做 spec 裡的 Google Cloud + Clerk 自訂憑證設定），打開任一適性練習儀表板頁，開瀏覽器 devtools console 執行：

```js
fetch(location.pathname.replace('/dashboard/adaptive/', '/api/adaptive-practices/') + '/export-sheet', { method: 'POST' })
  .then(r => r.json().then(body => console.log(r.status, body)))
```

Expected: 印出 `409 {error: 'GOOGLE_NOT_CONNECTED'}`——這條路徑不依賴外部設定，現在就能驗證

- [ ] **Step 5: 手動驗證「成功匯出」路徑（需要 spec 前置依賴的 Google Cloud + Clerk 設定已完成）**

完成 spec 文件「前置依賴」那四步、且用已加入 OAuth 測試名單的 Google 帳號登入 QuizFlow 後，重複 Step 4 的 fetch，改為：

```js
fetch(location.pathname.replace('/dashboard/adaptive/', '/api/adaptive-practices/') + '/export-sheet', { method: 'POST' })
  .then(r => r.json().then(body => console.log(r.status, body)))
```

Expected: 印出 `200 {url: 'https://docs.google.com/spreadsheets/d/...'}`，打開該連結確認：
- 標題格式為 `{練習標題}_{學科名稱}_班級成績_{yyyy-MM-dd}`
- 內容第一列是 header（姓名、學號、各知識點欄、學習後分數、總作答次數），後面每列一位學生，跟同一個練習下載的 CSV 內容一致

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/adaptive-practices/[practiceId]/export-sheet/route.ts"
git commit -m "feat(adaptive): 新增匯出到 Google Sheet 的 API route"
```

---

### Task 4: 匯出按鈕 client component

**Files:**
- Create: `src/app/[locale]/(auth)/dashboard/adaptive/[practiceId]/AdaptiveExportButtons.tsx`
- Test: `src/app/[locale]/(auth)/dashboard/adaptive/[practiceId]/AdaptiveExportButtons.test.tsx`

**Interfaces:**
- Consumes: 無新依賴（`useClerk` 來自 `@clerk/nextjs`，本專案既有套件）
- Produces: `AdaptiveExportButtons({ csvHref: string; sheetHref: string }): JSX.Element`——Task 5 會在 `page.tsx` 用這個取代原本的 `<a>` 匯出連結

- [ ] **Step 1: 寫失敗測試**

建立 `src/app/[locale]/(auth)/dashboard/adaptive/[practiceId]/AdaptiveExportButtons.test.tsx`：

```tsx
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
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `npx vitest run "src/app/[locale]/(auth)/dashboard/adaptive/[practiceId]/AdaptiveExportButtons.test.tsx"`
Expected: FAIL，找不到 `./AdaptiveExportButtons` 模組

- [ ] **Step 3: 寫最小實作**

建立 `src/app/[locale]/(auth)/dashboard/adaptive/[practiceId]/AdaptiveExportButtons.tsx`：

```tsx
'use client';

import { useClerk } from '@clerk/nextjs';
import { useState } from 'react';

// Google Sheets 讀寫 scope；用來讓 Clerk 的 UserProfile 知道要幫這個 Google
// 連線多要哪個權限（不管是「從沒連過」還是「連過但沒有這個 scope」都適用）
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

type ExportState = 'idle' | 'loading' | 'not_connected' | 'error';

export function AdaptiveExportButtons({ csvHref, sheetHref }: { csvHref: string; sheetHref: string }) {
  const [state, setState] = useState<ExportState>('idle');
  const clerk = useClerk();

  async function exportToSheet() {
    setState('loading');
    try {
      const res = await fetch(sheetHref, { method: 'POST' });
      if (res.status === 409) {
        setState('not_connected');
        return;
      }
      if (!res.ok) {
        setState('error');
        return;
      }
      const data = await res.json() as { url: string };
      window.open(data.url, '_blank');
      setState('idle');
    } catch {
      setState('error');
    }
  }

  function reconnectGoogle() {
    // 打開 Clerk 內建的帳號管理視窗，帶上 Sheets scope；老師在裡面完成
    // 「連接／重新授權 Google」後，直接回這頁再按一次匯出即可，不需要自訂回調頁
    clerk.openUserProfile({
      additionalOAuthScopes: { google: [GOOGLE_SHEETS_SCOPE] },
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={csvHref}
        download
        className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
      >
        ↓ 下載 CSV
      </a>
      <button
        type="button"
        onClick={exportToSheet}
        disabled={state === 'loading'}
        className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
      >
        {state === 'loading' ? '匯出中…' : '📊 匯出到 Google Sheet'}
      </button>
      {state === 'not_connected' && (
        <span className="text-xs text-amber-600">
          尚未連接 Google 帳號的 Sheets 權限。
          {' '}
          <button type="button" onClick={reconnectGoogle} className="underline">
            重新連接
          </button>
        </span>
      )}
      {state === 'error' && <span className="text-xs text-red-600">匯出失敗，請重試</span>}
    </div>
  );
}
```

- [ ] **Step 4: 執行測試，確認通過**

Run: `npx vitest run "src/app/[locale]/(auth)/dashboard/adaptive/[practiceId]/AdaptiveExportButtons.test.tsx"`
Expected: 4 個測試全部 PASS

- [ ] **Step 5: Lint + 型別檢查**

Run: `npm run check-types && npx eslint --fix "src/app/[locale]/(auth)/dashboard/adaptive/[practiceId]/AdaptiveExportButtons.tsx" "src/app/[locale]/(auth)/dashboard/adaptive/[practiceId]/AdaptiveExportButtons.test.tsx"`
Expected: 無錯誤

- [ ] **Step 6: Commit**

```bash
git add "src/app/[locale]/(auth)/dashboard/adaptive/[practiceId]/AdaptiveExportButtons.tsx" "src/app/[locale]/(auth)/dashboard/adaptive/[practiceId]/AdaptiveExportButtons.test.tsx"
git commit -m "feat(adaptive): 新增匯出按鈕 client component AdaptiveExportButtons"
```

---

### Task 5: 接上儀表板頁面

**Files:**
- Modify: `src/app/[locale]/(auth)/dashboard/adaptive/[practiceId]/page.tsx`

**Interfaces:**
- Consumes: `AdaptiveExportButtons` from Task 4

- [ ] **Step 1: 加 `sheetHref`，把原本的 `<a>` 換成新 component**

在 `page.tsx` 現有的 `const exportHref = ...`（第 168 行）下面加一行：

```ts
const sheetHref = `/api/adaptive-practices/${practice.id}/export-sheet${buildQuery({})}`;
```

在檔案最上面補 import：

```ts
import { AdaptiveExportButtons } from './AdaptiveExportButtons';
```

把第 182–188 行原本的：

```tsx
          <a
            href={exportHref}
            download
            className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
          >
            ↓ 匯出班級成績
          </a>
```

改成：

```tsx
          <AdaptiveExportButtons csvHref={exportHref} sheetHref={sheetHref} />
```

- [ ] **Step 2: 型別檢查與 lint**

Run: `npm run check-types && npx eslint --fix "src/app/[locale]/(auth)/dashboard/adaptive/[practiceId]/page.tsx"`
Expected: 無錯誤

- [ ] **Step 3: `npm run build` 全站建置確認沒有壞掉**

Run: `npm run build`
Expected: build 成功

- [ ] **Step 4: 手動端對端驗證**

```bash
npm run dev
```

打開任一適性練習儀表板頁，確認：
- 匯出區塊變成兩顆按鈕：「↓ 下載 CSV」與「📊 匯出到 Google Sheet」
- 「↓ 下載 CSV」行為與改動前完全一樣（含日期篩選時檔名/內容跟著變動）
- 「📊 匯出到 Google Sheet」在未完成 spec 前置設定時，點下去顯示「尚未連接 Google 帳號的 Sheets 權限」+「重新連接」；點「重新連接」會跳出 Clerk 的帳號管理視窗
- 若已完成 spec 前置設定並用測試名單帳號登入，點「📊 匯出到 Google Sheet」會開一個新分頁顯示剛建好的 Google Sheet，內容跟 CSV 一致

- [ ] **Step 5: 跑一次全部測試確認沒有回歸**

Run: `npx vitest run`
Expected: 全部 PASS（含這次新增的測試）

- [ ] **Step 6: Commit**

```bash
git add "src/app/[locale]/(auth)/dashboard/adaptive/[practiceId]/page.tsx"
git commit -m "feat(adaptive): 班級儀表板接上 Google Sheet 匯出按鈕"
```
