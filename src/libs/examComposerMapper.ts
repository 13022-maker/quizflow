// src/libs/examComposerMapper.ts
// 將 QuizFlow 測驗題目（DB 格式）轉成「段考命題助手」（public/tools/exam-composer.html）的草稿 state。
//
// 兩邊同源，QuizEditor 把結果寫進 localStorage 的 EXAM_COMPOSER_IMPORT_KEY，
// 再開新分頁到 EXAM_COMPOSER_URL；工具載入時讀取並清掉這個 key。
// state 結構必須與 exam-composer.html 內 sampleState() 的 v:1 格式一致。

import { stripOptionLabel } from '@/lib/ai/optionText';
import { extractClozeAnswers, stripClozeMarkers } from '@/lib/cloze';

export const EXAM_COMPOSER_URL = '/tools/exam-composer.html';
export const EXAM_COMPOSER_IMPORT_KEY = 'quizflow-exam-composer-import';

// 只取轉換需要的欄位，方便測試、也避免把整筆 DB row 塞進 localStorage
export type ComposerSourceQuestion = {
  type: string;
  body: string;
  options: { id: string; text: string }[] | null;
  correctAnswers: string[] | null;
  referenceAnswer: string | null;
  points: number;
  imageUrl: string | null;
};

type ComposerType = 'mc' | 'tf' | 'fill' | 'essay';

export type ComposerQuestion = {
  id: string;
  type: ComposerType;
  unit: string;
  bloom: string;
  score: number;
  stem: string;
  options: string[];
  answer: number | string | null;
};

export type ComposerState = {
  v: 1;
  isSample: false;
  nextQ: number;
  nextU: number;
  meta: Record<string, string | number>;
  units: { id: string; name: string; periods: number }[];
  qs: ComposerQuestion[];
  threshold: number;
};

export type ComposerImport = {
  quizTitle: string;
  state: ComposerState;
  notes: {
    skippedRanking: number; // 排序題：段考助手不支援，略過
    multiToSingle: number; // 多選題有多個正解：轉單選後需老師重選答案
    withImage: number; // 原題有圖片：助手不顯示圖片
  };
};

const TRUE_TEXT = /^(?:正確|[對是O○]|true)$/i;
const BLANK = '____';
const UNIT_ID = 'u1';

function correctIndices(q: ComposerSourceQuestion): number[] {
  const ids = (q.options ?? []).map(o => o.id);
  return (q.correctAnswers ?? []).map(id => ids.indexOf(id)).filter(i => i >= 0);
}

function trueFalseAnswer(q: ComposerSourceQuestion): 'O' | 'X' | null {
  const ans = q.correctAnswers?.[0];
  if (!ans) {
    return null;
  }
  if (ans === 'tf-true') {
    return 'O';
  }
  if (ans === 'tf-false') {
    return 'X';
  }
  const text = q.options?.find(o => o.id === ans)?.text.trim() ?? ans;
  return TRUE_TEXT.test(text) ? 'O' : 'X';
}

export function quizToComposerImport(
  quizTitle: string,
  questions: ComposerSourceQuestion[],
): ComposerImport {
  const notes = { skippedRanking: 0, multiToSingle: 0, withImage: 0 };
  const qs: ComposerQuestion[] = [];

  for (const q of questions) {
    if (q.type === 'ranking') {
      notes.skippedRanking++;
      continue;
    }
    if (q.imageUrl) {
      notes.withImage++;
    }
    const base = {
      id: `q${qs.length + 1}`,
      unit: UNIT_ID,
      bloom: '記憶',
      score: q.points,
      options: ['', '', '', ''],
    };

    if (q.type === 'true_false') {
      qs.push({ ...base, type: 'tf', stem: q.body, answer: trueFalseAnswer(q) });
    } else if (q.type === 'short_answer') {
      qs.push({ ...base, type: 'essay', stem: q.body, answer: q.referenceAnswer ?? q.correctAnswers?.[0] ?? '' });
    } else if (q.type === 'cloze') {
      qs.push({
        ...base,
        type: 'fill',
        stem: stripClozeMarkers(q.body, BLANK),
        answer: extractClozeAnswers(q.body).join('；'),
      });
    } else {
      // single_choice / multiple_choice / listening（聽力題的選項部分）
      const idx = correctIndices(q);
      if (idx.length > 1) {
        notes.multiToSingle++;
      }
      const opts = (q.options ?? []).slice(0, 5).map(o => stripOptionLabel(o.text));
      while (opts.length < 4) {
        opts.push('');
      }
      qs.push({ ...base, type: 'mc', stem: q.body, options: opts, answer: idx.length === 1 ? idx[0]! : null });
    }
  }

  return {
    quizTitle,
    notes,
    state: {
      v: 1,
      isSample: false,
      nextQ: qs.length + 1,
      nextU: 2,
      meta: { school: '', term: '', exam: quizTitle, subject: '', grade: '', minutes: 45, teacher: '', range: '' },
      units: [{ id: UNIT_ID, name: quizTitle || '未分類', periods: 1 }],
      qs,
      threshold: 5,
    },
  };
}
