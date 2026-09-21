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
