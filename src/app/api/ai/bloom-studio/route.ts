/**
 * Bloom's Taxonomy 題目生成 API
 * 使用 Claude Sonnet，回傳含 bloom_level / learning_objective 的豐富格式
 */

import Anthropic from '@anthropic-ai/sdk';
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { checkAndIncrementAiUsage } from '@/actions/aiUsageActions';

export const runtime = 'nodejs';
export const maxDuration = 60;

const SYSTEM_PROMPT = `你是台灣教育專家，幫助教師生成高品質的自動評量題目。

## 你的角色
- 根據 Bloom's Taxonomy（布魯姆分類法）設計題目
- 確保題目符合認知層級要求
- 使用台灣教育術語和例子
- 支援多種題型（單選、複選、簡答、計算）

## Bloom's Taxonomy 認知層級（由簡到難）

1. **記憶 (Remember)** - 難度 1：學生回憶事實、術語、定義。關鍵詞：定義、列舉、復述、識別
2. **理解 (Understand)** - 難度 2：學生解釋概念、轉述意義。關鍵詞：解釋、分類、舉例、描述
3. **應用 (Apply)** - 難度 3：學生在新情境使用知識。關鍵詞：應用、計算、使用、執行
4. **分析 (Analyze)** - 難度 4：學生分解、比較成分關係。關鍵詞：比較、對比、區分、推論
5. **評估 (Evaluate)** - 難度 5：學生判斷、批判、做決定。關鍵詞：評估、批判、判斷、選擇
6. **創造 (Create)** - 難度 6：學生組合、設計新觀念。關鍵詞：設計、發明、建構、規畫

## 輸出格式（必須是有效 JSON，最外層為物件）

{
  "metadata": {
    "topic": "主題",
    "bloom_levels_covered": ["remember", "understand"],
    "estimated_total_minutes": 10
  },
  "questions": [
    {
      "id": 1,
      "type": "multiple_choice",
      "bloom_level": "understand",
      "difficulty": 2,
      "content": "題目內容",
      "options": ["A選項", "B選項", "C選項", "D選項"],
      "correct_answer": 0,
      "explanation": "解釋為什麼是正確答案",
      "learning_objective": "學習目標",
      "estimated_time_minutes": 2
    }
  ]
}

type 值只能是 "multiple_choice" 或 "short_answer"。
correct_answer 對 multiple_choice 是選項索引（0-based），對 short_answer 是參考答案字串。
必須輸出純 JSON，不要加 markdown code block。`;

// difficulty → Bloom 層級提示
const DIFFICULTY_HINTS: Record<string, string> = {
  mixed: '均勻分配 6 個 Bloom 認知層級（記憶/理解/應用/分析/評估/創造）',
  easy: '集中在較低層次：記憶（Remember）與理解（Understand）',
  medium: '集中在中間層次：應用（Apply）與分析（Analyze）',
  hard: '集中在較高層次：評估（Evaluate）與創造（Create）',
};

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    const quota = await checkAndIncrementAiUsage(userId);
    if (!quota.allowed) {
      return NextResponse.json(
        { error: quota.reason, upgradeRequired: true },
        { status: 403 },
      );
    }

    const body = await request.json();
    const { content, difficulty = 'mixed', numQuestions = 5, questionType = 'mixed' } = body;

    if (!content?.trim()) {
      return NextResponse.json({ error: '請輸入教學內容' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: '伺服器未設定 ANTHROPIC_API_KEY' }, { status: 500 });
    }

    const count = Math.min(Number(numQuestions) || 5, 20);
    const difficultyHint = DIFFICULTY_HINTS[difficulty] ?? DIFFICULTY_HINTS.mixed!;
    const typeHint = questionType === 'multiple_choice'
      ? '全部使用單選題（multiple_choice）'
      : questionType === 'short_answer'
        ? '全部使用簡答題（short_answer）'
        : '以單選題為主，若 Bloom 層次為評估或創造可使用簡答題';

    const userPrompt = `教學內容：
${content}

生成要求：
- 題數：${count} 題
- 難度分布：${difficultyHint}
- 題型要求：${typeHint}
- 輸出格式：純 JSON（不要加 markdown）

請確保每題都有明確的 Bloom 認知層級標記、難度分數、解釋與學習目標。使用繁體中文和台灣教育語境。`;

    const client = new Anthropic({ apiKey });

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = message.content[0]?.type === 'text' ? message.content[0].text : '';

    // 解析 JSON（允許 Claude 包 markdown code block）
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: '回應格式錯誤，請重試' }, { status: 500 });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return NextResponse.json(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知錯誤';
    console.error('[bloom-studio]', msg);
    return NextResponse.json({ error: `生成失敗：${msg}` }, { status: 500 });
  }
}
