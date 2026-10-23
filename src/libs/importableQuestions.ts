/**
 * importableQuestions.ts — 匯入 AI 題目前，先挑出「格式不完整、存檔一定會失敗」的題目
 *
 * 踩過的坑：QuizEditor 的講義匯入過去逐題呼叫 createQuestion，它的 Zod 驗證失敗時
 * 回傳 { error } 而不是 throw，呼叫端沒檢查 → 題目被默默吃掉，老師完全不知道少了幾題。
 * 這裡依 createQuestion（src/actions/questionActions.ts QuestionInputSchema）的規則
 * 先行過濾：題幹不可空白、選項文字不可空白，並回傳略過題數讓 UI 告知老師。
 */

type ImportableQuestion = {
  question: string;
  options?: string[];
};

export function partitionImportableQuestions<T extends ImportableQuestion>(
  questions: T[],
): { valid: T[]; skipped: number } {
  const valid = questions.filter((q) => {
    if (typeof q.question !== 'string' || !q.question.trim()) {
      return false;
    }
    if (q.options && q.options.some(opt => typeof opt !== 'string' || !opt.trim())) {
      return false;
    }
    return true;
  });
  return { valid, skipped: questions.length - valid.length };
}

export function skippedQuestionsNotice(skipped: number): string | null {
  return skipped > 0 ? `${skipped} 題格式不完整已略過` : null;
}
