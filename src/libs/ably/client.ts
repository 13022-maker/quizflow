// 瀏覽器端 Ably Realtime 工廠。用 dynamic import 讓非 Live Mode 頁面不會被
// Ably client (~70KB gzipped) 拖慢。每組角色/身分只建一個連線，close 時釋放。

'use client';

import type * as AblyNs from 'ably';

export type AblyRole
  = | { kind: 'host'; gameId: number }
  | { kind: 'player'; gameId: number; playerId: number; playerToken: string };

function buildAuthUrl(role: AblyRole): string {
  if (role.kind === 'host') {
    return `/api/ably/token?role=host&gameId=${role.gameId}`;
  }
  return (
    `/api/ably/token?role=player`
    + `&gameId=${role.gameId}`
    + `&playerId=${role.playerId}`
    + `&playerToken=${encodeURIComponent(role.playerToken)}`
  );
}

export async function createRealtime(
  role: AblyRole,
): Promise<AblyNs.Realtime> {
  // Dynamic import to keep bundle lean on non-live pages
  const AblyModule = await import('ably');
  const Ably = AblyModule.default ?? AblyModule;

  return new Ably.Realtime({
    authUrl: buildAuthUrl(role),
    authMethod: 'GET',
    // 連線斷掉 60 秒內仍嘗試恢復 session（不要重新抓訊息就好；
    // 由 hook 在 attached 後做 rehydrate 補漏）
    disconnectedRetryTimeout: 2000,
    suspendedRetryTimeout: 10000,
  });
}
