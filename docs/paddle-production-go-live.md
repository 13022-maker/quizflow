# Paddle Production 上線清單（2026-11，使用者決定正式收費）

> 本清單由 `feat/paddle-production-ready` PR 產出。程式碼端已就緒：env 缺漏時按鈕顯示「即將開放」、API 回 503，不會讓 build 或頁面炸掉。
> 以下步驟**只能由你本人**在 Paddle Dashboard / Vercel 操作（涉及秘密金鑰與帳號驗證）。請依序勾選。
>
> - 正式站：`https://quizflow-psi.vercel.app`
> - Vercel project：`prj_erhgb3s2nbDDJRQxd4Tr9IapM7dh`（team `team_z70tsbdxYKp6SbUSjUp5bZiF`）
> - Webhook URL：`https://quizflow-psi.vercel.app/api/webhook`

---

## 0. 先合併程式碼

- [ ] Review 並 merge `feat/paddle-production-ready` PR 到 `main`（此時 production 還沒有 Paddle 金鑰，定價頁會出現、付費按鈕顯示「即將開放」，屬預期行為）
- [ ] 確認 production 部署成功後，打開 `https://quizflow-psi.vercel.app/zh/pricing` 看得到三個方案與價格（Paddle 審核員會看這頁）

## 1. 法務頁面（Paddle domain approval 必審）

路由都已存在且從 Footer 可點到（未登入可看、回 200）：

| 頁面 | 路由 | 檔案 |
|---|---|---|
| 服務條款 | `/terms` | `src/app/[locale]/(unauth)/terms/page.tsx` |
| 隱私權政策 | `/privacy` | `src/app/[locale]/(unauth)/privacy/page.tsx` |
| 退款政策 | `/refund` | `src/app/[locale]/(unauth)/refund/page.tsx` |

**但內容有幾處 Paddle 審核大概率會退件，請先自己修文字（法律文字由你決定，本 PR 沒有改）**：

- [ ] **服務條款加上法定名稱**：目前只寫「由 prpispace 所提供」。Paddle 要求條款內有公司名稱，個人（sole proprietor）建議寫**本名**（或「本名 dba QuizFlow」）
- [ ] **服務條款加 Merchant of Record 條款**，例如：「本平台之訂單由 Paddle.com 擔任經銷商（Merchant of Record）處理，付款、稅務與收據由 Paddle 提供。」
- [ ] **服務條款第三條方案描述過時**：寫「Pro 方案：每月 $9 美元」「免費方案…不含 AI 自動生題功能」，與現行 NT$299/月、NT$2,490/年、Free 每月 10 次 AI 不符 → 改成與 `/pricing` 一致（或改成「詳見定價頁」）
- [ ] **退款政策要放寬**：目前是「訂閱後 7 天內且從未使用 Pro 功能」+「不提供已使用計費週期的退款」。Paddle 對 seller 的退款政策要求 change-of-mind 退款期至少 **14 天**，且避免「概不退款」類限制語 → 建議改成「訂閱後 14 天內可申請全額退款」（或直接引用 Paddle 的 buyer 退款政策），並註明可透過 `paddle.net` 或來信申請
- [ ] **隱私權政策加上 Paddle**：在「資料提供給第三方」段落列出 Paddle（付款處理 / Merchant of Record），並寫明你的名稱與聯絡信箱
- [ ] 確認 `support@quizflow.app` 這個信箱**真的收得到信**（三頁都用它；Paddle 審核與買家都會寄這裡）。若沒有這個網域信箱，改成你實際使用的信箱

## 2. Paddle live 帳號驗證

- [ ] 登入 **Paddle live**（`vendors.paddle.com`，不是 sandbox）→ 完成 **Business verification / Identity verification**（身分證件、收款銀行帳戶、稅務資料）
- [ ] **Domain approval**：Checkout → Website approval 提交 `quizflow-psi.vercel.app`
  - 審核看：產品說明、定價頁、功能、三份政策可從導覽點到、條款內有你的名稱、HTTPS
  - 注意：`*.vercel.app` 子網域 Paddle 文件沒有明說禁止，但若被退件，最穩的解法是買自有網域（例如 `quizflow.app`），綁到 Vercel 後重新提交，並把下面所有 URL 換成新網域
  - 只有在 approved domain 上才能開 live checkout；preview 部署網址不會被核准，live checkout 只能在正式站測
- [ ] **Default payment link**：Checkout → Checkout settings → Default payment link 設為 `https://quizflow-psi.vercel.app/zh/pricing`（Paddle 規定一定要設；頁面已載入 Paddle.js，會自動處理 `?_ptxn=`）

## 3. Paddle live 產品 / 價格核對

- [ ] Catalog → Products 確認 Price 都是 **Active**，幣別 **TWD**，金額與網站一致（學校方案 2 個 Price 見下方註記）：

| env | Price ID | 方案 | 金額 | 週期 |
|---|---|---|---|---|
| `NEXT_PUBLIC_PADDLE_PRICE_PRO_MONTHLY` | `pri_01kp3nbts21fh1saqfxgat7kgb` | Pro 老師 | NT$299 | 每月 |
| `NEXT_PUBLIC_PADDLE_PRICE_PRO_YEARLY` | `pri_01kp3nerfqeama1ga5b54vgpk6` | Pro 老師 | NT$2,490 | 每年 |
| `NEXT_PUBLIC_PADDLE_PRICE_TEAM_MONTHLY` | `pri_01kp3nhjp1xw9g1jyxvxynhtp4` | 學校方案（**暫不設定 env**） | NT$1,990 | 每月 |
| `NEXT_PUBLIC_PADDLE_PRICE_TEAM_YEARLY` | `pri_01kp3nnjdzkj64jv7ra0ygtaf1` | 學校方案（**暫不設定 env**） | NT$16,990 | 每年 |

  > 網站顯示價格來源：`src/utils/AppConfig.ts`（`price` / `yearlyPrice`，有 `AppConfig.pricing.test.ts` 守門）與 `src/components/pricing/PricingSection.tsx`。改價要三處一起改。
  > **學校方案（Team）暫不開放**：Paddle 端的 Team 月/年 Price 可以保留（Active 也無妨），但**不要對外**（不要放進任何 payment link、email、文件）。網站上不會出現 Team 結帳入口，因為 Vercel 不設 `NEXT_PUBLIC_PADDLE_PRICE_TEAM_*`（見第 6 節）。
- [ ] 確認 Pro 2 個 ID 是在 **live** 帳號看到的（sandbox 的 ID 在 live 不存在，結帳會失敗）
- [ ] 確認稅務設定（Tax category = SaaS；價格是否含稅）符合你的預期

## 4. Paddle live 金鑰

- [ ] Developer tools → Authentication → **建立 API key**（`pdl_live_apikey_...`），權限至少要能：建立/讀取 **Customers**、建立 **Customer portal sessions**（若有 scope 選項）
- [ ] Developer tools → Authentication → **Client-side token**（`live_...`）

## 5. Paddle live webhook destination

- [ ] Developer tools → Notifications → **New destination**
  - Type：URL
  - URL：`https://quizflow-psi.vercel.app/api/webhook`
  - API version：用帳號預設的 Paddle Billing（v1 Billing API / notifications v2 格式，與 sandbox 那條相同設定）
  - Usage type：Platform（不是 simulation）
  - 勾選事件（程式只處理這些，其他事件會被 200 略過）：
    - [ ] `subscription.created`
    - [ ] `subscription.updated`
    - [ ] `subscription.activated`
    - [ ] `subscription.canceled`
    - [ ] `subscription.past_due`
    - [ ] `subscription.paused`
    - [ ] `subscription.resumed`
    - [ ] `subscription.trialing`
- [ ] 建立後複製 **Secret key**（`pdl_ntfset_...`）給下一步的 `PADDLE_WEBHOOK_SECRET`

## 6. Vercel production env

目前 production（2026-11-14 只讀檢查）**已有**：`NEXT_PUBLIC_PADDLE_ENV`、4 個 `NEXT_PUBLIC_PADDLE_PRICE_*`（2026-04-20 建立、類型 sensitive，值無法讀回確認）。
**缺**：`PADDLE_API_KEY`、`NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`、`PADDLE_WEBHOOK_SECRET`。

> **學校方案暫不開放：不要設定 `NEXT_PUBLIC_PADDLE_PRICE_TEAM_MONTHLY` / `NEXT_PUBLIC_PADDLE_PRICE_TEAM_YEARLY`。**
> 原因：程式尚未實作學校方案的席次 / 團隊功能（`teamMember: 30` 只是設定值，沒有邀請老師、共用席次的流程），現在開放結帳會收到錢卻給不出承諾的功能。
> 兩個 TEAM env 未設時：定價頁學校卡按鈕顯示「即將開放」且無法點（`PricingCard.test.tsx` 守門）；就算有人直接打 API 帶 Team priceId，`/api/paddle/checkout` 也會回 400 `INVALID_PRICE`（`route.test.ts` 守門）。
> 既有的 2 個 production TEAM env 要**刪掉不重設**（下面指令已處理）。

因為已存在的值看不到，**建議全部刪掉、只重設需要的**，確保是 live 值：

```bash
# 在 repo 目錄，已 vercel link 到 quizflow 專案
vercel env rm NEXT_PUBLIC_PADDLE_ENV production -y
vercel env rm NEXT_PUBLIC_PADDLE_PRICE_PRO_MONTHLY production -y
vercel env rm NEXT_PUBLIC_PADDLE_PRICE_PRO_YEARLY production -y
vercel env rm NEXT_PUBLIC_PADDLE_PRICE_TEAM_MONTHLY production -y
vercel env rm NEXT_PUBLIC_PADDLE_PRICE_TEAM_YEARLY production -y

# 公開值（可直接 pipe）
printf 'production' | vercel env add NEXT_PUBLIC_PADDLE_ENV production
printf 'pri_01kp3nbts21fh1saqfxgat7kgb' | vercel env add NEXT_PUBLIC_PADDLE_PRICE_PRO_MONTHLY production
printf 'pri_01kp3nerfqeama1ga5b54vgpk6' | vercel env add NEXT_PUBLIC_PADDLE_PRICE_PRO_YEARLY production
# 學校方案暫不開放：TEAM 兩個 env 刪掉後「不要」加回

# 秘密值：不加 pipe，讓 CLI 互動式提示貼上（避免留在 shell history）
vercel env add PADDLE_API_KEY production              # 貼 pdl_live_apikey_...
vercel env add NEXT_PUBLIC_PADDLE_CLIENT_TOKEN production  # 貼 live_...
vercel env add PADDLE_WEBHOOK_SECRET production       # 貼 pdl_ntfset_...
```

- [ ] `vercel env ls production | grep PADDLE` 確認 6 個都在（ENV、PRO_MONTHLY、PRO_YEARLY、API_KEY、CLIENT_TOKEN、WEBHOOK_SECRET），而且**沒有** `NEXT_PUBLIC_PADDLE_PRICE_TEAM_*`
- [ ] **不需要**設 `NEXT_PUBLIC_PRICING_ENABLED`（預設就是開啟；它只是回滾用的 kill switch）
- [ ] **重新部署 production**（`NEXT_PUBLIC_*` 是 build 時寫進 bundle，改 env 後一定要 redeploy）：Vercel Dashboard → Deployments → 最新 production → Redeploy（不要勾 use existing build cache）

## 7. 清掉 preview 綁的 sandbox env

只讀檢查結果：sandbox 那組 env 全部**只綁 `feature/paddle-sandbox` 分支**（該分支已刪），其他 preview 部署拿不到，所以目前無害；但留著容易混淆，建議清掉：

```bash
for k in PADDLE_API_KEY NEXT_PUBLIC_PADDLE_CLIENT_TOKEN NEXT_PUBLIC_PADDLE_ENV \
  NEXT_PUBLIC_PADDLE_PRICE_PRO_MONTHLY NEXT_PUBLIC_PADDLE_PRICE_PRO_YEARLY \
  NEXT_PUBLIC_PADDLE_PRICE_TEAM_MONTHLY NEXT_PUBLIC_PADDLE_PRICE_TEAM_YEARLY \
  PADDLE_WEBHOOK_SECRET BILLING_PLAN_ENV DATABASE_URL; do
  vercel env rm "$k" preview feature/paddle-sandbox -y
done
```

- [ ] 上面指令只刪 `feature/paddle-sandbox` 分支的值；**不要**動 production 的 `DATABASE_URL` / `BILLING_PLAN_ENV`
- [ ] Neon：刪除 preview branch `preview-paddle-sandbox`（`br-mute-darkness-a1i746p8`）
- [ ] Paddle **sandbox**：停用 webhook destination `ntfset_01kp66qw6wj7f3z0htq5ktg2qy`（它指向舊 preview URL）
- [ ] 之後若要在 preview 測 sandbox，再用「綁特定分支」的方式加回，**不要**綁全部 preview（會讓所有 preview 連到 sandbox DB / 金鑰）

## 8. 上線後快速檢查（不花錢）

- [ ] `https://quizflow-psi.vercel.app/zh/pricing`：Pro 方案按鈕顯示「立即訂閱」（不是「即將開放」）；學校方案按鈕顯示「即將開放」且無法點（月繳 / 年繳都要切換確認）
- [ ] 未登入點「立即訂閱」→ 導到登入頁，登入後回定價頁
- [ ] `curl -s -o /dev/null -w '%{http_code}\n' -X POST https://quizflow-psi.vercel.app/api/webhook -d '{}'` → 應為 **400**（簽章錯誤）。若是 **503** 代表 `PADDLE_WEBHOOK_SECRET` 沒生效（忘了 redeploy？）
- [ ] 瀏覽器 DevTools Console 沒有 Paddle.js 初始化錯誤

## 9. 真卡小額 smoke test（付款 → webhook → DB → 退款）

建議用**非 VIP 的第二個 Google 帳號**，選最便宜的 **Pro 月繳 NT$299**。

1. [ ] 用測試帳號登入 → `/dashboard/billing` → 選「月繳」→「立即升級 Pro」→ Paddle overlay 用**真實信用卡**付款
2. [ ] 付款後被導回 `/dashboard?checkout=success`，看到「訂閱成功」banner
3. [ ] Paddle Dashboard → Developer tools → Notifications → 該 destination 的 Logs：`subscription.created` / `subscription.activated` 等回應 **200**
4. [ ] Neon production SQL Editor：
   ```sql
   select clerk_user_id, paddle_customer_id from paddle_customer order by created_at desc limit 3;
   select clerk_user_id, plan, status, billing_cycle, current_period_end, cancel_at_period_end
     from subscription order by created_at desc limit 3;
   ```
   應看到該帳號一筆 `plan=pro`、`status=active`、`billing_cycle=month`
5. [ ] 重新整理 `/dashboard/billing`：顯示「Pro 老師」，出現「管理訂閱 / 取消 / 收據」按鈕，點下去能開 Paddle customer portal
6. [ ] **退款**：Paddle Dashboard → Transactions → 該筆 → Refund（全額）
7. [ ] **取消訂閱**（退款不會自動取消）：Subscriptions → 該筆 → Cancel → **Immediately**
8. [ ] Webhook log 出現 `subscription.canceled` 200；SQL 再查一次 `status=canceled`；`/dashboard/billing` 回到免費版 / 試用狀態
9. [ ] 確認退款金額有回到卡上（5–10 個工作天）

## 10. 回滾方式（由輕到重）

| 情境 | 做法 | 影響 |
|---|---|---|
| 只想先隱藏定價入口 | `printf 'false' \| vercel env add NEXT_PUBLIC_PRICING_ENABLED production` → redeploy | navbar / footer / 首頁定價區塊 / dashboard「定價」消失，`/pricing` 回 404。**billing 頁升級按鈕仍可用** |
| 暫停所有新結帳 | `vercel env rm NEXT_PUBLIC_PADDLE_CLIENT_TOKEN production -y` + `vercel env rm PADDLE_API_KEY production -y` → redeploy | 所有付費按鈕變「即將開放」，`/api/paddle/checkout` 回 503 |
| 新版程式有問題 | Vercel Dashboard → Deployments → 上一個正常的 production deployment → **Instant Rollback / Promote** | 回到舊程式；env 不受影響 |

- **不要**刪 `PADDLE_WEBHOOK_SECRET` 或停用 live webhook destination：已付費用戶的續訂 / 取消仍要同步進 DB，否則他們會被錯判成 Free（Paddle 收到 503 會重送，補 env 後可補上）
- Paddle 端若要完全停止收款：Paddle Dashboard 停用（archive）4 個 Price
