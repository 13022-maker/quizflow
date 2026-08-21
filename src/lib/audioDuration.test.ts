// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { probeAudioDuration } from './audioDuration';

describe('probeAudioDuration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('loadedmetadata 觸發時回傳四捨五入後的秒數', async () => {
    const listeners: Record<string, () => void> = {};
    let audioSrc = '';
    const fakeAudio = {
      addEventListener: (event: string, cb: () => void) => {
        listeners[event] = cb;
      },
      get src() {
        return audioSrc;
      },
      set src(v: string) {
        audioSrc = v;
      },
      duration: 18.6,
    } as unknown as HTMLAudioElement;
    vi.spyOn(document, 'createElement').mockReturnValue(fakeAudio);

    const promise = probeAudioDuration('blob:fake-url');
    listeners.loadedmetadata?.();

    await expect(promise).resolves.toBe(19);
  });

  it('error 事件觸發時回傳 null', async () => {
    const listeners: Record<string, () => void> = {};
    let audioSrc = '';
    const fakeAudio = {
      addEventListener: (event: string, cb: () => void) => {
        listeners[event] = cb;
      },
      get src() {
        return audioSrc;
      },
      set src(v: string) {
        audioSrc = v;
      },
    } as unknown as HTMLAudioElement;
    vi.spyOn(document, 'createElement').mockReturnValue(fakeAudio);

    const promise = probeAudioDuration('blob:fake-url');
    listeners.error?.();

    await expect(promise).resolves.toBeNull();
  });

  it('8 秒內都沒觸發任何事件時，逾時回傳 null', async () => {
    vi.useFakeTimers();
    let audioSrc = '';
    const fakeAudio = {
      addEventListener: () => {},
      get src() {
        return audioSrc;
      },
      set src(v: string) {
        audioSrc = v;
      },
    } as unknown as HTMLAudioElement;
    vi.spyOn(document, 'createElement').mockReturnValue(fakeAudio);

    const promise = probeAudioDuration('blob:fake-url');
    vi.advanceTimersByTime(8000);

    await expect(promise).resolves.toBeNull();
  });
});
