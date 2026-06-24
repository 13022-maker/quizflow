// 簡答題 AI 自動評分（學生提交時呼叫，同步）
//
// 使用 @anthropic-ai/sdk 直接呼叫 Claude，與專案其他 AI 端點一致
// （CLAUDE.md 明示「維持 @anthropic-ai/sdk，不遷移」）。

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export type GradeResult = {
  isCorrect: boolean; // 是否「算對」（>=70% 滿分算對）
  confidence: number; // AI 自身信心 0-1（有 reference 較高，靠題幹判較低）
  reason: string; // 一句話評語（給老師複核時看）
  score: number; // 0 ~ maxPoints 整數，可給部分分
};

export type GradeInput = {
  questionBody: string;
  referenceAnswer: string | null; // 老師選填的參考答案（沒有則 AI 靠題幹自行判斷）
  studentAnswer: string;
  maxPoints: number;
};

/**
 * 對單一簡答題作答呼叫 Claude 評分
 *
 * 失敗策略：上層應自己 try/catch 並 fallback 成「待批改」（isCorrect=null）
 * 這裡只負責呼叫 + 解析 JSON，外層處理錯誤更乾淨
 */
export async function gradeShortAnswer(input: GradeInput): Promise<GradeResult> {
  // 學生交白卷：直接判 0 分，不打 API 浪費 token
  if (input.studentAnswer.trim().length === 0) {
    return {
      isCorrect: false,
      confidence: 1,
      reason: '學生交白卷',
      score: 0,
    };
  }

  const modeDescription = input.referenceAnswer
    ? '【嚴格模式】請對照「參考答案」評分。允許學生用自己的話表達，但語意必須正確、不可遺漏關鍵概念。'
    : '【寬鬆模式】未提供參考答案，請依題幹語意判斷答案是否合理。信心度應較低（0.4-0.7）以反映不確定。';

  const promptBody = [
    `你是專業教師助理，幫忙批改一題簡答題。${modeDescription}`,
    '',
    `題目：${input.questionBody}`,
    input.referenceAnswer ? `參考答案：${input.referenceAnswer}` : null,
    `學生答案：${input.studentAnswer}`,
    `滿分：${input.maxPoints} 分`,
    '',
    '請只回傳合法 JSON（不要任何說明文字），格式如下：',
    '{',
    '  "isCorrect": true 或 false,',
    '  "confidence": 0.0 到 1.0 的數字,',
    '  "reason": "一句話評語（≤30 字，繁體中文）",',
    `  "score": 0 到 ${input.maxPoints} 的整數`,
    '}',
    '',
    '評分原則：',
    `- score >= ${Math.ceil(input.maxPoints * 0.7)} → isCorrect: true`,
    `- score < ${Math.ceil(input.maxPoints * 0.7)} → isCorrect: false`,
    '- 給部分分時要在 reason 簡述扣分理由',
  ]
    .filter(Boolean)
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250122',
    max_tokens: 512,
    messages: [{ role: 'user', content: promptBody }],
  });

  const raw = (message.content[0] as { type: string; text: string }).text ?? '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('AI 回傳格式無 JSON');
  }

  const parsed = JSON.parse(match[0]) as Partial<GradeResult>;

  // 防呆：clamp score 到 [0, maxPoints]，並 fallback 缺欄位
  const score = Math.max(0, Math.min(input.maxPoints, Math.round(parsed.score ?? 0)));
  const confidence = Math.max(0, Math.min(1, parsed.confidence ?? 0.5));
  const isCorrect = typeof parsed.isCorrect === 'boolean'
    ? parsed.isCorrect
    : score >= Math.ceil(input.maxPoints * 0.7); // 萬一 AI 沒回，用 score 推

  return {
    isCorrect,
    confidence,
    reason: parsed.reason ?? '（AI 未提供評語）',
    score,
  };
}
