/**
 * 練習頁成績的唯讀結果頁：學生「繳交到 Google Classroom」時附加的就是這個網址。
 *
 * GET /api/p/[id]/r/[token]   （[id] = practice_page_share.id、[token] = practice_page_submission.result_token）
 *
 * 公開、免登入（middleware.ts isPublicApiRoute 的 '/api/p/(.*)' 已涵蓋）——老師在 Classroom 點開
 * 不用登入 QuizFlow 也能看。token 是 24 bytes 亂數（不可猜），只回傳這一筆成績：
 * 題目名稱、班級姓名、分數、送出時間、逐題對錯，不含其他學生資料，也不含題目正解。
 * 頁面不含任何 script，並用 CSP 禁止執行 script、noindex 避免被搜尋引擎收錄。
 */
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { buildSubmissionResultHtml, isValidResultToken, type SubmissionDetail } from '@/lib/practicePageSubmission';
import { db } from '@/libs/DB';
import { practicePageShareSchema, practicePageSubmissionSchema, quizSchema } from '@/models/Schema';

export const runtime = 'nodejs';

const HTML_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  // 個人成績：不讓 CDN / 共用快取存
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': 'default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'; frame-ancestors \'none\'',
};

function notFoundPage() {
  return new NextResponse('找不到這份作答結果，連結可能有誤或已失效', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string; token: string } },
) {
  const shareId = Number(params.id);
  if (!Number.isInteger(shareId) || shareId <= 0 || !isValidResultToken(params.token)) {
    return notFoundPage();
  }

  const [row] = await db
    .select({
      className: practicePageSubmissionSchema.className,
      studentName: practicePageSubmissionSchema.studentName,
      score: practicePageSubmissionSchema.score,
      maxScore: practicePageSubmissionSchema.maxScore,
      detail: practicePageSubmissionSchema.detail,
      createdAt: practicePageSubmissionSchema.createdAt,
      quizTitle: quizSchema.title,
    })
    .from(practicePageSubmissionSchema)
    .innerJoin(practicePageShareSchema, eq(practicePageShareSchema.id, practicePageSubmissionSchema.shareId))
    .innerJoin(quizSchema, eq(quizSchema.id, practicePageShareSchema.quizId))
    .where(and(
      eq(practicePageSubmissionSchema.resultToken, params.token),
      eq(practicePageSubmissionSchema.shareId, shareId),
    ))
    .limit(1);

  if (!row) {
    return notFoundPage();
  }

  const html = buildSubmissionResultHtml({
    quizTitle: row.quizTitle,
    className: row.className,
    studentName: row.studentName,
    score: row.score,
    maxScore: row.maxScore,
    createdAt: row.createdAt,
    // detail 是送出 API 自己算好寫入的（scorePracticePageSubmission 的輸出），不是 client 原始輸入
    detail: row.detail as unknown as SubmissionDetail,
  });

  return new NextResponse(html, { status: 200, headers: HTML_HEADERS });
}
