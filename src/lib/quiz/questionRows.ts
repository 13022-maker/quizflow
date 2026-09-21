// 「AI 題型 → question 表欄位」的轉換規則。
// 原本寫死在 src/app/api/quizzes/[id]/questions/route.ts 裡，
// 抽出來讓「單一測驗匯入」跟「備課包批次匯入」共用同一套規則，不要維護兩份。
import { sanitizeStoredDiagramSvg } from '@/lib/ai/diagramSvg';
import { stripOptionLabel } from '@/lib/ai/optionText';
import { extractClozeAnswers } from '@/lib/cloze';
import type { questionSchema } from '@/models/Schema';

export type FileQuestionType = 'mc' | 'tf' | 'fill' | 'short' | 'rank' | 'listening' | 'cloze';

export type GeneratedQuestion = {
  type: FileQuestionType;
  question: string;
  options?: string[];
  // optional：cloze 題型不需要 answer（正解從 body 的 [[ ]] 標記解析），
  // 跟 src/lib/ai/lessonPackageSchema.ts 的 Zod schema 型別保持一致
  answer?: string | string[];
  explanation?: string;
  listeningText?: string; // 聽力題要念的口語化文字
  audioUrl?: string; // 聽力題已生成的音檔 URL
  audioDurationSec?: number; // 聽力題音檔秒數（Live Mode 計時用）
  imageUrl?: string; // 題目圖片網址
  diagramSvg?: string; // AI 自動生成的圖解 SVG(mc/tf/fill 題型才可能有)
};

export type QuestionInsertRow = typeof questionSchema.$inferInsert;

// 題型對應：AI 短碼 → DB enum
export const DB_TYPE_MAP: Record<FileQuestionType, string> = {
  mc: 'single_choice',
  tf: 'true_false',
  fill: 'short_answer',
  short: 'short_answer',
  rank: 'ranking',
  listening: 'listening',
  cloze: 'cloze',
};

/**
 * 把 AI 產生的題目陣列轉成可直接 `db.insert(questionSchema).values(rows)` 的列陣列。
 * position 從 startPosition 開始，逐題遞增（呼叫端負責算好新測驗該從幾號開始接）。
 */
export function buildQuestionInsertRows(
  questions: GeneratedQuestion[],
  quizId: number,
  startPosition: number,
): QuestionInsertRow[] {
  let position = startPosition;

  return questions.map((q) => {
    let type = (DB_TYPE_MAP[q.type] ?? 'short_answer') as QuestionInsertRow['type'];
    let options: { id: string; text: string }[] | null = null;
    let correctAnswers: string[] = [];

    if (q.type === 'cloze') {
      // 克漏字題：body 直接是 AI 回傳含 [[詞彙]] 標記的文章，答案從標記反推
      correctAnswers = extractClozeAnswers(q.question);
      // 防呆：AI 沒標記任何空格就退回簡答題，避免建出空白克漏字題
      if (correctAnswers.length === 0) {
        type = 'short_answer' as QuestionInsertRow['type'];
      }
    } else if ((q.type === 'mc' || q.type === 'listening') && q.options?.length) {
      // 選擇題：將 string[] 轉成 { id, text }[]
      options = q.options.map((text, i) => ({
        id: String.fromCharCode(97 + i), // a, b, c, d
        text: stripOptionLabel(text),
      }));
      // answer 可能是 "A"/"B" 大寫字母，或選項文字本身
      const ansStr = typeof q.answer === 'string' ? q.answer : '';
      const answerKey = ansStr.trim().toLowerCase();
      const byLetter = options.find(o => o.id === answerKey);
      const byText = options.find(o => o.text === stripOptionLabel(ansStr));
      const matched = byLetter ?? byText;
      correctAnswers = matched ? [matched.id] : [];
    } else if (q.type === 'rank' && q.options?.length) {
      // 排序題：每個選項配 id，correctAnswers 為依 q.answer 文字順序對映的 id 陣列
      options = q.options.map((text, i) => ({
        id: String.fromCharCode(97 + i),
        text: stripOptionLabel(text),
      }));
      const answerArr = Array.isArray(q.answer) ? q.answer : [];
      correctAnswers = answerArr
        .map(ansText => options!.find(o => o.text === stripOptionLabel(ansText))?.id)
        .filter((id): id is string => Boolean(id));
      // AI 幻覺保險：若對映失敗，回退到輸入順序當正解
      if (correctAnswers.length !== options.length) {
        correctAnswers = options.map(o => o.id);
      }
    } else if (q.type === 'tf') {
      // 是非題：將 AI 回傳的 ○/✕ 轉換為標準選項 ID
      options = [
        { id: 'tf-true', text: '正確' },
        { id: 'tf-false', text: '錯誤' },
      ];
      const ansStr = typeof q.answer === 'string' ? q.answer.trim() : '';
      const isTrue = ansStr === '○' || ansStr === 'O' || ansStr.toLowerCase() === 'true' || ansStr === '正確';
      correctAnswers = [isTrue ? 'tf-true' : 'tf-false'];
    } else {
      // 填空 / 簡答：直接存 answer 字串
      const ansStr = typeof q.answer === 'string' ? q.answer : '';
      correctAnswers = ansStr ? [ansStr] : [];
    }

    return {
      quizId,
      type,
      body: q.question,
      imageUrl: q.imageUrl || null,
      diagramSvg: sanitizeStoredDiagramSvg(q.diagramSvg),
      options,
      correctAnswers: correctAnswers.length ? correctAnswers : null,
      audioUrl: q.audioUrl || null,
      audioDurationSec: q.audioDurationSec ?? null,
      audioTranscript: q.listeningText || null,
      explanation: q.explanation || null,
      points: 1,
      position: position++,
    };
  });
}
