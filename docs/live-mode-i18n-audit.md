# Live Mode i18n 稽核（2026-04-22 autonomous session）

## 摘要

- 掃描範圍：`src/features/live/*`、`src/app/[locale]/live/*`、`src/app/[locale]/(auth)/dashboard/live/*`
- 檔案數：11
- 需翻譯字串數：**約 50 條**（UI label / button / status / error message / page metadata）
- 可略過（註解 / 內部字）：約 10 條
- 建議 i18n namespace：**`LiveMode`**（統一集中）、或拆成 `LiveHost` / `LivePlayer` / `LiveShared` 三組

## 建議 i18n key 結構（範例）

```jsonc
{
  "LiveMode": {
    "meta": {
      "player_title": "加入直播測驗 | QuizFlow",
      "play_title": "直播測驗 | QuizFlow"
    },
    "common": {
      "loading": "載入中⋯",
      "connecting": "連線中⋯",
      "back_to_quiz_list": "← 返回測驗列表",
      "back": "← 返回"
    },
    "host": {
      "lobby_instruction": "請學生掃描 QR Code，或輸入 PIN 加入",
      "game_pin": "遊戲 PIN",
      "copy_hint_default": "點擊可複製",
      "copy_hint_copied": "已複製！",
      "join_url": "加入網址",
      "joined_players": "已加入玩家",
      "waiting_for_players": "等待玩家加入⋯",
      "start_game": "🚀 開始遊戲",
      "end": "結束",
      "need_at_least_one_player": "需要至少 1 位玩家才能開始",
      "show_answer": "顯示答案",
      "show_leaderboard": "顯示排行榜",
      "next_question": "下一題",
      "question_number": "第 {index} 題",
      "answered_count": "{count} 人已答",
      "time_remaining": "剩餘時間",
      "load_host_title": "載入中⋯（PIN：{pin}）",
      "not_found_title": "找不到直播或沒有權限"
    },
    "player": {
      "join_title": "加入直播測驗",
      "join_subtitle": "輸入 6 碼 PIN 與你的暱稱",
      "pin_label": "遊戲 PIN",
      "nickname_label": "你的暱稱",
      "join_button": "加入",
      "joining": "加入中⋯",
      "join_failed": "加入失敗",
      "network_error": "網路錯誤，請重試",
      "waiting_for_host_title": "等待老師開始⋯",
      "your_nickname": "你的暱稱：",
      "rejoin": "重新加入",
      "loading_question": "載入題目中⋯",
      "your_score": "你的分數：",
      "time_remaining_short": "剩餘",
      "submit": "送出答案",
      "submitting": "送出中⋯",
      "submitted_waiting": "已送出，等待其他玩家⋯",
      "correct": "✅ 答對了！",
      "incorrect": "❌ 答錯了",
      "score_unit": "分",
      "timeout": "⏱ 時間到，未作答",
      "url_malformed": "網址格式錯誤"
    },
    "leaderboard": {
      "final_title": "🏆 最終排行榜",
      "no_players": "沒有玩家資料",
      "you_marker": "你",
      "correct_count": "答對 {count} 題"
    },
    "chart": {
      "total_answers": "共 {count} 份作答"
    }
  }
}
```

## 檔案清單（含 line number + 字串）

### `src/app/[locale]/live/play/[gameId]/page.tsx`

| 行 | 原文 | 類型 | 建議 key |
|---|---|---|---|
| 4 | `'直播測驗 | QuizFlow'` | page metadata | `LiveMode.meta.play_title` |
| 16 | `網址格式錯誤` | error | `LiveMode.player.url_malformed` |

### `src/app/[locale]/live/join/page.tsx`

| 行 | 原文 | 類型 | 建議 key |
|---|---|---|---|
| 4 | `'加入直播測驗 | QuizFlow'` | page metadata | `LiveMode.meta.player_title` |

### `src/app/[locale]/live/play/[gameId]/LivePlayRoom.tsx`

| 行 | 原文 | 類型 | 建議 key |
|---|---|---|---|
| 43 | `載入中⋯` | status | `LiveMode.common.loading` |
| 68 | `重新加入` | button | `LiveMode.player.rejoin` |
| 77 | `連線中⋯` | status | `LiveMode.common.connecting` |
| 89 | `等待老師開始⋯` | heading | `LiveMode.player.waiting_for_host_title` |
| 91 | `你的暱稱：` | label | `LiveMode.player.your_nickname` |

### `src/app/[locale]/(auth)/dashboard/live/host/[gameId]/page.tsx`

| 行 | 原文 | 類型 | 建議 key |
|---|---|---|---|
| 40 | `找不到直播或沒有權限` | error | `LiveMode.host.not_found_title` |
| 45 | `← 返回測驗列表` | button | `LiveMode.common.back_to_quiz_list` |

### `src/app/[locale]/(auth)/dashboard/live/host/[gameId]/LiveHostRoom.tsx`

| 行 | 原文 | 類型 | 建議 key |
|---|---|---|---|
| 31 | `載入中⋯（PIN：` | status（含變數） | `LiveMode.host.load_host_title`（含 `{pin}`）|
| 46 | `← 返回` | button | `LiveMode.common.back` |

### `src/features/live/LiveHostLobby.tsx`

| 行 | 原文 | 類型 | 建議 key |
|---|---|---|---|
| 38 | `請學生掃描 QR Code，或輸入 PIN 加入` | instruction | `LiveMode.host.lobby_instruction` |
| 45 | `遊戲 PIN` | label | `LiveMode.host.game_pin` |
| 55 | `已複製！ / 點擊可複製` | status | `LiveMode.host.copy_hint_copied` / `.copy_hint_default` |
| 61 | `加入網址` | label | `LiveMode.host.join_url` |
| 77 | `已加入玩家` | label | `LiveMode.host.joined_players` |
| 88 | `等待玩家加入⋯` | status | `LiveMode.host.waiting_for_players` |
| 111 | `🚀 開始遊戲` | button | `LiveMode.host.start_game` |
| 119 | `結束` | button | `LiveMode.host.end` |
| 124 | `需要至少 1 位玩家才能開始` | helper | `LiveMode.host.need_at_least_one_player` |

### `src/features/live/LivePlayerJoin.tsx`

| 行 | 原文 | 類型 | 建議 key |
|---|---|---|---|
| 41 | `加入失敗`（error fallback） | error | `LiveMode.player.join_failed` |
| 47 | `網路錯誤，請重試` | error | `LiveMode.player.network_error` |
| 57 | `加入直播測驗` | heading | `LiveMode.player.join_title` |
| 59 | `輸入 6 碼 PIN 與你的暱稱` | subheading | `LiveMode.player.join_subtitle` |
| 66 | `遊戲 PIN` | label | `LiveMode.player.pin_label` |
| 81 | `你的暱稱` | label | `LiveMode.player.nickname_label` |
| 103 | `加入中⋯ / 加入` | button | `LiveMode.player.joining` / `.join_button` |

### `src/features/live/LivePlayerQuestion.tsx`

| 行 | 原文 | 類型 | 建議 key |
|---|---|---|---|
| 36 | `載入題目中⋯` | status | `LiveMode.player.loading_question` |
| 83 | `你的分數：` | label | `LiveMode.player.your_score` |
| 92 | `剩餘` | label | `LiveMode.player.time_remaining_short` |
| 146 | `送出中⋯ / 送出答案` | button | `LiveMode.player.submitting` / `.submit` |
| 151 | `已送出，等待其他玩家⋯` | status | `LiveMode.player.submitted_waiting` |
| 163 | `✅ 答對了！ / ❌ 答錯了` | result | `LiveMode.player.correct` / `.incorrect` |
| 170 | `分` | unit | `LiveMode.player.score_unit` |
| 177 | `⏱ 時間到，未作答` | status | `LiveMode.player.timeout` |

### `src/features/live/LiveQuestionScreen.tsx`（host 端）

| 行 | 原文 | 類型 | 建議 key |
|---|---|---|---|
| 31 | `載入題目中⋯` | status | `LiveMode.common.loading` |
| 43-51 | `第 N 題` | heading（含變數） | `LiveMode.host.question_number`（含 `{index}`）|
| 60 | `人已答` | label（含變數）| `LiveMode.host.answered_count`（含 `{count}`）|
| 82 | `剩餘時間` | label | `LiveMode.host.time_remaining` |
| 110 | `顯示答案` | button | `LiveMode.host.show_answer` |
| 115 | `顯示排行榜 / 下一題` | button | `LiveMode.host.show_leaderboard` / `.next_question` |

### `src/features/live/LiveLeaderboard.tsx`

| 行 | 原文 | 類型 | 建議 key |
|---|---|---|---|
| 17 | `🏆 最終排行榜` | heading | `LiveMode.leaderboard.final_title` |
| 23 | `沒有玩家資料` | empty state | `LiveMode.leaderboard.no_players` |
| 45 | `你` | badge | `LiveMode.leaderboard.you_marker` |
| 50-54 | `答對 N 題` | label（含變數）| `LiveMode.leaderboard.correct_count`（含 `{count}`）|

### `src/features/live/LiveResultChart.tsx`

| 行 | 原文 | 類型 | 建議 key |
|---|---|---|---|
| 49-53 | `共 N 份作答` | label（含變數）| `LiveMode.chart.total_answers`（含 `{count}`）|

## 建議實作順序

1. **先定調 namespace**：決定採「單一 `LiveMode`」或拆 `LiveHost` / `LivePlayer` / `LiveShared`。本報告先示範單一 namespace 方案。
2. **zh.json 填上完整繁中 key**（以上表格為準）
3. **en.json 平行翻譯**（可一次全翻，或先 skeleton 留待人工校對）
4. **逐檔替換** — 建議從少字串的檔案開始暖身：
   - LiveResultChart（1 條）→ LivePlayRoom（5 條）→ LiveHostRoom（2 條）→ LiveLeaderboard（4 條）→ LiveQuestionScreen（6 條）→ LivePlayerQuestion（8 條）→ LivePlayerJoin（7 條）→ LiveHostLobby（9 條）
5. **Next.js Metadata 的 title 不能直接用 `useTranslations()`**（不是 client component），需改用 `getTranslations()` from `next-intl/server`
6. **含變數插值的字串**（`question_number`、`answered_count`、`correct_count`、`total_answers`、`load_host_title`）用 next-intl 的 ICU `{varname}` 語法
7. **驗證**：每改一檔，切到 `/en/dashboard/live/host/...` 跟 `/zh/...` 比對兩語系是否一致

## 時間估計

- 定 namespace + 填 50 條 zh + en key：~1 小時
- 11 檔逐步替換 + 驗證：~2 小時
- 合計：~3 小時工

## 風險備註

- 部分字串含 emoji（🚀、🏆、✅、❌、⏱）：建議保留 emoji 於翻譯 key value（跨語系通用）
- 部分字串含 `…` 用 unicode `U+22EF`（⋯，中文省略號）：英文翻譯建議改 `...`（ASCII 三點）
- Error fallback `'加入失敗'`：API 層錯誤訊息本身也是中文（需一併改）
- 本次僅涵蓋 Live Mode；整站其他中文硬寫（例：QuizEditor 新功能、AIQuizModal、後台 admin）未在範圍內
