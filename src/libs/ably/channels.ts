// Ably channel 命名單一真相來源。用 env prefix 區分 dev / preview / prod，
// 避免多環境共用同一個 Ably app 時發生跨環境訊息污染。

const PREFIX = process.env.NEXT_PUBLIC_ABLY_ENV_PREFIX ?? 'local';

export function gameChannel(gameId: number): string {
  return `live:${PREFIX}:game:${gameId}`;
}

export function playerChannel(gameId: number, playerId: number): string {
  return `live:${PREFIX}:game:${gameId}:player:${playerId}`;
}
