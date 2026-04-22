// Server 端 Ably REST client：負責所有事件發布與 token 簽發。
// 失敗一律 swallow（只 log），絕不阻斷 DB 寫入流程。

import Ably from 'ably';

import { Env } from '@/libs/Env';

import { gameChannel, playerChannel } from './channels';

let cached: Ably.Rest | null = null;

function getRest(): Ably.Rest | null {
  if (!Env.ABLY_API_KEY) {
    return null;
  }
  if (!cached) {
    cached = new Ably.Rest({ key: Env.ABLY_API_KEY });
  }
  return cached;
}

export async function publishToGame(
  gameId: number,
  event: string,
  data: unknown,
): Promise<void> {
  const rest = getRest();
  if (!rest) {
    return;
  }
  try {
    await rest.channels.get(gameChannel(gameId)).publish(event, data);
  } catch (err) {
    console.error(`[ably] publish ${event} to game:${gameId} failed`, err);
  }
}

export async function publishToPlayer(
  gameId: number,
  playerId: number,
  event: string,
  data: unknown,
): Promise<void> {
  const rest = getRest();
  if (!rest) {
    return;
  }
  try {
    await rest.channels
      .get(playerChannel(gameId, playerId))
      .publish(event, data);
  } catch (err) {
    console.error(
      `[ably] publish ${event} to player:${playerId} failed`,
      err,
    );
  }
}

export type AblyTokenRequest = Ably.TokenRequest;

export async function createTokenRequest(params: {
  clientId: string;
  capability: Record<string, string[]>;
}): Promise<AblyTokenRequest | null> {
  const rest = getRest();
  if (!rest) {
    return null;
  }
  return rest.auth.createTokenRequest({
    clientId: params.clientId,
    capability: JSON.stringify(params.capability),
  });
}
