// Live Mode server-side Ably：發 tick 通知 + 發 token 給 client
// 設計上只發「state-updated」tick，payload 近乎空；client 收到後自己 fetch 對應 REST
// 好處：
//   1. 單 channel 即可（live:{gameId}），不用依 host/player 分
//   2. 無隱私洩漏（channel 訊息不含任何 state）
//   3. 與既有 /api/live/.../state endpoints 完全共存
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

// 發 tick 到 live:{gameId}，讓訂閱的 host / player 重抓自己的 state
// 失敗不 throw（Ably 掛掉不應拖垮 mutation），只 log
export async function publishTick(gameId: number): Promise<void> {
  if (!isAblyEnabled()) {
    return;
  }
  try {
    const channel = getAbly().channels.get(`live:${gameId}`);
    await channel.publish('tick', { ts: Date.now() });
  } catch (err) {
    console.warn('[ablyServer] publishTick failed', { gameId, err });
  }
}

// 發 short-lived token request 給 client 訂閱用
// client 只能 subscribe 自己那場 game 的 channel，且不能 publish
export async function createAblyTokenRequest(params: {
  gameId: number;
  clientId: string;
}): Promise<Ably.TokenRequest> {
  const ably = getAbly();
  return ably.auth.createTokenRequest({
    clientId: params.clientId,
    capability: JSON.stringify({
      [`live:${params.gameId}`]: ['subscribe'],
    }),
    ttl: 2 * 60 * 60 * 1000, // 2 小時，夠撐一場遊戲
  });
}
