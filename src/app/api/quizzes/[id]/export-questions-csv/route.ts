/**
 * 匯出題目為 CSV（一列一題）
 *
 * GET /api/quizzes/[id]/export-questions-csv
 * 欄位：科目, 題幹, A, B, C, D, 正解
 *
 * 只支援單選題/多選題/是非題（有固定選項的題型）；簡答/排序/聽力/克漏字不適合這個欄位結構，略過不輸出。
 * 驗證：必須是該 quiz 的 owner（userId 比對）
 */

import { auth } from '@clerk/nextjs/server';
import { and, asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { stripClozeMarkers } from '@/lib/cloze';
import { db } from '@/libs/DB';
import { questionSchema, quizSchema } from '@/models/Schema';

export const runtime = 'nodejs';

const CSV_SUPPORTED_TYPES = new Set(['single_choice', 'multiple_choice', 'true_false']);
const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: '未登入' }, { status: 401 });
  }

  const quizId = Number(params.id);
  if (Number.isNaN(quizId)) {
    return NextResponse.json({ error: '無效的測驗 ID' }, { status: 400 });
  }

  const [quiz] = await db
    .select({ id: quizSchema.id, title: quizSchema.title, category: quizSchema.category })
    .from(quizSchema)
    .where(and(eq(quizSchema.id, quizId), eq(quizSchema.ownerId, userId)))
    .limit(1);

  if (!quiz) {
    return NextResponse.json({ error: '找不到測驗或無權限' }, { status: 404 });
  }

  const questions = await db
    .select()
    .from(questionSchema)
    .where(eq(questionSchema.quizId, quizId))
    .orderBy(asc(questionSchema.position));

  const exportable = questions.filter(q => CSV_SUPPORTED_TYPES.has(q.type) && q.options);
  if (exportable.length === 0) {
    return NextResponse.json({ error: '此測驗沒有可匯出成 CSV 的題目（只支援單選/多選/是非題）' }, { status: 400 });
  }

  const header = ['科目', '題幹', 'A', 'B', 'C', 'D', '正解'];
  const rows = exportable.map((q) => {
    const options = q.options ?? [];
    const optionTexts = OPTION_LETTERS.map((_, i) => options[i]?.text ?? '');
    const correctLetters = (q.correctAnswers ?? [])
      .map(id => options.findIndex(opt => opt.id === id))
      .filter(i => i >= 0)
      .map(i => OPTION_LETTERS[i])
      .join(',');
    return [quiz.category ?? '', stripClozeMarkers(q.body), ...optionTexts, correctLetters];
  });

  const csvContent = [header, ...rows]
    .map(row => row.map(cell => csvCell(String(cell))).join(','))
    .join('\n');

  const bom = '﻿';
  const safeTitle = quiz.title.replace(/[^a-z0-9\u4E00-\u9FFF]/gi, '_');
  const filename = `${safeTitle}_題目.csv`;

  return new Response(bom + csvContent, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
