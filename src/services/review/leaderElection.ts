// 組內隊長即時多數決：不設「投票視窗關閉」關卡，每次投票後即時重新計算，
// 平票或尚無人投票時，取最早加入該組的成員當預設隊長，確保任何時候都有人
// 能整合送出最終答案。

export type LeaderVote = { voterPlayerId: number; votedForPlayerId: number };
export type LeaderCandidate = { id: number; joinedAt: Date };

export function pickLeader(
  votes: LeaderVote[],
  members: LeaderCandidate[],
): number | null {
  if (members.length === 0) {
    return null;
  }

  // 按加入時間排序，最早的成員在最前面；加入時間相同時再用 id 小的優先，
  // 避免結果受傳入陣列（DB 回傳）順序影響而不穩定
  const sortedByJoinOrder = [...members].sort(
    (a, b) => (a.joinedAt.getTime() - b.joinedAt.getTime()) || (a.id - b.id),
  );

  // 統計每個成員的得票數
  const tally = new Map<number, number>();
  for (const vote of votes) {
    tally.set(vote.votedForPlayerId, (tally.get(vote.votedForPlayerId) ?? 0) + 1);
  }

  // 從最早加入的成員開始，找出得票最高者
  // 使用「升序遍歷 + 最小得票數起始」的策略，確保平票時自動選擇最早加入的
  let leaderId = sortedByJoinOrder[0]!.id;
  let highestCount = -1;
  for (const member of sortedByJoinOrder) {
    const memberCount = tally.get(member.id) ?? 0;
    if (memberCount > highestCount) {
      highestCount = memberCount;
      leaderId = member.id;
    }
  }

  return leaderId;
}
