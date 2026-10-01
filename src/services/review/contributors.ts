// 共創階段「誰有動手」摘要：依每人獨立草稿目前的字數呈現，不比對內容差異。
// review_draft 對每個 (teamId, playerId) 只會有 1 筆記錄，不需要聚合次數。
export type Contributor = { playerId: number; nickname: string; charCount: number };

export function summarizeContributors(
  draftRows: { playerId: number; charCount: number }[],
  players: { id: number; nickname: string }[],
): Contributor[] {
  const nicknameById = new Map(players.map(p => [p.id, p.nickname]));

  return draftRows
    .map(row => ({
      playerId: row.playerId,
      nickname: nicknameById.get(row.playerId) ?? '',
      charCount: row.charCount,
    }))
    .sort((a, b) => b.charCount - a.charCount);
}
