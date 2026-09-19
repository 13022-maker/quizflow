import { describe, expect, it } from 'vitest';

import { buildTimestampedTranscript, extractYouTubeId, validateYoutubeImportUrls } from './youtube';

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

describe('buildTimestampedTranscript', () => {
  it('單支影片：依 20 秒分桶並標記 videoId／時間戳', () => {
    const result = buildTimestampedTranscript([
      {
        videoId: 'abc123',
        segments: [
          { text: '第一句', offset: 0 },
          { text: '第二句', offset: 5 },
          { text: '第三句', offset: 25 },
        ],
      },
    ]);

    expect(result).toContain('abc123');
    expect(result).toContain('[t=0s]');
    expect(result).toContain('第一句');
    expect(result).toContain('第二句');
    expect(result).toContain('[t=20s]');
    expect(result).toContain('第三句');
  });

  it('多支影片：依序串接、各自標出 videoId', () => {
    const result = buildTimestampedTranscript([
      { videoId: 'vid1', segments: [{ text: '影片一內容', offset: 0 }] },
      { videoId: 'vid2', segments: [{ text: '影片二內容', offset: 0 }] },
    ]);

    const idxVid1 = result.indexOf('vid1');
    const idxVid2 = result.indexOf('vid2');

    expect(idxVid1).toBeGreaterThanOrEqual(0);
    expect(idxVid2).toBeGreaterThan(idxVid1);
  });

  it('超過 20000 字元：截斷', () => {
    const longText = 'x'.repeat(30000);
    const result = buildTimestampedTranscript([
      { videoId: 'abc', segments: [{ text: longText, offset: 0 }] },
    ]);

    expect(result.length).toBeLessThanOrEqual(20000);
  });
});
