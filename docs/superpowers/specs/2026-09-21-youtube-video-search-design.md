# 適性學習「YouTube 匯入」加搜尋教學影片功能 設計文件

- 日期：2026-09-21
- 起因：目前「從 YouTube 匯入」要求老師自己在 YouTube 上找到合適影片、複製網址貼過來。老師想要在
  QuizFlow 裡直接搜尋，系統依「適不適合教學」排序候選影片，選了就自動填進網址欄。
- 範圍：只加搜尋+排序+選取這段，不動既有的抽字幕／AI 生成／草稿發佈流程；不動一般測驗出題
  （`generate-from-url`）既有的 YouTube 匯入功能。

## 使用者決策（brainstorming 階段已確認）

1. **資料來源**：YouTube Data API v3（官方），需要新增 `YOUTUBE_API_KEY` 環境變數（server-only，
   optional——沒設就「搜尋影片」入口整個隱藏，不影響既有貼網址流程，比照 `ABLY_API_KEY` 的
   fallback 慣例）。
2. **排序標準**（複合評分，全部採用）：
   - 手動字幕優先於自動字幕（必選）
   - 時長適中（5~20 分鐘）
   - YouTube 分類 = 教育（categoryId `27`）
   - 與搜尋關鍵字的相關度（YouTube 自己的 relevance 排序當基礎）
3. **成本取捨**：手動/自動字幕判斷用 `captions.list`（一次 50 units，遠比 `search.list` 的
   100 units／次貴）。**兩階段設計**：先用便宜訊號（相關度＋時長＋分類）粗排 25 支候選，取前
   10~12 名才對這個縮小後的名單查 `captions.list`，精排後回傳前 8 筆。一次搜尋約 600 units，
   免費額度（10,000 units/日）約可搜尋 16 次/日，之後真的不夠再跟 Google 申請提高額度。
4. **UI 位置**：接在現有「從 YouTube 匯入」tab 裡，貼網址 textarea 上方加「🔍 搜尋教學影片」入口，
   不做獨立頁面。
5. **Quota**：搜尋本身不計入現有 AI quota（`checkAndIncrementAiUsage`）——搜尋不叫 AI，quota
   只在後續按「開始生成」時才照既有邏輯扣一次，跟現況一致。

## 架構

```
NewSubjectForm.tsx（YouTube tab，textarea 上方加搜尋區塊；由 youtubeSearchEnabled prop 控制顯示）
  ├─ 老師輸入關鍵字 → searchYoutubeVideos({ query })  [新 server action]
  │     src/actions/youtubeSearchActions.ts
  │       └─ searchYoutubeTeachingVideos(query)  [純邏輯，src/libs/youtubeSearch.ts]
  │            1. search.list（q, type=video, videoCaption=closedCaption,
  │               relevanceLanguage=zh-Hant, regionCode=TW, maxResults=25）
  │               — videoCaption=closedCaption 官方參數，直接篩掉沒字幕影片
  │            2. videos.list（批次查 25 支的 duration/viewCount/categoryId，1 unit）
  │            3. coarseRank()：relevance + duration fit + 教育分類加分，排序取前 12 名
  │            4. fetchCaptionKinds()：對前 12 名逐支呼叫 captions.list（各 50 units）
  │            5. refineRank()：疊加字幕類型加權，重新排序，取前 8 筆回傳
  │
  └─ 老師看縮圖/標題/頻道/時長/字幕類型 badge，點「加入」→ 網址填進既有 youtubeUrlsText
     （沿用既有 validateYoutubeImportUrls 的 5 支上限與格式驗證，不另寫一套）

new-subject/page.tsx（Server Component）
  └─ youtubeSearchEnabled = Boolean(process.env.YOUTUBE_API_KEY)，當 prop 傳給 NewSubjectForm
     （secret 存在與否的判斷留在伺服器端，只有 boolean 跨到 client）
```

## 改動點

### 1. `src/libs/Env.ts` — 新增可選環境變數

```ts
server: {
  // ...既有欄位...
  YOUTUBE_API_KEY: z.string().optional(), // 搜尋教學影片功能（未設則「搜尋影片」入口隱藏）
},
runtimeEnv: {
  // ...既有欄位...
  YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
},
```

### 2. `src/libs/youtubeSearch.ts`（新檔）— 純邏輯：呼叫 API、解析、排序

```ts
export type SearchCandidate = {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  durationSec: number;
  viewCount: number;
  categoryId: string;
};

export type RankedCandidate = SearchCandidate & {
  captionKind: 'manual' | 'auto';
};

const DURATION_SWEET_MIN = 300; // 5 分鐘
const DURATION_SWEET_MAX = 1200; // 20 分鐘
const EDUCATION_CATEGORY_ID = '27';
const COARSE_SHORTLIST_SIZE = 12;
const FINAL_RESULT_SIZE = 8;
const WEIGHT_RELEVANCE = 0.4;
const WEIGHT_DURATION = 0.4;
const WEIGHT_CATEGORY = 0.2;
const WEIGHT_CAPTION = 0.3;

/** 解析 YouTube API 回傳的 ISO 8601 時長（例如 "PT12M34S"）成秒數 */
export function parseIso8601Duration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  const hours = Number(match?.[1] ?? 0);
  const minutes = Number(match?.[2] ?? 0);
  const seconds = Number(match?.[3] ?? 0);
  return hours * 3600 + minutes * 60 + seconds;
}

/** 時長貼近 5~20 分鐘給滿分，越偏離扣越多，最低 0（不會是負分） */
function durationFitScore(durationSec: number): number {
  if (durationSec >= DURATION_SWEET_MIN && durationSec <= DURATION_SWEET_MAX) {
    return 1;
  }
  if (durationSec < DURATION_SWEET_MIN) {
    return Math.max(0, durationSec / DURATION_SWEET_MIN);
  }
  return Math.max(0, 1 - (durationSec - DURATION_SWEET_MAX) / DURATION_SWEET_MAX);
}

/**
 * 粗排：relevance（candidates 陣列順序＝YouTube 原始相關度排序）+ 時長貼近度 + 教育分類加分。
 * 回傳依分數由高到低排序後的陣列（不外露分數，呼叫端只需要排序結果）。
 */
export function coarseRank(candidates: SearchCandidate[]): SearchCandidate[] {
  const total = candidates.length;
  return [...candidates]
    .map((c, index) => ({
      candidate: c,
      score: (total - index) / total * WEIGHT_RELEVANCE
        + durationFitScore(c.durationSec) * WEIGHT_DURATION
        + (c.categoryId === EDUCATION_CATEGORY_ID ? WEIGHT_CATEGORY : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .map(({ candidate }) => candidate)
    .slice(0, COARSE_SHORTLIST_SIZE);
}

/**
 * 精排：對粗排後的候選疊加字幕類型加權（手動字幕加分），重新排序取前 8 名。
 * captionKinds 只包含有查過 captions.list 的 videoId（粗排前 12 名）。
 */
export function refineRank(
  candidates: SearchCandidate[],
  captionKinds: Map<string, 'manual' | 'auto'>,
): RankedCandidate[] {
  const total = candidates.length;
  return candidates
    .map((c, index) => {
      const captionKind = captionKinds.get(c.videoId) ?? 'auto';
      const relevanceAndDuration = (total - index) / total * WEIGHT_RELEVANCE
        + durationFitScore(c.durationSec) * WEIGHT_DURATION
        + (c.categoryId === EDUCATION_CATEGORY_ID ? WEIGHT_CATEGORY : 0);
      const score = relevanceAndDuration + (captionKind === 'manual' ? WEIGHT_CAPTION : 0);
      return { ...c, captionKind, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, FINAL_RESULT_SIZE)
    .map(({ score: _score, ...rest }) => rest);
}

/** 呼叫 search.list + videos.list，組成候選清單（尚未做任何排序，維持 API 回傳順序＝相關度順序） */
async function searchCandidateVideos(query: string, apiKey: string): Promise<SearchCandidate[]> { /* fetch 實作，不寫測試（同 fetchYouTubeTranscriptSegments 慣例） */ }

/** 對每支候選逐一呼叫 captions.list（YouTube API 不支援批次查多支影片），回傳 videoId → 字幕類型 */
async function fetchCaptionKinds(videoIds: string[], apiKey: string): Promise<Map<string, 'manual' | 'auto'>> { /* fetch 實作，不寫測試 */ }

/** 對外唯一入口：完整跑完粗排→精排兩階段，回傳最終排序好的前 8 筆 */
export async function searchYoutubeTeachingVideos(query: string): Promise<RankedCandidate[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error('YOUTUBE_API_KEY 未設定');
  }
  const candidates = await searchCandidateVideos(query, apiKey);
  const shortlist = coarseRank(candidates);
  const captionKinds = await fetchCaptionKinds(shortlist.map(c => c.videoId), apiKey);
  return refineRank(shortlist, captionKinds);
}
```

### 3. `src/actions/youtubeSearchActions.ts`（新檔）— server action

```ts
'use server';

import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';

import { type RankedCandidate, searchYoutubeTeachingVideos } from '@/libs/youtubeSearch';

const searchSchema = z.object({
  query: z.string().trim().min(1, '請輸入搜尋關鍵字').max(100),
});

export async function searchYoutubeVideos(
  input: { query: string },
): Promise<{ results: RankedCandidate[] } | { error: string }> {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('請先登入');
  }
  const parsed = searchSchema.parse(input);

  try {
    const results = await searchYoutubeTeachingVideos(parsed.query);
    if (results.length === 0) {
      return { error: '找不到符合的教學影片，試試其他關鍵字' };
    }
    return { results };
  } catch (err) {
    console.error('[searchYoutubeVideos] 搜尋失敗：', err);
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('quotaExceeded') || msg.includes('403')) {
      return { error: '搜尋額度已用完，請稍後再試或直接貼網址' };
    }
    return { error: 'YouTube 搜尋暫時無法使用，請稍後再試或直接貼網址' };
  }
}
```

### 4. `new-subject/page.tsx` — 傳入 `youtubeSearchEnabled`

```tsx
export default function NewSubjectPage() {
  const youtubeSearchEnabled = Boolean(process.env.YOUTUBE_API_KEY);
  return (
    // ...
    <NewSubjectForm youtubeSearchEnabled={youtubeSearchEnabled} />
  );
}
```

### 5. `NewSubjectForm.tsx` — YouTube tab 加搜尋區塊

- 新 props：`{ youtubeSearchEnabled: boolean }`。
- 新 state：`searchQuery`／`searching`／`searchResults: RankedCandidate[]`／`searchError`。
- `youtubeSearchEnabled && mode === 'youtube'` 時，在既有 textarea（
  `src/app/[locale]/(auth)/dashboard/adaptive/new-subject/NewSubjectForm.tsx:331-350`）**上方**加：
  - 關鍵字輸入框 + 「搜尋」按鈕，呼叫 `searchYoutubeVideos({ query: searchQuery })`。
  - 結果列表：每筆顯示縮圖、標題、頻道、時長（mm:ss）、字幕類型 badge（✅ 手動字幕 / 🤖 自動
    字幕）、教育分類 badge（有的話）、「加入」按鈕。
  - 「加入」：把 `https://www.youtube.com/watch?v=${videoId}` 附加到 `youtubeUrlsText`
    （換行分隔），重用既有 `validateYoutubeImportUrls` 邏輯即時檢查是否超過 5 支／重複，超過或
    重複就不加並提示。
  - 搜尋中／無結果／錯誤三種狀態各自的文案（見下方錯誤處理）。
- `youtubeSearchEnabled === false` 時完全不顯示搜尋區塊，只保留原本的貼網址 textarea（現況
  不變）。

## 錯誤處理

- 未設 `YOUTUBE_API_KEY`：入口整個不顯示（伺服器端判斷，client 拿到的就是 `false`）。
- YouTube API 額度用盡（403 `quotaExceeded`）：顯示「搜尋額度已用完，請稍後再試或直接貼網址」，
  不擋既有貼網址流程（老師仍可手動貼網址生成）。
- 搜尋無結果：顯示「找不到符合的教學影片，試試其他關鍵字」。
- 「加入」超過 5 支上限或重複網址：前端擋下，不呼叫任何 action，直接提示。

## 測試

- `src/libs/youtubeSearch.test.ts`：
  - `parseIso8601Duration`：`PT12M34S`→754、`PT1H2M3S`→3723、`PT45S`→45、純分鐘 `PT10M`→600
    等 hand-derived 案例。
  - `coarseRank`：時長在 5~20 分鐘內的候選應該排在明顯偏離的候選前面；教育分類候選在其餘條件
    相同時排更前面；輸入的相關度順序（陣列順序）在其他條件相同時保留。
  - `refineRank`：手動字幕的候選應該排到同分同時長的自動字幕候選前面；`captionKinds` 沒有某支
    影片的紀錄時，應該視為 `auto`（不是拋錯）。
  - `searchCandidateVideos`／`fetchCaptionKinds`（實際打 API）不寫測試，同 `fetchYouTubeTranscriptSegments`
    現況慣例。
- `npm run lint`、`npm run check-types` 需全過。
- 手動驗證（瀏覽器實跑，需要真的申請一組 `YOUTUBE_API_KEY`）：
  1. 搜尋一個中文教育關鍵字（例如「光合作用」），確認結果都有字幕 badge、時長合理，手動字幕的
     排在前面。
  2. 點「加入」把 2~3 支結果填進網址欄，確認網址正確、可以繼續走既有生成流程。
  3. 加到滿 5 支後再點「加入」，確認擋下並提示。
  4. 暫時把 `YOUTUBE_API_KEY` 從 `.env.local` 拿掉，確認「搜尋影片」入口消失，其餘 YouTube
     匯入流程（貼網址）不受影響。

## 不做（YAGNI）

- 不做獨立搜尋頁面，只接在既有 YouTube 匯入 tab 裡。
- 不對搜尋本身額外計入站內 quota／節流，先靠 YouTube API 自己的每日額度把關。
- 不做「排除已用過的影片」之類的個人化記憶功能。
- 不支援分頁載入更多結果（固定回傳前 8 筆，搜不到滿意的就換關鍵字重搜）。
- 不做進階篩選 UI（時長區間、語言等使用者自訂條件），排序公式的權重先寫死在程式碼常數裡。
