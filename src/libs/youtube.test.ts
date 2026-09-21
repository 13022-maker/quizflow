import { describe, expect, it, vi } from 'vitest';

// youtube-transcript 套件在檔案內是動態 import（見 youtube.ts 的 fetchYouTubeTranscriptSegments，
// 是為了繞開該套件在 vitest 下的 CommonJS/ESM dual-package hazard，之前 review 已定案不可還原成靜態 import）。
// vi.mock 對動態 import 一樣有效，必須放在 import 目標函式之前設定好。
const fetchTranscriptMock = vi.fn();
vi.mock('youtube-transcript', () => ({
  YoutubeTranscript: {
    fetchTranscript: (...args: unknown[]) => fetchTranscriptMock(...args),
  },
}));

// eslint-disable-next-line import/first -- mock 必須在 import 目標函式之前設定好
import { buildTimestampedTranscript, extractYouTubeId, fetchYouTubeTranscriptSegments, validateYoutubeImportUrls } from './youtube';

describe('extractYouTubeId', () => {
  it('watch?v= 格式：取出 11 碼 video id', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('youtu.be 短網址：取出 video id', () => {
    expect(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('embed 格式：取出 video id', () => {
    expect(extractYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('shorts 格式：取出 video id', () => {
    expect(extractYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('純 playlist 網址（無 v=）：回傳 null', () => {
    expect(extractYouTubeId('https://www.youtube.com/playlist?list=PLxxxxx')).toBeNull();
  });

  it('非 YouTube 網址：回傳 null', () => {
    expect(extractYouTubeId('https://example.com/video')).toBeNull();
  });
});

describe('validateYoutubeImportUrls', () => {
  it('空陣列：拒絕', () => {
    expect(validateYoutubeImportUrls([])).toEqual({ ok: false, error: '請至少貼一支影片網址' });
  });

  it('1~5 支合法網址：放行', () => {
    // video id 必須是 extractYouTubeId 認得的 11 碼（[\w-]{11}），"vid" + 1 碼數字 + 7 個 "a" = 11 碼
    const urls = Array.from({ length: 5 }, (_, i) => `https://youtu.be/vid${i}aaaaaaa`);

    expect(validateYoutubeImportUrls(urls)).toEqual({ ok: true });
  });

  it('超過 5 支：拒絕', () => {
    const urls = Array.from({ length: 6 }, (_, i) => `https://youtu.be/vid${i}aaaaaaa`);
    const result = validateYoutubeImportUrls(urls);

    expect(result.ok).toBe(false);
  });

  it('含 playlist 網址：拒絕，訊息說明不支援 playlist', () => {
    const result = validateYoutubeImportUrls(['https://www.youtube.com/playlist?list=PLxxxxx']);

    expect(result).toEqual({ ok: false, error: '不支援播放清單網址，請貼單支影片網址' });
  });

  it('格式錯誤的網址：拒絕', () => {
    const result = validateYoutubeImportUrls(['https://example.com/not-youtube']);

    expect(result.ok).toBe(false);
  });
});

describe('fetchYouTubeTranscriptSegments', () => {
  it('套件回傳的 offset 是毫秒，需正規化成秒（四捨五入）', async () => {
    // 這份 fixture 是 2026-09-21 對真實 YouTube 影片（dQw4w9WgXcQ, 3:33）實測擷取到的
    // 精簡版：套件的 srv3 解析路徑回傳的 offset 單位是毫秒，不是秒。
    fetchTranscriptMock.mockResolvedValueOnce([
      { text: '第一句', duration: 1680, offset: 1360, lang: 'zh-TW' },
      { text: '最後一句', duration: 2000, offset: 207920, lang: 'zh-TW' },
    ]);

    const result = await fetchYouTubeTranscriptSegments('dQw4w9WgXcQ');

    expect(result).toEqual([
      { text: '第一句', offset: 1 }, // Math.round(1360 / 1000)
      { text: '最後一句', offset: 208 }, // Math.round(207920 / 1000)
    ]);
  });
});

describe('buildTimestampedTranscript', () => {
  it('單支影片：依 20 秒分桶並標記 videoId／時間戳', () => {
    const { transcript, excludedVideoIds } = buildTimestampedTranscript([
      {
        videoId: 'abc123',
        segments: [
          { text: '第一句', offset: 0 },
          { text: '第二句', offset: 5 },
          { text: '第三句', offset: 25 },
        ],
      },
    ]);

    expect(transcript).toContain('abc123');
    expect(transcript).toContain('[t=0s]');
    expect(transcript).toContain('第一句');
    expect(transcript).toContain('第二句');
    expect(transcript).toContain('[t=20s]');
    expect(transcript).toContain('第三句');
    expect(excludedVideoIds).toEqual([]);
  });

  it('多支影片：依序串接、各自標出 videoId', () => {
    const { transcript, excludedVideoIds } = buildTimestampedTranscript([
      { videoId: 'vid1', segments: [{ text: '影片一內容', offset: 0 }] },
      { videoId: 'vid2', segments: [{ text: '影片二內容', offset: 0 }] },
    ]);

    const idxVid1 = transcript.indexOf('vid1');
    const idxVid2 = transcript.indexOf('vid2');

    expect(idxVid1).toBeGreaterThanOrEqual(0);
    expect(idxVid2).toBeGreaterThan(idxVid1);
    expect(excludedVideoIds).toEqual([]);
  });

  it('超過 20000 字元：截斷', () => {
    const longText = 'x'.repeat(30000);
    const { transcript } = buildTimestampedTranscript([
      { videoId: 'abc', segments: [{ text: longText, offset: 0 }] },
    ]);

    expect(transcript.length).toBeLessThanOrEqual(20000);
  });

  it('截斷點落在某支影片標頭之前：該影片（與其後影片）被判定為整支排除', () => {
    // 第一支影片的內容單獨就超過 20000 字元上限，第二、三支影片的標頭必定被截掉
    const longText = 'x'.repeat(30000);
    const { transcript, excludedVideoIds } = buildTimestampedTranscript([
      { videoId: 'vid1', segments: [{ text: longText, offset: 0 }] },
      { videoId: 'vid2', segments: [{ text: '影片二內容', offset: 0 }] },
      { videoId: 'vid3', segments: [{ text: '影片三內容', offset: 0 }] },
    ]);

    expect(transcript.length).toBeLessThanOrEqual(20000);
    expect(excludedVideoIds).toEqual(['vid2', 'vid3']);
  });
});
