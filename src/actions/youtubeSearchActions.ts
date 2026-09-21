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
