/**
 * 將測驗匯出為 Word（.docx）
 *
 * 兩種版本：
 * - teacher：含答案 + 配分（老師自己存檔）
 * - student：只有題目（可印發給學生）
 *
 * 目前限制：
 * - 圖片題僅顯示「此題含圖片，請線上查看」文字提示（未嵌入圖片）
 * - 排序題依題型顯示
 */

import type { Buffer } from 'node:buffer';

import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import type { InferSelectModel } from 'drizzle-orm';

import type { questionSchema, quizSchema } from '@/models/Schema';

type Quiz = InferSelectModel<typeof quizSchema>;
type Question = InferSelectModel<typeof questionSchema>;

export type ExportVariant = 'teacher' | 'student';

// 是非題若 DB 中 options 為 null 的預設
const TF_DEFAULTS = [
  { id: 'tf-true', text: '正確' },
  { id: 'tf-false', text: '錯誤' },
];

// 將 option id 陣列翻成顯示文字
function answerToText(question: Question, ids: string[] | null): string {
  if (!ids || ids.length === 0) {
    return '—';
  }
  const options = question.type === 'true_false' && (!question.options || question.options.length === 0)
    ? TF_DEFAULTS
    : (question.options ?? []);
  const sep = question.type === 'ranking' ? ' → ' : '、';
  return ids.map(id => options.find(o => o.id === id)?.text ?? id).join(sep);
}

// 單一題目轉 paragraphs
function questionToParagraphs(question: Question, index: number, variant: ExportVariant): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  // 題目本文（含分數）
  const pointsText = variant === 'teacher' ? `（${question.points} 分）` : '';
  paragraphs.push(
    new Paragraph({
      spacing: { before: 240, after: 120 },
      children: [
        new TextRun({ text: `${index + 1}. `, bold: true }),
        new TextRun({ text: question.body }),
        ...(pointsText ? [new TextRun({ text: pointsText, color: '666666', size: 20 })] : []),
      ],
    }),
  );

  // 圖片提示（不嵌入實際圖片）
  if (question.imageUrl) {
    paragraphs.push(
      new Paragraph({
        spacing: { before: 60, after: 60 },
        children: [
          new TextRun({ text: '[ 此題含圖片，請至線上版本查看 ]', italics: true, color: '888888', size: 20 }),
        ],
      }),
    );
  }

  // 選項（單選 / 多選 / 是非 / 排序）
  const options = question.type === 'true_false' && (!question.options || question.options.length === 0)
    ? TF_DEFAULTS
    : (question.options ?? []);

  if (['single_choice', 'multiple_choice', 'true_false', 'ranking'].includes(question.type) && options.length > 0) {
    options.forEach((opt, i) => {
      const letter = String.fromCharCode(65 + i); // A, B, C, D
      paragraphs.push(
        new Paragraph({
          spacing: { before: 40, after: 40 },
          indent: { left: 400 },
          children: [
            new TextRun({ text: `(${letter}) ${opt.text}` }),
          ],
        }),
      );
    });
  }

  // 簡答題 / 填空題：留答題線
  if (variant === 'student' && question.type === 'short_answer') {
    paragraphs.push(
      new Paragraph({
        spacing: { before: 100, after: 100 },
        children: [new TextRun({ text: '答：____________________________________________' })],
      }),
    );
  }

  // 老師版：答案 + 排序題正確順序說明
  if (variant === 'teacher') {
    if (question.type === 'ranking') {
      paragraphs.push(
        new Paragraph({
          spacing: { before: 80 },
          children: [
            new TextRun({ text: '正確順序：', bold: true, color: '047857' }),
            new TextRun({ text: answerToText(question, question.correctAnswers), color: '047857' }),
          ],
        }),
      );
    } else if (question.type === 'short_answer') {
      const refAnswer = question.correctAnswers?.[0] ?? '（無參考答案）';
      paragraphs.push(
        new Paragraph({
          spacing: { before: 80 },
          children: [
            new TextRun({ text: '參考答案：', bold: true, color: '047857' }),
            new TextRun({ text: refAnswer, color: '047857' }),
          ],
        }),
      );
    } else if (question.correctAnswers && question.correctAnswers.length > 0) {
      paragraphs.push(
        new Paragraph({
          spacing: { before: 80 },
          children: [
            new TextRun({ text: '答案：', bold: true, color: '047857' }),
            new TextRun({ text: answerToText(question, question.correctAnswers), color: '047857' }),
          ],
        }),
      );
    }
  }

  return paragraphs;
}

export async function generateQuizDocx(
  quiz: Quiz,
  questions: Question[],
  variant: ExportVariant,
): Promise<Buffer> {
  const children: Paragraph[] = [];

  // 標題
  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({ text: quiz.title, bold: true, size: 40 })],
    }),
  );

  // 副標（版本 + 描述）
  const subtitle = variant === 'teacher' ? '【老師版 — 含答案】' : '【作答卷】';
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({ text: subtitle, color: '666666', size: 22 })],
    }),
  );

  // 學生版：姓名 / 班級 / 座號 / 分數欄
  if (variant === 'student') {
    children.push(
      new Paragraph({
        spacing: { before: 120, after: 240 },
        children: [
          new TextRun({ text: '姓名：____________   班級：______   座號：______   分數：______', size: 22 }),
        ],
      }),
    );
  }

  // 描述
  if (quiz.description) {
    children.push(
      new Paragraph({
        spacing: { after: 200 },
        children: [new TextRun({ text: quiz.description, color: '444444', size: 22 })],
      }),
    );
  }

  // 滿分（老師版）
  if (variant === 'teacher') {
    const totalPoints = questions.reduce((sum, q) => sum + q.points, 0);
    children.push(
      new Paragraph({
        spacing: { after: 160 },
        children: [
          new TextRun({ text: `共 ${questions.length} 題，總分 ${totalPoints} 分`, color: '666666', size: 22 }),
        ],
      }),
    );
  }

  // 逐題
  questions.forEach((q, i) => {
    children.push(...questionToParagraphs(q, i, variant));
  });

  const doc = new Document({
    creator: 'QuizFlow',
    title: quiz.title,
    styles: {
      default: {
        document: {
          run: { font: 'PMingLiU', size: 24 }, // 預設 12pt 新細明體（相容 Word）
        },
      },
    },
    sections: [{ properties: {}, children }],
  });

  return await Packer.toBuffer(doc);
}
