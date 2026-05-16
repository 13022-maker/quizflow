import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/libs/DB';
import { answerSchema, questionSchema, quizSchema, responseSchema } from '@/models/Schema';

export const runtime = 'nodejs';

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
    .select({ id: quizSchema.id, title: quizSchema.title })
    .from(quizSchema)
    .where(and(eq(quizSchema.id, quizId), eq(quizSchema.ownerId, userId)))
    .limit(1);

  if (!quiz) {
    return NextResponse.json({ error: '找不到測驗或無權限' }, { status: 404 });
  }

  const responses = await db
    .select()
    .from(responseSchema)
    .where(eq(responseSchema.quizId, quizId))
    .orderBy(responseSchema.submittedAt);

  // 簡答題：拉出來給每題加 2 欄（學生答案 / AI 評語）+ 申訴狀態欄
  const shortAnswerQuestions = await db
    .select({ id: questionSchema.id, body: questionSchema.body, position: questionSchema.position })
    .from(questionSchema)
    .where(and(eq(questionSchema.quizId, quizId), eq(questionSchema.type, 'short_answer')))
    .orderBy(questionSchema.position);

  // 該測驗所有簡答題的 answer（含 gradingMeta、申訴）一次撈
  const shortAnswerRows = shortAnswerQuestions.length > 0 && responses.length > 0
    ? await db
      .select({
        responseId: answerSchema.responseId,
        questionId: answerSchema.questionId,
        answer: answerSchema.answer,
        isCorrect: answerSchema.isCorrect,
        gradingMeta: answerSchema.gradingMeta,
        appealStatus: answerSchema.appealStatus,
        appealReason: answerSchema.appealReason,
      })
      .from(answerSchema)
      .innerJoin(responseSchema, eq(answerSchema.responseId, responseSchema.id))
      .where(eq(responseSchema.quizId, quizId))
    : [];

  // 索引：(responseId, questionId) → row
  const saIndex = new Map<string, typeof shortAnswerRows[number]>();
  for (const r of shortAnswerRows) {
    saIndex.set(`${r.responseId}:${r.questionId}`, r);
  }

  // 表頭：基礎 6 欄 + 每題簡答題 2 欄（答案 / AI 評語）+ 申訴狀態（若有簡答題才加）
  const baseHeader = ['姓名', 'Email', '答對題數', '答對率', '離開次數', '作答時間'];
  const shortHeaders: string[] = [];
  for (const q of shortAnswerQuestions) {
    const shortBody = q.body.length > 20 ? `${q.body.slice(0, 20)}…` : q.body;
    shortHeaders.push(`Q${q.position} 答案：${shortBody}`, `Q${q.position} AI 評語`);
  }
  const hasShortAnswer = shortAnswerQuestions.length > 0;
  const appealHeader = hasShortAnswer ? ['申訴狀態'] : [];
  const header = [...baseHeader, ...shortHeaders, ...appealHeader];

  // 格式化 gradingMeta 成可讀文字
  const formatAiCell = (meta: typeof shortAnswerRows[number]['gradingMeta'], appealStatus: string | null): string => {
    if (!meta) {
      return '';
    }
    const verdict = meta.gradedBy === 'teacher'
      ? '老師：'
      : meta.gradedBy === 'teacher_confirmed'
        ? 'AI（老師認可）：'
        : 'AI：';
    const score = `${meta.aiScore} 分`;
    const conf = meta.gradedBy === 'ai' ? `（信心 ${Math.round((meta.confidence ?? 0) * 100)}%）` : '';
    const reason = meta.reason ? ` ${meta.reason}` : '';
    const appeal = appealStatus === 'pending' ? '【申訴中】' : '';
    return `${appeal}${verdict}${score}${conf}${reason}`.trim();
  };

  const rows = responses.map((r) => {
    const rate = r.score !== null && r.totalPoints !== null && r.totalPoints > 0
      ? `${Math.round((r.score / r.totalPoints) * 100)}%`
      : '—';
    const base = [
      r.studentName ?? '',
      r.studentEmail ?? '',
      r.score !== null && r.totalPoints !== null ? `${r.score}/${r.totalPoints}` : '—',
      rate,
      String(r.leaveCount),
      r.submittedAt.toLocaleString('zh-TW'),
    ];
    const shortCells: string[] = [];
    let anyPendingAppeal = false;
    for (const q of shortAnswerQuestions) {
      const sa = saIndex.get(`${r.id}:${q.id}`);
      const studentText = typeof sa?.answer === 'string' ? sa.answer : '';
      const aiText = formatAiCell(sa?.gradingMeta ?? null, sa?.appealStatus ?? null);
      shortCells.push(studentText, aiText);
      if (sa?.appealStatus === 'pending') {
        anyPendingAppeal = true;
      }
    }
    const appealCell = hasShortAnswer ? [anyPendingAppeal ? '⚠️ 有申訴' : ''] : [];
    return [...base, ...shortCells, ...appealCell];
  });

  const csvContent = [header, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const bom = '﻿';
  const safeTitle = quiz.title.replace(/[^a-z0-9一-鿿]/gi, '_');
  const filename = `${safeTitle}_成績.csv`;

  return new Response(bom + csvContent, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
