/**
 * 公開範例頁（/demo）用的題型與本機批改邏輯
 *
 * 範例頁不登入、不寫 DB：題目是靜態資料（src/data/demo/demoQuiz.ts），
 * 學生端作答只在瀏覽器批改，讓老師先看到「出好的題目 + 學生作答」的成果。
 */

export type DemoQuestion = {
  id: string;
  type: 'single_choice' | 'multiple_choice' | 'true_false';
  body: string;
  options: { id: string; text: string }[];
  correctAnswers: string[];
  explanation: string;
  tags: string[]; // 例：108 課綱素養、Bloom 層次（只做顯示）
};

export type DemoAnswers = Record<string, string[]>;

export type DemoGradeResult = {
  correct: number;
  total: number;
  score: number; // 0–100，四捨五入
  results: Record<string, boolean>;
};

// 純函數：全對才給分（多選題少選、多選都算錯），沒作答算錯
export function gradeDemoQuiz(questions: DemoQuestion[], answers: DemoAnswers): DemoGradeResult {
  const results: Record<string, boolean> = {};
  let correct = 0;

  for (const q of questions) {
    const picked = new Set(answers[q.id] ?? []);
    const expected = new Set(q.correctAnswers);
    const isCorrect = picked.size === expected.size && [...expected].every(id => picked.has(id));
    results[q.id] = isCorrect;
    if (isCorrect) {
      correct += 1;
    }
  }

  const total = questions.length;
  const score = total === 0 ? 0 : Math.round((correct / total) * 100);
  return { correct, total, score, results };
}
