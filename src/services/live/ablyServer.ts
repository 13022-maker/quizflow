// Server-side Ably helpers：發訊息到 channel + 發 token 給 client
// 設計上採 tick-only pattern（payload 近乎空），client 收到後自己 fetch 權威 REST state。
// 好處：單 channel 即可、無隱私洩漏、REST endpoint 仍是單一可信來源。
//
// 本模組同時服務 Live Mode（live:{gameId}）與其他 realtime 功能（監考 / 儀表板 / emoji）。
// Live Mode 既有 API publishTick() / createAblyTokenRequest(gameId) 保留為相容包裝。
import Ably from 'ably';

// Ably Rest client 單例（Node lambda 跨請求重用，省冷啟動）
let ablyRest: Ably.Rest | null = null;

function getAbly(): Ably.Rest {
  if (!ablyRest) {
    const key = process.env.ABLY_API_KEY;
    if (!key) {
      throw new Error('ABLY_API_KEY 未設定');
    }
    ablyRest = new Ably.Rest(key);
  }
  return ablyRest;
}

// 是否啟用 Ably（未設 ABLY_API_KEY = 未啟用，polling fallback）
export function isAblyEnabled(): boolean {
  return !!process.env.ABLY_API_KEY;
}

// 通用：發事件到任意 channel；失敗不 throw（Ably 掛掉不應拖垮 mutation）只 log
export async function publishToChannel(
  channelName: string,
  eventName: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  if (!isAblyEnabled()) {
    return;
  }
  try {
    const channel = getAbly().channels.get(channelName);
    await channel.publish(eventName, payload ?? { ts: Date.now() });
  } catch (err) {
    console.warn('[ablyServer] publishToChannel failed', { channelName, eventName, err });
  }
}

// Live Mode 相容 API：發 tick 到 live:{gameId}
export async function publishTick(gameId: number): Promise<void> {
  await publishToChannel(`live:${gameId}`, 'tick', { ts: Date.now() });
}

// 通用 token 發行：接受 channel → capability list 的 map
// 例：{ 'live:42': ['subscribe'], 'quiz-proctor:7': ['subscribe'] }
export async function createTokenRequest(params: {
  clientId: string;
  capability: Record<string, string[]>;
  ttlMs?: number;
}): Promise<Ably.TokenRequest> {
  return getAbly().auth.createTokenRequest({
    clientId: params.clientId,
    capability: JSON.stringify(params.capability),
    ttl: params.ttlMs ?? 2 * 60 * 60 * 1000, // 預設 2 小時
  });
}

// Live Mode 相容 API：subscribe-only on live:{gameId}
export async function createAblyTokenRequest(params: {
  gameId: number;
  clientId: string;
}): Promise<Ably.TokenRequest> {
  return createTokenRequest({
    clientId: params.clientId,
    capability: {
      [`live:${params.gameId}`]: ['subscribe'],
    },
  });
}
