/**
 * 學生作答頁的答案遮蔽（anti-cheat）。
 *
 * Server Component 傳給 Client Component 的 props 會整包序列化進 RSC payload，
 * 學生「檢視原始碼」或開 DevTools 就看得到。所以只要測驗不該在交卷前讓學生看到答案，
 * 就必須在 server 端先把答案相關欄位拿掉，不能靠 client 不顯示。
 *
 * 交卷後的正解由 submitQuizResponse 依 quiz.showAnswers 決定要不要回傳（見 answerKeyFor）。
 */
import type { InferSelectModel } from 'drizzle-orm';

import { parseClozeBody } from '@/lib/cloze';
import type { questionSchema, quizSchema } from '@/models/Schema';

type Quiz = InferSelectModel<typeof quizSchema>;
type Question = InferSelectModel<typeof questionSchema>;

/** 克漏字遮蔽後的空格內容：保留 [[ ]] 語法讓 ClozeQuestion 照樣算出空格位置，但不含答案 */
export const REDACTED_CLOZE_BLANK = '[[＿]]';

/**
 * 交卷前是否必須遮蔽答案：
 * - 考試模式（preventLeave）：一律遮蔽
 * - 老師關閉「顯示解答」：一律遮蔽（否則學生從原始碼就能拿到老師不想給的答案）
 * 其餘（練習／複習且顯示解答）保留答案，因為快閃卡、克漏字提示等練習功能本來就會顯示答案。
 */
export function shouldRedactAnswers(quiz: Pick<Quiz, 'preventLeave' | 'showAnswers'>): boolean {
  return Boolean(quiz.preventLeave) || !quiz.showAnswers;
}

function maskClozeBody(body: string): string {
  return parseClozeBody(body)
    .map(s => (s.kind === 'text' ? s.text : REDACTED_CLOZE_BLANK))
    .join('');
}

function shuffled<T>(arr: T[], random: () => number): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** 把單一題目的答案相關欄位拿掉，回傳型別不變（QuizTaker 不必改 props 型別） */
export function redactQuestionForTaker(q: Question, random: () => number = Math.random): Question {
  return {
    ...q,
    body: q.type === 'cloze' ? maskClozeBody(q.body) : q.body,
    // 排序題的 options 依正確順序儲存，原樣送出等於送答案 → server 端先打亂
    options: q.type === 'ranking' && q.options ? shuffled(q.options, random) : q.options,
    correctAnswers: null,
    referenceAnswer: null,
    explanation: null,
    aiHint: null,
    audioTranscript: null,
  };
}

/** 作答頁用：需要遮蔽時整批遮蔽，否則原樣回傳 */
export function prepareQuestionsForTaker(
  quiz: Pick<Quiz, 'preventLeave' | 'showAnswers'>,
  questions: Question[],
): Question[] {
  return shouldRedactAnswers(quiz) ? questions.map(q => redactQuestionForTaker(q)) : questions;
}

/** 交卷後回傳給學生的答案欄位（只在 quiz.showAnswers 時由 submitQuizResponse 帶回） */
export type AnswerKeyEntry = Pick<
  Question,
  'id' | 'body' | 'correctAnswers' | 'referenceAnswer' | 'explanation' | 'aiHint' | 'audioTranscript'
>;

export function answerKeyFor(q: Question): AnswerKeyEntry {
  return {
    id: q.id,
    body: q.body,
    correctAnswers: q.correctAnswers,
    referenceAnswer: q.referenceAnswer,
    explanation: q.explanation,
    aiHint: q.aiHint,
    audioTranscript: q.audioTranscript,
  };
}

/** client 端：交卷後把答案合併回遮蔽過的題目（options 維持學生看到的順序） */
export function mergeAnswerKey<T extends Question>(questions: T[], answerKey: AnswerKeyEntry[]): T[] {
  const byId = new Map(answerKey.map(k => [k.id, k]));
  return questions.map((q) => {
    const key = byId.get(q.id);
    return key ? { ...q, ...key } : q;
  });
}
