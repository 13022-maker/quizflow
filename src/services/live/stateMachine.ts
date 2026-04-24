// Live Mode phase 狀態機
// 集中管理合法 transition；所有寫入點 (liveActions / tick endpoint) 都應該透過這個 helper 驗證
//
// 對照表（DB status ↔ 概念 phase）：
//   waiting        ↔ idle    （遊戲建立、等待玩家）
//   playing        ↔ active  （倒數中、player 可送答）
//   locked         ↔ locked  （倒數結束尚未 reveal；server-side timer 自癒寫入）
//   showing_result ↔ reveal  （顯示正解 + 統計）
//   finished       ↔ ended   （遊戲結束）

import type { LiveGameStatus } from './types';

const TRANSITIONS: Record<LiveGameStatus, readonly LiveGameStatus[]> = {
  waiting: ['playing', 'finished'], // 開場 / 老師中途棄場
  playing: ['locked', 'showing_result', 'finished'], // 自然 timeout / 老師手動 reveal / 強制結束
  locked: ['showing_result', 'playing', 'finished'], // reveal / 老師直接跳下一題 / 強制結束
  showing_result: ['playing', 'finished'], // 下一題 / 結束
  finished: [],
};

export function canTransition(from: LiveGameStatus, to: LiveGameStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

// SQL 用：給 atomic UPDATE WHERE status IN (...) 用的合法來源狀態清單
export function validSourcesFor(target: LiveGameStatus): readonly LiveGameStatus[] {
  return (Object.keys(TRANSITIONS) as LiveGameStatus[]).filter(s =>
    TRANSITIONS[s].includes(target),
  );
}
