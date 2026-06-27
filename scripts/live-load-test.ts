/**
 * Live Mode 10 玩家壓測
 *
 * 用法：
 *   PIN=ABC123 npx tsx scripts/live-load-test.ts
 *   PIN=ABC123 PLAYER_COUNT=10 BASE_URL=http://localhost:3000 npx tsx scripts/live-load-test.ts
 *
 * 流程：
 *   1. 10 個玩家同時 POST /api/live/join（取得 gameId / playerId / playerToken）
 *   2. 每位玩家每 500ms 輪詢 /player-state
 *   3. 偵測題目切換 → 隨機思考 500–2000ms 後 POST /answer
 *   4. 老師按下一題時，記錄每位玩家「收到題目時間」與「答題 RTT」
 *   5. 老師結束遊戲（status='finished'）→ 輸出 report
 *
 * Report 指標：
 *   - per-question 同步偏差（最慢-最快收到題目）
 *   - per-question 答題 RTT 分布
 *   - 最終各玩家分數、答對數、排名
 */

const PIN = (process.env.PIN ?? '').toUpperCase();
const PLAYER_COUNT = Number(process.env.PLAYER_COUNT ?? 10);
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const POLL_INTERVAL_MS = 500;
const THINK_MIN_MS = 500;
const THINK_MAX_MS = 2000;
const MAX_RUN_MS = 15 * 60 * 1000; // 安全停損

if (!PIN || PIN.length !== 6) {
  console.error('❌ 請提供 6 碼 PIN：PIN=ABC123 npx tsx scripts/live-load-test.ts');
  process.exit(1);
}

type JoinResp = { gameId: number; playerId: number; playerToken: string };

type QuestionForPlayer = {
  id: number;
  type: 'single_choice' | 'multiple_choice' | 'true_false';
  body: string;
  options: { id: string; text: string }[];
};

type PlayerStateResp = {
  game: {
    id: number;
    title: string;
    status: 'waiting' | 'playing' | 'showing_result' | 'finished';
    currentQuestionIndex: number;
    questionStartedAt: string | null;
    questionDuration: number;
    totalQuestions: number;
  };
  me: { id: number; nickname: string; score: number; correctCount: number; rank: number };
  currentQuestion: QuestionForPlayer | null;
  myAnswer: { selectedOptionId: string | string[] | null; isCorrect: boolean; score: number } | null;
};

type QuestionEvent = {
  questionId: number;
  questionIndex: number;
  receivedAt: number; // performance.now() ms
};

type AnswerEvent = {
  questionId: number;
  rttMs: number;
  isCorrect: boolean;
};

type PlayerLog = {
  nickname: string;
  playerId: number | null;
  joinRttMs: number;
  joinError?: string;
  questionEvents: QuestionEvent[];
  answerEvents: AnswerEvent[];
  finalScore: number;
  finalCorrect: number;
  finalRank: number;
  pollErrors: number;
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const rand = (min: number, max: number) => min + Math.random() * (max - min);

function pickAnswer(q: QuestionForPlayer): string | string[] {
  if (q.type === 'multiple_choice') {
    // 隨機挑 1-2 個
    const shuffled = [...q.options].sort(() => Math.random() - 0.5);
    const n = Math.min(q.options.length, 1 + Math.floor(Math.random() * 2));
    return shuffled.slice(0, n).map(o => o.id);
  }
  // single_choice / true_false：隨機挑一個
  return q.options[Math.floor(Math.random() * q.options.length)]!.id;
}

async function joinGame(nickname: string): Promise<JoinResp> {
  const res = await fetch(`${BASE_URL}/api/live/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: PIN, nickname }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`join failed (${res.status}): ${t}`);
  }
  return res.json();
}

async function fetchPlayerState(
  gameId: number,
  playerId: number,
  token: string,
): Promise<PlayerStateResp> {
  const url = `${BASE_URL}/api/live/${gameId}/player-state?playerId=${playerId}&token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`player-state ${res.status}`);
  }
  return res.json();
}

async function submitAnswer(
  gameId: number,
  playerId: number,
  token: string,
  questionId: number,
  selectedOptionId: string | string[],
): Promise<{ ok: boolean; isCorrect?: boolean; score?: number; error?: string }> {
  const res = await fetch(`${BASE_URL}/api/live/${gameId}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, playerToken: token, questionId, selectedOptionId }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: j?.error ?? `HTTP ${res.status}` };
  }
  return { ok: true, ...j };
}

async function runPlayer(nickname: string, log: PlayerLog): Promise<void> {
  // 1. join
  const joinT0 = performance.now();
  let joined: JoinResp;
  try {
    joined = await joinGame(nickname);
    log.joinRttMs = performance.now() - joinT0;
    log.playerId = joined.playerId;
  } catch (err) {
    log.joinError = (err as Error).message;
    return;
  }

  // 2. polling loop
  const startedAt = performance.now();
  let lastSeenQuestionId: number | null = null;
  let answeredQuestionId: number | null = null;
  let answerTask: Promise<void> | null = null;

  while (performance.now() - startedAt < MAX_RUN_MS) {
    let state: PlayerStateResp;
    try {
      state = await fetchPlayerState(joined.gameId, joined.playerId, joined.playerToken);
    } catch {
      log.pollErrors++;
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    // 更新最終分數（每輪覆寫最新值）
    log.finalScore = state.me.score;
    log.finalCorrect = state.me.correctCount;
    log.finalRank = state.me.rank;

    if (state.game.status === 'finished') {
      break;
    }

    // 偵測題目切換
    const cq = state.currentQuestion;
    if (
      state.game.status === 'playing'
      && cq
      && cq.id !== lastSeenQuestionId
      && cq.options.length > 0
    ) {
      const receivedAt = performance.now();
      log.questionEvents.push({
        questionId: cq.id,
        questionIndex: state.game.currentQuestionIndex,
        receivedAt,
      });
      lastSeenQuestionId = cq.id;

      // 啟動答題（背景執行，不擋 polling）
      if (answeredQuestionId !== cq.id) {
        answeredQuestionId = cq.id;
        const qSnapshot = cq;
        answerTask = (async () => {
          await sleep(rand(THINK_MIN_MS, THINK_MAX_MS));
          const ans = pickAnswer(qSnapshot);
          const t0 = performance.now();
          const result = await submitAnswer(
            joined.gameId,
            joined.playerId,
            joined.playerToken,
            qSnapshot.id,
            ans,
          );
          const rttMs = performance.now() - t0;
          if (result.ok) {
            log.answerEvents.push({
              questionId: qSnapshot.id,
              rttMs,
              isCorrect: !!result.isCorrect,
            });
          }
        })().catch(() => { /* 忽略，不中斷主迴圈 */ });
      }
    }

    await sleep(POLL_INTERVAL_MS);
  }

  // 等最後一個 answer 收尾
  if (answerTask) {
    await answerTask.catch(() => {});
  }
}

function pct(arr: number[], p: number): number {
  if (arr.length === 0) {
    return Number.NaN;
  }
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx]!;
}

function printReport(logs: PlayerLog[]) {
  console.log(`\n${'='.repeat(80)}`);
  console.log('              📊 Live Mode 壓測報告');
  console.log('='.repeat(80));

  // === Join 結果 ===
  const joined = logs.filter(l => !l.joinError);
  const failed = logs.filter(l => l.joinError);
  console.log(`\n[加入結果] 成功 ${joined.length}/${logs.length}`);
  if (failed.length > 0) {
    console.log('  失敗的玩家：');
    for (const f of failed) {
      console.log(`    - ${f.nickname}: ${f.joinError}`);
    }
  }
  if (joined.length > 0) {
    const joinRtts = joined.map(l => l.joinRttMs);
    console.log(`  Join RTT：min=${Math.min(...joinRtts).toFixed(0)}ms / `
      + `avg=${(joinRtts.reduce((a, b) => a + b, 0) / joinRtts.length).toFixed(0)}ms / `
      + `max=${Math.max(...joinRtts).toFixed(0)}ms`);
  }

  // === 同步偏差 per question ===
  // 把所有玩家在同一題的 receivedAt 對齊
  const allQids = new Set<number>();
  for (const l of joined) {
    for (const ev of l.questionEvents) {
      allQids.add(ev.questionId);
    }
  }
  const qidOrdered = [...allQids].sort((a, b) => {
    // 用第一次出現的 questionIndex 排序
    const ia = joined.flatMap(l => l.questionEvents).find(e => e.questionId === a)?.questionIndex ?? 0;
    const ib = joined.flatMap(l => l.questionEvents).find(e => e.questionId === b)?.questionIndex ?? 0;
    return ia - ib;
  });

  console.log(`\n[題目同步偏差] (老師按下一題後，所有玩家收到題目的時間差)`);
  console.log('  Q# | qId  | 玩家數 | 最快(ms) | 中位(ms) | 最慢(ms) | 偏差(ms)');
  console.log(`  ${'-'.repeat(70)}`);
  for (const qid of qidOrdered) {
    const events = joined
      .map(l => l.questionEvents.find(e => e.questionId === qid))
      .filter(Boolean) as QuestionEvent[];
    if (events.length === 0) {
      continue;
    }
    const times = events.map(e => e.receivedAt);
    const earliest = Math.min(...times);
    const latest = Math.max(...times);
    const relTimes = times.map(t => t - earliest);
    const median = pct(relTimes, 0.5);
    const idx = events[0]!.questionIndex;
    console.log(
      `  Q${String(idx + 1).padStart(2)} | ${String(qid).padStart(4)} | `
      + `${String(events.length).padStart(3)}/${joined.length} | `
      + `${'0'.padStart(8)} | ${median.toFixed(0).padStart(8)} | `
      + `${(latest - earliest).toFixed(0).padStart(8)} | `
      + `${(latest - earliest).toFixed(0).padStart(7)}`,
    );
  }

  // === 答題 RTT ===
  const allRtts = joined.flatMap(l => l.answerEvents.map(e => e.rttMs));
  console.log(`\n[答題 RTT] 共 ${allRtts.length} 次提交`);
  if (allRtts.length > 0) {
    console.log(`  min=${Math.min(...allRtts).toFixed(0)}ms`);
    console.log(`  p50=${pct(allRtts, 0.5).toFixed(0)}ms`);
    console.log(`  p90=${pct(allRtts, 0.9).toFixed(0)}ms`);
    console.log(`  p99=${pct(allRtts, 0.99).toFixed(0)}ms`);
    console.log(`  max=${Math.max(...allRtts).toFixed(0)}ms`);
  }

  // === 最終排名 ===
  console.log(`\n[最終結果]`);
  const ranked = [...joined].sort((a, b) => b.finalScore - a.finalScore);
  console.log('  排名 | 暱稱       | 分數    | 答對 | poll 失敗');
  console.log(`  ${'-'.repeat(50)}`);
  ranked.forEach((l, i) => {
    console.log(
      `  ${String(i + 1).padStart(3)}  | ${l.nickname.padEnd(10)} | `
      + `${String(l.finalScore).padStart(6)} | ${String(l.finalCorrect).padStart(3)}  | `
      + `${l.pollErrors}`,
    );
  });

  console.log(`\n${'='.repeat(80)}\n`);
}

async function main() {
  console.log(`🎮 Live Mode 壓測啟動`);
  console.log(`   PIN: ${PIN}`);
  console.log(`   玩家數: ${PLAYER_COUNT}`);
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   輪詢間隔: ${POLL_INTERVAL_MS}ms`);
  console.log(`   思考時間: ${THINK_MIN_MS}~${THINK_MAX_MS}ms\n`);
  console.log(`👉 請在老師端開始遊戲、按下一題；偵測到 status=finished 即結束\n`);

  const logs: PlayerLog[] = Array.from({ length: PLAYER_COUNT }, (_, i) => ({
    nickname: `Bot${String(i + 1).padStart(2, '0')}`,
    playerId: null,
    joinRttMs: 0,
    questionEvents: [],
    answerEvents: [],
    finalScore: 0,
    finalCorrect: 0,
    finalRank: 0,
    pollErrors: 0,
  }));

  // 同時 join，模擬一群學生同步衝進來
  console.log('⏳ 10 個玩家同時加入...');
  await Promise.all(logs.map(l => runPlayer(l.nickname, l)));

  printReport(logs);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
