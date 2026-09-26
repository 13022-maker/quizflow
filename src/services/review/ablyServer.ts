// src/services/review/ablyServer.ts
// 協作批閱 server-side Ably：發 tick 通知 + 發 token 給 client
// 設計跟 src/services/live/ablyServer.ts 完全一致：只發近乎空的 tick，
// client 收到後自己 fetch 對應 REST（單 channel、無隱私洩漏、與既有 state endpoints 共存）
import Ably from 'ably';

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

export function isAblyEnabled(): boolean {
  return !!process.env.ABLY_API_KEY;
}

// 發 tick 到 review:{gameId}，讓訂閱的 host / team 重抓自己的 state
export async function publishTick(gameId: number): Promise<void> {
  if (!isAblyEnabled()) {
    return;
  }
  try {
    const channel = getAbly().channels.get(`review:${gameId}`);
    await channel.publish('tick', { ts: Date.now() });
  } catch (err) {
    console.warn('[review/ablyServer] publishTick failed', { gameId, err });
  }
}

export async function createAblyTokenRequest(params: {
  gameId: number;
  clientId: string;
}): Promise<Ably.TokenRequest> {
  const ably = getAbly();
  return ably.auth.createTokenRequest({
    clientId: params.clientId,
    capability: JSON.stringify({
      [`review:${params.gameId}`]: ['subscribe'],
    }),
    ttl: 2 * 60 * 60 * 1000,
  });
}
