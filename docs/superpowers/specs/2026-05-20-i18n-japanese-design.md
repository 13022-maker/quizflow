# 多語系擴展 Phase 1：日文（ja）上線設計

**日期**：2026-05-20
**狀態**：Spec — 待 review
**作者**：Claude（brainstorming session 推薦選項）
**範圍 trigger**：CLAUDE.md TODO #3「多語系擴展（日／韓／英／簡中）」中的日文 phase

---

## 1. 目的與決策背景

### 為什麼挑日文先做
B2B SaaS 對日本市場最有潛力：教育預算高、付費意願強、學校採購流程成熟。先做一個語系跑完整流程（翻譯產出 → UI 落字 → SEO 取捨 → 學生作答頁 → QA），驗證工序之後韓 / 簡中可以用同一條 pipeline 批次跑，避免一次三個語系互相干擾排查不易。

### 為什麼不一次三個全上
226 keys × 3 語系 ≈ 700 條翻譯，加上 UX 細節（韓文常見較長字串、簡中與繁中容易出現假同義詞）要分別排查。一次全上會把「翻譯品質」「i18n 漏洞」「UI 截斷」三類問題混在一起 debug。

### 為什麼不做 hreflang / SEO
B2B 早期靠口碑與直銷，不靠搜尋落地。hreflang setup 屬於漸進補強，等真的有日文老師反應「Google 搜不到」再加。Out-of-scope。

---

## 2. 範圍

### In-scope
- 新增 `ja` locale（id = `ja`，name = `日本語`）到 `src/utils/AppConfig.ts`
- 產出 `src/locales/ja.json`，覆蓋 zh.json 現有 226 keys / 26 sections（與 en.json 對齊）
- LocaleSwitcher 顯示 `繁體中文 / English / 日本語` 三選一
- Pricing / Hero / Quiz 三個高曝光區塊由我（user）spot-check
- 寫一支 `scripts/translate-locale.ts`，可重用於未來韓 / 簡中
- 清掉殘留半翻譯的 `src/locales/fr.json`（沒進 AppConfig.locales 的 boilerplate 遺物）
- 部署到 production，驗證 `/ja` 路徑各主要頁面渲染正常

### Out-of-scope（明確不做）
- hreflang、sitemap 多語版本、SEO meta 多語 — 等用戶要求再加
- ko / zh-CN — 留待 Phase 2 / 3，用本 phase 寫好的腳本批次跑
- AI 出題 prompt 隨 UI locale 切換 — 老師可能要出英文閱讀題給日本學生，不該綁定
- 題目內容本身翻譯 — 老師輸入什麼語言就什麼語言
- 學生 browser locale 偵測 — 學生作答頁 chrome UI 直接跟 URL 的 `[locale]` 段
- Clerk Sign-in / Sign-up 頁日文化 — 走 Clerk 自帶 ja locale config，QuizFlow 端只設 `localization` prop 即可

---

## 3. 翻譯產出流程

### 工具
- 模型：Claude Opus 4.7（最高品質、避免「機翻味」）
- Prompt 角色：「日本教育 SaaS 本地化專家，目標讀者為日本中學～大學老師」
- 輸入：`zh.json`（來源）+ `en.json`（語意輔證 / 消歧義）
- 輸出：`ja.json`（同 schema）+ `ja.translation-notes.md`（per-section 選詞理由 / 替代方案）

### 腳本設計
位置：`scripts/translate-locale.ts`

簽名：
```bash
npx tsx scripts/translate-locale.ts --target ja --source zh --reference en
```

行為：
1. 讀 `src/locales/zh.json`、`src/locales/en.json`
2. 以 section 為單位（top-level key）逐塊送 Claude Opus，避免單次 prompt 過長
3. 每塊 prompt 帶上：來源 zh、輔證 en、QuizFlow 產品名詞表（測驗 / 試卷 / 老師 / 學生 / 房間碼 / Pro / 試用 / AI 出題 / 命題框架）
4. 解析回應 JSON，merge 進 target 檔
5. 額外請 Claude 輸出 `notes` 欄位（為什麼選這個詞、有沒有替代）→ 寫進 markdown 報告
6. 失敗時 retry 1 次；retry 仍失敗就跳過該 section 並印警告（不阻擋整體）

可重用性：`--target ko --source zh --reference en` 之後直接跑韓文版（會調整 prompt 內 "日本教育 SaaS 本地化專家" 字串）。

### 品質檢查
- Spot-check：我 user 看 Pricing / Hero / Quiz section 三個高曝光區塊
- 自動：腳本最後執行 schema diff，列出哪些 key 仍是英文 / 仍是中文（疑似漏翻）
- 部署前：跑一遍 dev server `/ja` 路徑，截圖 8-10 個關鍵頁

---

## 4. UI / Routing 變更

### AppConfig
```ts
// src/utils/AppConfig.ts
locales: [
  { id: 'en', name: 'English' },
  { id: 'zh', name: '繁體中文' },
  { id: 'ja', name: '日本語' }, // 新增
],
defaultLocale: 'zh',  // 不變
localePrefix: 'as-needed',  // 不變 → /ja/dashboard、/en/dashboard、/dashboard (zh)
```

### LocaleSwitcher
現有元件已動態 map `AppConfig.locales`，加 `ja` 即自動出現第三個選項，**不需改元件碼**。

### Middleware
無變動。next-intl middleware 吃 `AllLocales`，自動接受 `ja`。

### Clerk Sign-in / Sign-up
加入 `<ClerkProvider localization={ja}>` 條件式注入（依當下 URL locale 切換）。Clerk 官方 `@clerk/localizations` 已內建 ja。

---

## 5. 學生作答頁

### 規則
- 學生公開連結 `/quiz/[accessCode]` 仍以 `[locale]` 段決定 chrome UI 語言
- 老師複製出去的連結保留產生時的 locale（老師日文 UI 下複製 → 連結就是 `/ja/quiz/XXX`）
- 題目本身、選項、解析、reference answer **不翻譯**（老師輸入原文）
- ranking 拖拉題、單字卡 SwipeableFlashcard 等 widget 內建文字（「下一題」「提交」）跟 chrome 一致

### 不做的事
- 不依 browser `Accept-Language` 自動偵測切語言（複雜度高、踩雷多）
- 不允許學生在作答頁手動切語言（避免老師看到結果跟學生作答看到的版本對不起來造成支援困擾）

---

## 6. 風險與緩解

| 風險 | 影響 | 緩解 |
|---|---|---|
| 日文較長字串撐爆 button / nav | UI 破版 | dev server 跑完截圖檢查，遇到處改 Tailwind `truncate` 或縮字 |
| 半翻譯字串遺漏（漏 key） | 用戶看到混語介面 | 腳本 schema diff、加 unit test 驗 zh / en / ja 三檔 keys 對齊 |
| Clerk 日文化未啟用 | 註冊 / 登入頁仍英文 | 用 `@clerk/localizations` 的 `ja` import 配 ClerkProvider `localization` prop |
| AI 出題對話框文字日文化但 prompt 仍中文輸出 | 老師日文 UI 但 AI 回繁中題目 | 確認 prompt 內部硬 code 中文（不依 UI locale），這是預期行為，文件說明 |
| 半翻譯 fr.json 沒清掉 | 留垃圾、未來新成員迷惑 | 本 phase 一起刪 |

---

## 7. 驗收標準

- [ ] `/ja` 路徑下首頁 / pricing / sign-in / sign-up / dashboard / quizzes list / quiz editor / quiz taker / billing 九個頁面渲染正常（無破版、無漏字、無英文殘留）
- [ ] LocaleSwitcher 在三個 locale 之間切換可正確 round-trip URL
- [ ] zh / en / ja 三個 locale 檔 key 集合完全相同（unit test 強制）
- [ ] Pricing / Hero / Quiz 三個 section 翻譯由我 spot-check 通過
- [ ] `fr.json` 已刪除、AppConfig.locales 無遺留
- [ ] production deploy 後從日本 IP（VPN）/ Chrome `--lang=ja` mode 模擬訪問正常
- [ ] 翻譯腳本可重新跑（idempotent，不會重複寫 / 損壞既有翻譯）

---

## 8. 工序預估

| Step | 預估時間 |
|---|---|
| 寫 translate-locale.ts + dry-run | 1.5h |
| 跑腳本產出 ja.json + notes | 30min（純 Claude API 等待）|
| AppConfig + LocaleSwitcher + Clerk localization | 30min |
| 刪 fr.json | 5min |
| dev server 各頁 smoke test + 修破版 | 1-2h |
| Spot-check 三 section + 修詞 | 1-2h（我 user）|
| Commit / push / Vercel deploy / production 驗證 | 30min |

合計：4-7 小時，可一天內完成。

---

## 9. 未來 Phase 預告

- **Phase 2**：韓文（ko）— 跑同腳本，多注意韓文長字串、可能要調整 nav 寬度
- **Phase 3**：簡中（zh-CN）— 用 opencc 工具自動繁→簡轉換做第一版，再用 Claude 修詞（簡中商業用語跟繁中不同，「測驗」→「测验」一般 ok，但「儲存」→「保存」要全替換）
- **未來**：hreflang + sitemap 多語 — 等實際 SEO 需求出現再排
