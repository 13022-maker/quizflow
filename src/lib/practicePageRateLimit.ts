/**
 * 簡易固定視窗限流器（in-memory、best-effort）。
 *
 * 用於公開的練習頁事件端點擋掉單一來源短時間大量灌事件。Serverless 多 instance
 * 之間不共享狀態，所以只是第一道防線；第二道是 route 內「每個 session 事件數上限」
 * （存在 DB，跨 instance 有效）。key 由呼叫端先雜湊過，這裡不會碰到原始 IP，
 * 且只存在記憶體、不落地。
 */

type Options = {
  limit: number;
  windowMs: number;
  now?: () => number;
  maxKeys?: number;
};

export function createFixedWindowLimiter({ limit, windowMs, now = Date.now, maxKeys = 10_000 }: Options) {
  const buckets = new Map<string, { start: number; count: number }>();

  const prune = (t: number) => {
    for (const [key, bucket] of buckets) {
      if (t - bucket.start > windowMs) {
        buckets.delete(key);
      }
    }
  };

  return {
    // 回傳 true 表示放行，false 表示超過上限
    hit(key: string): boolean {
      const t = now();
      if (buckets.size >= maxKeys) {
        prune(t);
      }
      const bucket = buckets.get(key);
      if (!bucket || t - bucket.start > windowMs) {
        buckets.set(key, { start: t, count: 1 });
        return true;
      }
      bucket.count++;
      return bucket.count <= limit;
    },
    size: () => buckets.size,
  };
}
