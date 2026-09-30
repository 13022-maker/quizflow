// 共創階段「誰有動手」摘要：只算編輯次數，不比對內容差異
export type Contributor = { playerId: number; nickname: string; editCount: number };

export function summarizeContributors(
  editRows: { playerId: number }[],
  players: { id: number; nickname: string }[],
): Contributor[] {
  const nicknameById = new Map(players.map(p => [p.id, p.nickname]));
  const countByPlayerId = new Map<number, number>();
  for (const row of editRows) {
    countByPlayerId.set(row.playerId, (countByPlayerId.get(row.playerId) ?? 0) + 1);
  }

  return Array.from(countByPlayerId.entries())
    .map(([playerId, editCount]) => ({
      playerId,
      nickname: nicknameById.get(playerId) ?? '',
      editCount,
    }))
    .sort((a, b) => b.editCount - a.editCount);
}
