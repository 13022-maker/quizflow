import { z } from 'zod';

// ---------- 申論題批改（Essay Grading） ----------

export type EssayRubric = {
  criteria: { name: string; maxScore: number; description: string }[];
  instructions?: string;
};

// 系統預設評分量表：內容 / 結構 / 語言 / 創意 各 5 分，總分 20
export const DEFAULT_ESSAY_RUBRIC: EssayRubric = {
  criteria: [
    { name: '內容', maxScore: 5, description: '論點清晰、舉例恰當、深度足夠' },
    { name: '結構', maxScore: 5, description: '段落分明、起承轉合、邏輯連貫' },
    { name: '語言', maxScore: 5, description: '用詞精準、文法正確、標點得當' },
    { name: '創意', maxScore: 5, description: '觀點新穎、表達獨特、引人深思' },
  ],
};

export const EssayGradingResultSchema = z.object({
  criteriaScores: z.array(
    z.object({
      name: z.string(),
      score: z.number(),
      maxScore: z.number(),
      feedback: z.string(),
    }),
  ),
  overallFeedback: z.string(),
  sentenceFeedback: z.array(
    z.object({
      sentence: z.string(),
      comment: z.string(),
    }),
  ),
  totalScore: z.number(),
  maxScore: z.number(),
});

export type EssayGradingResult = z.infer<typeof EssayGradingResultSchema>;

export const ESSAY_GRADING_SYSTEM_PROMPT = `你是資深國文科教師，擅長批改台灣中學生作文與申論題。
批改原則：
- 使用繁體中文
- 嚴謹但鼓勵式，具體指出優點與改進方向
- 逐句回饋只挑 3-6 個關鍵句子（不需每句都評）
- 逐句回饋要引用學生原文句子（sentence 欄位）
- criteriaScores 的 name 要與評分標準表一致
- totalScore = 各 criteriaScores.score 加總；maxScore = 各 criteriaScores.maxScore 加總
- 只輸出合法 JSON，不加任何前後說明文字`;

export function buildEssayGradingUserPrompt({
  question,
  rubric,
  studentAnswer,
}: {
  question: string;
  rubric: EssayRubric;
  studentAnswer: string;
}): string {
  const criteriaText = rubric.criteria
    .map(c => `- ${c.name}（滿分 ${c.maxScore}）：${c.description}`)
    .join('\n');

  const extra = rubric.instructions ? `\n【額外批改指示】\n${rubric.instructions}` : '';

  return `【題目】
${question}

【評分標準】
${criteriaText}${extra}

【學生作答】
${studentAnswer}

請依以下 JSON schema 輸出：
{
  "criteriaScores": [{"name": "面向名稱", "score": 分數, "maxScore": 滿分, "feedback": "這個面向的評語"}],
  "overallFeedback": "整體綜合評語（2-4 句）",
  "sentenceFeedback": [{"sentence": "學生原句", "comment": "針對這句的具體評語"}],
  "totalScore": 各面向分數加總,
  "maxScore": 各面向滿分加總
}`;
}
