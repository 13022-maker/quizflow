# QuizFlow Passive Income 稽核 — 總覽（2026-04-24）

## 閱讀順序建議

1. **本文件**（5 分鐘）— 拿到全局判斷與優先順序
2. [pricing-conversion-audit.md](./pricing-conversion-audit.md) — **最重要**，因為有個 **P0 bug** 可能正在漏掉付費
3. [publisher-marketplace-revenue.md](./publisher-marketplace-revenue.md) — 新收入線的長期藍圖
4. [growth-loop-proposals.md](./growth-loop-proposals.md) — 病毒擴散 / 推薦機制

---

## 最重要的發現（如果只能看 3 條）

### 🚨 發現 1：Paddle checkout 前端可能斷線

**現況**：Paddle SDK / webhook / customer table / subscription schema **全部建好了**（sandbox smoke test 過），但 **`useCheckout` React hook 似乎沒實作**（或 `/dashboard/billing` 頁的「升級 Pro」按鈕 click 後連不上 Paddle overlay）。

**影響**：即便有用戶想升級，付款流程可能根本點不動。這不是優化問題 — 是**漏斗中間破一個洞**。

**驗證方式**：登入一個 free 帳號（非 VIP 白名單），到 `/dashboard/billing` 點升級按鈕，看會不會真的開 Paddle overlay。若沒開 / 開空白 → 這就是要先修的。

**Effort**：補完 2–3 天。

詳見 [pricing-conversion-audit.md §1](./pricing-conversion-audit.md#1-現況完整-funnel-盤點)。

---

### 🌱 發現 2：每場測驗有 30 位潛在新老師，現在轉化 0%

**現況**：學生作答 QuizFlow 測驗時，整個作答體驗**完全看不到 QuizFlow 品牌**：
- 沒 Header / Footer / Logo
- 結果頁沒有「我也要當老師」CTA
- 下載的報告頁尾有「由 QuizFlow 生成」但**沒連結**
- 收集的學生 email 零 marketing automation
- 沒短網址、沒 referral 追蹤

**影響**：老師 1 位 → 學生 30 位作答 → 潛在 30 位新老師 touchpoint **全部浪費**。

**Effort**：1 週補完最關鍵 5 個漏洞（Footer / 結果頁 CTA / 報告 CTA / 老師邀請同事 / event tracking）。

**預期收益**：免廣告費、自我擴散 — 估算可替代每月 NT$30,000 以上的 CAC。

詳見 [growth-loop-proposals.md §2](./growth-loop-proposals.md#2-可執行的-12-個改善按-effortimpact-排序)。

---

### 📘 發現 3：Publisher 空殼已建，5–10 天可開新收入線

**現況**：
- `publisher` 表 schema 完整（剛 merge 的 PR #27）
- `quiz` 表已加 `publisherId / isbn / chapter / bookTitle` 欄位
- `AppConfig.ts` 已定義 PUBLISHER 方案（月 ¥990 / 年 ¥9,900）
- **但 server action、dashboard、UI、Paddle price ID 全部 0 行實作**

**影響**：技術基礎都有，只差 UI 跟 flow — 是最快能打開的「第二條收入線」。

**3 條實作路徑**：
- 路徑 A（訂閱制）5–7 天 → 10 家出版社 = ¥99k/年
- 路徑 B（分潤制）10–14 天 → 月交易 ¥50k × 30% = ¥15k/月
- 路徑 C（白牌）3 週+ → 3 家大出版社 × ¥100k = ¥300k/年

詳見 [publisher-marketplace-revenue.md §2](./publisher-marketplace-revenue.md#2-變現模式--3-條可行路徑)。

---

## 統合優先順序（1 個月的 roadmap）

| Week | 做什麼 | 預期收益 |
|---|---|---|
| **Week 1** | P0：修 Paddle checkout UI（2–3 天）+ 加作答頁 Footer / 結果頁 CTA / 報告 CTA（1 天）| 修漏 + 啟動有機成長 |
| **Week 2** | 老師邀請同事機制 + 漸進式 Paywall（第 3/7 份提醒）+ Analytics event | 提升 conversion +20–40% |
| **Week 3** | Publisher 方案 MVP（訂閱制路徑 A）| 新收入線，¥99k/年 潛力 |
| **Week 4** | PricingSection 加 Publisher 卡 + 年繳 default + 3 個 A/B 測試 | 提升單客單價 |

---

## 其他值得知道但不是 P0 的

### 4 月測試期 5/1 到期

目前（2026-04-24）AI 出題是「測試期全 Pro、無 quota」。2026-05-01 自動恢復為 Free 10 次/月。

**影響**：5/1 以後老師會突然撞到 paywall，預期 conversion uplift 來源之一。若 checkout UI 還沒修好，那天的流失會很嚴重。

### 30 天 Trial 機制已建但沒在 UI 曝光

`src/libs/trial.ts` 已實作 lazy init 30 天 Pro 試用，但 `QuizLimitWall` 上沒有「取得 30 天免費試用」按鈕。純 UX 設計問題，加個按鈕 0.5 天。

### VIP 白名單會讓您看不到真實 paywall

您自己（prpispace@gmail.com）是 VIP，所有 paywall 不會觸發。建議用另一個 email 註冊測試帳號，體驗學生眼中的 / 新老師眼中的 QuizFlow。

### 記憶系統已同步

下次對話時會自動讀到：
- [ably_upgrade_pending.md](../../../.claude/projects/-Users-hsiehchinhung-quizflow-A/memory/ably_upgrade_pending.md) — Ably 擱置至用戶 100
- [paddle_production_pending.md](../../../.claude/projects/-Users-hsiehchinhung-quizflow-A/memory/paddle_production_pending.md) — Paddle production Phase 3b
- [b2c_roadmap.md](../../../.claude/projects/-Users-hsiehchinhung-quizflow-A/memory/b2c_roadmap.md) — B2C 家教路徑

這些都是 **等用戶 100 才重啟討論** 的大戰略項目。本次報告專注「**100 用戶之前就能做的**」增長機制。

---

## 要不要我接下一步？

回來後選擇：

- **A.** 立刻讓我補 P0 Paddle checkout bug（最值錢的 3 天）
- **B.** 讓我先做「作答頁 Footer + 成績頁 CTA + 報告 CTA」三個病毒擴散漏洞（1 天）
- **C.** Publisher 方案 MVP 開工（5–7 天一條新收入線）
- **D.** 先自己 review 報告、晚點再決定

建議 **B → A → C** 的順序：
- B 只要 1 天、影響立即（每份測驗都多 3 個品牌 touchpoint）
- A 最大 blocker（沒付款機制根本無從收費）
- C 較大功能，前兩件做完後打開第二條收入線

三份報告都在 `docs/` 底下，commit 進 main，隨時可讀。
