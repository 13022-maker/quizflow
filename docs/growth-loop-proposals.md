# 成長迴圈 / 病毒機制設計（2026-04-24）

## TL;DR

**QuizFlow 最寶貴的資產**：每位老師發一份測驗，平均 30 位學生作答 → 一個老師把 30 個潛在新老師帶進平台。**現況**：老師 1 位 → 學生 N 位作答 → **0 位學生看到 QuizFlow 品牌**，更別說變老師。漏水嚴重。

**最致命的 3 個漏洞**：
1. 作答頁沒有 Header / Footer / Logo（學生看到一個無品牌頁面）
2. 成績結果頁沒有「我也要當老師」CTA
3. 學生留了 email 但無任何 follow-up / marketing automation

修好這 3 個漏洞可讓 **每場測驗變成 30 個招募 touchpoint**。工期約 3–5 天。

---

## 1. 學生接觸品牌的 N 個 touchpoint 現況

依學生完整作答流程盤點（`/quiz/[accessCode]` → submit → 結果頁 → 下載報告 → 單字卡練習）：

| Touchpoint | 品牌曝光 | 註冊 CTA | 評分 |
|---|---|---|---|
| 作答頁（top/bottom） | ❌ 無 Logo / Header / Footer | ❌ 無 | 0/10 |
| 作答中的 sticky bar | ❌ 只有進度條、計時器、送出鈕 | ❌ 無 | 0/10 |
| 送出成功結果頁 | ⚠️ 錯題單字卡、下載報告等 | ❌ **零**升級 CTA | 2/10 |
| 下載的學習報告（HTML）| ✅ 頁尾「由 QuizFlow 生成」 | ❌ 無連結 | 3/10 |
| 單字卡練習頁 `/vocab` | ❌ 無品牌 | ❌ 無 CTA | 0/10 |
| AI 助教解題 overlay | ❌ 「AI 助教」generic | ❌ 無 | 1/10 |
| AI 補救練習 | ❌ 無品牌 | ❌ 無 CTA | 0/10 |
| QR Code | ⚠️ 下載檔名含 `QuizFlow_` prefix，QR 內容無品牌 | ❌ 無 | 2/10 |
| 分享出去的連結 | 格式 `/quiz/{accessCode}` 無短網址 | ❌ 無 | 1/10 |

**平均 ~1/10**。一個學生做完整份測驗，最多只認得到 QuizFlow logo **一次**（下載報告的 PDF 頁尾），而且 **還沒有連結**。

---

## 2. 可執行的 12 個改善（按 effort/impact 排序）

### 🔴 P0 — 本週立刻改（0.5–1 天各）

#### ① 作答頁加簡潔 Footer

檔案：`src/app/[locale]/quiz/[accessCode]/page.tsx` 底部加：
```tsx
<footer className="py-4 text-center text-xs text-muted-foreground">
  由 <a href="/" className="font-semibold text-primary hover:underline">QuizFlow</a> 提供，
  <a href="/sign-up?ref=student-footer" className="hover:underline">老師也想出題 →</a>
</footer>
```
**影響**：每場測驗 × N 學生看到 logo × 每份答完都再看一次。**量變引起質變**。

#### ② 成績結果頁「我也要當老師」CTA

檔案：`src/features/quiz/QuizTaker.tsx` QuizResult 元件（~line 600-650 附近）。
在錯題重做 / 下載報告按鈕區上方，加一張大卡：
```tsx
<div className="rounded-2xl border-2 border-primary/40 bg-gradient-to-br from-primary/5 to-background p-6">
  <p className="text-sm font-semibold text-primary">✨ 你也是老師嗎？</p>
  <h3 className="mt-1 text-lg font-bold">免費建立你自己的測驗</h3>
  <p className="mt-1 text-sm text-muted-foreground">10 份測驗 + AI 出題通通免費，學生掃 QR 就能作答</p>
  <Link href="/sign-up?ref=student-result" className="mt-3 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
    3 分鐘建立我的第一份測驗
  </Link>
</div>
```
**影響**：最高轉換 touchpoint。學生剛完成作答感覺良好，最可能嘗試。

#### ③ 下載報告加註冊連結

檔案：`src/features/quiz/QuizTaker.tsx:462-524`（handleDownloadReport 產 HTML 區段）。
在頁尾「由 QuizFlow 生成」之後加一句：
```html
<p style="text-align:center; margin-top:16px; color:#666; font-size:13px;">
  想為你的學生建立這樣的測驗與分析？
  <a href="https://quizflow-psi.vercel.app/sign-up?ref=report" style="color:#4f46e5;">免費開始 →</a>
</p>
```
**影響**：學生把 HTML 檔傳給家長 / 朋友，對方看到 CTA 可能變老師。病毒擴散。

#### ④ QR Code 整合品牌

檔案：`src/components/quiz/ShareModal.tsx`（QRCode 下載邏輯，~line 68）
用 `qrcode-with-logos` 庫，把 logo 印在 QR 中央。檔案名保持 `QuizFlow_{標題}_QRCode.png`。

---

### 🟠 P1 — 兩週內（1–2 天各）

#### ⑤ 學生 Email 收集後的 marketing automation

現況：`response.studentEmail` 選填，收了也沒用。

建議：
- 新增 `student_marketing_consent` 欄位（opt-in checkbox）
- 連 Resend / Brevo 這類 email service（or Paddle 有附的 email tool）
- 觸發時機：
  - 作答完隔天：「你做得不錯！這邊有更多練習推薦 → templates」
  - 作答完 3 天：「你老師是誰？邀請他 / 她加入 QuizFlow」
  - 作答完 7 天：「你也想當老師嗎？」

工期 2 天（整合 email service + 寫 3 封模板 + 加 schema 欄位）。

#### ⑥ 老師端「邀請同事」入口

檔案：`src/features/dashboard/templates/TemplateB.tsx` 加一張橫條卡。
點開：
```
🎉 邀請同事加入 QuizFlow
兩人都升級 Pro 時，你們各送 1 個月免費
[複製邀請連結]  [透過 LINE 邀請]
```

Schema 新增：`user_referral`（referrer_id / referred_id / reward_granted_at / referral_code）

工期 2 天（schema + 邀請流程 + 驗證已升級）。

#### ⑦ 單字卡頁加「我也想做」CTA

檔案：`src/app/[locale]/vocab/[accessCode]/page.tsx`
單字卡練習結束頁或側邊固定：
```
🔤 想為學生製作單字卡？
[免費開始] ← 連去 /sign-up?ref=vocab
```
工期 0.5 天。

#### ⑧ 成就 + 分享 moments

`StreakCard` 累積達里程碑時（7 天連勝 / 第 1 位學生作答 / 累積 100 學生）彈出分享 modal：
```
🎉 太棒了！你已幫助 100 位學生學習
[分享到 LINE 鼓勵同事] [分享到 Facebook]
```

分享文案帶 `?ref=milestone-{teacherId}` 追蹤來源。

工期 1.5 天（milestone 偵測 + 分享 UI）。

---

### 🟡 P2 — 一個月內（大改動）

#### ⑨ 短網址 + referral tracking

現況：`/quiz/{accessCode}` 8 碼 access code，無任何 referral 追蹤。

建議：
- 建 `/r/{shortCode}` route 支援多層轉向
- 每個 accessCode 可綁 referral source（`?utm_source=line&utm_campaign=teacher_{id}`）
- ShareModal 分享時自動附上
- 建 `referral_visit` 表記錄 click

工期 3 天。

#### ⑩ Blog 每篇加 exit intent CTA

現況：部落格 30 篇 SEO 文章，沒統一 CTA。

建議：
- 每篇底部固定 CTA 區塊 + scroll 至文章 2/3 時顯示 modal
- 文案：「看完這篇，你也想試試 AI 出題嗎？免費 10 份測驗」
- UTM 追蹤：`?utm_source=blog&utm_article={slug}`

工期 1.5 天（統一 BlogCTA 元件 + 寫進 blog data）。

#### ⑪ 學生免費單字卡 feed

目前 `/vocab/{accessCode}` 只看當份錯題。可擴展成：
- 學生留 email 後推薦**更多免費單字卡**（templates 的 vocab quiz）
- 讓學生主動使用平台，建立學習習慣 → 學生家長看到會問「這哪來的」→ 家長自己加入（或告訴老師朋友）

工期 2 天。

#### ⑫ 教師推薦排行榜

現況：老師完全不知道自己幫多少學生作答。

建議：
- `/dashboard` Hero 加「你已幫助 N 位學生，本月共 M 人次作答」
- 一次跳 milestone：「你超越了 80% 的 QuizFlow 老師」
- 讓老師「自我感覺良好」產生自發分享

工期 1 天。

---

## 3. 為什麼這些 CTA 是 passive income？

老師推薦老師、學生推薦老師、家長推薦老師 — 每一條**一旦設好不用再花 marketing 錢**。對比：
- Facebook / Google 廣告：每位註冊老師成本約 NT$200–500（假設 CAC $10）
- 學生看到 footer CTA：一次 deployment，成本 ¥0 / 每位新老師
- Email automation：Resend 免費 3k emails/月，QuizFlow 規模內幾乎免費

**投 3 天寫 email automation + footer CTA，可以替代 NT$30,000 的廣告費用**（估算：30 個新老師來自有機 referral）。

---

## 4. 衡量 growth 要打的 event

沒 analytics 就沒法優化。最少要打：

| Event | 觸發位置 |
|---|---|
| `quiz_page_view` | /quiz/[accessCode] page mount |
| `quiz_answered` | handleSubmit 成功 |
| `quiz_result_cta_clicked` | 成績頁「我也要當老師」點擊 |
| `report_downloaded` | handleDownloadReport 成功 |
| `report_cta_clicked` | 從 HTML report 連結點進站 |
| `referral_shared` | ShareModal 分享按鈕 |
| `signup_from_student_cta` | sign-up 頁帶 ?ref=student-* 進來 |

前 3 週先打 event 建立 baseline，之後優化才有依據。

---

## 5. 總結 — 推薦 3 個馬上做

如果您只有 1 週時間：

```
Day 1  作答頁 Footer + 成績頁 CTA（P0 ① + ②）
Day 2  報告加註冊連結（P0 ③）
Day 3-4  老師邀請同事機制（P1 ⑥）
Day 5  Event tracking 加進去（P2 衡量基礎）
```

5 天後：**每份測驗有 3 個品牌 touchpoint、1 個學生轉老師 CTA、1 個老師邀請同事機制**。

這是真正的 passive income 結構：**一次建好，每場測驗自動幫您做招商**。

---

## 附錄：關鍵檔案路徑索引

| 功能 | 檔案 | 行號 |
|---|---|---|
| 學生作答頁 | `src/app/[locale]/quiz/[accessCode]/page.tsx` | 全檔 |
| QuizTaker UI | `src/features/quiz/QuizTaker.tsx` | 1433-1689（作答）/ 368-893（結果）|
| 報告 HTML 生成 | `src/features/quiz/QuizTaker.tsx` | 462-524 |
| AIAssistant | `src/features/quiz/AIAssistant.tsx` | 全檔 |
| 單字卡頁 | `src/app/[locale]/vocab/[accessCode]/page.tsx` | 全檔 |
| ShareModal | `src/components/quiz/ShareModal.tsx` | 全檔 |
| QR Code 下載 | `src/components/quiz/ShareModal.tsx` | ~line 68 |
| OnboardingSteps | `src/components/onboarding/OnboardingSteps.tsx` | 全檔 |
| TemplateB Dashboard | `src/features/dashboard/templates/TemplateB.tsx` | 全檔 |
| StreakCard | `src/features/dashboard/StreakCard.tsx` | 全檔 |
| Sitemap | `src/app/sitemap.ts` | 7-59 |
| Blog 頁 | `src/app/[locale]/(unauth)/blog/` | 全目錄 |
| PostBody（blog CTA）| `src/features/blog/PostBody.tsx` | 85-100 |
| Response schema | `src/models/Schema.ts` | 135-146 |
