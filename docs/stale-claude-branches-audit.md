# `claude/*` 遠端分支調查（2026-04-22 autonomous session）

## 摘要

實際共 **5 支** `claude/*` 分支（不是原本說的 2 支，中間又有 GitHub Action 新推的）：

| 分支 | 內容 | 狀態 | 處置建議 |
|---|---|---|---|
| `claude/review-consolidate-changes-CwagV` | 無唯一 commit（跟 main 同） | 殘留 | **直接刪** |
| `claude/fix-live-game-relation-PuzPn` | 修 0018 migration（跟已 merged 的 PR #17 `233a70a` 重複）| **PR #22 OPEN 但已過時** | **Close PR #22 + 刪分支** |
| `claude/optimize-live-mode-performance-h1hBo` | Ably + optimistic UI（跟 PR #23 + 今天 `0083fc2` 重複）| 跟現有工作高度重疊 | **評估有無獨家價值，沒則刪** |
| `claude/ai-essay-grading-6RLsZ` | AI 申論題/作文批改 | 有真功能、無 PR | **保留、您決定是否接手開 PR**|
| `claude/progress-next-steps-Ntjt1` | 日文 / 韓文語系 + AI 出題語言跟 UI | 有真功能、無 PR | **保留，契合 roadmap「多語系擴展」**|

**我不會自己動手刪**（destructive 需要您授權），以下是詳細資料供您決策。

## 逐支細節

### 1. `claude/review-consolidate-changes-CwagV` — 🗑 乾淨可刪

- **unique commits vs main**: `0`
- **last commit**: `f86424a feat(live-mode): 新增 Kahoot 風格直播競賽模式 MVP (#17)`（= 已在 main 的 squash commit）
- **PR**: 無
- **診斷**：此分支 HEAD 就是 main 的 PR #17 squash commit。應該是 GitHub Action 創了個 review 用的「consolidate」branch 後沒刪乾淨。
- **建議**：`git push origin --delete claude/review-consolidate-changes-CwagV`

### 2. `claude/fix-live-game-relation-PuzPn` — 🔁 重複勞動，PR #22 應關閉

- **unique commits**: `1`
  - `608b6b2 fix(live-mode): 修正 migration journal 時序，讓 0018_live_mode 正確執行`（14h 前）
- **PR**: [#22 OPEN](https://github.com/13022-maker/quizflow/pull/22)
- **診斷**：另一個 Claude GitHub agent 獨立試著修「migration 跑但表沒建」的詭異現象（跟我 session 裡踩的是同一個 bug）。我的修法是在 PR #17 用 commit `233a70a` 把檔名從 `20260421_live_mode.sql` 改成 `0018_live_mode.sql` + journal tag 同步。這個 agent 的修法可能不同（沒看過 diff），但目標相同且 PR #17 已把表格補到 preview-shared 也驗通。
- **建議**：
  ```bash
  gh pr close 22 --comment "Superseded by PR #17's commit 233a70a (migration filename normalized to 0018_live_mode.sql); issue already resolved on main."
  gh pr view 22 --json headRefName --jq '.headRefName' | xargs -I{} git push origin --delete {}
  ```

### 3. `claude/optimize-live-mode-performance-h1hBo` — 🔁 很可能重複，需評估

- **unique commits**: `1`
  - `3df85ce perf(live-mode): 以 Ably 取代 HTTP polling，加上 optimistic UI 與排行榜節流`（5h 前）
- **PR**: 無
- **診斷**：從 commit title 看，這支分支的三件事都跟我們做的重疊：
  - 「Ably 取代 HTTP polling」→ 我們 PR #23 已做（tick-only Ably adapter + polling fallback）
  - 「optimistic UI」→ 今早 `0083fc2` 已做（灰階 pending preview）
  - 「排行榜節流」→ **這是我們沒做的**！可能是獨家優化
- **建議**：
  1. 先 diff 看 detail：`git diff main..origin/claude/optimize-live-mode-performance-h1hBo`
  2. 若排行榜節流有真實價值 → cherry-pick 那段
  3. 其餘功能已重疊 → 刪分支

### 4. `claude/ai-essay-grading-6RLsZ` — 🌱 有獨家功能，無 PR

- **unique commits**: `1`
  - `7e9e90e feat(ai-grading): AI 申論題/作文批改（含評分量表）`（14h 前）
- **PR**: 無
- **診斷**：完全是新 feature（AI 批改申論題），與任何現存工作不重疊。agent 可能做完沒自動開 PR，或開了後又關。
- **建議**：
  - 若您要推進這功能：`gh pr create --base main --head claude/ai-essay-grading-6RLsZ ...`
  - 若暫時不要：留著分支、記成 feature backlog，之後再評估
  - **不要刪**（唯一紀錄）

### 5. `claude/progress-next-steps-Ntjt1` — 🌱 有獨家功能 + 契合 roadmap，無 PR

- **unique commits**: `1`
  - `b2118b3 feat(i18n): 新增日文 / 韓文語系 + AI 出題輸出語言隨 UI`（10h 前）
- **PR**: 無
- **診斷**：CLAUDE.md 的「🔥 下一步優先順序 3. 多語系擴展（日語、韓語、英語、簡體中文）」完全對齊。agent 做了前半（ja/ko），並順便把 AI 出題語言跟 UI 語系綁定。
- **建議**：
  - **高優先保留**
  - 拉下來看 diff，確認 zh.json / en.json / ja.json / ko.json 都有完整對齊
  - 若 OK 直接開 PR 進 main

## 動作腳本（供您一鍵跑）

```bash
# 1. 刪 review-consolidate（零風險）
git push origin --delete claude/review-consolidate-changes-CwagV

# 2. 關閉 PR #22 + 刪分支
gh pr close 22 --comment "Superseded by PR #17's 233a70a"
git push origin --delete claude/fix-live-game-relation-PuzPn

# 3. 看 optimize-live-mode-performance 的 diff 決定
git fetch origin claude/optimize-live-mode-performance-h1hBo
git diff main..origin/claude/optimize-live-mode-performance-h1hBo --stat

# 4. 對 ai-essay-grading 開 PR
gh pr create --base main --head claude/ai-essay-grading-6RLsZ \
  --title "feat: AI 申論題/作文批改（含評分量表）" \
  --body "From orphaned Claude Agent branch. Review then decide whether to merge."

# 5. 對 progress-next-steps（i18n ja/ko）開 PR
gh pr create --base main --head claude/progress-next-steps-Ntjt1 \
  --title "feat(i18n): 新增日文 / 韓文語系 + AI 出題輸出語言隨 UI" \
  --body "Aligns with CLAUDE.md roadmap priority 3 (多語系擴展)."
```

## 給 CLAUDE.md 的一行 meta 教訓

Claude GitHub Action 經常**在您不在線時推新分支但不自動開 PR**，導致工作漏失。建議考慮：
- 設 GitHub Actions 排程檢查：每天列出無 PR 的 `claude/*` 分支給您
- 或在 CLAUDE.md 固化「Claude Agent 推分支必開 PR」的約定
