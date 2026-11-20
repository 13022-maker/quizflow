# 實作模擬（hdfix3 電腦硬體裝修丙級）整合進 QuizFlow — 介面規格

分支：`feat/hdfix3-sim-integration`。三個子代理平行開發，**檔案所有權互斥**，介面以本文件為準。

## 產品流程
1. 老師在 `/dashboard/sims` 建立「實作模擬」：選模式（`practice` 練習＝有步驟教學與參考答案 / `exam` 測驗＝無解答、交卷），填標題、限時（分鐘，可空）、選填監評指定內容 spec 覆蓋值。
2. 系統產生 8 碼 accessCode，學生連結 `/{locale}/sim/{code}`（免登入，QR／LINE／Classroom 分享沿用適性學習的 CopyLinkButton / ShareClassroomButton 模式）。
3. 學生頁輸入姓名＋學號＋崗位號碼 → 作答（嵌入 hdfix3 HTML）→
   - exam：交卷時 POST 成績；
   - practice：每通過一題就 POST 一次最新進度（upsert），讓老師即時看到。
4. 老師在 `/dashboard/sims/[id]` 看班級儀表板（風格比照 `/dashboard/adaptive/[practiceId]`）：總覽卡片、15 題通過率長條＋最弱 3 題、學生×題目矩陣、學生詳情、CSV 匯出、每 10 秒自動刷新、刪除練習、匯入離線成績碼（`HDFIX3:` base64 JSON）。

## 資料表（Agent A 負責，`src/models/Schema.ts` + migration）
```ts
simPracticeSchema = pgTable('sim_practice', {
  id: serial PK,
  ownerId: text notNull,              // Clerk userId
  simKind: text notNull default 'hdfix3', // 之後可擴充其他模擬器；CHECK IN ('hdfix3')
  mode: text notNull,                  // CHECK IN ('practice','exam')
  title: text notNull,
  accessCode: text unique notNull,     // 8 碼
  spec: jsonb nullable $type<Record<string, unknown>>, // 覆蓋 hdfix3 DEF 的欄位
  timeLimitMin: integer nullable,
  createdAt, updatedAt
}); index on ownerId

simSubmissionSchema = pgTable('sim_submission', {
  id: serial PK,
  practiceId: integer FK → sim_practice.id onDelete cascade,
  studentKey: text notNull,   // 學號
  displayName: text notNull,
  seat: text notNull,         // 崗位 "01"~"24"
  attemptNo: integer notNull, // 同學生第幾次（exam 每次交卷 +1；practice 固定 1，upsert）
  isFinal: boolean notNull,   // exam 交卷 = true；practice 進度 = false
  startedAt: timestamp notNull,
  submittedAt: timestamp notNull,
  durationSec: integer notNull,
  score: integer notNull,     // server 依 items 重算：round(passed/15*100)
  items: jsonb notNull $type<SimItems>,
  createdAt
}); uniqueIndex(practiceId, studentKey, attemptNo); index(practiceId, submittedAt)
```
**不得**碰 `quiz_attempt` / `quiz_final_score` / `src/libs/scoring.ts`。

## 共用型別與函式（Agent A 建立於 `src/libs/sim/`）
`src/libs/sim/types.ts`
```ts
export type SimMode = 'practice' | 'exam';
export type SimItemResult = { passed: boolean; attempts: number; firstPassSec: number | null };
export type SimItems = Record<string, SimItemResult>; // key "1"~"15"
export type SimResultPayload = { // = hdfix3 成績 JSON（v:1, exam:'hdfix3'）
  v: 1; exam: 'hdfix3'; name: string; sid: string; seat: string;
  startedAt: string; submittedAt: string; durationSec: number; score: number; items: SimItems;
};
export const HDFIX3_ITEMS: { id: number; title: string; os: 'win' | 'lx' | 'both' }[]; // 15 題
```
`src/libs/sim/result.ts`（純函式，vitest 測試先寫）：
- `parseSimResult(input: unknown): { ok: true; value: SimResultPayload } | { ok: false; error: string }` — Zod 驗證，補齊缺題為 `{passed:false,attempts:0,firstPassSec:null}`，字串長度限制（name/sid ≤30，seat 兩位數字）。
- `computeSimScore(items: SimItems): number` — round(passed/15*100)。
- `decodeSimCode(text: string): SimResultPayload[]` 解析 `HDFIX3:` 成績碼（UTF-8 base64，容忍 base64url、缺 `=`）及原始 JSON。
- `summarizeClass(rows)`：人數、平均、中位數、及格率(≥60)、平均用時、每題通過率、最弱 3 題。
`src/libs/sim/dao.ts`：`getSimPracticeByCode(code)`、`getSimPracticeForOwner(id, userId)`、`listSimPractices(userId)`、`listSubmissions(practiceId)`（每學生最新 + 歷史）、`insertExamSubmission`、`upsertPracticeProgress`、`importSubmissions(practiceId, payloads)`。

## API（Agent A）
- `GET  /api/sim/[code]` 公開：`{ title, mode, timeLimitMin, spec }`（不回 ownerId）。
- `POST /api/sim/[code]/submit` 公開：body = `SimResultPayload`。exam → 新增一筆 attemptNo+1、isFinal=true；practice → upsert attemptNo=1、isFinal=false。分數一律 server 重算。用 `src/libs/rateLimit.ts` 限流（每 IP 每分鐘 300 次（學校 NAT 共用 IP））。回 `{ ok: true, score, attemptNo }`。
- middleware：把 `/api/sim/(.*)` 加入 `isPublicApiRoute`（**Agent B** 負責改 middleware，避免衝突）。
- Server Actions `src/actions/simActions.ts`：`createSimPractice`、`deleteSimPractice`、`importSimResults(practiceId, text)`（auth + Zod + owner 檢查）。

## 學生端（Agent B）
- `public/sims/hdfix3/practice.html`（來源 `/home/claude/hdfix3/index.html`）與 `public/sims/hdfix3/exam.html`（來源 `/home/claude/hdfix3/exam.html`），加入「QuizFlow 連線模式」：網址有 `?code=XXXX` 時，啟動時 `GET /api/sim/{code}` 取得 spec／限時並鎖定，不顯示規格編輯；exam 交卷→POST submit（失敗時仍保留下載/成績碼作為備援）；practice 每次通過→POST 進度。沒有 `code` 時行為與原本離線版相同。
- `src/app/[locale]/(unauth)/sim/[code]/page.tsx`：薄殼，查練習（`getSimPracticeByCode`），找不到 → notFound；全螢幕 iframe 載入對應 HTML 並帶 `?code=`。
- `src/middleware.ts` 加公開 API 白名單。

## 老師端（Agent C）
- `src/app/[locale]/(auth)/dashboard/sims/page.tsx`（列表＋建立表單）、`.../sims/[id]/page.tsx`（儀表板）及其 client 元件。
- dashboard nav（`src/app/[locale]/(auth)/dashboard/layout.tsx`）加「實作模擬」入口，放在「適性學習」旁。
- 若新增 i18n key，三語（zh/en/ja）同步；或比照適性學習頁直接寫繁中字串（優先比照現有慣例）。
- CSV 匯出（UTF-8 BOM）欄位：座號、學號、姓名、分數、用時(分)、交卷時間、Q1..Q15、Q1次數..Q15次數。
- 視覺比照適性學習儀表板＋`.claude/design-systems/linear-app/DESIGN.md`。

## 完成定義
`npm run check-types`、`npm run lint`、`npm run test`（含新 `src/libs/sim/*.test.ts`）、`npm run build` 皆通過；migration 檔名照 CLAUDE.md 規則重新命名並檢查 SQL 只含本次兩張表。
