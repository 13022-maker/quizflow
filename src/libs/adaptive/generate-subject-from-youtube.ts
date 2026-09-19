/**
 * AI 生成學科 — YouTube 匯入模式。跟 generate-subject.ts（貼文字／上傳檔案）是完全獨立的一份
 * prompt／schema／驗證，刻意不共用 generatedSubjectSchema／SYSTEM_PROMPT／toSubject，
 * 避免任何改動波及既有已經在跑的兩種模式。
 */
import { z } from 'zod';

import { generateAIText, isPaidSubscriberSafe } from '@/lib/ai/textModel';

import { AdaptiveEngine } from './engine';
import { extractJson } from './generate-subject';

const BLOOM_LEVELS = ['記憶', '理解', '應用', '分析', '評鑑', '創造'] as const;

const youtubeGeneratedSubjectSchema = z.object({
  name: z.string().min(1).max(40),
  knowledgePoints: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/, 'id 需為小寫英數與連字號'),
        name: z.string().min(1).max(30),
        prerequisites: z.array(z.string()),
        videoRef: z
          .object({
            videoId: z.string(),
            startSec: z.number().min(0),
            endSec: z.number().min(0),
          })
          .optional(),
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
        bloomLevel: z.enum(BLOOM_LEVELS),
      }),
    )
    .min(9),
  tutor: z.object({
    lessonExampleRule: z.string().min(1),
    formatRule: z.string().min(1),
  }),
});

export type YoutubeGeneratedSubject = z.infer<typeof youtubeGeneratedSubjectSchema>;

const YOUTUBE_SYSTEM_PROMPT = `你是台灣中學／大學教材設計專家，為「適性學習系統」設計學科內容。
教材來源是一份或多份 YouTube 教學影片的逐字稿，每段都標有 [t=秒數s] 時間戳與所屬影片 videoId
（格式：=== 影片 N：{videoId} === 開頭，後面接該影片的分段逐字稿）。
系統原理：BKT 精熟度模型沿知識圖譜的前置依賴逐點教學，依學生表現動態調整題目難度；
學生連錯兩題會觸發 AI 補強課文。你設計的內容品質直接決定診斷準確度。

輸出要求：只輸出一個 JSON 物件（不要 Markdown 圍欄、不要任何說明文字），結構如下：
{
  "name": "學科顯示名稱（簡潔，例如：光合作用）",
  "knowledgePoints": [
    {
      "id": "小寫英數與連字號",
      "name": "知識點名稱",
      "prerequisites": ["前置知識點id"],
      "videoRef": { "videoId": "逐字稿裡出現過的 videoId", "startSec": 93, "endSec": 180 }
    }
  ],
  "items": [
    {
      "id": "題目唯一id",
      "knowledgeId": "所屬知識點id",
      "difficulty": 0.2,
      "prompt": "題幹",
      "options": ["選項A", "選項B", "選項C", "選項D"],
      "answerIndex": 0,
      "explanation": "一句話解析（為什麼是這個答案、常見錯誤在哪）",
      "bloomLevel": "理解"
    }
  ],
  "tutor": {
    "lessonExampleRule": "補強課文『重點講解』段落的範例形式要求",
    "formatRule": "表達格式規則（見下方格式鐵則）"
  }
}

設計鐵則：
1. 知識點 3~5 個，依賴關係構成由淺入深的有向無環圖（至少是一條線性鏈）；第一個知識點 prerequisites 必須是空陣列
2. 每個知識點 5~8 題，難度覆蓋 0.2 到 0.9 的光譜（至少含一題 ≤0.3 與一題 ≥0.7）
3. 全部單選題、恰好 4 個選項；錯誤選項必須是「學生真的會犯的典型錯誤」，不要湊數
4. answerIndex 必須平均分散在 0、1、2、3 之間，生成完後自我檢查一次分布，發現集中就手動調整
5. 每題標一個 bloomLevel（記憶/理解/應用/分析/評鑑/創造），同一知識點內盡量覆蓋多種層次，不要全部都是「記憶」層級
6. videoRef 必須引用逐字稿裡實際出現過的 videoId，startSec/endSec 落在該知識點內容講解的範圍（抓一段約 30~90 秒、足以完整講解該知識點），沒有明確對應片段就不要硬湊，留空即可（videoRef 為選填）
7. 所有內容使用繁體中文（台灣用語）
8. 格式鐵則（一律寫進 tutor.formatRule）：數學內容一律用純文字與 Unicode 符號，絕對禁止 LaTeX`;

export function buildYoutubeUserPrompt(topic: string, transcript: string): string {
  return `請為以下單元主題設計學科：「${topic.trim()}」\n\n以下是老師提供的 YouTube 影片逐字稿，知識點劃分與題目範圍以此為準（不要超出逐字稿範圍出題）：\n<影片逐字稿>\n${transcript}\n</影片逐字稿>`;
}

/** 結構之外的語意驗證：知識點引用、題目數量、videoRef 合法性；最後用引擎建構驗 DAG */
export function validateYoutubeSemantics(
  generated: YoutubeGeneratedSubject,
  videoIds: string[],
): void {
  const knowledgeIds = new Set(generated.knowledgePoints.map(k => k.id));
  const videoIdSet = new Set(videoIds);

  for (const k of generated.knowledgePoints) {
    for (const p of k.prerequisites) {
      if (!knowledgeIds.has(p)) {
        throw new Error(`知識點 ${k.id} 的前置 ${p} 不存在`);
      }
    }
    if (k.videoRef) {
      if (!videoIdSet.has(k.videoRef.videoId)) {
        throw new Error(`知識點 ${k.id} 的 videoRef.videoId「${k.videoRef.videoId}」不在送入的影片清單裡`);
      }
      if (k.videoRef.startSec >= k.videoRef.endSec) {
        throw new Error(`知識點 ${k.id} 的 videoRef 時間範圍不合法（startSec 需小於 endSec）`);
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
  const graph = {
    nodes: generated.knowledgePoints.map(k => ({
      id: k.id,
      name: k.name,
      prerequisites: k.prerequisites,
      videoRef: k.videoRef,
    })),
  };
  const itemBank = { items: generated.items };
  void new AdaptiveEngine(graph, itemBank);
}

/**
 * 呼叫 AI 生成學科（YouTube 模式）。走 generateAIText 分流備援，付費判定沿用文字/檔案模式同一套規則。
 * 驗證失敗會帶著錯誤訊息重試一次；兩次都失敗才丟錯給呼叫端。
 */
export async function generateSubjectFromYoutube(
  topic: string,
  transcript: string,
  videoIds: string[],
): Promise<YoutubeGeneratedSubject> {
  const forceGemini = !(await isPaidSubscriberSafe());
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const retryNote = lastError
      ? `\n\n【上次生成有以下問題，請修正後重新生成】\n${lastError}`
      : '';
    const { text, usedModel } = await generateAIText({
      prompt: buildYoutubeUserPrompt(topic, transcript) + retryNote,
      system: YOUTUBE_SYSTEM_PROMPT,
      claudeModel: 'claude-opus-4-8',
      claudeThinking: true,
      maxTokens: 32000,
      json: true,
      forceGemini,
    });
    console.warn(`[generate-subject-from-youtube] attempt=${attempt} usedModel=${usedModel}`);

    try {
      const generated = youtubeGeneratedSubjectSchema.parse(extractJson(text));
      validateYoutubeSemantics(generated, videoIds);
      return generated;
    } catch (error) {
      lastError = (error as Error).message;
    }
  }
  throw new Error(`AI 生成的學科結構驗證失敗：${lastError}`);
}
