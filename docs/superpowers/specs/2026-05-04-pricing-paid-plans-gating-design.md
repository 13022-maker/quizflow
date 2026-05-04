# 設計：公開頁定價隱藏 Pro/Team + 帳號內 ≥10 份才解鎖

- 日期：2026-05-04
- 狀態：設計完成，待實作計畫
- 範圍：Surface A（landing `/` 定價區塊）、Surface B（公開定價頁 `/zh/pricing`）

## 背景與動機

目前公開頁（landing 定價區塊 + `/zh/pricing`）對所有訪客直接展示三張方案卡：Free、Pro、Team。預期希望：訪客 / 低使用度用戶先看到 Free 方案不被嚇退，等他們在帳號內累積到 Free 上限（10 份測驗）的瞬間，再讓 Pro / Team 卡解鎖顯示，對齊「想升級」的心理時刻。

`AppConfig.ts` 的 Free `website: 10` 已是 10 份上限（CLAUDE.md 寫 3 為過時資訊），不需動 quota，純粹改 UI 顯示邏輯。

## 核心規則

> **「目前是付費方案」OR「帳號內 quiz 數 ≥ 10」 → 顯示完整 3 卡；否則只顯示 Free。**

可見規則矩陣：

| 角色 | 公開頁 `/` 定價區 + `/zh/pricing` | `/dashboard/billing`（管理頁） |
|---|---|---|
| 訪客（未登入） | 只 Free | N/A |
| Free 用戶 < 10 份 | 只 Free | 不變 |
| Free 用戶 ≥ 10 份 | Free + Pro + Team | 不變 |
| 試用中 < 10 份 | 只 Free | 不變 |
| 試用中 ≥ 10 份 | Free + Pro + Team | 不變 |
| 付費 Pro / Team | Free + Pro + Team | 不變 |

## 實作架構

兩個 pricing surface 用不同元件，要一起改：

| Surface | 路徑 | 元件鏈 | 資料源 |
|---|---|---|---|
| A 公開首頁 | `/` (landing) | `templates/Pricing.tsx` → `features/billing/PricingInformation.tsx` | `AppConfig.PricingPlanList` |
| B 公開定價頁 | `/zh/pricing` | `components/pricing/PricingSection.tsx` | hardcoded `PLANS` array |
| C 管理頁 | `/dashboard/billing` | 自有頁面 | 不動（按 Q4 (a) 決議） |

**抽 server helper 給兩個 surface 共用**：

```
src/libs/PricingVisibility.ts （新檔，server-only）
└─ getPricingVisibility() → { showPaidPlans: boolean, reason: 'guest' | 'under' | 'reached' | 'paid' }
   ├─ 未登入                  → { showPaidPlans: false, reason: 'guest' }
   ├─ 已登入 + 付費 Pro/Team   → { showPaidPlans: true,  reason: 'paid' }
   ├─ 已登入 + quiz count ≥10 → { showPaidPlans: true,  reason: 'reached' }
   └─ 否則                    → { showPaidPlans: false, reason: 'under' }
```

**「quiz count」定義**：當前帳號內仍存在的測驗數（依 `quizSchema` 用 `quizActions` 既有 ownership 邏輯查詢，已軟刪除的不算）。對應 (ii)「目前帳號內還存在 10 份」決議。

共用 helper 的理由：
- 兩個 surface 邏輯一致，不重複實作避免 drift
- quiz count 是 DB call，一次拿出來重用
- 之後門檻 10 → 7 / 15 只動一個檔

## 元件改動

### Surface A — landing `/` 定價區塊

- `src/templates/Pricing.tsx`：改為 `async` server component，呼叫 `getPricingVisibility()`，把 `showPaidPlans` 傳進 `PricingInformation`
- `src/features/billing/PricingInformation.tsx`：加 `showPaidPlans: boolean` prop，false 時 `publicPlans.filter(p => p.id === PLAN_ID.FREE)`，true 時保留現行邏輯

### Surface B — `/zh/pricing`

- `src/app/[locale]/(unauth)/pricing/page.tsx`：呼叫 `getPricingVisibility()`，傳 prop 給 `PricingSection`
- `src/components/pricing/PricingSection.tsx`：加 `showPaidPlans: boolean` prop，false 時 `PLANS.filter(p => p.monthlyPrice === 0)`，true 時用完整 PLANS。元件本身仍是 client（保留月繳/年繳切換 state），prop 由 server parent 注入

### 升級入口

按 Q3 (b) 決議：升級 CTA 走公開定價頁 `/pricing`。已登入用戶 quiz 數達 10 時 helper 自動讓 Pro 卡顯示，可直接觸發 Paddle Checkout。Navbar / Footer 既有 `/pricing` 連結不動。

### 不動 dashboard/billing

按 Q4 (a) 決議，這頁是訂閱管理頁面，繼續顯示完整資訊（試用 / 付費 / Free 各狀態），不套 gate。

### 渲染快取

landing page 預設可能被 ISR 靜態快取。helper 結果跟使用者狀態綁，必須避免快取。
- 在 `templates/Pricing.tsx` 內呼叫 `noStore()`（`next/cache`），或在 `src/app/[locale]/(unauth)/page.tsx` 加 `export const dynamic = 'force-dynamic'`
- `/zh/pricing/page.tsx` 同樣需要 dynamic 標記

## 邊界情況

| 情況 | 行為 | 備註 |
|---|---|---|
| 刪除題目從 10 → 9 | Pro 卡會「消失」 | 可接受，符合「目前帳號狀態」邏輯 |
| 試用中用戶創建到 10 份 | 看到 Pro + Team 卡 | 把握試用期高使用度的轉換時機 |
| 試用結束自動降級為 Free，留下 50 份試用作品 | 看到 Pro + Team 卡（≥10） | 符合「想升級轉正」流程 |
| VIP 帳號 (`prpispace@gmail.com`) | 走 `paid` 分支 | `getUserPlanId` 已把 VIP 算 PREMIUM，不另寫條件 |
| Free 用戶 quiz 數剛好 = 10（撞牆瞬間）| 解鎖 → 看到 Pro 卡 | 對齊轉換時機，與 quota 阻擋同步 |
| Navbar / Footer 的「方案」連結 | 不動 | 用戶點進去看到的內容由 helper 自動決定 |

## 檔案清單

| 檔案 | 動作 | 備註 |
|---|---|---|
| `src/libs/PricingVisibility.ts` | **新增** | server-only helper，4 分支 |
| `src/templates/Pricing.tsx` | 改為 async server component | 注入 `showPaidPlans`，加 `noStore()` |
| `src/features/billing/PricingInformation.tsx` | 加 `showPaidPlans` prop | 過濾 `publicPlans` |
| `src/app/[locale]/(unauth)/pricing/page.tsx` | 呼叫 helper，傳 prop | 加 `dynamic = 'force-dynamic'` |
| `src/components/pricing/PricingSection.tsx` | 加 `showPaidPlans` prop | 過濾 hardcoded `PLANS` |
| `src/libs/__tests__/PricingVisibility.test.ts` | **新增** vitest | 4 分支單測 |

**不動**：`dashboard/billing`、Navbar/Footer 連結、`AppConfig.ts` quota（已是 10）、Paddle 設定、AI quota 邏輯、i18n 翻譯（不顯示就不需要新文字）

## 測試

### 單元測試（vitest 新檔）

`src/libs/__tests__/PricingVisibility.test.ts` 4 分支：
- `guest`：無 userId → `{ showPaidPlans: false, reason: 'guest' }`
- `paid`：mock `getUserPlanId` 回 `PREMIUM` → `{ true, 'paid' }`
- `reached`：mock count 回 10 → `{ true, 'reached' }`
- `under`：mock count 回 9 → `{ false, 'under' }`

### 手動驗收

1. **訪客**：無痕進 `/` 與 `/zh/pricing` → 只看到 Free 卡
2. **Free 用戶 9 份**：登入後進兩處 → 只看到 Free 卡
3. **Free 用戶補到 10 份**：重整 → 看到 Free + Pro + Team 三卡
4. **付費 Pro 帳號**：任何 quiz 數都看到完整三卡
5. **Navbar 「方案」**：訪客點 → 公開定價頁；已登入 < 10 份點 → 公開定價頁（仍只 Free）

## 不在範圍

- 修改 quota 數字（`AppConfig.ts` 已是 10）
- 改公開定價頁的文案 / 視覺 / 排版
- 加「升級提示」彈窗 / Banner（既有機制繼續工作）
- i18n key 新增
- 任何 Paddle 相關設定變動

## 後續實作

進入 writing-plans skill 產生實作計畫，依檔案清單拆步驟，預計 2–3 個 commit（helper + tests / Surface A / Surface B）。
