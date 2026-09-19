/**
 * YouTube 匯入生成學科（適性學習）專用：保留 timestamp 的抽字幕與清洗。
 * extractYouTubeId／classifyYouTubeError 跟 src/app/api/ai/generate-from-url/route.ts
 * 裡的版本邏輯相同、刻意重複實作，換取不去碰既有已經在跑的一般出題 YouTube 匯入功能。
 */

const MAX_VIDEOS = 5;
const MAX_TRANSCRIPT_CHARS = 20000;
const BUCKET_SECONDS = 20;

export function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([\w-]{11})/,
    /youtube\.com\/shorts\/([\w-]{11})/,
  ];
  for (const p of patterns) {
    const match = url.match(p);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

export function classifyYouTubeError(err: unknown): string {
  const msg = err instanceof Error ? err.message.toLowerCase() : '';
  if (msg.includes('disabled')) {
    return '此影片的字幕已被上傳者關閉，無法擷取內容。請換一支影片。';
  }
  if (msg.includes('unavailable') || msg.includes('not found') || msg.includes('404')) {
    return '此影片不存在或為私人影片，無法讀取。請確認連結正確且影片為公開。';
  }
  if (msg.includes('no transcript') || msg.includes('could not') || msg.includes('transcript')) {
    return '此影片沒有可用的字幕（可能尚未自動產生）。請換一支影片。';
  }
  if (msg.includes('timeout') || msg.includes('econnrefused') || msg.includes('fetch') || msg.includes('network')) {
    return '系統暫時無法讀取 YouTube，請稍後再試。';
  }
  return 'YouTube 字幕擷取失敗，請確認連結正確後重試。';
}

/** 前端與 server action 共用的送出前驗證：格式、支數上限、擋 playlist 網址 */
export function validateYoutubeImportUrls(urls: string[]): { ok: true } | { ok: false; error: string } {
  if (urls.length === 0) {
    return { ok: false, error: '請至少貼一支影片網址' };
  }
  if (urls.length > MAX_VIDEOS) {
    return { ok: false, error: `最多支援 ${MAX_VIDEOS} 支影片，請刪減後再試` };
  }
  for (const url of urls) {
    if (url.includes('list=') && !extractYouTubeId(url)) {
      return { ok: false, error: '不支援播放清單網址，請貼單支影片網址' };
    }
    if (!extractYouTubeId(url)) {
      return { ok: false, error: `無法辨識的 YouTube 網址：${url}` };
    }
  }
  return { ok: true };
}

/** 抓字幕並保留 timestamp（zh-TW → zh → 自動偵測 fallback，同既有 generate-from-url 邏輯） */
export async function fetchYouTubeTranscriptSegments(
  videoId: string,
): Promise<{ text: string; offset: number }[]> {
  let items;
  try {
    // 動態 import 在 try 內部，確保 import 失敗也被 classifyYouTubeError 處理
    const { YoutubeTranscript } = await import('youtube-transcript');
    items = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'zh-TW' })
      .catch(() => YoutubeTranscript.fetchTranscript(videoId, { lang: 'zh' }))
      .catch(() => YoutubeTranscript.fetchTranscript(videoId));
  } catch (err) {
    throw new Error(classifyYouTubeError(err));
  }
  if (!items || items.length === 0) {
    throw new Error('此影片沒有可用的字幕（可能尚未自動產生）。請換一支影片。');
  }
  return items.map(i => ({ text: i.text, offset: i.offset }));
}

/**
 * 把多支影片的逐字稿合併成一份帶時間戳的教材文字，餵給 LLM。
 * 每支影片依時間分桶（約 20 秒一桶，減少 token 量又保留可定位精度）。
 * 總長度沿用既有文字模式 <教材> 的 20000 字元截斷邏輯。
 */
export function buildTimestampedTranscript(
  videos: { videoId: string; segments: { text: string; offset: number }[] }[],
): string {
  const parts: string[] = [];
  videos.forEach((video, index) => {
    parts.push(`\n=== 影片 ${index + 1}：${video.videoId} ===`);
    let bucketStart = -1;
    let bucketText: string[] = [];
    const flush = () => {
      if (bucketText.length > 0) {
        parts.push(`[t=${bucketStart}s] ${bucketText.join(' ')}`);
      }
    };
    for (const seg of video.segments) {
      const bucket = Math.floor(seg.offset / BUCKET_SECONDS) * BUCKET_SECONDS;
      if (bucket !== bucketStart) {
        flush();
        bucketStart = bucket;
        bucketText = [];
      }
      bucketText.push(seg.text);
    }
    flush();
  });
  return parts.join('\n').trim().slice(0, MAX_TRANSCRIPT_CHARS);
}
