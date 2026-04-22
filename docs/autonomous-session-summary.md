# 2 小時自駕 Session 成果總覽（2026-04-22）

## 三份研究報告已產出

| # | 報告 | 檔案 |
|---|---|---|
| 1 | Live Mode i18n 稽核（50 條中文 + 建議 key 結構 + 11 檔對照表 + 實作順序）| [`docs/live-mode-i18n-audit.md`](./live-mode-i18n-audit.md) |
| 2 | Drizzle migration snapshot 修復計畫（4 個缺洞 + 三方案 + 推薦）| [`docs/drizzle-snapshot-repair-plan.md`](./drizzle-snapshot-repair-plan.md) |
| 3 | `claude/*` 殘留分支調查（5 支全掃 + 處置建議 + 可一鍵腳本）| [`docs/stale-claude-branches-audit.md`](./stale-claude-branches-audit.md) |

## Task 5 — Ably Production Log 觀察：⏸ 阻塞

**原因**：session 中途 Vercel CLI 登入憑證被清空（可能被某次 `--environment production` 指令或 session 超時打亂），重抓 log 需要 OAuth 登入，我無法互動式 auth。

**您回來後的動作（30 秒）：**
```bash
vercel login
# 瀏覽器完成 auth 後，回來跑：
vercel logs --since 4h --limit 200 --query "/api/live/ably-auth" --no-branch --expand
```

或者我可以幫您分析，若您願意 paste log output，我幫您比對：
- `/api/live/ably-auth` 成功率（200 vs 500 vs 307）
- Function invocation 總量跟昨天 polling 版對比（應該顯著下降）
- WebSocket 連線建立率（間接從 ably-auth success 次數推估）

## 關鍵洞察摘要（不讀報告也能看的）

### i18n 稽核：比想像的小

- 11 檔、約 50 條需翻譯字串，**3 小時人工可收工**
- 推薦單一 `LiveMode` namespace + 子分組（common/host/player/leaderboard/chart）
- 最大一檔：`LiveHostLobby.tsx`（9 條）；最小：`LiveResultChart.tsx`（1 條）
- 有 5 條含變數插值（題號 / 人數 / 分數），用 next-intl ICU 語法

### Drizzle snapshot：CLAUDE.md 擔憂已過時

- 真實狀況：**0018 snapshot 已含完整 18 tables**，`db:generate` 不會把 vocab / marketplace 當 diff 重複產
- 缺洞是 0001、0015、0016、0017（CLAUDE.md 寫 0015-0017，漏算 0001）
- 唯一實際影響是 `drizzle-kit drop` 的 partial rollback 功能（實務上不用）
- **推薦：方案 A 什麼都不做**；CLAUDE.md 那段建議改寫（我在報告裡給了新文案）

### claude/* 分支：5 支竟然有 3 支重複勞動

| 分支 | 處置 |
|---|---|
| `review-consolidate-changes-CwagV` | 直接刪（0 unique commits）|
| `fix-live-game-relation-PuzPn` (PR #22) | Close PR + 刪分支（跟已 merged 的 `233a70a` 重複）|
| `optimize-live-mode-performance-h1hBo` | 評估 — 排行榜節流可能是獨家，Ably + optimistic 跟我們重複 |
| `ai-essay-grading-6RLsZ` | 保留，**新 feature（AI 批改申論題）** |
| `progress-next-steps-Ntjt1` | 保留，**ja/ko 語系 + AI 出題跟 UI 同語**（契合 roadmap）|

其中 2 支有**獨家 feature** 值得開 PR 進 main，別錯過。

### 觀察到的系統性問題

Claude GitHub Action 在您不在線時**頻繁推分支但不自動開 PR**，導致：
- 可能丟失有價值的工作（14h 前的 AI 批改功能沒開 PR）
- 同時間不同 agent 重複做同一件事（1 個修 migration、1 個做 Ably、我們在對話中也做了同件）

建議加一個 daily GitHub Actions scheduled job，列出 7 天內無 PR 的 `claude/*` 分支 email 給您。

## 您回來後建議的下一步

按優先順序：

1. **瀏覽 3 份報告**（約 15 分鐘）
2. **打 `vercel login` 抓 Ably log**（30 秒）丟給我分析
3. **關閉 PR #22 + 刪 2 支已完工分支**（照 audit 報告的一鍵腳本）
4. **評估 `ai-essay-grading` + `progress-next-steps`** 是否要開 PR merge
5. **更新 CLAUDE.md 的 Drizzle 段落**（我在 drizzle 報告有新文案）

## 未處理但有發現

- `.claude/commands/integrate-ai-prompts.md` 仍擱置（等 `docs/prompts/*.md` 兩份模板）
- 沒產生 `.env.example`（我沒動到 middle-risk 任務，您選的組合只含純研究）
