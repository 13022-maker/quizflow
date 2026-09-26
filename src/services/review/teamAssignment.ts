// 系統隨機分組：round-robin 發牌式分配，人數自然平均（例如 10 人分 4 人一組
// 會產生 4/3/3，而不是 4/4/2 這種不平均的結果）

export function assignTeamsRoundRobin(
  playerIds: number[],
  teamSize: number,
): number[][] {
  if (playerIds.length === 0) {
    return [];
  }
  const numTeams = Math.max(1, Math.ceil(playerIds.length / teamSize));
  const teams: number[][] = Array.from({ length: numTeams }, () => []);
  playerIds.forEach((id, i) => {
    teams[i % numTeams]!.push(id);
  });
  return teams;
}
