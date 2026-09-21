// 涵蓋 mc/tf/short/fill/rank/cloze/listening 七種 type 的轉換規則
// 對齊既有 src/app/api/quizzes/[id]/questions/route.ts:98-169 的行為，抽出後不能變
import { describe, expect, it } from 'vitest';

import { buildQuestionInsertRows, type GeneratedQuestion } from './questionRows';

describe('buildQuestionInsertRows', () => {
  it('mc：answer 用字母時，依 options 順序比對出正確 id', () => {
    const rows = buildQuestionInsertRows(
      [{ type: 'mc', question: '光合作用發生在哪？', options: ['葉綠體', '粒線體', '細胞核', '液泡'], answer: 'B' }],
      1,
      1,
    );

    expect(rows[0]!.options).toEqual([
      { id: 'a', text: '葉綠體' },
      { id: 'b', text: '粒線體' },
      { id: 'c', text: '細胞核' },
      { id: 'd', text: '液泡' },
    ]);
    expect(rows[0]!.correctAnswers).toEqual(['b']);
    expect(rows[0]!.type).toBe('single_choice');
  });

  it('mc：answer 用選項文字本身時也能比對到（無字母 fallback 走文字比對）', () => {
    const rows = buildQuestionInsertRows(
      [{ type: 'mc', question: 'Q', options: ['甲', '乙', '丙', '丁'], answer: '丙' }],
      1,
      1,
    );

    expect(rows[0]!.correctAnswers).toEqual(['c']);
  });

  it('mc：options 文字帶「(A)」前綴會被去除', () => {
    const rows = buildQuestionInsertRows(
      [{ type: 'mc', question: 'Q', options: ['(A)甲', '(B)乙'], answer: 'A' }],
      1,
      1,
    );

    expect(rows[0]!.options).toEqual([
      { id: 'a', text: '甲' },
      { id: 'b', text: '乙' },
    ]);
  });

  it('tf：answer 為「正確」時，options 固定為 tf-true/tf-false，correctAnswers 為 tf-true', () => {
    const rows = buildQuestionInsertRows(
      [{ type: 'tf', question: 'Q', answer: '正確' }],
      1,
      1,
    );

    expect(rows[0]!.options).toEqual([
      { id: 'tf-true', text: '正確' },
      { id: 'tf-false', text: '錯誤' },
    ]);
    expect(rows[0]!.correctAnswers).toEqual(['tf-true']);
    expect(rows[0]!.type).toBe('true_false');
  });

  it('tf：answer 不是任何一種「真」的表示法時，視為 false', () => {
    const rows = buildQuestionInsertRows(
      [{ type: 'tf', question: 'Q', answer: '錯誤' }],
      1,
      1,
    );

    expect(rows[0]!.correctAnswers).toEqual(['tf-false']);
  });

  it('short：answer 字串直接存進 correctAnswers 單一元素陣列', () => {
    const rows = buildQuestionInsertRows(
      [{ type: 'short', question: 'Q', answer: '光合作用' }],
      1,
      1,
    );

    expect(rows[0]!.correctAnswers).toEqual(['光合作用']);
    expect(rows[0]!.type).toBe('short_answer');
    expect(rows[0]!.options).toBeNull();
  });

  it('rank：answer 文字順序對應出 correctAnswers 的 id 順序（與 options 呈現順序可以不同）', () => {
    const rows = buildQuestionInsertRows(
      [{
        type: 'rank',
        question: 'Q',
        options: ['文藝復興', '工業革命', '二次大戰'],
        answer: ['工業革命', '文藝復興', '二次大戰'],
      }],
      1,
      1,
    );

    expect(rows[0]!.options).toEqual([
      { id: 'a', text: '文藝復興' },
      { id: 'b', text: '工業革命' },
      { id: 'c', text: '二次大戰' },
    ]);
    expect(rows[0]!.correctAnswers).toEqual(['b', 'a', 'c']);
  });

  it('rank：answer 對映失敗（長度不符）時 fallback 回 options 原順序', () => {
    const rows = buildQuestionInsertRows(
      [{
        type: 'rank',
        question: 'Q',
        options: ['甲', '乙', '丙'],
        answer: ['甲', '不存在的選項'],
      }],
      1,
      1,
    );

    expect(rows[0]!.correctAnswers).toEqual(['a', 'b', 'c']);
  });

  it('cloze：correctAnswers 從 [[ ]] 標記依序解析，不看 answer 欄位', () => {
    const rows = buildQuestionInsertRows(
      [{ type: 'cloze', question: '光合作用需要[[陽光]]和[[水]]。', answer: '忽略這個值' }],
      1,
      1,
    );

    expect(rows[0]!.correctAnswers).toEqual(['陽光', '水']);
    expect(rows[0]!.type).toBe('cloze');
    expect(rows[0]!.body).toBe('光合作用需要[[陽光]]和[[水]]。');
  });

  it('cloze：完全沒有 [[ ]] 標記時退回 short_answer，避免建出空白克漏字題', () => {
    const rows = buildQuestionInsertRows(
      [{ type: 'cloze', question: '這句話沒有標記', answer: 'x' }],
      1,
      1,
    );

    expect(rows[0]!.type).toBe('short_answer');
    expect(rows[0]!.correctAnswers).toBeNull();
  });

  it('listening：跟 mc 一樣做選項比對，並存入 audioUrl/audioDurationSec/audioTranscript', () => {
    const rows = buildQuestionInsertRows(
      [{
        type: 'listening',
        question: 'Q',
        options: ['甲', '乙'],
        answer: 'A',
        audioUrl: 'https://blob.example/a.mp3',
        audioDurationSec: 12,
        listeningText: '小明說了什麼',
      }],
      1,
      1,
    );

    expect(rows[0]!.type).toBe('listening');
    expect(rows[0]!.correctAnswers).toEqual(['a']);
    expect(rows[0]!.audioUrl).toBe('https://blob.example/a.mp3');
    expect(rows[0]!.audioDurationSec).toBe(12);
    expect(rows[0]!.audioTranscript).toBe('小明說了什麼');
  });

  it('position 從 startPosition 開始逐題遞增，quizId 帶入每一列', () => {
    const questions: GeneratedQuestion[] = [
      { type: 'short', question: 'Q1', answer: 'A1' },
      { type: 'short', question: 'Q2', answer: 'A2' },
      { type: 'short', question: 'Q3', answer: 'A3' },
    ];
    const rows = buildQuestionInsertRows(questions, 42, 5);

    expect(rows.map(r => r.position)).toEqual([5, 6, 7]);
    expect(rows.every(r => r.quizId === 42)).toBe(true);
  });

  it('每題預設 points = 1', () => {
    const rows = buildQuestionInsertRows(
      [{ type: 'short', question: 'Q', answer: 'A' }],
      1,
      1,
    );

    expect(rows[0]!.points).toBe(1);
  });
});
