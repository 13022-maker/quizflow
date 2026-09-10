/**
 * AI 生成「弱點概念卡」API（Adaptive 學習儀表板專用）
 * 輸入：{ subjectName, concepts: [{ name, masteryPct }] }（全班掌握率 <50% 的知識點）
 * 輸出：{ title, cards: [{ front, back, example }] }（front=知識點名稱，back=簡潔解釋，example=範例）
 *
 * 統一走 generateAIText（付費 Claude、失敗備援 Gemini），跟 generate-remedial 同套模式。
 */
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { checkAndIncrementAiUsage } from '@/actions/aiUsageActions';
import { generateAIText } from '@/lib/ai/textModel';

export const runtime = 'nodejs';
export const maxDuration = 60;

const conceptSchema = z.object({
  name: z.string().min(1),
  masteryPct: z.number().min(0).max(100),
});

const requestSchema = z.object({
  subjectName: z.string().min(1),
  concepts: z.array(conceptSchema).min(1).max(30),
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
  const { subjectName, concepts } = parsed.data;

  const conceptList = concepts
    .map(c => `- ${c.name}（全班平均掌握率 ${c.masteryPct}%）`)
    .join('\n');

  const prompt = `你是一位耐心的「${subjectName}」家教老師。以下是全班學生目前掌握率偏低、需要加強的知識點：

${conceptList}

請針對每一個知識點，各出一張「概念卡」，幫助學生快速複習、建立記憶。

規則：
1. 每張卡片：front 是知識點名稱（直接沿用上面給的名稱，不要改寫）、back 是精簡扼要的解釋（100 字以內，講清楚核心觀念跟常見誤解）、example 是一個具體範例（程式概念給範例程式碼片段，數學概念給範例算式，其他概念給簡短例句或情境）
2. 卡片數量跟知識點數量一致，一個知識點一張卡，不要合併也不要拆分
3. 只回傳合法 JSON，不要任何 markdown 或說明文字
4. 所有文字使用繁體中文
5. title 是根據這批知識點命名的卡集標題（≤ 20 字，例如「XX 弱點複習卡」）

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
    const msg = err instanceof Error ? err.message : '概念卡生成失敗';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
