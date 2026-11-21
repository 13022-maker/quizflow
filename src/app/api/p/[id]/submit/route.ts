/**
 * 練習頁線上分享版「確認送出」成績回傳端點。
 *
 * POST /api/p/[id]/submit   （[id] = practice_page_share.id）
 *   body: { sessionId, className, studentName, answers }（練習頁以 text/plain 送出，這裡讀 text 自己 parse）
 *   回傳: { ok, score, maxScore, resultUrl, classroomShareUrl }
 *
 * 公開、免登入（middleware.ts isPublicApiRoute 的 '/api/p/(.*)' 已涵蓋），route 內不呼叫 auth()。
 * 全部當不可信輸入：
 *   1. in-memory 限流（key = 雜湊過的 IP，不落地）；同一間教室常共用一個對外 IP，上限抓寬
 *   2. body 大小上限 + Zod 驗證 + 字串截斷（見 lib/practicePageSubmission.ts）
 *   3. 分數一律由 server 依 practice_page_share.answer_key 重算，不收 client 分數
 *      （填空題「看答案次數」只能採 client 回報，見 lib/practicePageSubmission.ts 開頭說明）
 *   4. 同一份練習頁同一個 session 只收一筆（DB unique）；重送直接回傳第一次的結果（網路重試冪等）
 *   5. 每份練習頁最多 MAX_SUBMISSIONS_PER_SHARE 筆，防止被灌爆
 * 不儲存 IP、User-Agent、cookie；班級/姓名是學生自填，不驗證身分。
 */
import { createHash } from 'node:crypto';

import { and, count, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { createFixedWindowLimiter } from '@/lib/practicePageRateLimit';
import {
  buildClassroomShareUrl,
  generateResultToken,
  MAX_SUBMISSION_BODY_BYTES,
  parsePracticePageAnswerKey,
  parsePracticePageSubmission,
  scorePracticePageSubmission,
} from '@/lib/practicePageSubmission';
import { db } from '@/libs/DB';
import { practicePageShareSchema, practicePageSubmissionSchema, quizSchema } from '@/models/Schema';

export const runtime = 'nodejs';

// 一個來源每分鐘最多 60 次送出：一個班 30–40 人共用學校 IP 同時按送出也夠用
const limiter = createFixedWindowLimiter({ limit: 60, windowMs: 60_000 });
const MAX_SUBMISSIONS_PER_SHARE = 2000;

function clientKey(req: Request): string {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
  // 只拿雜湊值當限流 key，原始 IP 不保存
  return createHash('sha256').update(`submit:${ip}`).digest('hex').slice(0, 32);
}

type SubmissionRow = {
  score: number;
  maxScore: number;
  resultToken: string;
  className: string;
  studentName: string;
};

function successResponse(origin: string, shareId: number, quizTitle: string, row: SubmissionRow) {
  const resultUrl = `${origin}/api/p/${shareId}/r/${row.resultToken}`;
  return NextResponse.json({
    ok: true,
    score: row.score,
    maxScore: row.maxScore,
    resultUrl,
    classroomShareUrl: buildClassroomShareUrl({
      url: resultUrl,
      title: `${quizTitle} 作答結果－${row.className} ${row.studentName}`,
    }),
  });
}

const submissionReturning = {
  score: practicePageSubmissionSchema.score,
  maxScore: practicePageSubmissionSchema.maxScore,
  resultToken: practicePageSubmissionSchema.resultToken,
  className: practicePageSubmissionSchema.className,
  studentName: practicePageSubmissionSchema.studentName,
};

async function findExisting(shareId: number, sessionId: string): Promise<SubmissionRow | undefined> {
  const [row] = await db
    .select(submissionReturning)
    .from(practicePageSubmissionSchema)
    .where(and(eq(practicePageSubmissionSchema.shareId, shareId), eq(practicePageSubmissionSchema.sessionId, sessionId)))
    .limit(1);
  return row;
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const shareId = Number(params.id);
  if (!Number.isInteger(shareId) || shareId <= 0) {
    return NextResponse.json({ ok: false, error: '找不到這份練習頁' }, { status: 404 });
  }

  if (!limiter.hit(clientKey(req))) {
    return NextResponse.json({ ok: false, error: '送出太頻繁，請稍等一分鐘再試' }, { status: 429 });
  }

  const declaredLength = Number(req.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_SUBMISSION_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: '送出內容過大' }, { status: 413 });
  }

  const parsed = parsePracticePageSubmission(await req.text());
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }
  const { submission } = parsed;
  const origin = new URL(req.url).origin;

  try {
    const [share] = await db
      .select({
        id: practicePageShareSchema.id,
        answerKey: practicePageShareSchema.answerKey,
        quizTitle: quizSchema.title,
      })
      .from(practicePageShareSchema)
      .innerJoin(quizSchema, eq(quizSchema.id, practicePageShareSchema.quizId))
      .where(eq(practicePageShareSchema.id, shareId))
      .limit(1);
    if (!share) {
      return NextResponse.json({ ok: false, error: '找不到這份練習頁，連結可能已失效' }, { status: 404 });
    }

    const answerKey = parsePracticePageAnswerKey(share.answerKey);
    if (!answerKey) {
      // 加送出功能前產生的舊連結沒有答案表，無法由 server 計分
      return NextResponse.json(
        { ok: false, error: '這份練習頁是舊版連結，無法送出成績，請通知老師重新產生分享連結' },
        { status: 409 },
      );
    }

    // 同一次作答重送（例如網路逾時後再按一次）→ 回傳第一次的結果，不重複寫入
    const existing = await findExisting(shareId, submission.sessionId);
    if (existing) {
      return successResponse(origin, shareId, share.quizTitle, existing);
    }

    const [submissionCount] = await db
      .select({ n: count() })
      .from(practicePageSubmissionSchema)
      .where(eq(practicePageSubmissionSchema.shareId, shareId));
    if ((submissionCount?.n ?? 0) >= MAX_SUBMISSIONS_PER_SHARE) {
      return NextResponse.json({ ok: false, error: '這份練習頁的送出人數已達上限，請通知老師' }, { status: 429 });
    }

    const scored = scorePracticePageSubmission(answerKey, submission.answers);
    if (!scored.ok) {
      return NextResponse.json({ ok: false, error: scored.error }, { status: 409 });
    }

    const [inserted] = await db
      .insert(practicePageSubmissionSchema)
      .values({
        shareId,
        sessionId: submission.sessionId,
        className: submission.className,
        studentName: submission.studentName,
        score: scored.score,
        maxScore: scored.maxScore,
        detail: scored.detail,
        resultToken: generateResultToken(),
      })
      .onConflictDoNothing({ target: [practicePageSubmissionSchema.shareId, practicePageSubmissionSchema.sessionId] })
      .returning();

    // 併發重送時另一筆先寫進去了 → 回傳那一筆
    const row = inserted ?? await findExisting(shareId, submission.sessionId);
    if (!row) {
      return NextResponse.json({ ok: false, error: '送出失敗，請稍後再試' }, { status: 500 });
    }
    return successResponse(origin, shareId, share.quizTitle, row);
  } catch (error) {
    console.error('[practice-page submit] 寫入失敗', error);
    return NextResponse.json({ ok: false, error: '送出失敗，請稍後再試' }, { status: 500 });
  }
}
