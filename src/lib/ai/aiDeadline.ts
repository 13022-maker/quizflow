/**
 * AI 呼叫的時間預算（deadline）與重試策略，純函式／可注入時鐘，可單元測試。
 *
 * 背景（2026-11-18）：generate-from-file 在 Vercel 上撞到 maxDuration=60 被平台直接砍掉
 * （"Task timed out after 60 seconds"），前端只拿到非 JSON 的 504，老師只看到「命題失敗」。
 * 原因是整條鏈沒有任何總時間上限：route 自己的 callWithRetry（3 次）× Anthropic SDK 內建
 * maxRetries（2 次）＋ Gemini 截斷後改走 Claude 整份重出、Claude 失敗再整份改走 Gemini，
 * 每一段都是循序且不設 timeout（Anthropic SDK 預設 10 分鐘、Gemini SDK 不設）。
 * 這裡把「還剩多少時間」變成每次重試／fallback 前的判斷條件，並給每次呼叫一個 AbortSignal，
 * 讓 route 能在平台砍人之前自己回一個清楚的 JSON 錯誤。
 */

export const AI_DEADLINE_EXCEEDED = 'AI_DEADLINE_EXCEEDED';

/** 時間預算用完時回給老師的訊息（route 504 JSON 與前端非 JSON 504 共用） */
export const AI_TIMEOUT_MESSAGE = 'AI 回應逾時，請減少頁數或題數後再試';

/** 時間預算用完（或剩下的時間不夠再打一次 AI）；route 對應回 504 */
export class AIDeadlineError extends Error {
  constructor(options?: { cause?: unknown }) {
    super(AI_DEADLINE_EXCEEDED, options);
    this.name = 'AIDeadlineError';
  }
}

export type Deadline = {
  elapsedMs: () => number;
  remainingMs: () => number;
};

/** 從現在開始算 budgetMs 的時間預算 */
export function createDeadline(budgetMs: number, now: () => number = Date.now): Deadline {
  const startedAt = now();
  return {
    elapsedMs: () => now() - startedAt,
    remainingMs: () => Math.max(0, budgetMs - (now() - startedAt)),
  };
}

/** 等 delayMs 之後，剩下的時間是否還夠一次 AI 呼叫（minAttemptMs） */
export function canStartAttempt(
  deadline: Deadline,
  options: { minAttemptMs: number; delayMs?: number },
): boolean {
  return deadline.remainingMs() - (options.delayMs ?? 0) >= options.minAttemptMs;
}

/** AbortSignal 逾時／中斷，或 Anthropic SDK 的中斷／連線逾時錯誤 */
export function isAbortLikeError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  return err.name === 'AbortError'
    || err.name === 'TimeoutError'
    || err.name === 'APIUserAbortError'
    || err.name === 'APIConnectionTimeoutError';
}

export type CallWithDeadlineOptions = {
  deadline: Deadline;
  /** 總嘗試次數（含第一次） */
  maxRetries: number;
  /** 第 n 次失敗後等 n × baseDelayMs 再重試 */
  baseDelayMs: number;
  /** 單次呼叫最長時間；卡住的連線不會把整個預算吃光，留時間給重試 / fallback */
  attemptCapMs: number;
  /** 剩下不到這麼多時間就不再開新的一次呼叫 */
  minAttemptMs: number;
  isRetryable: (err: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * 在時間預算內呼叫 fn，可重試錯誤遞增 backoff 重試。
 * fn 會收到這一次的 AbortSignal 與 timeoutMs（= min(剩餘預算, attemptCapMs)），要轉交給 SDK。
 * - 一開始就不夠時間 → AIDeadlineError（不呼叫）
 * - 被 abort 且剩餘預算不夠再試（或次數用完）→ AIDeadlineError；預算還夠 → 視為可重試
 * - 可重試但剩餘預算不夠再等 backoff + 打一次 → 拋原錯誤（例如 503 → 「AI 忙碌」訊息比逾時準確）
 */
export async function callWithDeadline<T>(
  fn: (signal: AbortSignal, timeoutMs: number) => Promise<T>,
  options: CallWithDeadlineOptions,
): Promise<T> {
  const { deadline, maxRetries, baseDelayMs, attemptCapMs, minAttemptMs, isRetryable } = options;
  const sleep = options.sleep ?? defaultSleep;

  if (!canStartAttempt(deadline, { minAttemptMs })) {
    throw new AIDeadlineError();
  }

  for (let i = 0; ; i++) {
    const timeoutMs = Math.min(deadline.remainingMs(), attemptCapMs);
    try {
      return await fn(AbortSignal.timeout(timeoutMs), timeoutMs);
    } catch (err) {
      const aborted = isAbortLikeError(err);
      const delayMs = (i + 1) * baseDelayMs;
      const hasBudget = canStartAttempt(deadline, { minAttemptMs, delayMs });
      if (aborted && (!hasBudget || i >= maxRetries - 1)) {
        throw new AIDeadlineError({ cause: err });
      }
      if ((!aborted && !isRetryable(err)) || i >= maxRetries - 1 || !hasBudget) {
        throw err;
      }
      await sleep(delayMs);
    }
  }
}
