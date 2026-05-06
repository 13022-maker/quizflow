/**
 * 蘇格拉底式 AI 教練提示 API
 *
 * POST /api/hint/socratic
 * body: { question, correctAnswer, studentAnswer, roundNumber }
 * 回傳：{ hint, showExplanation }
 *
 * 用於錯題重做流程：學生答錯後，AI 教練分三輪以反問引導，
 * 第三輪後再答錯就回 showExplanation:true 讓前端顯示解析。
 *
 * 公開 endpoint：學生無需登入即可使用（quiz 本身已公開作答）
 */

import { GoogleGenAI } from '@google/genai';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });

const SOCRATIC_SYSTEM_PROMPT = `
你是一位蘇格拉底式 AI 學習教練，專門協助學生在錯誤中自行建構正確理解。

【核心原則】
- 絕對不直接說出答案或答案的關鍵字
- 用反問、類比、舉例引導學生重新思考
- 每次回應只問一個問題，不問多個
- 語氣溫暖但簡潔，不說教

【對話結構：最多三輪】
第一輪（診斷思維）：
找出學生答錯的根本原因，用一個問題讓他重新檢視自己的邏輯。
例：「你選了 X，可以告訴我你是怎麼想到這個的嗎？」

第二輪（鬆動錯誤）：
針對錯誤邏輯提供一個反例或類比，再問一個問題。
例：「如果換成 [類比情境]，你覺得還是一樣嗎？」

第三輪（給方向）：
給出思考方向但不給答案，引導學生最後一步。
例：「試著從 [關鍵概念] 的角度再想一次，重點是什麼？」

【輸出規則】
- 只輸出給學生看的 2-3 句話
- 不加任何前綴或說明文字
- 使用繁體中文
`.trim();

export async function POST(req: NextRequest) {
  try {
    const { question, correctAnswer, studentAnswer, roundNumber } = await req.json();

    // 防護：round > 3 直接回 showExplanation
    if (typeof roundNumber !== 'number' || roundNumber > 3) {
      return NextResponse.json({ showExplanation: true });
    }

    if (!question || !correctAnswer) {
      return NextResponse.json({ error: '缺少題目或正確答案' }, { status: 400 });
    }

    const prompt = `題目：${question}
正確答案：${correctAnswer}（只供你參考，絕對不可說出）
學生答案：${studentAnswer ?? '（未作答）'}
目前輪次：${roundNumber}`;

    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction: SOCRATIC_SYSTEM_PROMPT,
        // 關閉 thinking 模式（這是聊天回應不是推理任務），避免 thinking tokens 把預算吃掉導致正文被截斷
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 1024,
      },
    });

    const hint = (result.text ?? '').trim();
    if (!hint) {
      return NextResponse.json({ error: 'AI 教練暫時無回應，請再試一次' }, { status: 500 });
    }

    return NextResponse.json({ hint, showExplanation: false });
  } catch (err) {
    console.error('[hint/socratic] Gemini 呼叫失敗：', err);
    return NextResponse.json({ error: 'Failed to generate hint' }, { status: 500 });
  }
}
