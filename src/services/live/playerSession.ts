// 學生本機身分持久化：playerId + playerToken 存在 localStorage
// key 格式：live_player_<gameId>

const KEY = (gameId: number) => `live_player_${gameId}`;

export function savePlayerSession(
  gameId: number,
  playerId: number,
  playerToken: string,
) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(
    KEY(gameId),
    JSON.stringify({ playerId, playerToken }),
  );
}

export function loadPlayerSession(
  gameId: number,
): { playerId: number; playerToken: string } | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const raw = window.localStorage.getItem(KEY(gameId));
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { playerId: number; playerToken: string };
    if (parsed.playerId && parsed.playerToken) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
