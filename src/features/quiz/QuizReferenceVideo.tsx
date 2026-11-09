import { buildYoutubeEmbedUrl, extractYouTubeId } from '@/libs/youtube';

/**
 * 測驗參考影片：題目源自 YouTube 影片（常見是沒有字幕、學生必須看影片才能作答）時，
 * 在學生作答頁頂部嵌入 16:9 響應式播放器。
 *
 * - 用 youtube-nocookie.com 網域（隱私強化模式，未播放前不寫追蹤 cookie）
 * - 網址解析不出 video id（理論上 server action 已擋，保險起見）時整塊不渲染
 * - 防作弊模式：iframe 內點擊 / 全螢幕不會讓 document 變成 hidden，不會觸發 visibilitychange，
 *   因此不會誤計離開次數；但點影片內「在 YouTube 上觀看」會開新分頁，那屬於真的離開，照常計次
 */
export function QuizReferenceVideo({ youtubeUrl, quizTitle }: { youtubeUrl: string | null; quizTitle: string }) {
  if (!youtubeUrl) {
    return null;
  }
  const videoId = extractYouTubeId(youtubeUrl);
  if (!videoId) {
    return null;
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-black shadow-sm">
      <div className="relative aspect-video w-full">
        {/* 不加 sandbox：YouTube 官方嵌入碼沒有 sandbox，加了可能讓部分影片 / 全螢幕失效；來源固定為 youtube-nocookie 網域 */}
        {/* eslint-disable-next-line react-dom/no-missing-iframe-sandbox */}
        <iframe
          src={buildYoutubeEmbedUrl(videoId)}
          title={`「${quizTitle}」參考影片`}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="absolute inset-0 size-full border-0"
        />
      </div>
    </div>
  );
}
