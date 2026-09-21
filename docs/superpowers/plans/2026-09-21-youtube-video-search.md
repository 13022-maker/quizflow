# 適性學習「YouTube 匯入」加搜尋教學影片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 老師在「從 YouTube 匯入」tab 裡直接輸入關鍵字搜尋教學影片，系統依相關度／時長／教育分類／
字幕類型（手動優先於自動）複合評分排序，老師點「加入」把選中的影片網址填進既有的網址欄，接上既有
生成流程。

**Architecture:** 新增一層獨立的純邏輯 `src/libs/youtubeSearch.ts`（呼叫 YouTube Data API v3
的 `search.list`／`videos.list`／`captions.list`，兩階段排序：粗排 25 支候選取前 12 名、只對這
12 名查字幕類型再精排取前 8 名），一個薄薄的 server action 包裝，UI 接在既有 `NewSubjectForm.tsx`
的 YouTube tab 裡。整層功能由 `YOUTUBE_API_KEY` 環境變數是否存在控制顯示/隱藏，未設不影響任何
既有功能。

**Tech Stack:** Next.js 14 App Router Server Actions、Zod、plain `fetch()` 呼叫 YouTube Data
API v3（不裝 `googleapis` 套件，三支 REST 端點用內建 fetch 就夠）、Vitest。

**Spec:** `docs/superpowers/specs/2026-09-21-youtube-video-search-design.md`

## Global Constraints

- 不修改既有「從 YouTube 匯入」（貼網址生成）與「貼文字」「上傳檔案」三種既有流程的行為，只在
  YouTube tab 的網址欄**上方**新增搜尋區塊。
- 不修改一般測驗出題（`generate-from-url`）既有的 YouTube 匯入功能。
- 不裝 `googleapis` npm 套件，三支 API（search/videos/captions）都用內建 `fetch()` 直接打
  REST endpoint。
- `YOUTUBE_API_KEY` 未設時，「搜尋影片」入口整個不顯示（伺服器端判斷，只有 boolean 跨到
  client），不報錯、不影響既有貼網址流程。
- 搜尋本身**不**計入現有 AI quota（`checkAndIncrementAiUsage`）——quota 只在按「開始生成」時
  照既有邏輯扣一次。
- 兩階段排序：粗排（相關度＋時長貼近 5~20 分鐘＋教育分類）取前 12 名 → 只對這 12 名呼叫
  `captions.list` 判斷手動/自動字幕 → 精排（疊加字幕加權）取前 8 名回傳。`captions.list`
  一次 50 units，不可對全部候選都查（會爆額度）。
- 「加入」按鈕要重用既有 `validateYoutubeImportUrls` 的 5 支上限規則（不重複造規則），並擋掉
  重複網址。
- 全部新增程式碼註解一律繁體中文；UI 文字一律繁體中文；變數/函式/檔名英文（camelCase/kebab-case）。

---

## 檔案總覽

**新增：**
- `src/libs/youtubeSearch.ts` — 呼叫 YouTube Data API v3 的純邏輯 + 兩階段排序
- `src/libs/youtubeSearch.test.ts`
- `src/actions/youtubeSearchActions.ts` — server action

**修改：**
- `src/libs/Env.ts` — 加 `YOUTUBE_API_KEY`（optional）
- `src/app/[locale]/(auth)/dashboard/adaptive/new-subject/page.tsx` — 傳入
  `youtubeSearchEnabled` prop
- `src/app/[locale]/(auth)/dashboard/adaptive/new-subject/NewSubjectForm.tsx` — YouTube tab
  加搜尋 UI

---

### Task 1: `src/libs/youtubeSearch.ts` — YouTube Data API 呼叫與兩階段排序

**Files:**
- Modify: `src/libs/Env.ts`
- Create: `src/libs/youtubeSearch.ts`
- Create: `src/libs/youtubeSearch.test.ts`

**Interfaces:**
- Produces（Task 2 依賴這些確切名稱）：
  - `export type SearchCandidate = { videoId: string; title: string; channelTitle: string; thumbnailUrl: string; durationSec: number; viewCount: number; categoryId: string }`
  - `export type RankedCandidate = SearchCandidate & { captionKind: 'manual' | 'auto' }`
  - `export function parseIso8601Duration(iso: string): number`
  - `export function coarseRank(candidates: SearchCandidate[]): SearchCandidate[]`
  - `export function refineRank(candidates: SearchCandidate[], captionKinds: Map<string, 'manual' | 'auto'>): RankedCandidate[]`
  - `export async function searchYoutubeTeachingVideos(query: string): Promise<RankedCandidate[]>`

- [ ] **Step 1: `src/libs/Env.ts` 加 `YOUTUBE_API_KEY`**

`src/libs/Env.ts` 的 `server: {}` 區塊（第 14 行 `ABLY_API_KEY` 後面）加一行：

```ts
    YOUTUBE_API_KEY: z.string().optional(), // 搜尋教學影片功能（未設則「搜尋影片」入口隱藏）
```

`runtimeEnv: {}` 區塊（第 36 行 `ABLY_API_KEY: process.env.ABLY_API_KEY,` 後面）加一行：

```ts
    YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
```

- [ ] **Step 2: 寫失敗的測試（純函式部分）**

Create `src/libs/youtubeSearch.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { coarseRank, parseIso8601Duration, refineRank, type SearchCandidate } from './youtubeSearch';

describe('parseIso8601Duration', () => {
  it('分秒格式：PT12M34S → 754 秒', () => {
    expect(parseIso8601Duration('PT12M34S')).toBe(754);
  });

  it('含小時：PT1H2M3S → 3723 秒', () => {
    expect(parseIso8601Duration('PT1H2M3S')).toBe(3723);
  });

  it('只有秒：PT45S → 45 秒', () => {
    expect(parseIso8601Duration('PT45S')).toBe(45);
  });

  it('只有分鐘：PT10M → 600 秒', () => {
    expect(parseIso8601Duration('PT10M')).toBe(600);
  });
});

function makeCandidate(overrides: Partial<SearchCandidate> = {}): SearchCandidate {
  return {
    videoId: 'vid-default',
    title: '預設標題',
    channelTitle: '預設頻道',
    thumbnailUrl: 'https://example.com/thumb.jpg',
    durationSec: 600, // 10 分鐘，落在甜蜜區間
    viewCount: 1000,
    categoryId: '22', // 非教育類別
    ...overrides,
  };
}

describe('coarseRank', () => {
  it('時長落在 5~20 分鐘內的候選排在明顯偏離的候選前面（其餘條件相同）', () => {
    const short = makeCandidate({ videoId: 'short', durationSec: 30 }); // 30 秒，明顯偏離
    const sweet = makeCandidate({ videoId: 'sweet', durationSec: 600 }); // 10 分鐘，甜蜜區間
    const ranked = coarseRank([short, sweet]);

    expect(ranked[0]!.videoId).toBe('sweet');
  });

  it('教育分類的候選在時長/相關度相同時排更前面', () => {
    const normal = makeCandidate({ videoId: 'normal', categoryId: '22' });
    const education = makeCandidate({ videoId: 'edu', categoryId: '27' });
    // 陣列順序刻意讓 normal 在前（相關度較高），驗證教育分類加分足以逆轉排名
    const ranked = coarseRank([normal, education]);

    expect(ranked[0]!.videoId).toBe('edu');
  });

  it('其餘條件相同時保留原始相關度順序（陣列順序）', () => {
    const first = makeCandidate({ videoId: 'first' });
    const second = makeCandidate({ videoId: 'second' });
    const ranked = coarseRank([first, second]);

    expect(ranked.map(c => c.videoId)).toEqual(['first', 'second']);
  });

  it('候選數超過 12 名時只回傳前 12 名', () => {
    const candidates = Array.from({ length: 20 }, (_, i) => makeCandidate({ videoId: `v${i}` }));
    const ranked = coarseRank(candidates);

    expect(ranked).toHaveLength(12);
  });
});

describe('refineRank', () => {
  it('手動字幕的候選排到同時長的自動字幕候選前面', () => {
    const auto = makeCandidate({ videoId: 'auto' });
    const manual = makeCandidate({ videoId: 'manual' });
    const captionKinds = new Map<string, 'manual' | 'auto'>([
      ['auto', 'auto'],
      ['manual', 'manual'],
    ]);
    // 陣列順序刻意讓 auto 在前，驗證手動字幕加分足以逆轉排名
    const ranked = refineRank([auto, manual], captionKinds);

    expect(ranked[0]!.videoId).toBe('manual');
    expect(ranked[0]!.captionKind).toBe('manual');
  });

  it('captionKinds 沒有某支影片的紀錄時視為 auto（不拋錯）', () => {
    const unknown = makeCandidate({ videoId: 'unknown' });
    const ranked = refineRank([unknown], new Map());

    expect(ranked[0]!.captionKind).toBe('auto');
  });

  it('最多回傳 8 筆', () => {
    const candidates = Array.from({ length: 12 }, (_, i) => makeCandidate({ videoId: `v${i}` }));
    const ranked = refineRank(candidates, new Map());

    expect(ranked).toHaveLength(8);
  });

  it('回傳的物件不含內部用的 score 欄位', () => {
    const candidate = makeCandidate({ videoId: 'v0' });
    const ranked = refineRank([candidate], new Map());

    expect(ranked[0]).not.toHaveProperty('score');
  });
});
```

- [ ] **Step 3: 執行測試確認全部失敗**

Run: `npx vitest run src/libs/youtubeSearch.test.ts`
Expected: FAIL（`Cannot find module './youtubeSearch'`，因為 `youtubeSearch.ts` 還不存在）

- [ ] **Step 4: 實作 `src/libs/youtubeSearch.ts`**

```ts
/**
 * 搜尋教學影片（適性學習 YouTube 匯入的輔助功能）：呼叫 YouTube Data API v3 的
 * search.list（找候選）+ videos.list（補時長/觀看數/分類）+ captions.list（判斷手動/
 * 自動字幕）。captions.list 一次 50 units、比 search.list 貴很多，因此用兩階段排序控制
 * 成本：粗排（相關度+時長+教育分類）先篩到 12 名，只對這 12 名查字幕類型，避免對全部
 * 候選都查而爆額度。YOUTUBE_API_KEY 未設時 searchYoutubeTeachingVideos 會 throw，
 * 呼叫端（server action）負責轉成友善錯誤；UI 層則是完全不顯示搜尋入口。
 */

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
const SEARCH_MAX_RESULTS = 25;
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
 * 回傳依分數由高到低排序後的前 12 名（不外露分數，呼叫端只需要排序結果）。
 */
export function coarseRank(candidates: SearchCandidate[]): SearchCandidate[] {
  const total = candidates.length;
  return candidates
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
 * captionKinds 只包含有查過 captions.list 的 videoId（粗排前 12 名），沒查過的視為 auto。
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
    // 把內部用的 score 從回傳物件剝掉；_score 這個命名本身就會被專案 eslint 設定當成刻意不用，
    // 不需要額外的 eslint-disable（比照 src/libs/adaptive/service.ts:172 的既有寫法）
    .map(({ score: _score, ...rest }) => rest);
}

type YoutubeSearchApiResponse = {
  items: { id: { videoId: string } }[];
};

type YoutubeVideosApiResponse = {
  items: {
    id: string;
    snippet: {
      title: string;
      channelTitle: string;
      categoryId: string;
      thumbnails: { medium?: { url: string }; default?: { url: string } };
    };
    contentDetails: { duration: string };
    statistics: { viewCount?: string };
  }[];
};

/** 呼叫 search.list + videos.list，組成候選清單（維持 search.list 回傳順序＝相關度順序） */
async function searchCandidateVideos(query: string, apiKey: string): Promise<SearchCandidate[]> {
  const searchParams = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    videoCaption: 'closedCaption', // 官方參數，直接篩掉沒字幕的影片
    relevanceLanguage: 'zh-Hant',
    regionCode: 'TW',
    maxResults: String(SEARCH_MAX_RESULTS),
    key: apiKey,
  });
  const searchRes = await fetch(`https://www.googleapis.com/youtube/v3/search?${searchParams}`);
  if (!searchRes.ok) {
    const body = await searchRes.text();
    throw new Error(`YouTube search.list 失敗（${searchRes.status}）：${body}`);
  }
  const searchData = await searchRes.json() as YoutubeSearchApiResponse;
  const videoIds = searchData.items.map(item => item.id.videoId).filter(Boolean);
  if (videoIds.length === 0) {
    return [];
  }

  const videosParams = new URLSearchParams({
    part: 'snippet,contentDetails,statistics',
    id: videoIds.join(','),
    key: apiKey,
  });
  const videosRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?${videosParams}`);
  if (!videosRes.ok) {
    const body = await videosRes.text();
    throw new Error(`YouTube videos.list 失敗（${videosRes.status}）：${body}`);
  }
  const videosData = await videosRes.json() as YoutubeVideosApiResponse;

  // videos.list 不保證回傳順序跟查詢的 id 順序一致，用 search.list 的順序重新排列，
  // 因為 coarseRank 依賴陣列順序＝相關度排名
  const byId = new Map(videosData.items.map(item => [item.id, item]));
  return videoIds
    .map(id => byId.get(id))
    .filter((item): item is YoutubeVideosApiResponse['items'][number] => item !== undefined)
    .map(item => ({
      videoId: item.id,
      title: item.snippet.title,
      channelTitle: item.snippet.channelTitle,
      thumbnailUrl: item.snippet.thumbnails.medium?.url ?? item.snippet.thumbnails.default?.url ?? '',
      durationSec: parseIso8601Duration(item.contentDetails.duration),
      viewCount: Number(item.statistics.viewCount ?? 0),
      categoryId: item.snippet.categoryId,
    }));
}

type YoutubeCaptionsApiResponse = {
  items: { snippet: { trackKind: string } }[];
};

/** 查單支影片的字幕軌清單，判斷是否有非 ASR（自動語音辨識）的手動字幕軌 */
async function fetchCaptionKindForVideo(videoId: string, apiKey: string): Promise<'manual' | 'auto'> {
  const params = new URLSearchParams({ part: 'snippet', videoId, key: apiKey });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/captions?${params}`);
  if (!res.ok) {
    // 單支查詢失敗不中斷整批（例如該影片權限特殊），保守當自動字幕處理
    return 'auto';
  }
  const data = await res.json() as YoutubeCaptionsApiResponse;
  const hasManualTrack = data.items.some(item => item.snippet.trackKind !== 'ASR');
  return hasManualTrack ? 'manual' : 'auto';
}

/** captions.list 不支援批次查多支影片，只能逐一呼叫；用 Promise.all 平行送出減少總延遲 */
async function fetchCaptionKinds(videoIds: string[], apiKey: string): Promise<Map<string, 'manual' | 'auto'>> {
  const entries = await Promise.all(
    videoIds.map(async videoId => [videoId, await fetchCaptionKindForVideo(videoId, apiKey)] as const),
  );
  return new Map(entries);
}

/**
 * 對外唯一入口：完整跑完粗排→精排兩階段，回傳最終排序好的前 8 筆。
 * YOUTUBE_API_KEY 未設定時 throw，呼叫端（server action）負責轉成友善錯誤訊息。
 */
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

- [ ] **Step 5: 執行測試確認全部通過**

Run: `npx vitest run src/libs/youtubeSearch.test.ts`
Expected: PASS（14 個測試案例）

- [ ] **Step 6: 型別檢查與 lint**

Run: `npm run check-types && npm run lint`
Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add src/libs/Env.ts src/libs/youtubeSearch.ts src/libs/youtubeSearch.test.ts
git commit -m "feat(adaptive): 新增搜尋教學影片的 YouTube Data API 呼叫與兩階段排序邏輯"
```

---

### Task 2: `src/actions/youtubeSearchActions.ts` — server action

**Files:**
- Create: `src/actions/youtubeSearchActions.ts`

**Interfaces:**
- Consumes: `searchYoutubeTeachingVideos`／`RankedCandidate`（`@/libs/youtubeSearch`，Task 1 產出）
- Produces（Task 3 依賴這個名稱與回傳型別）：
  `export async function searchYoutubeVideos(input: { query: string }): Promise<{ results: RankedCandidate[] } | { error: string }>`

- [ ] **Step 1: 實作 `src/actions/youtubeSearchActions.ts`**

```ts
'use server';

/**
 * 搜尋教學影片 server action——只讀不寫（不動 DB），供「AI 生成學科」的 YouTube 匯入模式
 * 挑選候選影片用。搜尋本身不計入 AI quota（沒有呼叫任何 AI，quota 只在按「開始生成」時扣）。
 */
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

- [ ] **Step 2: 型別檢查與 lint**

Run: `npm run check-types && npm run lint`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/actions/youtubeSearchActions.ts
git commit -m "feat(adaptive): 新增搜尋教學影片 server action"
```

---

### Task 3: `NewSubjectForm.tsx` 加搜尋 UI + `page.tsx` 傳入 enabled flag

**Files:**
- Modify: `src/app/[locale]/(auth)/dashboard/adaptive/new-subject/page.tsx`
- Modify: `src/app/[locale]/(auth)/dashboard/adaptive/new-subject/NewSubjectForm.tsx`

**Interfaces:**
- Consumes: `searchYoutubeVideos`（`@/actions/youtubeSearchActions`，Task 2 產出）、
  `RankedCandidate`（`@/libs/youtubeSearch`，Task 1 產出）

- [ ] **Step 1: `page.tsx` 傳入 `youtubeSearchEnabled`**

`src/app/[locale]/(auth)/dashboard/adaptive/new-subject/page.tsx` 整份從：

```tsx
import Link from 'next/link';

import { NewSubjectForm } from './NewSubjectForm';

export const dynamic = 'force-dynamic';

/** AI 生成學科 — 老師輸入單元主題（可選附教材），Claude 生成知識圖譜＋題庫 */
export default function NewSubjectPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-xl font-bold">✨ AI 生成學科</h1>
        <Link href="/dashboard/adaptive" className="text-sm text-muted-foreground hover:underline">
          ← 回適性學習
        </Link>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        輸入單元主題，AI 會自動規劃 3～5 個知識點（含前置依賴）與每點 5～8 題單選題。
        生成後可直接用來建立練習。
      </p>
      <NewSubjectForm />
    </div>
  );
}
```

改成：

```tsx
import Link from 'next/link';

import { NewSubjectForm } from './NewSubjectForm';

export const dynamic = 'force-dynamic';

/** AI 生成學科 — 老師輸入單元主題（可選附教材），Claude 生成知識圖譜＋題庫 */
export default function NewSubjectPage() {
  // YOUTUBE_API_KEY 是否存在的判斷留在伺服器端，只有 boolean 跨到 client component
  const youtubeSearchEnabled = Boolean(process.env.YOUTUBE_API_KEY);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-xl font-bold">✨ AI 生成學科</h1>
        <Link href="/dashboard/adaptive" className="text-sm text-muted-foreground hover:underline">
          ← 回適性學習
        </Link>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        輸入單元主題，AI 會自動規劃 3～5 個知識點（含前置依賴）與每點 5～8 題單選題。
        生成後可直接用來建立練習。
      </p>
      <NewSubjectForm youtubeSearchEnabled={youtubeSearchEnabled} />
    </div>
  );
}
```

- [ ] **Step 2: `NewSubjectForm.tsx` 加 import 與 props**

`src/app/[locale]/(auth)/dashboard/adaptive/new-subject/NewSubjectForm.tsx:9-24` 從：

```tsx
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { generateAdaptiveSubject, generateAdaptiveSubjectFromYoutube } from '@/actions/adaptiveActions';
import { validateSubjectUploadFiles } from '@/libs/adaptive/subjectFileValidation';
import { validateYoutubeImportUrls } from '@/libs/youtube';

type Result = {
  id: number;
  name: string;
  knowledgeCount: number;
  itemCount: number;
};

type Mode = 'text' | 'file' | 'youtube';
```

改成：

```tsx
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { generateAdaptiveSubject, generateAdaptiveSubjectFromYoutube } from '@/actions/adaptiveActions';
import { searchYoutubeVideos } from '@/actions/youtubeSearchActions';
import { validateSubjectUploadFiles } from '@/libs/adaptive/subjectFileValidation';
import { validateYoutubeImportUrls } from '@/libs/youtube';
import type { RankedCandidate } from '@/libs/youtubeSearch';

type Result = {
  id: number;
  name: string;
  knowledgeCount: number;
  itemCount: number;
};

type Mode = 'text' | 'file' | 'youtube';
```

- [ ] **Step 3: 加 `youtubeSearchEnabled` prop 與搜尋相關 state**

`src/app/[locale]/(auth)/dashboard/adaptive/new-subject/NewSubjectForm.tsx:43` 從：

```tsx
export function NewSubjectForm() {
```

改成：

```tsx
export function NewSubjectForm({ youtubeSearchEnabled }: { youtubeSearchEnabled: boolean }) {
```

`src/app/[locale]/(auth)/dashboard/adaptive/new-subject/NewSubjectForm.tsx:61-62` 的
`// YouTube 匯入模式：一行一支影片網址` 那兩行後面加：

```tsx
  // YouTube 搜尋教學影片
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<RankedCandidate[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
```

- [ ] **Step 4: 加搜尋與加入網址的處理函式**

`src/app/[locale]/(auth)/dashboard/adaptive/new-subject/NewSubjectForm.tsx` 的
`switchMode` 函式（第 64-67 行）後面加：

```tsx
  async function handleSearch() {
    if (!searchQuery.trim() || searching) {
      return;
    }
    setSearching(true);
    setSearchError(null);
    setSearchResults([]);
    const res = await searchYoutubeVideos({ query: searchQuery.trim() });
    if ('error' in res) {
      setSearchError(res.error);
    } else {
      setSearchResults(res.results);
    }
    setSearching(false);
  }

  /** 把搜尋結果的影片加進網址欄：重複網址自己擋，支數上限重用既有 validateYoutubeImportUrls，
   *  不在這裡另外寫死「5」這個數字，避免以後上限調整時兩處要一起改卻忘記一處 */
  function addVideoUrl(videoId: string) {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const urls = youtubeUrlsText.split('\n').map(u => u.trim()).filter(Boolean);
    if (urls.includes(url)) {
      setError('這支影片已經加入過了');
      return;
    }
    const nextUrls = [...urls, url];
    const check = validateYoutubeImportUrls(nextUrls);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setYoutubeUrlsText(nextUrls.join('\n'));
    setError(null);
  }

  function formatDuration(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
```

- [ ] **Step 5: YouTube tab 加搜尋 UI**

`src/app/[locale]/(auth)/dashboard/adaptive/new-subject/NewSubjectForm.tsx:331-350` 從：

```tsx
      {mode === 'youtube' && (
        <div className="flex flex-col gap-1">
          <label htmlFor="subject-youtube-urls" className="text-sm font-medium">
            YouTube 影片網址（一行一支，最多 5 支）
          </label>
          <textarea
            id="subject-youtube-urls"
            value={youtubeUrlsText}
            onChange={e => setYoutubeUrlsText(e.target.value)}
            disabled={generating}
            rows={5}
            placeholder={'https://www.youtube.com/watch?v=xxxxxxxxxxx\nhttps://youtu.be/yyyyyyyyyyy'}
            className="rounded-md border px-3 py-2 font-mono text-sm"
          />
          <p className="text-xs text-gray-400">
            不支援播放清單網址，請貼單支影片的網址。AI 會用影片字幕內容設計知識點與題目，
            並可讓學生卡關時「重看關鍵片段」。
          </p>
        </div>
      )}
```

改成：

```tsx
      {mode === 'youtube' && (
        <div className="flex flex-col gap-3">
          {youtubeSearchEnabled && (
            <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
              <label htmlFor="subject-youtube-search" className="text-sm font-medium">
                🔍 搜尋教學影片
              </label>
              <div className="flex gap-2">
                <input
                  id="subject-youtube-search"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && void handleSearch()}
                  disabled={searching || generating}
                  placeholder="例如：光合作用"
                  className="h-9 flex-1 rounded-md border px-3 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void handleSearch()}
                  disabled={searching || generating || !searchQuery.trim()}
                  className="h-9 rounded-lg border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50"
                >
                  {searching ? '搜尋中…' : '搜尋'}
                </button>
              </div>
              {searchError && (
                <p className="text-xs text-red-600">
                  ⚠️
                  {' '}
                  {searchError}
                </p>
              )}
              {searchResults.length > 0 && (
                <div className="flex flex-col gap-2">
                  {searchResults.map(v => (
                    <div key={v.videoId} className="flex items-center gap-2 rounded-lg border p-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={v.thumbnailUrl} alt="" className="h-12 w-20 rounded object-cover" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{v.title}</p>
                        <p className="truncate text-xs text-gray-400">
                          {v.channelTitle}
                          {' · '}
                          {formatDuration(v.durationSec)}
                          {' · '}
                          {v.captionKind === 'manual' ? '✅ 手動字幕' : '🤖 自動字幕'}
                          {v.categoryId === '27' && ' · 🎓 教育'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => addVideoUrl(v.videoId)}
                        disabled={generating}
                        className="shrink-0 rounded-lg border px-2 py-1 text-xs font-medium hover:bg-muted"
                      >
                        加入
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label htmlFor="subject-youtube-urls" className="text-sm font-medium">
              YouTube 影片網址（一行一支，最多 5 支）
            </label>
            <textarea
              id="subject-youtube-urls"
              value={youtubeUrlsText}
              onChange={e => setYoutubeUrlsText(e.target.value)}
              disabled={generating}
              rows={5}
              placeholder={'https://www.youtube.com/watch?v=xxxxxxxxxxx\nhttps://youtu.be/yyyyyyyyyyy'}
              className="rounded-md border px-3 py-2 font-mono text-sm"
            />
            <p className="text-xs text-gray-400">
              不支援播放清單網址，請貼單支影片的網址。AI 會用影片字幕內容設計知識點與題目，
              並可讓學生卡關時「重看關鍵片段」。
            </p>
          </div>
        </div>
      )}
```

- [ ] **Step 6: 型別檢查與 lint**

Run: `npm run check-types && npm run lint`
Expected: 0 errors

- [ ] **Step 7: 手動瀏覽器驗證**

需要先在 `.env.local` 設一組真的 `YOUTUBE_API_KEY`（Google Cloud Console 啟用
「YouTube Data API v3」後建立）。啟動 `npm run dev`，開 `/dashboard/adaptive/new-subject`：

1. 切到「從 YouTube 匯入」tab，確認網址欄上方出現「🔍 搜尋教學影片」區塊。
2. 輸入中文教育關鍵字（例如「光合作用」）搜尋，確認結果列表有縮圖、標題、頻道、時長、字幕
   類型 badge，且手動字幕的候選大致排在自動字幕候選前面。
3. 點「加入」，確認網址正確填進下方 textarea；重複點同一筆確認擋下「這支影片已經加入過了」。
4. 連續加到 5 支後再點「加入」，確認擋下並顯示 `validateYoutubeImportUrls` 既有的
   「最多支援 5 支影片，請刪減後再試」訊息。
5. 把 `.env.local` 的 `YOUTUBE_API_KEY` 註解掉、重啟 dev server，確認「搜尋教學影片」區塊
   完全不顯示，其餘 YouTube 匯入流程（貼網址、生成）不受影響。
6. 確認「貼文字」「上傳檔案」兩種既有模式完全沒被動到。

- [ ] **Step 8: Commit**

```bash
git add "src/app/[locale]/(auth)/dashboard/adaptive/new-subject/page.tsx" "src/app/[locale]/(auth)/dashboard/adaptive/new-subject/NewSubjectForm.tsx"
git commit -m "feat(adaptive): YouTube 匯入 tab 加搜尋教學影片入口"
```

---

## 全部完成後

- [ ] Run: `npm run build`
  Expected: 建置成功
- [ ] Run: `npm run lint && npm run check-types && npm run test`
  Expected: 全部 0 error / 0 fail
- [ ] 對照 spec 的「測試」section 手動驗證清單，逐項跑過一次（需要真的申請 `YOUTUBE_API_KEY`）
