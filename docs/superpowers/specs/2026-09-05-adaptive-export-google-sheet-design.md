# 適性學習「匯出班級成績」加上 Google Sheet 選項 設計文件

- 日期：2026-09-05
- 起因：`/dashboard/adaptive/[practiceId]` 班級儀表板目前「匯出班級成績」只能下載 CSV，
  老師希望能直接匯出成 Google Sheet（不用自己再匯入一次）。
- 範圍：只加這一個匯出按鈕；不動一般測驗（`/dashboard/quizzes/statistics`）既有的 CSV 匯出，
  那條路徑跟適性學習是分開的兩套功能（見 2026-09-05 稍早討論）。

## 實作修正（實作時對本文件的偏離）

實作的 plan（`docs/superpowers/plans/2026-09-05-adaptive-export-google-sheet.md`，
以此為準）跟本文件較早草稿有以下三處出入，日後閱讀本 spec 時請以下列修正為準，
不要照本文件較早草稿的寫法「修回去」：

1. Clerk 的 provider 字串用 `'google'`，不是本文件稍早草稿寫的 `'oauth_google'`
   （已對照實際安裝的 `@clerk/nextjs` 套件與 Clerk 官方文件確認；`'oauth_google'`
   格式的方法已標記 deprecated）。
2. Sheets API 失敗時回傳 HTTP 502，不是本文件較早草稿裡寫的 500。
3. 老師端「重新連接 Google 帳號」用 Clerk 內建的 `useClerk().openUserProfile({ additionalOAuthScopes: {...} })`，
   不需要像本文件稍早草稿設想的那樣自己做一個 OAuth callback 頁面。

## 使用者決策（brainstorming 階段已確認）

1. 老師目前登入 QuizFlow **有**開放 Google 社群登入（Clerk 後台已設定）。
2. 技術路線：**方法 A**——借用 Clerk 既有的 Google 連線多加 Sheets 讀寫 scope，不另外做一套
   獨立的 Google OAuth 流程（那是方法 B，工程量大很多，這次不採用）。
3. 目的表單：**每次都建一張新的 Google Sheet**（不做「固定更新同一張表」，避免要處理表格
   被老師手動刪除等邊界情況）。

## 前置依賴（使用者需自行在後台完成，程式碼動不到）

Clerk 目前的 Google 連線多半是「共用憑證」（Clerk 內建的 Google OAuth app），共用憑證
**無法**加自訂 scope。要讓 access token 帶有 Sheets 讀寫權限，必須：

1. Google Cloud Console 開一個新專案（或用現有的）→ 啟用 **Google Sheets API**
2. 建立 OAuth 2.0 用戶端（Web application），設定授權重新導向 URI 為 Clerk 提供的 callback
   （Clerk Dashboard 換成自訂憑證時會顯示要填哪個 URI）
3. OAuth 同意畫面加上 scope：`https://www.googleapis.com/auth/spreadsheets`
   （這是 Google 分類的「敏感 scope」，同意畫面預設為「測試中」狀態，僅測試人員名單內的
   帳號能授權成功——上線階段只有你自己或你手動加入的老師帳號能用，其他老師會在同意畫面
   被 Google 擋下。要開放給所有老師需要送 Google 應用程式審核，這件事列在下方「已知限制」）
4. Clerk Dashboard → User & Authentication → Social Connections → Google → 切換成
   「Use custom credentials」，貼入上面建立的 Client ID / Secret，並在 scope 欄位加上
   `https://www.googleapis.com/auth/spreadsheets`

這四步全部在外部後台操作，這份 spec 之後的程式碼改動都假設這四步已完成。

## 架構

```
AdaptiveExportButtons.tsx（新的 client component，取代原本 <a> 標籤）
  ├─ 「↓ 下載 CSV」──────────▶ GET /api/adaptive-practices/[practiceId]/export-csv（既有，不動行為）
  └─ 「📊 匯出到 Google Sheet」▶ POST /api/adaptive-practices/[practiceId]/export-sheet（新）
                                        │
                                        ├─ clerk.users.getUserOauthAccessToken(userId, 'oauth_google')
                                        │     └─ 失敗／查無 token ──▶ 回傳 409 GOOGLE_NOT_CONNECTED
                                        │
                                        ├─ buildClassScoreReport(practiceId, subjectId, dateRange)
                                        │     （從 export-csv/route.ts 抽出的共用函式）
                                        │
                                        └─ Google Sheets API v4（直接 fetch，不裝 googleapis 套件）
                                              1. POST /v4/spreadsheets            → 建表
                                              2. PUT  /v4/spreadsheets/{id}/values/A1:update
                                                      ?valueInputOption=RAW       → 寫入 header+rows
                                              回傳 { url: spreadsheetUrl }
```

不用 `googleapis` npm 套件：只需要兩支 REST call，直接 fetch 帶 Bearer token 即可，
比照專案現有風格（Gemini/Claude 都是直接呼叫 REST API，見 `src/lib/ai/textModel.ts`），
不為了兩支 API 多裝一個大套件。

## 改動點

### 1. `src/libs/adaptive/classScoreReport.ts`（新增，共用邏輯抽出）

把 `export-csv/route.ts` 現有的「撈 states → 算診斷 → 算分數 → 組 header/rows」邏輯搬過來：

```ts
export async function buildClassScoreReport(
  practice: { id: number; subjectId: string },
  dateRange: DateRange | null, // 沿用 dateRangeFilter.ts 的型別
): Promise<{ header: string[]; rows: string[][] }>
```

內部呼叫 `getAdaptiveService` + `filterActiveStudentKeys`（已存在於 `dateRangeFilter.ts`），
產生的 `header`/`rows` 跟目前 CSV 內容逐欄一致（姓名、學號、各知識點欄、學習後分數、總作答次數）。

`export-csv/route.ts` 改成呼叫這個函式，拿到 `header`/`rows` 後做既有的 CSV 字串組裝
（含 `"..."` 轉義、BOM）；**不改變 CSV 既有輸出格式**，純粹是把算資料的部分搬出去共用。

### 2. `src/lib/google/sheetsExport.ts`（新增）

```ts
export async function createGoogleSheet(
  accessToken: string,
  title: string,
  header: string[],
  rows: string[][],
): Promise<{ spreadsheetUrl: string }>
```

- `POST https://sheets.googleapis.com/v4/spreadsheets`，body 帶 `{ properties: { title } }`，
  回應含 `spreadsheetId` 與 `spreadsheetUrl`
- `PUT https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}/values/A1:update?valueInputOption=RAW`，
  body 帶 `{ values: [header, ...rows] }`
- 任一步 non-2xx 就 throw，帶原始錯誤訊息（呼叫端負責轉成對使用者友善的錯誤）

### 3. `src/app/api/adaptive-practices/[practiceId]/export-sheet/route.ts`（新增）

- 沿用 `export-csv/route.ts` 的驗證邏輯（登入 + ownership 檢查，直接複製那段，不刻意抽共用
  避免兩個 route 的錯誤處理耦合在一起）
- `const clerk = await clerkClient(); const tokens = await clerk.users.getUserOauthAccessToken(userId, 'oauth_google');`
  拿不到或陣列為空 → `NextResponse.json({ error: 'GOOGLE_NOT_CONNECTED' }, { status: 409 })`
  　⚠️ `getUserOauthAccessToken` 確切回傳形狀（陣列/物件、token 欄位名稱）動工前要對照
  　目前安裝的 `@clerk/nextjs@^6.18.3` 文件確認，不要憑記憶硬寫
- 呼叫 `buildClassScoreReport` + `createGoogleSheet`，標題格式沿用 CSV 檔名的邏輯
  （`${practice.title}_${subject.name}_班級成績_${today}`，不需要檔名安全字元過濾，
  Google Sheet 標題本身沒有檔名字元限制）
- 支援跟 CSV 一樣的 `?start=&end=` 日期區間（沿用 `parseDateRangeParams`）
- 成功回傳 `NextResponse.json({ url: spreadsheetUrl })`

### 4. `src/app/[locale]/(auth)/dashboard/adaptive/[practiceId]/AdaptiveExportButtons.tsx`（新增，client component）

取代目前 page.tsx 裡那顆 `<a href={exportHref} download>↓ 匯出班級成績</a>`，改成：

```tsx
'use client';
export function AdaptiveExportButtons({ csvHref, sheetHref }: { csvHref: string; sheetHref: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'not_connected' | 'error'>('idle');

  async function exportToSheet() {
    setState('loading');
    const res = await fetch(sheetHref, { method: 'POST' });
    if (res.status === 409) { setState('not_connected'); return; }
    if (!res.ok) { setState('error'); return; }
    const { url } = await res.json();
    window.open(url, '_blank');
    setState('idle');
  }

  function reconnectGoogle() {
    // Clerk 前端 SDK 觸發重新授權（帶新 scope）；確切 API 動工前查
    // 目前安裝的 @clerk/nextjs 文件（createExternalAccount 或對應方法）
  }

  return (
    <div className="flex items-center gap-2">
      <a href={csvHref} download className="…">↓ 下載 CSV</a>
      <button onClick={exportToSheet} disabled={state === 'loading'} className="…">
        📊 匯出到 Google Sheet
      </button>
      {state === 'not_connected' && (
        <span className="text-xs text-amber-600">
          尚未連接 Google 帳號的 Sheets 權限。
          <button onClick={reconnectGoogle} className="underline">重新連接</button>
        </span>
      )}
      {state === 'error' && <span className="text-xs text-red-600">匯出失敗，請重試</span>}
    </div>
  );
}
```

`page.tsx` 把原本的 `<a>` 換成 `<AdaptiveExportButtons csvHref={exportHref} sheetHref={...} />`，
`sheetHref` 用同一個 `buildQuery({})` 組出 `?start=&end=`（若有篩選）。

**Clerk 重新授權的確切呼叫方式**（`reconnectGoogle` 裡面要打的 API）在動工前要查
`@clerk/nextjs@^6.18.3` 當時的官方文件——Clerk 前端 SDK 在不同版本間，「幫既有帳號補簽
新 scope」這件事的 API 名稱／參數可能不一樣，不要在這份 spec 或實作時憑記憶編造，寫
implementation plan 時列成一個要先查文件確認的步驟。

## 錯誤處理

| 情況 | 處理 |
|---|---|
| 老師從沒用 Google 登入過 QuizFlow | `getUserOauthAccessToken` 查無資料 → 409 GOOGLE_NOT_CONNECTED → 前端顯示「連接 Google 帳號」 |
| 老師用 Google 登入過，但 scope 是舊的（沒有 Sheets 權限） | 同上，一樣是查無帶 Sheets scope 的 token → 同一套「重新連接」流程 |
| 老師的 Google 帳號不在 OAuth 同意畫面測試名單內（應用未過審階段） | Google 端會直接擋下並顯示 Google 自己的錯誤頁，不是 QuizFlow 能攔截的錯誤——這是「已知限制」，暫時無解，等應用送審過了才會消失 |
| Sheets API 呼叫失敗（額度、網路等） | 500 + 前端顯示「匯出失敗，請重試」，不重試機制（跟 CSV 匯出一樣簡單處理） |

## 測試

- `classScoreReport.ts` 抽出後，`export-csv` 既有行為（含日期篩選）用現有測試/手動驗證確認
  沒有跑掉即可，不必為這個純搬移動作重寫新測試
- `sheetsExport.ts` 兩支 fetch 呼叫可以寫最小單元測試（mock fetch），驗證 request body／URL
  組得對；不必真的打 Google API
- 端對端驗證（老師實際點按鈕、拿到真的 Google Sheet 連結）只能在完成「前置依賴」的四個
  外部設定步驟後，用你自己已加入測試名單的 Google 帳號手動驗證，無法在自動化測試裡涵蓋

## 已知限制

- 每次都建新表，Google Drive 會持續累積檔案，沒有自動清理（維持目前 CSV 下載的調性：
  產出後怎麼管理是老師自己的事）
- Sheets 讀寫是 Google 的敏感 scope：應用未通過 Google 審核前，只有 OAuth 同意畫面測試
  名單內的帳號能成功授權；要開放給所有老師使用需要走 Google 應用程式審核（含隱私權政策、
  使用情境說明等），這次不做，等真的要對所有老師開放時再處理
- 如果 Sheets API 建表成功但寫入資料那一步失敗，老師的 Google Drive 裡會留下一份空白的
  試算表（沒有自動清理機制）
