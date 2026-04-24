# 出版社 / 書商合作變現藍圖（2026-04-24）

## TL;DR（一段話）

**最大 passive income 機會**：QuizFlow 已經把 `publisher` 表、`quiz.publisherId/isbn/chapter/book_title` 等 schema 建好、PUBLISHER 方案（月 ¥990 / 年 ¥9,900，5 席編輯 + 200 題批次配額）也已經在 `AppConfig.ts` 定義，**但 server action / dashboard / 認證徽章 / ISBN 搜尋全部 0 行實作 — 純空殼**。預估 **5–10 天**工期可補齊上線，直接打開一個從個人老師訂閱拓展到 **B2B 出版社訂閱 + 平台分潤**的新收入線。

---

## 1. 現況盤點

### ✅ 已建好（schema-level）

**`publisher` 表**（`src/models/Schema.ts:114-131`）欄位齊全：
- `orgId` UNIQUE（一個 Clerk org = 一筆 publisher）
- `displayName`、`slug` UNIQUE、`logoUrl`、`bio`、`websiteUrl`
- `verifiedStatus`（pending / verified / rejected）、`verifiedAt`
- `contactEmail`、`taxId`（統一編號）

**`quiz` 表**擴充 4 欄（`Schema.ts:98-102`）：
- `publisherId`（FK → publisher.id, nullable）
- `isbn`、`chapter`、`bookTitle`

**PUBLISHER pricing plan** 定義（`src/utils/AppConfig.ts:70-80`）：
```
月繳 ¥990 / 年繳 ¥9,900
999 份測驗（實質無限）
999 次 AI 出題/月（實質無限）
5 席老師
20 GB 存儲
batchQuota: 200 題/月（專屬欄位）
```

**Paddle infrastructure**（`src/libs/paddle.ts`, `src/app/api/paddle/checkout/route.ts`, `/api/webhook/route.ts`）全通。Sandbox smoke test 過了。Webhook plan mapping 也支援 `publisher` plan。

### ❌ 空殼（schema 做了但零實作）

| 項目 | 缺什麼 |
|---|---|
| Server actions | `createPublisher` / `updatePublisher` / `getPublisherByOrg` / `verifyPublisher` 全部沒寫 |
| Dashboard route | `/dashboard/publisher/*` 完全不存在 |
| ISBN 搜尋 | Marketplace 篩選只有 category / gradeLevel，沒 ISBN |
| 認證徽章 | MarketplaceCard 看不出哪些 quiz 來自 verified publisher |
| 老師端 UI | QuizEditor / QuizForm 無 book-linking 欄位（學生練習書不會帶 ISBN）|
| Pricing UI | PricingSection 只顯示 Free/Pro/Team 三方案，Publisher 方案被藏起來 |
| Paddle production price ID | PUBLISHER 方案的 monthly/yearly Paddle Price ID 沒加到 env 變數 |

---

## 2. 變現模式 — 3 條可行路徑

### 路徑 A：純訂閱制（最快、工期 5–7 天）⭐️ 建議先做

**商業模式**：出版社付月/年費使用 QuizFlow 出題平台。

**目標客群**：
- 教科書出版社（翰林、康軒、南一）的編輯部
- 補習班教材出版部
- 獨立教材作者 / 教師工作室

**付費誘因**：
1. 一次付費全編輯部共用（5 席）
2. 200 題批次出題額度/月（配合新教材上市週期）
3. ISBN / 章節結構化歸檔（他們的內部知識庫）
4. 將來可在 marketplace 展示 verified badge 建立品牌可信度

**技術改動**：
- `src/actions/publisherActions.ts`（新）：CRUD + verify flow
- `/dashboard/publisher/profile`（新）：顯示名稱 / logo / 簡介 / 聯絡資訊
- `/dashboard/publisher/quizzes`（新）：以 ISBN/chapter 分組看自家 quiz
- `PublisherVerificationBadge` 元件 + MarketplaceCard 整合
- PricingSection 加第 4 張卡片「Publisher」
- Paddle env：`NEXT_PUBLIC_PADDLE_PRICE_PUBLISHER_MONTHLY/YEARLY`

**預期收益**：10 家出版社 × ¥9,900/年 = **¥99,000/年** 被動收入。30 家 = ¥297,000/年。

---

### 路徑 B：Marketplace 分潤制（工期 10–14 天）⭐️⭐️ 中期大招

**商業模式**：出版社在 marketplace 上架付費 quiz（按 ISBN / 章節組單），老師購買後分潤。

**經濟拆解**：
- 老師購買一本教材的完整 quiz 包：¥30 / ¥50 / ¥100（依難度 / 題數）
- 分潤：出版社 70%、QuizFlow 30%（行業常見 ratio）
- 或 Publisher 方案升級：分潤提升到 80%（激勵訂閱）

**目前 marketplace 狀況**（`src/app/[locale]/(unauth)/marketplace/page.tsx`）：
- ✅ 公開瀏覽 + 篩選（subject / grade / 全文搜尋）
- ✅ `copyCount` 追蹤「被複製次數」
- ❌ **完全免費**，無支付流程
- ❌ `copyQuizFromMarketplace`（`marketplaceActions.ts:91-165`）零 quota 檢查、零費用

**技術改動（較大）**：
- 新表 `marketplace_listing`：price、currency、royalty_split、status
- 新表 `marketplace_purchase`：purchaserId、listingId、paddlePaymentId、purchasedAt
- Paddle one-time payment 流程（非訂閱）
- 購買前顯示預覽（現在顯示全部）
- 購買後才能 copy，否則只能看範例題
- 出版社端 `/dashboard/publisher/earnings` 查分潤 + 請款
- 目前 `copyQuizFromMarketplace` 邏輯需改：免費的保留、付費的走支付

**預期收益**：平台毛利 30% × 月交易量 ¥50,000 = **¥15,000/月 被動收入**。隨 quiz 內容增加線性成長。

---

### 路徑 C：白牌 API / 嵌入式教材平台（工期 3 週+）⭐️⭐️⭐️ 長期大躍遷

**商業模式**：出版社把 QuizFlow 嵌入自己網站 / App，書附錄的 QR Code 掃進 publisher 的章節 quiz，看起來是出版社自家功能。

**付費結構**：
- 授權費：¥50,000–200,000/年（依出版社規模）
- 使用量分級：超過 X 份 response/月 加價
- 白牌要求：移除 QuizFlow 品牌、可訂製 theme

**現況 blockers**：
- 目前 Marketplace / QuizTaker 完全沒 theming API
- 品牌曝光分佈散（ShareModal / DownloadReport / 作答頁 header 都需要改）
- 需要 `white_label` 欄位跟 `branding` 配置

**技術改動**：
- 新表 `publisher_branding`（logo / 主色 / footer 文字 / custom_domain）
- middleware 加 custom domain 解析
- QuizTaker / ReportDownloader 依 publisher 切換品牌
- `api/public/publisher/{slug}/quiz/{id}` 等 embeddable endpoints

**預期收益**：3 家大出版社 × ¥100,000/年 = **¥300,000/年**。但銷售週期長（需要 BD 出差談）。

---

## 3. 建議的 6 個月 roadmap

```
Week 1–2  路徑 A（訂閱制）MVP
  - publisher CRUD + profile dashboard
  - PricingSection 加第 4 張卡
  - Paddle production env 補 PUBLISHER price IDs
  - MarketplaceCard 顯示 verified badge
  → 第一個付費出版社可簽約

Week 3–6  客戶開發 + UX 打磨
  - 找 3–5 家出版社做免費試用（Publisher 方案免費 6 個月）
  - ISBN 搜尋功能
  - 書-quiz 關聯 UI（quiz.bookTitle / chapter 編輯）
  - 學生端作答頁「來自 XX 出版社」標示（建立信任）
  → 試用用戶回饋

Week 7–12  路徑 B（分潤制）開發
  - marketplace_listing / purchase 兩個表
  - Paddle one-time payment
  - 出版社端 earnings dashboard
  - 老師端購買 UI（免費 preview + 付費 unlock）
  → 同時跑訂閱 + 分潤雙線

Week 13+  路徑 C（白牌）評估
  - 前面有穩定流量再做
  - BD 資源要到位
```

---

## 4. 競品對照

| 平台 | 收費模式 | 與 QuizFlow 差異 |
|---|---|---|
| **Eduaide.ai** | 老師訂閱（$5–15/月）| 沒 publisher 模組、沒分潤 |
| **MagicSchool** | 老師訂閱（$0–15/月）+ 學校方案 | 沒書商合作、分潤 0 |
| **翰林評量雲** | 出版社自建，內部使用 | 有教材結構化但只服務自家 |
| **1 對 1 家教平台 AmazingTalker** | 分潤制 20–30% | 人力服務，不同品類 |
| **Notion 教育模板作者** | 付費模板 | Notion 抽 10%（作者 90%）|

**結論**：路徑 B 的 70/30 分潤對出版社有吸引力（比 Apple App Store 的 30% 好），且 QuizFlow 目前沒競爭對手主打這塊。**這是空白市場**。

---

## 5. 風險 / 未知

1. **出版社心態**：教科書出版社習慣自建系統，說服他們「把內容放上別人的平台」需要時間
2. **盜版風險**：付費 quiz 被複製後再轉分享 — 目前 `copyQuizFromMarketplace` 會生成新 quiz，複製後內容等於「搬走」。要不要加 watermark / 轉載追蹤？
3. **法律**：出版社分潤要開發票 / 代收代付稅務處理，需跟會計師確認（contact_email / tax_id 欄位已預留）
4. **Verified 審核**：`verifiedStatus` pending → verified 要人工審嗎？還是 auto-approve？初期建議人工
5. **Paddle 政策**：Paddle 是否支援 revenue split 給第三方？若不支援需手動月結對帳給 publisher

---

## 6. 下一步具體建議

**如果您只做一件事**：把「路徑 A 訂閱制」的 MVP 做起來（5–7 天）。

**如果想再保守一點**：先寫 `publisherActions.ts`（2 天）+ `/dashboard/publisher/profile` 簡單頁面（1 天）＝ 3 天內讓 VIP 測試帳號建一個 publisher 資料，確認流程無礙再推 pricing UI 跟 Paddle。

**如果想探索客戶需求**：
- 找 2–3 個目標出版社聊一下（免費診斷他們的出題流程）
- 跑完 3 通電話後，才決定路徑 A 還是 B 先做
- 這是 product-market-fit discovery 的正規流程

---

## 附錄：關鍵檔案路徑索引

| 功能 | 檔案 | 行號 |
|---|---|---|
| Publisher schema | `src/models/Schema.ts` | 114–131 |
| Quiz book 欄位 | `src/models/Schema.ts` | 98–102 |
| Publisher pricing plan | `src/utils/AppConfig.ts` | 70–80 |
| Marketplace 公開頁 | `src/app/[locale]/(unauth)/marketplace/page.tsx` | 全檔 |
| 上架對話框 | `src/components/quiz/PublishMarketplaceDialog.tsx` | 全檔 |
| 複製 quiz action | `src/actions/marketplaceActions.ts` | 91–165 |
| Paddle SDK | `src/libs/paddle.ts` | 全檔 |
| Webhook（plan mapping）| `src/app/api/webhook/route.ts` | 全檔 |
| PricingSection UI | `src/components/pricing/PricingSection.tsx` | 全檔 |
