# Pro 訂閱轉換率稽核（2026-04-24）

## TL;DR

**最大 bug**：Paddle checkout infrastructure 已全通（SDK、webhook、customer 表都就緒），但前端 **`useCheckout` hook 根本沒實作 / 沒被呼叫** → 老師在 `/dashboard/billing` 點「升級 Pro」**很可能什麼都沒發生**或 redirect 到一個空的 Paddle overlay。這不是優化問題，是 **漏斗破一個洞直接漏水**。建議先補這個 blocker（2–3 天），再談 A/B 測試轉換率。

**2026-04-20 memory 裡的「Paddle Production 擱置至用戶達 100」寫得很誠實**，但 blocker 不是「要不要做 production」而是「即便做了 production，UI 也連不上」。這個洞要補。

---

## 1. 現況完整 funnel 盤點

### Free → Pro 轉換流程

```
FREE 老師
  ↓ (漸漸用超 10 份測驗 or 10 次 AI 出題/月)
觸發 Paywall
  ↓
  └─ 若建第 11 份：QuizLimitWall 元件 (src/features/quiz/QuizLimitWall.tsx)
       「立即升級」按鈕 → /dashboard/billing
  └─ 若 AI 額度 >= 60%：AiQuotaBanner 橫幅 (src/features/dashboard/AiQuotaBanner.tsx)
       「升級 Pro」按鈕 → /dashboard/billing
  └─ 其他 Pro-only 功能：UpgradeDialog (src/features/upgrade/UpgradeDialog.tsx)
       「前往升級」按鈕 → /dashboard/billing

/dashboard/billing 頁
  ↓
點「選擇 Pro」/「升級 Pro」
  ↓
  ❗ 預期：useCheckout() hook 開 Paddle Overlay
  ❗ 現況：Hook 未實作 / 呼叫斷線（需驗證）
  ↓
Paddle Overlay（若能開）
  ↓
付款完成 → Paddle webhook → DB subscription 表 upsert
  ↓
redirect 回 dashboard，升級成 Pro
```

### 已建好的組件清單

| 組件 / 邏輯 | 檔案 | 狀態 |
|---|---|---|
| Pricing UI | `src/components/pricing/PricingSection.tsx` | ✅ 3 方案 + 月/年切換（CLAUDE.md 記載）|
| QuizLimitWall | `src/features/quiz/QuizLimitWall.tsx` | ✅ 完整（滿 10 份測驗觸發）|
| UpgradeDialog | `src/features/upgrade/UpgradeDialog.tsx` | ✅ Modal、4 大功能清單、年費計算 |
| AiQuotaBanner | `src/features/dashboard/AiQuotaBanner.tsx` | ✅ 3 級視覺警告（60/80/95%）|
| Paddle SDK | `src/libs/paddle.ts` | ✅ getOrCreatePaddleCustomer |
| Checkout API | `src/app/api/paddle/checkout/route.ts` | ✅ 回傳 customerId + priceId |
| Webhook 處理 | `src/app/api/webhook/route.ts` | ✅ Created/Updated/Canceled 皆處理 |
| 30 天試用 | `src/libs/trial.ts` | ✅ lazy init auto 給新用戶 |
| VIP 白名單 | `src/libs/vip.ts` | ✅ prpispace@gmail.com 免費 |

### 缺失組件

| 缺的 | 影響 |
|---|---|
| `useCheckout` React hook | **致命** — 前端無法開 Paddle overlay |
| Paddle.js script loader（前端）| 要塞到 `<head>` 或 PaddleProvider |
| `/dashboard/billing` page 的完整 layout | 若頁面不完整，用戶 click 後被卡住 |
| Publisher 方案（第 4 張卡）| 藏起 ¥990/月 的一個收入線 |

---

## 2. Free 方案是否太寬鬆？

### 目前免費額度（`src/utils/AppConfig.ts`）

```
Free plan:
  - 10 份測驗（永久累計）
  - 10 次 AI 出題/月
  - 1 人
  - 0 GB storage
```

**評估**：
- ✅ **AI 出題 10 次/月**：合理。2026-04 現在還在「測試期全 Pro」，5 月 1 日恢復正式 quota
- ⚠️ **10 份測驗永久累計**：老師建 10 份後被擋，但已建好的 quiz 不會被封 → **老師不一定會升級，他們會刪舊建新**
- ❌ **發佈 / 作答不受限**：免費老師可以讓 1000 個學生作答 10 份測驗 → 平台成本（DB、Ably、AI 補救）吃滿但沒收益

### 建議
- Free 保留 10 份測驗，但加**每月作答 500 人次上限**（讓高活躍老師被推升級）
- AI 出題 5 次/月（現在 10 次稍鬆）— 對比 MagicSchool（$0 免費方案每月 5 次）可以緊一點
- Live Mode 每月開 2 場（目前無限免費，這是 Pro 的核心差異化應該收費）

---

## 3. Paywall 觸發時機優化

### 現在：「用滿 10 份」才擋

- 老師一開始試用完全沒感覺被擋（Free 10 份夠寫完整學期用）
- 等到某天建第 11 份被 QuizLimitWall 擋住 → 很可能不爽離開

### 建議改為漸進式 paywall

```
第 1 份建立       -> 沒阻力（體驗優秀）
第 3 份建立後   -> 淡提醒「你已建 3 / 10 份，Pro 方案無限制 →」
第 7 份建立後   -> 顯眼橫幅「剩 3 份，Pro 年繳平均 NT$208/月（比便當便宜）」
第 10 份建立後 -> Paywall + 30 天試用自動啟動 CTA（已實作）
第 11 份建立    -> QuizLimitWall（Pro-only，已實作）
```

### 實作 effort

- 加一個 `<QuizCountProgressBanner>` 放在 `/dashboard/quizzes` 列表頂部
- 依 quizCount 切換 3 種視覺
- 工期 **1 天**，預期 conversion +20–40%

---

## 4. 3 個 A/B test 變體提案

### Variant 1：定價錨定法

**現在**：¥299/月 or ¥2,490/年（省 ¥1,098）

**測試**：新增第 3 欄「學校方案 ¥1,990/月」顯眼放在 Pro 旁邊，讓 Pro 看起來「不錯」。

> 行為經濟學：中間選項 bias 會提升 Pro 的選擇率

**預期 lift**：+15–25% Pro 轉換率

---

### Variant 2：年繳 default

**現在**：`PricingSection` 預設月/年切換 — 通常預設月繳

**測試**：預設切到**年繳**（便宜 ¥1,098），把年繳金額 ¥2,490 以大字顯示、月繳藏小字。

> 心理：loss aversion，用戶看到「年繳省 ¥1,098」會更傾向年繳 → 一次收到全年，churn 降低

**預期 lift**：+40–60% 年繳比例，同時提升總現金流

---

### Variant 3：「一份測驗 ¥1」量化法

**現在**：¥299/月 抽象

**測試**：展示「建 300 份測驗每份只要 ¥1」 / 「每天 NT$10 = 一杯 7-11 咖啡」

> 已在 UpgradeDialog 做了一半（「平均每月 NT$208，比一頓便當還便宜」），但 PricingSection 沒做

**預期 lift**：+10–20% 訂閱啟動率

---

## 5. 其他被忽視的低風險優化（quick wins）

### A. 升級成功後的感謝頁

目前 Paddle 付款完成後 redirect 回 dashboard — 沒有**慶祝 moment**。建議加 `/dashboard/welcome-to-pro` 頁：
- 🎉 動畫 + 「歡迎成為 Pro 老師」
- 立即可以做的 3 件事（AI 出題、Live Mode、匯出成績）
- 社群分享 CTA：「我升級了 Pro，解鎖無限 AI 出題」→ 帶 UTM tag 的推薦連結

### B. Paywall 拒絕的再次 nudge

`QuizLimitWall` 裡的「返回」按鈕現在乾脆讓人離開。改成：
- 「取得 30 天免費試用」按鈕（已實作 trial infrastructure，但未在 UI 曝光！）
- 「發問到客服」快速 link

### C. AI 出題 quota 用滿的 upsell moment

`AiQuotaBanner` 已經分 3 級，但 **95% 用量** 的警示按鈕只是「升級 Pro」。可以改：
- 「升級取無限 AI 出題 ¥299/月」
- 旁邊小字：「或等 3 天到月重置」（讓用戶自己比 ¥299 划不划算）

### D. VIP 白名單暴露問題

`VIP_EMAILS` 只有您自己。測試時您看不到真正的 paywall 表現。建議：
- 加一個開發環境 `?force-free=1` query param 暫時忽略 VIP 判斷
- 或開一個隱私瀏覽器用不同帳號測試

---

## 6. 衡量 conversion 的追蹤漏洞

### 現況：**沒有 funnel tracking**

從 blog 讀者 → 註冊 → 建第 1 份 → 建第 10 份 → 升級 Pro，**每個節點都沒發 analytics event**。

### 最少要打的 event

| Event | 意義 | 建議觸發位置 |
|---|---|---|
| `quiz_created` | 每次建新測驗（含 count：第幾份）| `createQuiz` server action 成功後 |
| `paywall_shown` | QuizLimitWall/UpgradeDialog 展示 | 元件 mount |
| `paywall_upgrade_clicked` | 點「升級」按鈕 | button onClick |
| `checkout_started` | Paddle overlay 開啟 | `useCheckout` 呼叫時 |
| `checkout_completed` | webhook 收到 SubscriptionCreated | webhook handler |
| `trial_started` / `trial_ended` | 30 天試用 | `ensureTrialRecord` / scheduled check |

Vercel Analytics + Plausible / PostHog 是合適的量級（不用 Google Analytics 那種重量）。

---

## 7. 結論 — 三件事優先序

| 優先 | 項目 | Effort | 影響 |
|---|---|---|---|
| 🔴 P0 | 補完 `useCheckout` hook + Paddle.js loader | 2–3 天 | **釋放整條付款鏈**（最大 bug）|
| 🟠 P1 | 漸進式 paywall（第 3/7 份提醒）| 1 天 | +20–40% conversion |
| 🟡 P2 | PricingSection 加 Publisher 第 4 卡 + 年繳 default | 0.5 天 | 解鎖 ¥990 收入線 + 年繳現金流 |
| 🟢 P3 | 3 個 A/B 變體 | 2–3 天 | +15–25% 各自 |
| 🟢 P3 | Analytics funnel tracking | 1 天 | 才能量化上面優化 |

**一週做完 P0 + P1 + P2 就能看到有意義的 revenue 變化**。A/B 測試要等有 baseline traffic 才有意義（至少 100 active teachers / 月）。

---

## 附錄：關鍵檔案路徑索引

| 功能 | 檔案 | 行號 |
|---|---|---|
| Pricing plans | `src/utils/AppConfig.ts` | 19–80 |
| PricingSection | `src/components/pricing/PricingSection.tsx` | 全檔 |
| QuizLimitWall | `src/features/quiz/QuizLimitWall.tsx` | 6–95 |
| UpgradeDialog | `src/features/upgrade/UpgradeDialog.tsx` | 32–127 |
| AiQuotaBanner | `src/features/dashboard/AiQuotaBanner.tsx` | 19–76 |
| Paddle SDK | `src/libs/paddle.ts` | 全檔 |
| Checkout API | `src/app/api/paddle/checkout/route.ts` | 13–47 |
| Webhook 處理 | `src/app/api/webhook/route.ts` | 全檔 |
| Trial logic | `src/libs/trial.ts` | 24–46 |
| Plan logic | `src/libs/Plan.ts` | 84–97 |
| VIP 白名單 | `src/libs/vip.ts` | 7–18 |
| AI quota 檢查 | `src/actions/aiUsageActions.ts` | 24–91 |
| 4 月測試期 | `src/actions/aiUsageActions.ts` | 34–38 |
