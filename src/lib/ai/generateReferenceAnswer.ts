// 簡答題參考答案 AI 預生成（給老師建題時的草稿，老師可微調）
// 與 gradeShortAnswer 共用 Anthropic SDK 直連模式

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export type GenerateReferenceAnswerInput = {
  questionBody: string;
};

export async function generateReferenceAnswer(
  input: GenerateReferenceAnswerInput,
): Promise<string> {
  const prompt = [
    '你是專業出題教師助理。給定一道簡答題，請寫一份適合作為「參考答案 / 評分要點」的草稿。',
    '',
    `題目：${input.questionBody}`,
    '',
    '要求：',
    '- 繁體中文回答',
    '- 80-200 字以內',
    '- 涵蓋此題期望學生答出的核心概念與關鍵詞',
    '- 若題目可有多角度回答，用「應包含」「至少提及」等用詞列出評分要點',
    '- 直接給答案文字，不要前後綴（例：不要寫「以下是參考答案：」）',
  ].join('\n');

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = message.content[0];
  if (!block || block.type !== 'text') {
    throw new Error('AI 未回傳文字');
  }
  return block.text.trim();
}
