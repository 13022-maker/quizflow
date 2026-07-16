/**
 * AI 生成學科 — 老師輸入單元主題（可選附教材文字），AI（Claude 為主，失敗自動退 Gemini）生成完整學科：
 *   知識圖譜（3~5 個知識點，含前置依賴鏈）＋題庫（每點 5~8 題單選，難度分布
 *   0.2~0.9、正解、解析）＋導師風格規則（數學類強制純文字數學式、程式類給範例）。
 * 驗證三道關卡：JSON 可解析 → zod 結構驗證 → AdaptiveEngine 建構（拓撲排序驗 DAG）。
 * 格式不合法自動重試一次（把錯誤訊息回饋給模型修正）。
 */
import { z } from 'zod';

import { generateAIText } from '@/lib/ai/textModel';

import { AdaptiveEngine, type ItemBank, type KnowledgeGraph } from './engine';
import type { Subject } from './subjects';

/** 生成結果的結構驗證（引擎層的硬性約束都在這裡把關） */
const generatedSubjectSchema = z.object({
  name: z.string().min(1).max(40),
  knowledgePoints: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/, 'id 需為小寫英數與連字號'),
        name: z.string().min(1).max(30),
        prerequisites: z.array(z.string()),
      }),
    )
    .min(3)
    .max(5),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        knowledgeId: z.string(),
        difficulty: z.number().min(0.1).max(1),
        prompt: z.string().min(1),
        options: z.array(z.string().min(1)).length(4),
        answerIndex: z.number().int().min(0).max(3),
        explanation: z.string().min(1),
      }),
    )
    .min(9),
  tutor: z.object({
    lessonExampleRule: z.string().min(1),
    formatRule: z.string().min(1),
  }),
});

export type GeneratedSubject = z.infer<typeof generatedSubjectSchema>;

const SYSTEM_PROMPT = `你是台灣中學／大學教材設計專家，為「適性學習系統」設計學科內容。
系統原理：BKT 精熟度模型沿知識圖譜的前置依賴逐點教學，依學生表現動態調整題目難度；
學生連錯兩題會觸發 AI 補強課文。你設計的內容品質直接決定診斷準確度。

輸出要求：只輸出一個 JSON 物件（不要 Markdown 圍欄、不要任何說明文字），結構如下：
{
  "name": "學科顯示名稱（簡潔，例如：二次函數）",
  "knowledgePoints": [
    { "id": "小寫英數與連字號", "name": "知識點名稱", "prerequisites": ["前置知識點id"] }
  ],
  "items": [
    {
      "id": "題目唯一id",
      "knowledgeId": "所屬知識點id",
      "difficulty": 0.2,
      "prompt": "題幹",
      "options": ["選項A", "選項B", "選項C", "選項D"],
      "answerIndex": 0,
      "explanation": "一句話解析（為什麼是這個答案、常見錯誤在哪）"
    }
  ],
  "tutor": {
    "lessonExampleRule": "補強課文『重點講解』段落的範例形式要求（程式類：可執行程式碼＋逐步推導；數學類：算式逐步推導，每步一行並說明理由；其他：具體實例）",
    "formatRule": "表達格式規則（見下方格式鐵則）"
  }
}

設計鐵則：
1. 知識點 3~5 個，依賴關係構成由淺入深的有向無環圖（至少是一條線性鏈）；第一個知識點 prerequisites 必須是空陣列
2. 每個知識點 5~8 題，難度覆蓋 0.2 到 0.9 的光譜（至少含一題 ≤0.3 與一題 ≥0.7）
3. 全部單選題、恰好 4 個選項；錯誤選項必須是「學生真的會犯的典型錯誤」（差一錯誤、概念混淆、符號誤用），不要湊數
4. answerIndex 位置刻意打散（不要都是同一個位置）
5. 所有內容使用繁體中文（台灣用語）
6. 格式鐵則（一律寫進 tutor.formatRule）：數學內容一律用純文字與 Unicode 符號（x²、√x、f′(x)、∫₀¹、lim(x→0)、π），絕對禁止 LaTeX（\\frac、$…$ 等），因為閱讀介面不支援 LaTeX 渲染；多步推導放在程式碼區塊逐行對齊`;

function buildUserPrompt(topic: string, material?: string): string {
  const materialBlock = material?.trim()
    ? `\n\n以下是老師提供的教材內容，知識點劃分與題目範圍以此為準（不要超出教材範圍出題）：\n<教材>\n${material.trim().slice(0, 20000)}\n</教材>`
    : '';
  return `請為以下單元主題設計學科：「${topic.trim()}」${materialBlock}`;
}

/** 把生成結果組裝成引擎可用的 Subject（id 由呼叫端以 db:<rowId> 填入） */
export function toSubject(
  generated: GeneratedSubject,
  id: string,
): { subject: Subject; graph: KnowledgeGraph; itemBank: ItemBank } {
  const graph: KnowledgeGraph = {
    nodes: generated.knowledgePoints.map(k => ({
      id: k.id,
      name: k.name,
      prerequisites: k.prerequisites,
    })),
  };
  const itemBank: ItemBank = { items: generated.items };
  const subject: Subject = {
    id,
    name: generated.name,
    graph,
    itemBank,
    tutor: generated.tutor,
  };
  return { subject, graph, itemBank };
}

/** 結構之外的語意驗證：知識點引用、每點題數、難度光譜；最後用引擎建構驗 DAG */
function validateSemantics(generated: GeneratedSubject): void {
  const knowledgeIds = new Set(generated.knowledgePoints.map(k => k.id));

  for (const k of generated.knowledgePoints) {
    for (const p of k.prerequisites) {
      if (!knowledgeIds.has(p)) {
        throw new Error(`知識點 ${k.id} 的前置 ${p} 不存在`);
      }
    }
  }

  const itemIds = new Set<string>();
  for (const item of generated.items) {
    if (!knowledgeIds.has(item.knowledgeId)) {
      throw new Error(`題目 ${item.id} 綁定的知識點 ${item.knowledgeId} 不存在`);
    }
    if (itemIds.has(item.id)) {
      throw new Error(`題目 id 重複：${item.id}`);
    }
    itemIds.add(item.id);
  }

  for (const kId of knowledgeIds) {
    const count = generated.items.filter(i => i.knowledgeId === kId).length;
    if (count < 3) {
      throw new Error(`知識點 ${kId} 只有 ${count} 題（至少 3 題才能適性派題）`);
    }
  }

  // 引擎建構時做拓撲排序，循環依賴會在這裡丟錯
  const { graph, itemBank } = toSubject(generated, 'validation');
  void new AdaptiveEngine(graph, itemBank);
}

/** 從模型輸出取出 JSON（容錯：剝掉可能的 Markdown 圍欄） */
function extractJson(text: string): unknown {
  const stripped = text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  return JSON.parse(stripped);
}

/**
 * 呼叫 AI 生成學科（約 1~3 分鐘）。走 generateAIText 分流備援（付費 Claude 失敗自動退 Gemini）。
 * 驗證失敗會帶著錯誤訊息重試一次；兩次都失敗才丟錯給呼叫端。
 */
export async function generateSubject(topic: string, material?: string): Promise<GeneratedSubject> {
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    // 重試時附上上次的驗證錯誤，讓模型修正
    const retryNote = lastError
      ? `\n\n【上次生成有以下問題，請修正後重新生成】\n${lastError}`
      : '';
    const { text, usedModel } = await generateAIText({
      prompt: buildUserPrompt(topic, material) + retryNote,
      system: SYSTEM_PROMPT,
      claudeModel: 'claude-opus-4-8',
      claudeThinking: true,
      maxTokens: 32000,
      json: true,
    });
    console.warn(`[generate-subject] attempt=${attempt} usedModel=${usedModel}`);

    try {
      const generated = generatedSubjectSchema.parse(extractJson(text));
      validateSemantics(generated);
      return generated;
    } catch (error) {
      lastError = (error as Error).message;
    }
  }
  throw new Error(`AI 生成的學科結構驗證失敗：${lastError}`);
}
