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

// 小組搶答專用：發完整搶答看板快照（LiveBuzzerBoard）到 live:{gameId}，client 直接套用、不用再 fetch REST。
// 內容只有同場所有人本來就看得到的資訊（組名、組分、搶答順序與結果、揭曉後的正解），不含任何人的所選答案。
// 發的是完整狀態而非增量：漏收一則也不會錯位，下一則就自動校正。
// 失敗不 throw（同 publishTick）；client 端還有 REST 輪詢 / tick 當保底
export async function publishBoard(gameId: number, board: unknown): Promise<void> {
  if (!isAblyEnabled()) {
    return;
  }
  try {
    const channel = getAbly().channels.get(`live:${gameId}`);
    await channel.publish('board', board);
  } catch (err) {
    console.warn('[ablyServer] publishBoard failed', { gameId, err });
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
