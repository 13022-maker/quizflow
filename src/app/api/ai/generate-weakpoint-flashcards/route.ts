/**
 * AI 生成「弱點概念卡」API（Adaptive 學習儀表板專用）
 * 輸入：{ subjectName, items: [{ prompt, wrongCount, knowledgeName }] }（全班答錯次數最高的前3題）
 * 輸出：{ title, cards: [{ front, back, example }] }（front=核心概念名稱，back=簡潔解釋，example=範例）
 *
 * 統一走 generateAIText（付費 Claude 失敗備援 Gemini；免費 Gemini 失敗也會備援 Claude），
 * 跟 generate-remedial 同套模式。
 */
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { checkAndIncrementAiUsage } from '@/actions/aiUsageActions';
import { generateAIText } from '@/lib/ai/textModel';
import { friendlyAIGenerationError } from '@/libs/adaptive/generate-subject';

export const runtime = 'nodejs';
export const maxDuration = 60;

const wrongItemSchema = z.object({
  prompt: z.string().min(1),
  wrongCount: z.number().int().min(1),
  knowledgeName: z.string().min(1),
});

const requestSchema = z.object({
  subjectName: z.string().min(1),
  items: z.array(wrongItemSchema).min(1).max(3),
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  const quota = await checkAndIncrementAiUsage(userId);
  if (!quota.allowed) {
    return NextResponse.json(
      { error: quota.reason, upgradeRequired: true, remaining: 0 },
      { status: 403 },
    );
  }

  const parsed = requestSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: '缺少必要資料' }, { status: 400 });
  }
  const { subjectName, items } = parsed.data;

  const itemList = items
    .map((it, i) => `${i + 1}. 【${it.knowledgeName}】全班答錯 ${it.wrongCount} 次\n   題目：${it.prompt}`)
    .join('\n');

  const prompt = `你是一位耐心的「${subjectName}」家教老師。以下是全班學生答錯次數最高的題目（依答錯次數排序）：

${itemList}

請針對每一題，各出一張「概念卡」，講清楚這題背後真正該理解的核心概念，幫助學生下次不再犯同樣的錯。

規則：
1. 每張卡片：front 是這題考的核心概念名稱（用幾個字精簡概括，不要整題照抄）、back 是精簡扼要的解釋（100 字以內，講清楚為什麼容易答錯、正確的理解是什麼）、example 是一個具體範例（程式概念給範例程式碼片段，數學概念給範例算式，其他概念給簡短例句或情境）
2. 卡片數量跟題目數量一致，一題一張卡，不要合併也不要拆分
3. 只回傳合法 JSON，不要任何 markdown 或說明文字
4. 所有文字使用繁體中文
5. title 是根據這批錯題命名的卡集標題（≤ 20 字，例如「XX 錯題複習卡」）

JSON 格式：
{
  "title": "卡集標題",
  "cards": [
    { "front": "知識點名稱", "back": "簡潔解釋", "example": "範例" }
  ]
}`;

  try {
    const { text: raw, usedModel } = await generateAIText({
      prompt,
      maxTokens: 2048,
      json: true,
    });
    console.warn(`[generate-weakpoint-flashcards] usedModel=${usedModel}`);

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return NextResponse.json({ error: 'AI 回傳格式錯誤' }, { status: 500 });
    }

    const result = JSON.parse(match[0]) as { title?: string; cards?: unknown };
    if (!result.title || !Array.isArray(result.cards) || result.cards.length === 0) {
      return NextResponse.json({ error: 'AI 未回傳卡片內容，請重試' }, { status: 500 });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('[generate-weakpoint-flashcards] 生成失敗：', err);
    return NextResponse.json({ error: friendlyAIGenerationError(err) }, { status: 500 });
  }
}
