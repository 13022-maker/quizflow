'use client';

// 探測音檔長度（秒），四捨五入成整數；失敗（跨域、不支援、逾時）回傳 null，
// 不阻擋儲存流程 —— null 會讓 Live Mode 走 LISTENING_FALLBACK_SEC 寬限
// （見 src/services/live/questionDuration.ts）。
export function probeAudioDuration(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    const timeout = setTimeout(() => resolve(null), 8000);
    audio.addEventListener('loadedmetadata', () => {
      clearTimeout(timeout);
      resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration) : null);
    });
    audio.addEventListener('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });
    audio.src = url;
  });
}
