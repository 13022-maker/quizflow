# Pro 試用機制 4 個缺口修補（2026-04-30）

## 背景

QuizFlow 30 天 Pro 試用機制大部分早已實作完成：

- ✅ `user_trial` DB 表（`Schema.ts:292`）
- ✅ Lazy init helper `ensureTrialRecord` / 純讀取 `getTrialStatus`（`libs/trial.ts`）
- ✅ `isProOrAbove` 三階判斷 subscription → trial → free（`libs/Plan.ts:80`）
- ✅ Dashboard `TrialBanner` 顯示倒數 / 到期（`features/dashboard/TrialBanner.tsx`）
- ✅ 自動降級：純 lazy，到期後 `isProOrAbove` 自然回 false，無需 cron

但探索後發現 4 個明顯缺口（其中一個是「試用起算點是 lazy」造成的承諾語意問題），
本 spec 只處理這 4 件，**不**重做機制本身。其他可能新增（email 提醒、admin
重置、grace period 等）由後續另開 spec。

## 實作順序（重要）

四個 Fix 互相之間有 1 條隱性依賴：**Fix 1 必須先 land 或與 Fix 2 同時 commit**。
理由：Fix 2 修完 billing 頁顯示後，會呼叫 `getAiUsageRemaining`；如果此時 Fix 1
還沒改 `aiUsageActions`，試用中的用戶在 billing 頁的 AI 使用率區塊會看到
「0 / 10 次 + 進度條」這個跟「Pro 老師 · 試用中」標題互相打架的錯誤狀態。

建議實作順序：**Fix 1 → Fix 4 → Fix 2 → Fix 3**，每步可分別 commit。
Fix 3 與其他三個完全獨立，可任何時點插入。

---

## Fix 1：AI quota 沒走 trial（明天 5/1 起會踩到）

### 問題

`src/actions/aiUsageActions.ts` 兩個 function 用 `getUserPlanId(userId)` 判定 quota，
而 `getUserPlanId` 純看 `subscription` 表（不看 `user_trial`），所以試用中老師
被視為 free → AI 出題本月 quota = 10 次。

目前靠 L34-38 的 hardcoded hack 撐：

```ts
// 2026 年 4 月試用期：不限制 AI 出題次數（5 月起恢復正式 quota）
const now = new Date();
if (now.getFullYear() === 2026 && now.getMonth() === 3) {
  return { allowed: true, remaining: 999 };
}
```

**5/1 一過，這段條件 false，所有試用中老師會被擋在 10 次/月。**

### 修法

`checkAndIncrementAiUsage` 與 `getAiUsageRemaining` 兩個 function 開頭都加：

```ts
// 試用中老師享 Pro 待遇（與 isProOrAbove 一致）
import { isProOrAbove } from '@/libs/Plan'; // 改成檔案頂部 static import
// ...
if (await isProOrAbove(userId)) {
  return { allowed: true, remaining: 999 };
  // getAiUsageRemaining 對應形狀:
  // return { quota: 999, used: 0, remaining: 999 };
}
```

**用 static import**（不照抄 `vip.ts` 的 dynamic import pattern）：
`Plan.ts` 與 `aiUsageActions.ts` 之間沒有 circular dep（已驗證），靜態 import 較乾淨。

同時**刪除** L34-38 的 2026-04 hardcoded hack（被新邏輯取代）。

### 為什麼不改 `getUserPlanId` 本身

`getUserPlanId` 保持「只回付費方案 ID」的語意，因為 billing 頁面（Fix 2）
需要區分「真 Pro」vs「Free 但試用中」做不同顯示。把 trial 灌進
`getUserPlanId` 會讓 billing 頁無法做這個區分。

### 副作用

試用用戶 `isProOrAbove === true` 時直接 short-circuit，不增加
`ai_usage` 表計數。試用結束當下回到 free 看到「0 / 10」很乾淨，
不會出現「試用期間累積但本月才開始計算」的誤會。

### 動到的檔案

- `src/actions/aiUsageActions.ts`：兩 function 各加 4 行 short-circuit、刪 5 行 hack。

---

## Fix 4：試用起算點改為「進入 dashboard 即起算」（eager trigger）

### 問題

`ensureTrialRecord` 目前只在 `isProOrAbove` 被呼叫時建立紀錄。實際路徑：

| 用戶行為 | 是否觸發試用啟動 |
|---------|----------------|
| 登入後只看 dashboard | ❌（TrialBanner 用唯讀的 getTrialStatus） |
| 點 AI 出題 / 進編輯頁 | ✅ |
| 進 billing 頁 | ❌ 目前 / ✅ Fix 1 之後 |

衍生問題：用戶 sign up 後純逛 dashboard 一週、第 8 天才點 AI——他的 30 天從
**第 8 天**起算，不是註冊日。對用戶比較好，但「30 天試用」這個產品承諾的語意
變模糊（每個用戶起算點不一樣）。

### 修法

在 `dashboard/layout.tsx` 入口呼叫 `ensureTrialRecord(userId)`，optimistic 觸發：

```ts
// dashboard/layout.tsx server side render 入口
const { userId } = await auth();
if (userId) {
  // fire-and-forget 也行；ensureTrialRecord 是 idempotent，
  // 第二次以後 SELECT 命中既有紀錄直接返回
  await ensureTrialRecord(userId);
}
```

### 為什麼放 layout 而不是 dashboard/page.tsx

Layout 涵蓋整個 dashboard 路由群（home、quizzes、vocab、billing、live host 等），
任一入口都會觸發。Page 只涵蓋 `/dashboard` 首頁；用戶從 Clerk redirect URL 直接
跳 `/dashboard/quizzes` 就會漏。

### 副作用

- Layout 變成「有寫操作的 server component」。但 `ensureTrialRecord` 是 idempotent
  且只在 user_trial 表沒紀錄時插入一次，第 2 次以後純 SELECT；已登入用戶絕大多數
  渲染只多一次 SELECT 的 cost。
- VIP 用戶（`prpispace@gmail.com`）也會被建一筆 user_trial 紀錄。VIP 走獨立 short-circuit
  不受影響，但會留下 vestigial row。可接受。
- TrialBanner 仍用 `getTrialStatus`（純讀），不需動。

### 動到的檔案

- `src/app/[locale]/(auth)/dashboard/layout.tsx`：加 4 行 `auth()` + `ensureTrialRecord()`
  呼叫（layout 已經是 async server component，不需轉型）。

---

## Fix 2：Billing 頁不知道試用狀態

### 問題

`src/app/[locale]/(auth)/dashboard/billing/page.tsx:24`：

```ts
const isPro = planId === PLAN_ID.PREMIUM || planId === PLAN_ID.ENTERPRISE || planId === PLAN_ID.PUBLISHER;
```

試用中老師 `planId === 'free'`、`isPro === false`，billing 頁顯示為
「免費版 NT$0/月」、AI 配額秀「0 / 10」進度條（修完 Fix 1 後此處
也要對應改成「無限制」）、底部還秀「升級至 Pro 方案」CTA。
試用中老師會困惑：「我不是已經在 Pro 試用了嗎？」

### 修法

`BillingPage` 在 `getUserPlanId` 旁邊加一段 `getTrialStatus`，依下表分支：

| 狀態判定 | 「目前方案」標題 | 副標 | AI 使用顯示 | CTA 區塊 |
|---------|----------------|------|------------|---------|
| 真 Pro/Enterprise/Publisher | 原邏輯（Pro 老師 / 學校方案 / 書商方案） | 無 | 無限制 | 訂閱管理 |
| `trial.inTrial === true` | `Pro 老師（試用中）` | 小字「試用剩 N 天 · YYYY/MM/DD 結束」 | 無限制 | 升級 CTA（文字「升級正式 Pro」） |
| `trial` 存在且 `inTrial === false` | `免費版` | 小字「Pro 試用已於 YYYY/MM/DD 結束」 | 原 quota 邏輯 | 原升級 CTA |
| `trial === null`（從未觸發過試用） | `免費版` | 無 | 原 quota 邏輯 | 原升級 CTA |

「試用剩 N 天」直接重用 `trial.daysLeft`。日期 format 用
`endsAt.toLocaleDateString('zh-TW')`。

### 不動的部分

L115 那顆 disabled 的「即將推出 — NT$299/月」按鈕**先不動**。
Paddle production 還沒上線（記憶系統 `paddle_production_pending.md`：
等用戶 ≥100 且命題人數 >10 才補 env），現在改成可點會中斷流程。
等 Paddle production 那天連帶處理。

方案比較表（CompareRow）也不動——這是**通用**比較，不該因當下
用戶狀態改變顯示。

### 動到的檔案

- `src/app/[locale]/(auth)/dashboard/billing/page.tsx`：
  - 多 import `getTrialStatus`
  - L22-25 區塊重構成上表四分支（用 `planId` + `trial` 一起判定）
  - 「目前方案」卡片內容依分支動態（標題 + 副標）
  - CTA 區塊條件 `!isPro` 改成「真 Pro 才顯示訂閱管理；其他都顯示升級 CTA」（試用中也顯示）

AI 使用率區塊**不需動**：Fix 1 修完後 `getAiUsageRemaining` 對試用用戶自動回
`{ quota: 999, used: 0, remaining: 999 }`，現有 L71 `aiUsage.quota >= 999 ? '無限制' : ...`
分支自動命中。

---

## Fix 3：到期 banner 永久顯示

### 問題

`TrialBanner.tsx` L70-88（試用結束分支）：只要 `trial` 存在且
`inTrial === false`，永遠顯示「🔒 Pro 試用已結束」鎖頭 banner。
沒有時限——降級後 6 個月還會看到，干擾。

### 修法

「試用已到期」分支進去前先檢查距到期時間：

```ts
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const daysSinceEnd = Math.floor(
  (Date.now() - trial.endsAt!.getTime()) / MS_PER_DAY
);
if (daysSinceEnd > 7) {
  return null; // 7 天後讓 AiQuotaBanner 接手
}
```

7 天 = 一個週的觀察期，足夠老師意識到降級並做決定，
之後改由 `AiQuotaBanner`（free 用戶用到 60% quota 才出現）負責提醒，
不重複打擾。

### 不需要 dismiss / 永久關閉機制

7 天後自然消失，不需要 cookie / localStorage 記憶。
若 7 天內老師升級成功，他變成真 Pro，TrialBanner 開頭那段
`if (planId === PREMIUM/...) return null;` 直接擋掉，不會繼續看到。

### 動到的檔案

- `src/features/dashboard/TrialBanner.tsx`：到期分支起手加 4 行 daysSinceEnd 檢查
  （MS_PER_DAY 直接在檔案頂端宣告 const，不從 trial.ts export，避免動兩個檔）。

---

## VIP 與試用的關係（spec 內必讀）

`AppConfig.ts` 的 `VIP_EMAILS`（目前只有 `prpispace@gmail.com`）是**獨立軸**，
不重疊試用機制：

- `aiUsageActions` 開頭 `isVipUser()` short-circuit 在 Fix 1 新加的 `isProOrAbove`
  **之前**——VIP 永遠無限 AI，行為不變。
- VIP 沒進 `isProOrAbove` 判斷，所以 VIP 用戶看 billing 頁會被當「試用中」或「免費版」
  顯示（取決於 user_trial 表是否有紀錄）。本 spec 接受此現狀，不為 VIP 客製顯示。
- Fix 4 的 eager trigger 會幫 VIP 也建一筆 user_trial 紀錄（vestigial），可接受。

如果未來覺得 VIP 應該在 billing 頁顯示為「Pro」，由後續另開 spec 處理。

## 不在本 spec 範圍

下列項目**不**做，等後續另開：

- Email 試用提醒（剩 7 天 / 3 天 / 1 天 / 已到期）
- Admin UI 手動重置試用
- 試用過期後「升級回 Pro」的 grace period（保留試用期累積資料）
- 調整 30 天天數
- TrialBanner / billing 頁文案 i18n（目前繁中硬寫；live mode i18n 也還沒做，一起拖到後面）
  。本 spec 新加的文案（「Pro 老師（試用中）」、「試用剩 N 天」、「Pro 試用已於 YYYY/MM/DD 結束」）
  **沿用既有硬寫繁中 pattern**，不新增 i18n key。
- Paddle production 上線後 billing 頁那顆 disabled 按鈕的修
- **試用結束後測驗數量超出 free 額度的處理**：AppConfig 設 free 上限 10 份測驗。
  試用期間用戶可能建了 30 份，到期後是否要鎖建立新測驗 / 隱藏舊測驗 / 不動，需驗 `quizActions`
  既有 quota 邏輯後另開 spec 決定。本次先不碰。
- VIP 在 billing 頁顯示「Pro」（見上節）

## 測試方式（手動）

無自動化測試。四個 fix 都用 `npm run dev` + Drizzle Studio 手動驗：

1. **Fix 1**：建一個無 subscription 的 test user，user_trial endsAt 設未來 → 連續呼叫 11 次 AI 出題不應被擋；endsAt 改過去 → 第 11 次應被擋。
2. **Fix 4**：user_trial 表清空，新登入 → 進 dashboard 任一子頁立刻 reload Drizzle Studio，user_trial 應有此 user 的紀錄、endsAt = 今天 + 30 天。
3. **Fix 2**：四種狀態（真 Pro / 試用中 / 試用過期 / 從未試用）造資料各看一次 billing 頁顯示正確。注意：因 Fix 4，「從未試用」狀態只可能出現在從未進 dashboard 的用戶（理論可能，實務罕見）；測試時可暫時繞過 Fix 4 製造此狀態。
4. **Fix 3**：user_trial endsAt 設 6 天前 → 看到鎖頭；endsAt 設 8 天前 → banner 應消失；endsAt 設未來 7 天 → 看到倒數 banner。

## 風險與回滾

4 個 fix 之間僅有 Fix 1 ↔ Fix 2 的隱性順序依賴（見「實作順序」段），其餘
可獨立 commit / 回滾單一檔案。DB schema **完全不動**（不需要新 migration）。

### 已知技術債（本 spec 不修，明列備案）

- **`ensureTrialRecord` race condition**：function 內部 SELECT → INSERT 非 atomic。
  同一新用戶並發兩個請求（例如雙開分頁載 dashboard，~50ms 內）有機率兩個都走進
  INSERT → 第二個請求 throw `clerk_user_id` UNIQUE 衝突。實務機率極低
  （人類點擊間距遠大於 50ms），但 Fix 4 啟用後曝光度略升（每個新用戶第一次進 dashboard
  都跑 ensure）。長期 fix：改用 Drizzle 的
  `.onConflictDoNothing({ target: userTrialSchema.clerkUserId })` 包住 INSERT。
  本 spec 不處理。
